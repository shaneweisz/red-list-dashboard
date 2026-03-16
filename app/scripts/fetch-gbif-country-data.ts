/**
 * fetch-gbif-country-data: GBIF country occurrences per species
 *
 * For each species in the GBIF CSVs, determines which countries it occurs in
 * by querying the GBIF occurrence API and writes semicolon-separated ISO
 * country codes into the `countries` column of the per-taxon data/gbif/{taxonId}.csv.
 *
 * OPTIMIZED APPROACH: Queries at the kingdom level per country, then filters
 * results against the known species set from the GBIF CSVs. This reduces
 * API calls from ~660k (per-species) to ~1,000 (4 kingdoms × ~250 countries),
 * a ~700x improvement.
 *
 * Usage:
 *   npx tsx scripts/fetch-gbif-country-data.ts [taxon]           # One taxon, skip already-fetched
 *   npx tsx scripts/fetch-gbif-country-data.ts                   # All taxa, skip already-fetched
 *   npx tsx scripts/fetch-gbif-country-data.ts --refresh [taxon] # Re-fetch all species
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  GBIF_DIR,
  delay,
  mapConcurrent,
} from "./utils";
import { getTaxa } from "./taxa";
import {
  type GbifSpecies,
  readGbifCsv,
  writeGbifCsv,
} from "./fetch-gbif-species";

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_RETRIES = 5;
const CONCURRENCY = 20;
const FACET_LIMIT = 200000;

const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OCCURRENCE",
  "MATERIAL_SAMPLE",
  "OBSERVATION",
];

// GBIF kingdom keys covering all taxa in the dashboard
const KINGDOM_KEYS = [
  { key: 1, name: "Animalia" },
  { key: 6, name: "Plantae" },
  { key: 5, name: "Fungi" },
  { key: 4, name: "Chromista" },  // brown algae
];

// =============================================================================
// GBIF API HELPERS
// =============================================================================

/** Generic GBIF GET with retry + backoff. Returns parsed JSON or null. */
async function gbifGet(params: URLSearchParams): Promise<Record<string, any> | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < MAX_RETRIES) {
          await delay(Math.pow(2, attempt + 1) * 1000);
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt < MAX_RETRIES) {
        await delay(Math.pow(2, attempt + 1) * 1000);
        continue;
      }
      return null;
    }
  }
  return null;
}

/** Fetch the list of countries with occurrences for a given kingdom. */
async function fetchCountriesForKingdom(kingdomKey: number): Promise<string[]> {
  const params = new URLSearchParams({
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
    facet: "country",
    facetLimit: "300",
    limit: "0",
    kingdomKey: kingdomKey.toString(),
  });
  INCLUDED_BASIS_OF_RECORD.forEach((bor) => params.append("basisOfRecord", bor));

  const data = await gbifGet(params);
  if (!data) return [];

  const facet = data.facets?.find((f: { field: string }) => f.field === "COUNTRY");
  if (!facet) return [];
  return facet.counts.map((c: { name: string }) => c.name);
}

/**
 * For a given kingdom + country, fetch all speciesKeys with occurrences.
 * Handles pagination via facetOffset for large result sets (e.g., US Animalia has ~170k species).
 */
async function fetchSpeciesInKingdomCountry(
  kingdomKey: number,
  country: string,
): Promise<number[]> {
  const allSpeciesKeys: number[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
      facet: "speciesKey",
      facetLimit: FACET_LIMIT.toString(),
      facetOffset: offset.toString(),
      limit: "0",
      country,
      kingdomKey: kingdomKey.toString(),
    });
    INCLUDED_BASIS_OF_RECORD.forEach((bor) => params.append("basisOfRecord", bor));

    const data = await gbifGet(params);
    if (!data) break;

    const facet = data.facets?.find((f: { field: string }) => f.field === "SPECIES_KEY");
    if (!facet || facet.counts.length === 0) break;

    for (const c of facet.counts) {
      allSpeciesKeys.push(parseInt(c.name, 10));
    }

    hasMore = facet.counts.length >= FACET_LIMIT;
    if (hasMore) offset += FACET_LIMIT;
  }

  return allSpeciesKeys;
}

// =============================================================================
// MAIN LOGIC
// =============================================================================

