/**
 * fetch-gbif-new-counts: GBIF occurrence counts since last Red List assessment
 *
 * For each linked species, fetches GBIF occurrence counts from the year
 * after their last assessment to the current year, then updates gbif-species.csv.
 *
 * Prerequisites:
 *   1. redlist-species.csv exists (from fetch-redlist)
 *   2. gbif-species.csv exists (from fetch-gbif)
 *   3. redlist-species.csv has gbif_species_key populated (from match)
 *
 * Usage:
 *   npx tsx scripts/fetch-gbif-new-counts.ts [taxon]   # One taxon (e.g. mammalia)
 *   npx tsx scripts/fetch-gbif-new-counts.ts            # All taxa
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  readCsv,
  DATA_DIR,
  mapConcurrent,
} from "./utils";
import {
  GBIF_TAXA,
  GbifTaxon,
  GbifSpecies,
  fetchFacets,
  writeGbifCsv,
} from "./fetch-gbif-species";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_BUCKET_CONCURRENCY = 30;

// =============================================================================
// HELPERS
// =============================================================================

function loadGbifCsv(): Map<number, GbifSpecies> {
  const csvPath = path.join(DATA_DIR, "gbif-species.csv");
  const rows = readCsv<GbifSpecies>(csvPath, (r) => ({
    gbif_species_key: parseInt(r.gbif_species_key, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name,
    taxon_group_table1a: r.taxon_group_table1a,
    total_count: parseInt(r.total_count, 10) || 0,
    count_after_assessment_year: r.count_after_assessment_year ? parseInt(r.count_after_assessment_year, 10) : null,
  }));
  const map = new Map<number, GbifSpecies>();
  for (const row of rows) map.set(row.gbif_species_key, row);
  return map;
}

function loadAssessmentYears(taxonGbifKeys: Set<number>): Map<number, number> {
  const redlistPath = path.join(DATA_DIR, "redlist-species.csv");

  const speciesAssessmentYear = new Map<number, number>();
  readCsv(redlistPath, (r) => {
    const gbifKey = r.gbif_species_key ? parseInt(r.gbif_species_key, 10) : null;
    if (gbifKey && taxonGbifKeys.has(gbifKey) && r.assessment_date) {
      const year = parseInt(r.assessment_date.slice(0, 4), 10);
      if (!isNaN(year)) speciesAssessmentYear.set(gbifKey, year);
    }
    return null;
  });

  return speciesAssessmentYear;
}

// =============================================================================
// MAIN LOGIC
// =============================================================================

export async function fetchCountsSinceAssessment(
  taxon: GbifTaxon,
  gbifSpeciesMap: Map<number, GbifSpecies>,
): Promise<number> {
  const taxonGbifKeys = new Set<number>();
  gbifSpeciesMap.forEach((row, key) => {
    if (row.taxon_group_table1a === taxon.id) taxonGbifKeys.add(key);
  });

  const speciesAssessmentYear = loadAssessmentYears(taxonGbifKeys);
  console.log(`  ${speciesAssessmentYear.size} linked species with assessment dates`);

  if (speciesAssessmentYear.size === 0) return 0;

  const uniqueYears = Array.from(new Set(Array.from(speciesAssessmentYear.values()))).sort((a, b) => a - b);
  const yearBuckets = uniqueYears.filter((y) => y + 1 <= CURRENT_YEAR);

  const speciesByYear = new Map<number, Set<number>>();
  speciesAssessmentYear.forEach((year, speciesKey) => {
    if (!speciesByYear.has(year)) speciesByYear.set(year, new Set());
    speciesByYear.get(year)!.add(speciesKey);
  });

  const sinceAssessmentCounts = new Map<number, number>();
  speciesAssessmentYear.forEach((_year, speciesKey) => {
    sinceAssessmentCounts.set(speciesKey, 0);
  });

  console.log(`  ${yearBuckets.length} year buckets x ${taxon.queries.length} queries`);

  for (let qi = 0; qi < taxon.queries.length; qi++) {
    const q = taxon.queries[qi];
    let completedBuckets = 0;

    await mapConcurrent(yearBuckets, YEAR_BUCKET_CONCURRENCY, async (assessmentYear) => {
      const yearRange = `${assessmentYear + 1},${CURRENT_YEAR}`;
      const results = await fetchFacets(q.keyType, q.keyValue, yearRange);
      const bucketSpecies = speciesByYear.get(assessmentYear);

      if (bucketSpecies) {
        for (const r of results) {
          if (bucketSpecies.has(r.speciesKey)) {
            sinceAssessmentCounts.set(r.speciesKey, sinceAssessmentCounts.get(r.speciesKey)! + r.count);
          }
        }
      }

      completedBuckets++;
      process.stdout.write(`\r  Query ${qi + 1}/${taxon.queries.length}: ${completedBuckets}/${yearBuckets.length} year buckets`);
    });
  }
  if (yearBuckets.length > 0) console.log("");

  sinceAssessmentCounts.forEach((count, key) => {
    const row = gbifSpeciesMap.get(key);
    if (row) row.count_after_assessment_year = count;
  });

  return sinceAssessmentCounts.size;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const taxonArg = args[0]?.toLowerCase();

  const taxaToSync = taxonArg
    ? (GBIF_TAXA[taxonArg] ? [GBIF_TAXA[taxonArg]] : [])
    : Object.values(GBIF_TAXA);

  if (taxonArg && taxaToSync.length === 0) {
    console.error(`Unknown taxon: ${taxonArg}`);
    console.error("Available:", Object.keys(GBIF_TAXA).join(", "));
    process.exit(1);
  }

  console.log("fetch-gbif-new-counts: GBIF counts since last assessment");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const logger = new SyncLogger("fetch-gbif-new-counts");

  try {
    const gbifSpeciesMap = loadGbifCsv();
    let totalComputed = 0;

    for (const taxon of taxaToSync) {
      console.log(`\n${taxon.name} (${taxon.id}):`);
      const count = await fetchCountsSinceAssessment(taxon, gbifSpeciesMap);
      totalComputed += count;
      logger.log("taxon_complete", { taxon_id: taxon.id, computed: count });
    }

    const outputPath = path.join(DATA_DIR, "gbif-species.csv");
    writeGbifCsv(gbifSpeciesMap, outputPath);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("complete", { total_computed: totalComputed, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("fetch-gbif-new-counts complete:");
    console.log(`  Computed: ${totalComputed.toLocaleString()}`);
    console.log(`  Output:   ${outputPath}`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch-gbif-new-counts.ts") || process.argv[1]?.endsWith("fetch-gbif-new-counts.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
