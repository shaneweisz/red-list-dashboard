/**
 * sync-gbif: GBIF API → Supabase
 *
 * Fetches per-species observation counts from GBIF and upserts into Supabase.
 * Species already in the DB get GBIF columns updated. GBIF species not in
 * IUCN are inserted as NE (Not Evaluated) species.
 *
 * Also computes gbif_occurrences_since_assessment using year-bucketed facet
 * queries matched against assessment_date values from Supabase.
 *
 * Prerequisites:
 *   1. Environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   2. sync-iucn should have run first (for assessment_date values)
 *
 * Usage:
 *   npx tsx scripts/sync-gbif.ts <taxon>   # e.g. mammalia, plantae, fishes
 *   npx tsx scripts/sync-gbif.ts            # Sync all taxa
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  loadEnvFiles,
  createServiceClient,
  normalizeSpeciesName,
  buildSpeciesIndex,
  findMatch,
  SyncLogger,
  ExistingSpecies,
} from "./sync-utils";

// =============================================================================
// GBIF TAXA CONFIGURATION
// =============================================================================

// Maps GBIF query parameters to the 15 taxon_group IDs stored in Supabase.
// Combined taxa (fishes, invertebrates, fungi) map multiple queries to multiple groups.
interface GbifTaxonConfig {
  id: string;
  name: string;
  // Each query specifies a key type and value, and the taxon_group for NE species
  queries: Array<{
    keyType: "kingdomKey" | "classKey" | "orderKey";
    keyValue: number;
    taxonGroup: string; // The specific taxon_group ID for NE species from this query
  }>;
}

const FISH_ORDER_KEYS = [389,391,427,428,446,494,495,496,497,498,499,537,538,547,548,549,550,587,588,589,590,696,708,742,752,753,772,773,774,781,836,848,857,860,861,888,889,890,898,929,975,976,1067,1153,1313];

const GBIF_TAXA: Record<string, GbifTaxonConfig> = {
  mammalia: {
    id: "mammalia", name: "Mammals",
    queries: [{ keyType: "classKey", keyValue: 359, taxonGroup: "mammalia" }],
  },
  aves: {
    id: "aves", name: "Birds",
    queries: [{ keyType: "classKey", keyValue: 212, taxonGroup: "aves" }],
  },
  reptilia: {
    id: "reptilia", name: "Reptiles",
    queries: [
      { keyType: "classKey", keyValue: 11592253, taxonGroup: "reptilia" },
      { keyType: "classKey", keyValue: 11493978, taxonGroup: "reptilia" },
      { keyType: "classKey", keyValue: 11418114, taxonGroup: "reptilia" },
    ],
  },
  amphibia: {
    id: "amphibia", name: "Amphibians",
    queries: [{ keyType: "classKey", keyValue: 131, taxonGroup: "amphibia" }],
  },
  fishes: {
    id: "fishes", name: "Fishes",
    queries: [
      ...FISH_ORDER_KEYS.map((k) => ({ keyType: "orderKey" as const, keyValue: k, taxonGroup: "fishes" })),
      { keyType: "classKey" as const, keyValue: 121, taxonGroup: "fishes" },
      { keyType: "classKey" as const, keyValue: 120, taxonGroup: "fishes" },
    ],
  },
  invertebrates: {
    id: "invertebrates", name: "Invertebrates",
    queries: [
      { keyType: "classKey", keyValue: 216, taxonGroup: "insecta" },
      { keyType: "classKey", keyValue: 367, taxonGroup: "arachnida" },
      { keyType: "classKey", keyValue: 225, taxonGroup: "mollusca" },
      { keyType: "classKey", keyValue: 137, taxonGroup: "mollusca" },
      { keyType: "classKey", keyValue: 229, taxonGroup: "crustacea" },
      { keyType: "classKey", keyValue: 206, taxonGroup: "corals" },
    ],
  },
  plantae: {
    id: "plantae", name: "Plants",
    queries: [{ keyType: "kingdomKey", keyValue: 6, taxonGroup: "plantae" }],
  },
  fungi: {
    id: "fungi", name: "Fungi",
    queries: [
      { keyType: "kingdomKey", keyValue: 5, taxonGroup: "fungi" },
    ],
  },
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const FACET_LIMIT = 100000;
const REQUEST_DELAY = 200;
const SPECIES_VALIDATION_BATCH_SIZE = 500;
const SPECIES_VALIDATION_DELAY = 50;
const CURRENT_YEAR = new Date().getFullYear();

const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OCCURRENCE",
  "MATERIAL_SAMPLE",
  "OBSERVATION",
];

// =============================================================================
// TYPES
// =============================================================================

interface SpeciesCount {
  speciesKey: number;
  count: number;
  taxonGroup: string; // Which taxon_group to assign to NE species
}

interface ValidatedSpecies {
  key: number;
  canonicalName: string;
  vernacularName: string;
}

// =============================================================================
// HELPERS
// =============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// =============================================================================
// GBIF API FUNCTIONS
// =============================================================================

async function fetchForTaxonKey(
  keyType: string,
  keyValue: number,
  yearRange?: string
): Promise<Array<{ speciesKey: number; count: number }>> {
  const allResults: Array<{ speciesKey: number; count: number }> = [];
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
      [keyType]: keyValue.toString(),
    });

    if (yearRange) params.set("year", yearRange);
    INCLUDED_BASIS_OF_RECORD.forEach((bor) => params.append("basisOfRecord", bor));

    const response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
    if (!response.ok) throw new Error(`GBIF API error: ${response.statusText}`);

    const data = await response.json();
    const facet = data.facets?.find((f: { field: string }) => f.field === "SPECIES_KEY");

    if (!facet || facet.counts.length === 0) {
      hasMore = false;
      break;
    }

    for (const c of facet.counts) {
      allResults.push({ speciesKey: parseInt(c.name, 10), count: c.count });
    }

    hasMore = facet.counts.length >= FACET_LIMIT;
    if (hasMore) {
      offset += FACET_LIMIT;
      await delay(REQUEST_DELAY);
    }
  }

  return allResults;
}

async function validateSpeciesKeys(speciesKeys: number[]): Promise<Map<number, ValidatedSpecies>> {
  const valid = new Map<number, ValidatedSpecies>();

  for (let i = 0; i < speciesKeys.length; i += SPECIES_VALIDATION_BATCH_SIZE) {
    const batch = speciesKeys.slice(i, i + SPECIES_VALIDATION_BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (key) => {
        try {
          const res = await fetch(`https://api.gbif.org/v1/species/${key}`, {
            headers: { "Accept-Language": "en" },
          });
          if (!res.ok) return { key, rank: "UNKNOWN", status: "UNKNOWN", canonicalName: "", vernacularName: "" };
          const data = await res.json();
          return {
            key,
            rank: data.rank || "UNKNOWN",
            status: data.taxonomicStatus || "UNKNOWN",
            canonicalName: data.canonicalName || data.scientificName || "",
            vernacularName: data.vernacularName || "",
          };
        } catch {
          return { key, rank: "ERROR", status: "ERROR", canonicalName: "", vernacularName: "" };
        }
      })
    );

    for (const info of results) {
      if (info.rank === "SPECIES" && info.status === "ACCEPTED") {
        valid.set(info.key, { key: info.key, canonicalName: info.canonicalName, vernacularName: info.vernacularName });
      }
    }

    const progress = Math.min(i + SPECIES_VALIDATION_BATCH_SIZE, speciesKeys.length);
    process.stdout.write(`\r  Validated ${progress}/${speciesKeys.length} (${valid.size} valid)`);

    if (i + SPECIES_VALIDATION_BATCH_SIZE < speciesKeys.length) {
      await delay(SPECIES_VALIDATION_DELAY);
    }
  }

  console.log("");
  return valid;
}

// =============================================================================
// FETCH ALL SPECIES COUNTS
// =============================================================================

async function fetchAllSpeciesCounts(taxon: GbifTaxonConfig): Promise<SpeciesCount[]> {
  const allResults: SpeciesCount[] = [];

  for (let i = 0; i < taxon.queries.length; i++) {
    const q = taxon.queries[i];
    if (!yearRangeMode) {
      const label = `${q.keyType}=${q.keyValue}`;
      process.stdout.write(`\r  Fetching ${label} (${i + 1}/${taxon.queries.length})...`);
    }
    const results = await fetchForTaxonKey(q.keyType, q.keyValue);
    for (const r of results) {
      allResults.push({ speciesKey: r.speciesKey, count: r.count, taxonGroup: q.taxonGroup });
    }
    await delay(REQUEST_DELAY);
  }

  if (!yearRangeMode) console.log("");

  // Deduplicate: keep highest count per speciesKey, preserve taxonGroup from winner
  const seen = new Map<number, SpeciesCount>();
  for (const r of allResults) {
    if (!seen.has(r.speciesKey) || seen.get(r.speciesKey)!.count < r.count) {
      seen.set(r.speciesKey, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.count - a.count);
}

// Global flag to suppress verbose logging during year-range queries
let yearRangeMode = false;

async function fetchFacetsForYearRange(
  taxon: GbifTaxonConfig,
  startYear: number,
  endYear: number
): Promise<Map<number, number>> {
  const yearRange = `${startYear},${endYear}`;
  const counts = new Map<number, number>();

  for (const q of taxon.queries) {
    const results = await fetchForTaxonKey(q.keyType, q.keyValue, yearRange);
    for (const r of results) {
      const existing = counts.get(r.speciesKey) || 0;
      counts.set(r.speciesKey, existing + r.count);
    }
    await delay(REQUEST_DELAY);
  }

  return counts;
}

// =============================================================================
// UPSERT LOGIC
// =============================================================================

const UPSERT_BATCH_SIZE = 500;

/**
 * Upsert GBIF species data into Supabase.
 * - Existing species (matched by gbif_species_key, col_id, or name): UPDATE GBIF columns
 * - Unmatched GBIF species: INSERT as NE species
 */