export async function run(opts: {
  taxa?: string[];
  refresh?: boolean;
  logger?: SyncLogger;
} = {}): Promise<void> {
  const taxaToSync = getTaxa(opts.taxa);
  const refresh = opts.refresh ?? false;
  const logger = opts.logger ?? SyncLogger.noop();

  const startTime = Date.now();

  logger.log("fetch_gbif_country_data_start", {
    taxa: taxaToSync.map((t) => t.id),
    taxa_count: taxaToSync.length,
    refresh,
  });

  // ── Step 1: Load all GBIF CSVs and build a global speciesKey → taxon index ──

  const taxonData = new Map<string, { map: Map<number, GbifSpecies>; needsUpdate: Set<number> }>();
  const globalSpeciesIndex = new Map<number, string[]>(); // speciesKey → taxonIds

  for (const taxon of taxaToSync) {
    const gbifMap = readGbifCsv(taxon.id);
    const speciesList = Array.from(gbifMap.values());
    const needsUpdate = refresh
      ? new Set(speciesList.map((s) => s.gbif_species_key))
      : new Set(speciesList.filter((s) => !s.countries).map((s) => s.gbif_species_key));

    taxonData.set(taxon.id, { map: gbifMap, needsUpdate });

    for (const species of speciesList) {
      const key = species.gbif_species_key;
      const taxonIds = globalSpeciesIndex.get(key);
      if (taxonIds) taxonIds.push(taxon.id);
      else globalSpeciesIndex.set(key, [taxon.id]);
    }

    const total = speciesList.length;
    const needs = needsUpdate.size;
    console.log(`  ${taxon.id}: ${total} species, ${needs} need country data${refresh ? " (refresh)" : ""}`);
  }

  const totalNeedingData = Array.from(taxonData.values()).reduce((s, d) => s + d.needsUpdate.size, 0);
  if (totalNeedingData === 0) {
    console.log("\nAll species already have country data. Nothing to do.");
    return;
  }

  console.log(`\nTotal: ${globalSpeciesIndex.size} unique species, ${totalNeedingData} need country data`);

  // ── Step 2: Query at kingdom level per country ──
  // Only query kingdoms that are relevant to the taxa being synced

  const neededKingdomKeys = new Set(taxaToSync.map((t) => t.kingdomKey));
  const kingdomsToQuery = KINGDOM_KEYS.filter((k) => neededKingdomKeys.has(k.key));

  const speciesCountries = new Map<number, Set<string>>();
  let totalApiCalls = 0;

  for (const kingdom of kingdomsToQuery) {
    console.log(`\n${kingdom.name} (kingdomKey=${kingdom.key}):`);

    // Get countries with occurrences for this kingdom
    const countries = await fetchCountriesForKingdom(kingdom.key);
    totalApiCalls++;
    console.log(`  ${countries.length} countries with occurrences`);

    if (countries.length === 0) continue;

    // For each country, get all species (concurrent)
    let completed = 0;
    await mapConcurrent(countries, CONCURRENCY, async (country) => {
      const speciesKeys = await fetchSpeciesInKingdomCountry(kingdom.key, country);
      totalApiCalls++;

      // Only record countries for species we know about
      for (const key of speciesKeys) {
        if (!globalSpeciesIndex.has(key)) continue;
        let set = speciesCountries.get(key);
        if (!set) {
          set = new Set();
          speciesCountries.set(key, set);
        }
        set.add(country);
      }

      completed++;
      if (completed % 25 === 0 || completed === countries.length) {
        process.stdout.write(`\r  Fetched ${completed}/${countries.length} countries`);
      }
    });
    console.log("");
  }

  // ── Step 3: Write updated country data back to per-taxon CSVs ──

  let totalUpdated = 0;

  for (const taxon of taxaToSync) {
    const { map: gbifMap, needsUpdate } = taxonData.get(taxon.id)!;

    let updated = 0;
    for (const [key, species] of gbifMap) {
      if (!needsUpdate.has(key)) continue;
      const countries = speciesCountries.get(key);
      if (countries) {
        species.countries = Array.from(countries).sort().join(";");
        updated++;
      }
    }

    const outputPath = path.join(GBIF_DIR, `${taxon.id}.csv`);
    writeGbifCsv(gbifMap, outputPath);

    const withCountries = Array.from(gbifMap.values()).filter((s) => s.countries).length;
    console.log(`${taxon.id}: updated ${updated}, ${withCountries}/${gbifMap.size} have country data → ${outputPath}`);

    totalUpdated += updated;

    logger.log("fetch_gbif_country_data_taxon", {
      taxon_id: taxon.id,
      total: gbifMap.size,
      updated,
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;

  logger.log("fetch_gbif_country_data_complete", {
    total_updated: totalUpdated,
    api_calls: totalApiCalls,
    duration_seconds: Number(elapsed),
  });

  console.log("\n" + "=".repeat(50));
  console.log("fetch-gbif-country-data complete:");
  console.log(`  Updated: ${totalUpdated.toLocaleString()}`);
  console.log(`  API calls: ${totalApiCalls} (vs ~${globalSpeciesIndex.size.toLocaleString()} in per-species approach)`);
  console.log(`  Output:  ${GBIF_DIR}/`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const taxonArg = args.find((a: string) => a !== "--refresh")?.toLowerCase();

  console.log("fetch-gbif-country-data: GBIF country occurrences per species");
  console.log("  Strategy: kingdom-level queries (~1,000 API calls for all species)");
  if (refresh) console.log("  Mode: --refresh (re-fetching all species)");
  console.log("=".repeat(50));

  const logger = new SyncLogger("fetch-gbif-country-data");
  try {
    await run({ taxa: taxonArg ? [taxonArg] : undefined, refresh, logger });
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch-gbif-country-data.ts") || process.argv[1]?.endsWith("fetch-gbif-country-data.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
