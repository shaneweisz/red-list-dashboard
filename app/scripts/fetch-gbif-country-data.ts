/**
 * fetch-gbif-country-data: GBIF country occurrences per species
 *
 * For each species in the GBIF CSVs, fetches the country facet from the GBIF
 * occurrence API and writes semicolon-separated ISO country codes into the
 * `countries` column of the per-taxon data/gbif/{taxonId}.csv.
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
const CONCURRENCY = 30;
const REQUEST_DELAY = 50; // ms between batches

const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OCCURRENCE",
  "MATERIAL_SAMPLE",
  "OBSERVATION",
  "PRESERVED_SPECIMEN",
];

// =============================================================================
// GBIF COUNTRY FACET
// =============================================================================

async function fetchCountryFacet(speciesKey: number): Promise<string[]> {
  const params = new URLSearchParams({
    speciesKey: speciesKey.toString(),
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
    facet: "country",
    facetLimit: "300",
    limit: "0",
  });
  INCLUDED_BASIS_OF_RECORD.forEach((bor) => params.append("basisOfRecord", bor));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < MAX_RETRIES) {
          await delay(Math.pow(2, attempt + 1) * 1000);
          continue;
        }
        return [];
      }
      if (!res.ok) return [];
      const data = await res.json();
      const facet = data.facets?.find((f: { field: string }) => f.field === "COUNTRY");
      if (!facet) return [];
      return facet.counts.map((c: { name: string }) => c.name);
    } catch {
      if (attempt < MAX_RETRIES) {
        await delay(Math.pow(2, attempt + 1) * 1000);
        continue;
      }
      return [];
    }
  }
  return [];
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

    // In refresh mode, re-fetch all species; otherwise only those missing country data
    const needsFetch = refresh ? speciesList : speciesList.filter((s) => !s.countries);
    console.log(`  ${speciesList.length} species total, ${needsFetch.length} need country data${refresh ? " (refresh)" : ""}`);

    if (needsFetch.length === 0) {
      console.log("  Skipping (all species already have country data)");
      continue;
    }

    let completed = 0;

    await mapConcurrent(needsFetch, CONCURRENCY, async (species) => {
      const countries = await fetchCountryFacet(species.gbif_species_key);
      species.countries = countries.join(";");
      completed++;
      if (completed % 500 === 0 || completed === needsFetch.length) {
        process.stdout.write(`\r  Fetched ${completed}/${needsFetch.length} species`);
      }
    });
    console.log("");

    const outputPath = path.join(GBIF_DIR, `${taxon.id}.csv`);
    writeGbifCsv(gbifSpeciesMap, outputPath);

    const withCountries = Array.from(gbifSpeciesMap.values()).filter((s) => s.countries).length;
    console.log(`  ${withCountries}/${gbifSpeciesMap.size} species have country data`);
    console.log(`  Wrote → ${outputPath}`);

    totalUpdated += needsFetch.length;

    const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
    logger.log("fetch_gbif_country_data_taxon", {
      taxon_id: taxon.id,
      total: speciesList.length,
      fetched: needsFetch.length,
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
  const taxonArg = args.find((a) => a !== "--refresh")?.toLowerCase();

  console.log("fetch-gbif-country-data: GBIF country occurrences per species");
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
