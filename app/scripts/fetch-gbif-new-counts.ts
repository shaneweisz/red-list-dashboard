/**
 * fetch-gbif-new-counts: GBIF occurrence counts since last Red List assessment
 *
 * For each linked species, fetches GBIF occurrence counts that were modified
 * (added or updated) since their last assessment date. This captures both new
 * observations and older records (e.g. preserved specimens) that were digitised
 * after the assessment.
 *
 * Uses the GBIF `modified` filter with class-level faceted queries, bucketed by
 * unique assessment dates for efficiency.
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
import { readMappingCsv } from "./match-redlist-species-to-gbif";

// =============================================================================
// CONFIGURATION
// =============================================================================

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const BUCKET_CONCURRENCY = 30;

// =============================================================================
// HELPERS
// =============================================================================

function loadAssessmentDates(taxonId: string, taxonGbifKeys: Set<number>): Map<number, string> {
  const mapping = readMappingCsv();
  const speciesAssessmentDate = new Map<number, string>();
  const redlistSpecies = readRedlistCsv(taxonId);
  for (const s of redlistSpecies) {
    const m = mapping.get(s.sis_taxon_id);
    const gbifKey = m?.gbif_species_key;
    if (gbifKey && taxonGbifKeys.has(gbifKey) && s.assessment_date) {
      speciesAssessmentDate.set(gbifKey, s.assessment_date);
    }
  }
  return speciesAssessmentDate;
}

// =============================================================================
// MAIN LOGIC
// =============================================================================

export async function fetchCountsSinceAssessment(
  taxon: Taxon,
  gbifSpeciesMap: Map<number, GbifSpecies>,
): Promise<number> {
  const taxonGbifKeys = new Set(gbifSpeciesMap.keys());

  const speciesAssessmentDate = loadAssessmentDates(taxon.id, taxonGbifKeys);
  console.log(`  ${speciesAssessmentDate.size} linked species with assessment dates`);

  if (speciesAssessmentDate.size === 0) return 0;

  // Group species by assessment date for efficient batched queries
  const speciesByDate = new Map<string, Set<number>>();
  speciesAssessmentDate.forEach((date, speciesKey) => {
    if (!speciesByDate.has(date)) speciesByDate.set(date, new Set());
    speciesByDate.get(date)!.add(speciesKey);
  });

  const uniqueDates = Array.from(speciesByDate.keys()).sort();

  const sinceAssessmentCounts = new Map<number, number>();
  speciesAssessmentDate.forEach((_date, speciesKey) => {
    sinceAssessmentCounts.set(speciesKey, 0);
  });

  console.log(`  ${uniqueDates.length} date buckets x ${taxon.gbif.length} queries`);

  for (let qi = 0; qi < taxon.gbif.length; qi++) {
    const q = taxon.gbif[qi];
    let completedBuckets = 0;

    await mapConcurrent(uniqueDates, BUCKET_CONCURRENCY, async (assessmentDate) => {
      const modifiedRange = `${assessmentDate},${TODAY}`;
      const results = await fetchFacets(q.keyType, q.keyValue, undefined, modifiedRange);
      const bucketSpecies = speciesByDate.get(assessmentDate);

      if (bucketSpecies) {
        for (const r of results) {
          if (bucketSpecies.has(r.speciesKey)) {
            sinceAssessmentCounts.set(r.speciesKey, sinceAssessmentCounts.get(r.speciesKey)! + r.count);
          }
        }
      }

      completedBuckets++;
      process.stdout.write(`\r  Query ${qi + 1}/${taxon.gbif.length}: ${completedBuckets}/${uniqueDates.length} date buckets`);
    });
  }
  if (uniqueDates.length > 0) console.log("");

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

  console.log("fetch-gbif-new-counts: GBIF records modified since last assessment");
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
