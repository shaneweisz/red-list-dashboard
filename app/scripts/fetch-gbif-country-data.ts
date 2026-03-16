/**
 * fetch-gbif-country-data: GBIF country occurrences per species
 *
 * For each species in the GBIF CSVs, determines which countries it occurs in
 * by querying the GBIF occurrence API and writes semicolon-separated ISO
 * country codes into the `countries` column of the per-taxon data/gbif/{taxonId}.csv.
 *
 * OPTIMIZED APPROACH: Instead of querying per-species (660k API calls), this
 * inverts the query: for each taxon GBIF query, it first gets the list of
 * countries, then for each country facets by speciesKey. This reduces API calls
 * from ~660k to ~15-20k (a ~40x improvement).
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
import { getTaxa, type GbifQuery } from "./taxa";
import {
  type GbifSpecies,
  readGbifCsv,
  writeGbifCsv,
} from "./fetch-gbif-species";

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_RETRIES = 5;
const CONCURRENCY = 30;
const FACET_LIMIT = 500000;

const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OCCURRENCE",
  "MATERIAL_SAMPLE",
  "OBSERVATION",
  "PRESERVED_SPECIMEN",
];

// =============================================================================
// GBIF API: COUNTRY-FIRST QUERIES
// =============================================================================

/** Fetch the list of countries that have occurrences for a given taxon query. */
async function fetchCountriesForQuery(query: GbifQuery): Promise<string[]> {
  const params = new URLSearchParams({
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
    facet: "country",
    facetLimit: "300",
    limit: "0",
    [query.keyType]: query.keyValue.toString(),
  });
  INCLUDED_BASIS_OF_RECORD.forEach((bor) => params.append("basisOfRecord", bor));

  const data = await gbifGet(params);
  if (!data) return [];

  const facet = data.facets?.find((f: { field: string }) => f.field === "COUNTRY");
  if (!facet) return [];
  return facet.counts.map((c: { name: string }) => c.name);
}

/**
 * For a given taxon query + country, fetch all speciesKeys that have
 * occurrences. Returns an array of speciesKey numbers.
 * Handles pagination via facetOffset for large result sets.
 */
async function fetchSpeciesInCountry(
  query: GbifQuery,
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
      [query.keyType]: query.keyValue.toString(),
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

  let totalUpdated = 0;

  for (const taxon of taxaToSync) {
    const taxonStart = Date.now();
    console.log(`\n${taxon.name} (${taxon.id}):`);

    const gbifSpeciesMap = readGbifCsv(taxon.id);
    const speciesList = Array.from(gbifSpeciesMap.values());

    // Determine which species need country data
    const speciesNeedingData = refresh
      ? new Set(speciesList.map((s) => s.gbif_species_key))
      : new Set(speciesList.filter((s) => !s.countries).map((s) => s.gbif_species_key));

    console.log(`  ${speciesList.length} species total, ${speciesNeedingData.size} need country data${refresh ? " (refresh)" : ""}`);

    if (speciesNeedingData.size === 0) {
      console.log("  Skipping (all species already have country data)");
      continue;
    }

    // Build speciesKey → Set<country> map using inverted queries
    const speciesCountries = new Map<number, Set<string>>();
    let totalApiCalls = 0;

    for (let qi = 0; qi < taxon.gbif.length; qi++) {
      const query = taxon.gbif[qi];
      console.log(`  Query ${qi + 1}/${taxon.gbif.length}: ${query.keyType}=${query.keyValue}`);

      // Step 1: Get list of countries for this taxon query
      const countries = await fetchCountriesForQuery(query);
      totalApiCalls++;
      console.log(`    ${countries.length} countries with occurrences`);

      if (countries.length === 0) continue;

      // Step 2: For each country, get species list (concurrent)
      let completed = 0;
      await mapConcurrent(countries, CONCURRENCY, async (country) => {
        const speciesKeys = await fetchSpeciesInCountry(query, country);
        totalApiCalls++;

        // Only record countries for species we care about
        for (const key of speciesKeys) {
          if (!speciesNeedingData.has(key) && !gbifSpeciesMap.has(key)) continue;
          let set = speciesCountries.get(key);
          if (!set) {
            set = new Set();
            speciesCountries.set(key, set);
          }
          set.add(country);
        }

        completed++;
        if (completed % 50 === 0 || completed === countries.length) {
          process.stdout.write(`\r    Fetched ${completed}/${countries.length} countries`);
        }
      });
      console.log("");
    }

    // Apply country data to species that needed it
    let updated = 0;
    for (const [key, countries] of speciesCountries) {
      const species = gbifSpeciesMap.get(key);
      if (species && speciesNeedingData.has(key)) {
        species.countries = Array.from(countries).sort().join(";");
        updated++;
      }
    }

    const outputPath = path.join(GBIF_DIR, `${taxon.id}.csv`);
    writeGbifCsv(gbifSpeciesMap, outputPath);

    const withCountries = Array.from(gbifSpeciesMap.values()).filter((s) => s.countries).length;
    console.log(`  Updated ${updated} species, ${withCountries}/${gbifSpeciesMap.size} have country data`);
    console.log(`  API calls: ${totalApiCalls} (vs ${speciesNeedingData.size} in per-species approach)`);
    console.log(`  Wrote → ${outputPath}`);

    totalUpdated += updated;

    const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
    logger.log("fetch_gbif_country_data_taxon", {
      taxon_id: taxon.id,
      total: speciesList.length,
      updated,
      api_calls: totalApiCalls,
      duration_seconds: Number(taxonDuration),
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;

  logger.log("fetch_gbif_country_data_complete", {
    total_updated: totalUpdated,
    duration_seconds: Number(elapsed),
  });

  console.log("\n" + "=".repeat(50));
  console.log("fetch-gbif-country-data complete:");
  console.log(`  Updated: ${totalUpdated.toLocaleString()}`);
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
  console.log("  Strategy: country-first (inverted queries)");
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
