/**
 * fetch-gbif-new-counts: GBIF occurrence counts since last Red List assessment
 *
 * For each linked species, fetches GBIF occurrence counts from the year
 * after their last assessment to the current year, then updates per-taxon data/gbif/{taxonId}.csv.
 *
 * Prerequisites:
 *   1. Per-taxon redlist CSVs exist in data/redlist/ (from fetch-redlist, with GBIF keys from match)
 *   2. Per-taxon GBIF CSVs exist in data/gbif/ (from fetch-gbif)
 *
 * Usage:
 *   npx tsx scripts/fetch-gbif-new-counts.ts [taxon]   # One taxon (e.g. mammalia)
 *   npx tsx scripts/fetch-gbif-new-counts.ts            # All taxa
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  GBIF_DIR,
  mapConcurrent,
} from "./utils";
import { getTaxa, type Taxon } from "./taxa";
import {
  GbifSpecies,
  fetchFacets,
  writeGbifCsv,
  readGbifCsv,
} from "./fetch-gbif-species";
import { readRedlistCsv } from "./fetch-redlist-species";

// =============================================================================
// CONFIGURATION
// =============================================================================

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_BUCKET_CONCURRENCY = 30;

// =============================================================================
// HELPERS
// =============================================================================

function loadAssessmentYears(taxonId: string, taxonGbifKeys: Set<number>): Map<number, number> {
  const speciesAssessmentYear = new Map<number, number>();
  const redlistSpecies = readRedlistCsv(taxonId);
  for (const s of redlistSpecies) {
    if (s.gbif_species_key && taxonGbifKeys.has(s.gbif_species_key) && s.assessment_date) {
      const year = parseInt(s.assessment_date.slice(0, 4), 10);
      if (!isNaN(year)) speciesAssessmentYear.set(s.gbif_species_key, year);
    }
  }
  return speciesAssessmentYear;
}

// =============================================================================
// MAIN LOGIC
// =============================================================================

export async function fetchCountsSinceAssessment(
  taxon: Taxon,
  gbifSpeciesMap: Map<number, GbifSpecies>,
): Promise<number> {
  const taxonGbifKeys = new Set(gbifSpeciesMap.keys());

  const speciesAssessmentYear = loadAssessmentYears(taxon.id, taxonGbifKeys);
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

  console.log(`  ${yearBuckets.length} year buckets x ${taxon.gbif.length} queries`);

  for (let qi = 0; qi < taxon.gbif.length; qi++) {
    const q = taxon.gbif[qi];
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
      process.stdout.write(`\r  Query ${qi + 1}/${taxon.gbif.length}: ${completedBuckets}/${yearBuckets.length} year buckets`);
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

export async function run(opts: {
  taxa?: string[];
  logger?: SyncLogger;
} = {}): Promise<void> {
  const taxaToSync = getTaxa(opts.taxa);
  const logger = opts.logger ?? SyncLogger.noop();

  const startTime = Date.now();

  let totalComputed = 0;

  for (const taxon of taxaToSync) {
    console.log(`\n${taxon.name} (${taxon.id}):`);
    const gbifSpeciesMap = readGbifCsv(taxon.id);
    const count = await fetchCountsSinceAssessment(taxon, gbifSpeciesMap);
    totalComputed += count;

    const outputPath = path.join(GBIF_DIR, `${taxon.id}.csv`);
    writeGbifCsv(gbifSpeciesMap, outputPath);

    logger.log("fetch_new_gbif_counts_taxon", { taxon_id: taxon.id, computed: count });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;

  logger.log("fetch_new_gbif_counts_complete", { total_computed: totalComputed, duration_seconds: Number(elapsed) });

  console.log("\n" + "=".repeat(50));
  console.log("fetch-gbif-new-counts complete:");
  console.log(`  Computed: ${totalComputed.toLocaleString()}`);
  console.log(`  Output:   ${GBIF_DIR}/`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const taxonArg = args[0]?.toLowerCase();

  console.log("fetch-gbif-new-counts: GBIF counts since last assessment");
  console.log("=".repeat(50));

  const logger = new SyncLogger("fetch-gbif-new-counts");
  try {
    await run({ taxa: taxonArg ? [taxonArg] : undefined, logger });
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