export interface GbifUpsertStats {
  inserted: number;
  matched_by_id: number;
  matched_by_col_id: number;
  matched_by_name: number;
  errors: number;
}

export async function upsertGbifSpecies(
  supabase: SupabaseClient,
  speciesList: Array<{
    speciesKey: number;
    observationsTotal: number;
    scientificName: string;
    commonName: string;
    taxonGroup: string;
    observationsAfterAssessment: number | null;
  }>,
  logger: SyncLogger
): Promise<GbifUpsertStats> {
  // Load existing species for matching
  const { data: existing, error: fetchError } = await supabase
    .from("species")
    .select("id, scientific_name, sis_taxon_id, gbif_species_key, col_id");

  if (fetchError) throw new Error(`Failed to fetch existing species: ${fetchError.message}`);

  const index = buildSpeciesIndex(existing as ExistingSpecies[]);
  const stats: GbifUpsertStats = { matched_by_id: 0, matched_by_col_id: 0, matched_by_name: 0, inserted: 0, errors: 0 };

  // Classify species into inserts vs updates using in-memory matching
  type GbifSource = typeof speciesList[number];
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: number; row: Record<string, unknown>; source: GbifSource; matchType: string }> = [];

  for (const s of speciesList) {
    const result = findMatch(index, {
      primaryId: { type: "gbif_species_key", value: s.speciesKey },
      scientificName: s.scientificName,
    });

    if (result.match === "none") {
      toInsert.push({
        scientific_name: s.scientificName,
        common_name: s.commonName || null,
        taxon_group: s.taxonGroup,
        gbif_species_key: s.speciesKey,
        gbif_occurrence_count: s.observationsTotal,
        gbif_occurrences_since_assessment: s.observationsAfterAssessment,
        status: "active",
        synced_at: new Date().toISOString(),
      });
    } else {
      toUpdate.push({
        id: result.species.id,
        row: {
          gbif_species_key: s.speciesKey,
          gbif_occurrence_count: s.observationsTotal,
          gbif_occurrences_since_assessment: s.observationsAfterAssessment,
          ...(result.species.sis_taxon_id === null && s.commonName ? { common_name: s.commonName } : {}),
          synced_at: new Date().toISOString(),
        },
        source: s,
        matchType: result.match,
      });
    }
  }

  // Batch inserts
  for (let i = 0; i < toInsert.length; i += UPSERT_BATCH_SIZE) {
    const batch = toInsert.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from("species").insert(batch);
    if (error) {
      stats.errors += batch.length;
      logger.log("error", { error: error.message, context: "batch_insert", count: batch.length });
    } else {
      stats.inserted += batch.length;
    }
    process.stdout.write(`\r  Inserted ${Math.min(i + UPSERT_BATCH_SIZE, toInsert.length)}/${toInsert.length}`);
  }
  if (toInsert.length > 0) console.log("");

  // Updates must be individual (each targets a different row by id)
  for (let i = 0; i < toUpdate.length; i++) {
    const { id, row, source, matchType } = toUpdate[i];
    const { error } = await supabase.from("species").update(row).eq("id", id);
    if (error) {
      stats.errors++;
      logger.log("error", { name: source.scientificName, gbif_species_key: source.speciesKey, error: error.message });
    } else {
      if (matchType === "by_col_id") {
        stats.matched_by_col_id++;
        logger.log("matched_by_col_id", { name: source.scientificName, gbif_species_key: source.speciesKey, matched_id: id });
      } else if (matchType === "by_name") {
        stats.matched_by_name++;
        logger.log("matched_by_name", { name: source.scientificName, gbif_species_key: source.speciesKey, matched_id: id });
      } else {
        stats.matched_by_id++;
      }
    }
    if ((i + 1) % UPSERT_BATCH_SIZE === 0 || i === toUpdate.length - 1) {
      process.stdout.write(`\r  Updated ${i + 1}/${toUpdate.length}`);
    }
  }
  if (toUpdate.length > 0) console.log("");

  return stats;
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

  console.log("sync-gbif: GBIF API → Supabase");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const supabase = createServiceClient();
  const logger = new SyncLogger("sync-gbif");

  try {
    logger.log("sync_start", {
      taxa: taxaToSync.map((t) => t.id),
      taxa_count: taxaToSync.length,
    });

    const totals: GbifUpsertStats = { inserted: 0, matched_by_id: 0, matched_by_col_id: 0, matched_by_name: 0, errors: 0 };

    for (const taxon of taxaToSync) {
      console.log(`\n${taxon.name} (${taxon.id}):`);

      // Step 1: Fetch total occurrence counts
      console.log("  Fetching species observation counts from GBIF...");
      const rawResults = await fetchAllSpeciesCounts(taxon);
      console.log(`  Raw species: ${rawResults.length}`);

      // Step 2: Validate species keys
      console.log("  Validating species keys...");
      const speciesKeys = rawResults.map((r) => r.speciesKey);
      const validSpecies = await validateSpeciesKeys(speciesKeys);
      console.log(`  Valid species: ${validSpecies.size}`);

      const validated = rawResults
        .filter((r) => validSpecies.has(r.speciesKey))
        .map((r) => {
          const info = validSpecies.get(r.speciesKey)!;
          return {
            speciesKey: r.speciesKey,
            observationsTotal: r.count,
            scientificName: info.canonicalName,
            commonName: info.vernacularName,
            taxonGroup: r.taxonGroup,
          };
        });

      // Step 3: Load assessment dates from Supabase for post-assessment counts
      console.log("  Loading assessment dates from Supabase...");
      const { data: assessedSpecies, error: assessError } = await supabase
        .from("species")
        .select("scientific_name, assessment_date")
        .not("assessment_date", "is", null);

      if (assessError) throw new Error(`Failed to fetch assessment dates: ${assessError.message}`);

      const assessmentYears = new Map<string, number>();
      for (const row of assessedSpecies || []) {
        if (row.assessment_date) {
          const year = parseInt(row.assessment_date.slice(0, 4), 10);
          if (!isNaN(year)) {
            assessmentYears.set(normalizeSpeciesName(row.scientific_name), year);
          }
        }
      }
      console.log(`  ${assessmentYears.size} species with assessment dates`);

      // Match validated species to assessment years
      const speciesAssessmentYear = new Map<number, number>();
      for (const sp of validated) {
        const year = assessmentYears.get(normalizeSpeciesName(sp.scientificName));
        if (year !== undefined) {
          speciesAssessmentYear.set(sp.speciesKey, year);
        }
      }
      console.log(`  ${speciesAssessmentYear.size} matched to assessment years`);

      // Step 4: Year-bucketed GBIF queries for post-assessment counts
      const uniqueYears = [...new Set(speciesAssessmentYear.values())].sort((a, b) => a - b);
      const yearBuckets = uniqueYears.filter((y) => y + 1 <= CURRENT_YEAR);
      console.log(`  ${yearBuckets.length} year buckets to query`);

      const sinceAssessmentCounts = new Map<number, number>();

      yearRangeMode = true;
      for (const assessmentYear of yearBuckets) {
        const speciesInBucket = [...speciesAssessmentYear.entries()]
          .filter(([, y]) => y === assessmentYear)
          .map(([key]) => key);

        process.stdout.write(`\r  Post-assessment: year ${assessmentYear} (${speciesInBucket.length} species)...`);

        const counts = await fetchFacetsForYearRange(taxon, assessmentYear + 1, CURRENT_YEAR);

        for (const speciesKey of speciesInBucket) {
          sinceAssessmentCounts.set(speciesKey, counts.get(speciesKey) ?? 0);
        }
      }
      yearRangeMode = false;
      if (yearBuckets.length > 0) console.log("");

      // Step 5: Upsert into Supabase
      console.log("  Upserting into Supabase...");
      const speciesList = validated.map((sp) => ({
        ...sp,
        commonName: sp.commonName ? toTitleCase(sp.commonName) : "",
        observationsAfterAssessment: sinceAssessmentCounts.has(sp.speciesKey)
          ? sinceAssessmentCounts.get(sp.speciesKey)!
          : null,
      }));

      logger.log("taxon_start", { taxon_id: taxon.id, taxon_name: taxon.name, raw_species: rawResults.length, valid_species: speciesList.length });

      const stats = await upsertGbifSpecies(supabase, speciesList, logger);

      logger.log("taxon_complete", { taxon_id: taxon.id, taxon_name: taxon.name, raw_species: rawResults.length, valid_species: speciesList.length, ...stats });

      for (const key of Object.keys(totals) as (keyof GbifUpsertStats)[]) {
        totals[key] += stats[key];
      }
    }

    // Log + print summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", { ...totals, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("sync-gbif complete:");
    console.log(`  Matched by gbif_species_key: ${totals.matched_by_id.toLocaleString()}`);
    console.log(`  Matched by col_id:           ${totals.matched_by_col_id.toLocaleString()}`);
    console.log(`  Matched by name:             ${totals.matched_by_name.toLocaleString()}`);
    console.log(`  Inserted new (NE):           ${totals.inserted.toLocaleString()}`);
    if (totals.errors) {
      console.log(`  Errors:                      ${totals.errors.toLocaleString()}`);
    }
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("sync-gbif.ts") || process.argv[1]?.endsWith("sync-gbif.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
