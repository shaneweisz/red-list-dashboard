/**
 * sync-gbif: GBIF API → Supabase
 *
 * Fetches per-species observation counts from GBIF and upserts into gbif_species.
 * Does NOT touch the species linking table — that's handled by link-gbif.
 *
 * Two modes:
 *   --counts-only             Fetch + upsert total counts only
 *   --since-assessment-only   Compute count_since_assessment via FK join
 *   (no flags)                Run both phases
 *
 * Prerequisites:
 *   1. Environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   2. For --since-assessment-only: link-gbif must have run first
 *
 * Usage:
 *   npx tsx scripts/sync-gbif.ts <taxon> [--counts-only|--since-assessment-only]
 *   npx tsx scripts/sync-gbif.ts [--counts-only|--since-assessment-only]
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  loadEnvFiles,
  createServiceClient,
  fetchAllRows,
  SyncLogger,
} from "./sync-utils";

// =============================================================================
// GBIF TAXA CONFIGURATION
// =============================================================================

interface GbifQuery {
  keyType: "kingdomKey" | "classKey" | "orderKey";
  keyValue: number;
  taxonGroup: string;
}

interface GbifTaxonConfig {
  id: string;
  name: string;
  queries: GbifQuery[];
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
      { keyType: "classKey", keyValue: 351, taxonGroup: "horseshoe_crabs" },
      { keyType: "classKey", keyValue: 222, taxonGroup: "other_invertebrates" }, // Holothuroidea
      { keyType: "classKey", keyValue: 255, taxonGroup: "other_invertebrates" }, // Clitellata
      { keyType: "classKey", keyValue: 361, taxonGroup: "other_invertebrates" }, // Diplopoda
      { keyType: "classKey", keyValue: 10713444, taxonGroup: "other_invertebrates" }, // Collembola
      { keyType: "classKey", keyValue: 360, taxonGroup: "other_invertebrates" }, // Chilopoda
      { keyType: "classKey", keyValue: 199, taxonGroup: "other_invertebrates" }, // Demospongiae
      { keyType: "classKey", keyValue: 205, taxonGroup: "other_invertebrates" }, // Hydrozoa
      { keyType: "classKey", keyValue: 214, taxonGroup: "other_invertebrates" }, // Asteroidea
      { keyType: "classKey", keyValue: 308, taxonGroup: "other_invertebrates" }, // Calcarea
      { keyType: "classKey", keyValue: 256, taxonGroup: "other_invertebrates" }, // Polychaeta
      { keyType: "classKey", keyValue: 341, taxonGroup: "other_invertebrates" }, // Turbellaria
      { keyType: "classKey", keyValue: 221, taxonGroup: "other_invertebrates" }, // Echinoidea
      { keyType: "classKey", keyValue: 63, taxonGroup: "other_invertebrates" },  // Nemertea
      { keyType: "classKey", keyValue: 62, taxonGroup: "velvet_worms" },         // Onychophora
    ],
  },
  plantae: {
    id: "plantae", name: "Plants",
    queries: [{ keyType: "kingdomKey", keyValue: 6, taxonGroup: "plantae" }],
  },
  fungi: {
    id: "fungi", name: "Fungi",
    queries: [{ keyType: "kingdomKey", keyValue: 5, taxonGroup: "fungi" }],
  },
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const FACET_LIMIT = 100000;
const REQUEST_DELAY = 200; // ms between GBIF requests
const SPECIES_VALIDATION_BATCH_SIZE = 1000;
const CURRENT_YEAR = new Date().getFullYear();
const MAX_RETRIES = 5;

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
  taxonGroup: string;
}

interface ValidatedSpecies {
  key: number;
  canonicalName: string;
  vernacularName: string;
  className: string;
  orderName: string;
}

// =============================================================================
// HELPERS
// =============================================================================

let rateLimitHits = 0;
const YEAR_BUCKET_CONCURRENCY = 30;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run async tasks with a concurrency limit (worker pool pattern).
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// =============================================================================
// GBIF API FUNCTIONS
// =============================================================================

/**
 * Fetch species occurrence facets for a single taxon key. Sequential with retry.
 */
async function fetchFacets(
  keyType: string,
  keyValue: number,
  yearRange?: string,
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

    let response: Response | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
      } catch (err) {
        // Network error (ETIMEDOUT, ECONNRESET, etc.) — retry with backoff
        if (attempt < MAX_RETRIES) {
          const wait = Math.pow(2, attempt + 1) * 1000;
          await delay(wait);
          continue;
        }
        throw err;
      }
      if (response.status === 429) {
        rateLimitHits++;
        const wait = Math.pow(2, attempt + 1) * 1000;
        await delay(wait);
        continue;
      }
      break;
    }
    if (!response || !response.ok) throw new Error(`GBIF API error: ${response?.statusText}`);

    const data = await response.json();
    const facet = data.facets?.find((f: { field: string }) => f.field === "SPECIES_KEY");

    if (!facet || facet.counts.length === 0) break;

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

/**
 * Fetch all species counts for a taxon. Sequential queries (one at a time).
 */
async function fetchAllSpeciesCounts(taxon: GbifTaxonConfig): Promise<SpeciesCount[]> {
  const allResults: SpeciesCount[] = [];

  for (let i = 0; i < taxon.queries.length; i++) {
    const q = taxon.queries[i];
    process.stdout.write(`\r  Query ${i + 1}/${taxon.queries.length}`);
    const results = await fetchFacets(q.keyType, q.keyValue);
    for (const r of results) {
      allResults.push({ speciesKey: r.speciesKey, count: r.count, taxonGroup: q.taxonGroup });
    }
    if (i < taxon.queries.length - 1) await delay(REQUEST_DELAY);
  }
  console.log("");

  // Deduplicate: keep highest count per speciesKey
  const seen = new Map<number, SpeciesCount>();
  for (const r of allResults) {
    if (!seen.has(r.speciesKey) || seen.get(r.speciesKey)!.count < r.count) {
      seen.set(r.speciesKey, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.count - a.count);
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
          if (!res.ok) return { key, rank: "UNKNOWN", status: "UNKNOWN", canonicalName: "", vernacularName: "", className: "", orderName: "" };
          const data = await res.json();
          return {
            key,
            rank: data.rank || "UNKNOWN",
            status: data.taxonomicStatus || "UNKNOWN",
            canonicalName: data.canonicalName || data.scientificName || "",
            vernacularName: data.vernacularName || "",
            className: data.class || "",
            orderName: data.order || "",
          };
        } catch {
          return { key, rank: "ERROR", status: "ERROR", canonicalName: "", vernacularName: "", className: "", orderName: "" };
        }
      })
    );

    for (const info of results) {
      if (info.rank === "SPECIES" && info.status === "ACCEPTED") {
        valid.set(info.key, { key: info.key, canonicalName: info.canonicalName, vernacularName: info.vernacularName, className: info.className, orderName: info.orderName });
      }
    }

    const progress = Math.min(i + SPECIES_VALIDATION_BATCH_SIZE, speciesKeys.length);
    process.stdout.write(`\r  Validated ${progress}/${speciesKeys.length} (${valid.size} valid)`);
  }

  console.log("");
  return valid;
}

// =============================================================================
// UPSERT LOGIC
// =============================================================================

const UPSERT_BATCH_SIZE = 1000;

export interface GbifUpsertStats {
  upserted: number;
  errors: number;
}

/**
 * Upsert species into gbif_species table. Simple PK-based upsert.
 * Does NOT touch the species linking table.
 */
export async function upsertGbifSpecies(
  supabase: SupabaseClient,
  speciesList: Array<{
    speciesKey: number;
    scientificName: string;
    commonName: string;
    taxonGroup: string;
    observationsTotal: number;
    observationsAfterAssessment?: number | null;
  }>,
  logger: SyncLogger
): Promise<GbifUpsertStats> {
  const stats: GbifUpsertStats = { upserted: 0, errors: 0 };

  for (let i = 0; i < speciesList.length; i += UPSERT_BATCH_SIZE) {
    const batch = speciesList.slice(i, i + UPSERT_BATCH_SIZE);
    const rows = batch.map((s) => ({
      gbif_species_key: s.speciesKey,
      scientific_name: s.scientificName,
      common_name: s.commonName || null,
      taxon_group: s.taxonGroup,
      total_count: s.observationsTotal,
      ...(s.observationsAfterAssessment !== undefined
        ? { count_since_assessment: s.observationsAfterAssessment }
        : {}),
      synced_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("gbif_species")
      .upsert(rows, { onConflict: "gbif_species_key" });

    if (error) {
      stats.errors += batch.length;
      logger.log("error", { error: error.message, context: "gbif_upsert", count: batch.length });
    } else {
      stats.upserted += batch.length;
    }
    process.stdout.write(`\r  Upserted ${Math.min(i + UPSERT_BATCH_SIZE, speciesList.length)}/${speciesList.length} into gbif_species`);
  }
  if (speciesList.length > 0) console.log("");

  return stats;
}

// =============================================================================
// SINCE-ASSESSMENT PHASE
// =============================================================================

/**
 * Compute count_since_assessment for linked species.
 * Loads assessment dates via FK join (species → redlist_species),
 * then fetches year-bucketed counts from GBIF.
 */
export async function computeSinceAssessment(
  supabase: SupabaseClient,
  taxon: GbifTaxonConfig,
  logger: SyncLogger
): Promise<{ updated: number; errors: number }> {
  // Fetch gbif_species_keys for this taxon group only
  const gbifKeysForTaxon = await fetchAllRows<{ gbif_species_key: number }>(
    supabase, "gbif_species", "gbif_species_key",
    (q) => q.eq("taxon_group", taxon.id)
  );
  const taxonGbifKeys = new Set(gbifKeysForTaxon.map((r) => r.gbif_species_key));

  // Fetch linked species: those with both FKs set in species table
  const linkedSpecies = await fetchAllRows<{
    gbif_species_key: number;
    sis_taxon_id: number;
  }>(
    supabase, "species", "gbif_species_key, sis_taxon_id",
    (q) => q.not("gbif_species_key", "is", null).not("sis_taxon_id", "is", null)
  );

  // Filter to only species in this taxon group
  const taxonLinkedSpecies = linkedSpecies.filter((s) => taxonGbifKeys.has(s.gbif_species_key));

  // Fetch assessment dates from redlist_species
  const redlistRows = await fetchAllRows<{
    sis_taxon_id: number;
    assessment_date: string;
  }>(
    supabase, "redlist_species", "sis_taxon_id, assessment_date",
    (q) => q.not("assessment_date", "is", null)
  );

  const assessmentDateByTaxon = new Map<number, string>();
  for (const row of redlistRows) {
    assessmentDateByTaxon.set(row.sis_taxon_id, row.assessment_date);
  }

  // Build gbif_species_key → assessment year mapping
  const speciesAssessmentYear = new Map<number, number>();
  for (const link of taxonLinkedSpecies) {
    const date = assessmentDateByTaxon.get(link.sis_taxon_id);
    if (date) {
      const year = parseInt(date.slice(0, 4), 10);
      if (!isNaN(year)) {
        speciesAssessmentYear.set(link.gbif_species_key, year);
      }
    }
  }
  console.log(`  ${speciesAssessmentYear.size} linked species with assessment dates`);

  // Compute year-bucketed counts
  const uniqueYears = [...new Set(speciesAssessmentYear.values())].sort((a, b) => a - b);
  const yearBuckets = uniqueYears.filter((y) => y + 1 <= CURRENT_YEAR);

  // Precompute species per year bucket
  const speciesByYear = new Map<number, Set<number>>();
  for (const [speciesKey, year] of speciesAssessmentYear) {
    if (!speciesByYear.has(year)) speciesByYear.set(year, new Set());
    speciesByYear.get(year)!.add(speciesKey);
  }

  const sinceAssessmentCounts = new Map<number, number>();
  for (const [speciesKey] of speciesAssessmentYear) {
    sinceAssessmentCounts.set(speciesKey, 0);
  }

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

  // Update gbif_species with since-assessment counts (batched upsert)
  let updated = 0;
  let errors = 0;
  const entries = Array.from(sinceAssessmentCounts.entries());

  for (let i = 0; i < entries.length; i += UPSERT_BATCH_SIZE) {
    const batch = entries.slice(i, i + UPSERT_BATCH_SIZE);
    const rows = batch.map(([key, count]) => ({
      gbif_species_key: key,
      count_since_assessment: count,
    }));

    const { error } = await supabase
      .from("gbif_species")
      .upsert(rows, { onConflict: "gbif_species_key" });

    if (error) {
      errors += batch.length;
      logger.log("error", { error: error.message, context: "since_assessment_upsert", count: batch.length });
    } else {
      updated += batch.length;
    }
    process.stdout.write(`\r  Updated ${Math.min(i + UPSERT_BATCH_SIZE, entries.length)}/${entries.length} since-assessment counts`);
  }
  if (entries.length > 0) console.log("");

  return { updated, errors };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const taxonArg = positionalArgs[0]?.toLowerCase();

  const countsOnly = flags.includes("--counts-only");
  const sinceAssessmentOnly = flags.includes("--since-assessment-only");

  const taxaToSync = taxonArg
    ? (GBIF_TAXA[taxonArg] ? [GBIF_TAXA[taxonArg]] : [])
    : Object.values(GBIF_TAXA);

  if (taxonArg && taxaToSync.length === 0) {
    console.error(`Unknown taxon: ${taxonArg}`);
    console.error("Available:", Object.keys(GBIF_TAXA).join(", "));
    process.exit(1);
  }

  console.log("sync-gbif: GBIF API → Supabase");
  if (countsOnly) console.log("Mode: --counts-only");
  if (sinceAssessmentOnly) console.log("Mode: --since-assessment-only");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const supabase = createServiceClient();
  const logger = new SyncLogger("sync-gbif");

  try {
    logger.log("sync_start", {
      taxa: taxaToSync.map((t) => t.id),
      taxa_count: taxaToSync.length,
      mode: countsOnly ? "counts-only" : sinceAssessmentOnly ? "since-assessment-only" : "full",
    });

    const totals: GbifUpsertStats = { upserted: 0, errors: 0 };
    let sinceAssessmentTotals = { updated: 0, errors: 0 };

    for (const taxon of taxaToSync) {
      const taxonStart = Date.now();
      console.log(`\n${taxon.name} (${taxon.id}):`);

      // Phase 1: Total counts
      if (!sinceAssessmentOnly) {
        console.log("  Fetching species observation counts from GBIF...");
        const rawResults = await fetchAllSpeciesCounts(taxon);
        console.log(`  Raw species: ${rawResults.length}`);

        console.log("  Validating species keys...");
        const speciesKeys = rawResults.map((r) => r.speciesKey);
        const validSpecies = await validateSpeciesKeys(speciesKeys);
        console.log(`  Valid species: ${validSpecies.size}`);

        const speciesList = rawResults
          .filter((r) => validSpecies.has(r.speciesKey))
          .map((r) => {
            const info = validSpecies.get(r.speciesKey)!;
            return {
              speciesKey: r.speciesKey,
              observationsTotal: r.count,
              scientificName: info.canonicalName,
              commonName: info.vernacularName ? toTitleCase(info.vernacularName) : "",
              taxonGroup: r.taxonGroup,
            };
          });

        console.log("  Upserting into gbif_species...");
        const stats = await upsertGbifSpecies(supabase, speciesList, logger);
        totals.upserted += stats.upserted;
        totals.errors += stats.errors;

        logger.log("taxon_counts_complete", {
          taxon_id: taxon.id, raw_species: rawResults.length,
          valid_species: speciesList.length, ...stats,
        });
      }

      // Phase 2: Since-assessment counts
      if (!countsOnly) {
        console.log("  Computing since-assessment counts...");
        const saStats = await computeSinceAssessment(supabase, taxon, logger);
        sinceAssessmentTotals.updated += saStats.updated;
        sinceAssessmentTotals.errors += saStats.errors;

        logger.log("taxon_since_assessment_complete", {
          taxon_id: taxon.id, ...saStats,
        });
      }

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      logger.log("taxon_complete", { taxon_id: taxon.id, duration_seconds: Number(taxonDuration) });
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", { ...totals, since_assessment: sinceAssessmentTotals, rate_limit_retries: rateLimitHits, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("sync-gbif complete:");
    if (!sinceAssessmentOnly) {
      console.log(`  Upserted:                   ${totals.upserted.toLocaleString()}`);
      if (totals.errors) {
        console.log(`  Errors:                     ${totals.errors.toLocaleString()}`);
      }
    }
    if (!countsOnly) {
      console.log(`  Since-assessment updated:   ${sinceAssessmentTotals.updated.toLocaleString()}`);
      if (sinceAssessmentTotals.errors) {
        console.log(`  Since-assessment errors:    ${sinceAssessmentTotals.errors.toLocaleString()}`);
      }
    }
    if (rateLimitHits > 0) {
      console.log(`  Rate limit retries (429s):  ${rateLimitHits}`);
    }
    console.log(`  Duration: ${minutes}m ${seconds}s`);

    // Refresh materialized view
    console.log("\nRefreshing taxa_summary materialized view...");
    const { error: viewError } = await supabase.rpc("refresh_taxa_summary");
    if (viewError) {
      console.error(`  Error: ${viewError.message}`);
      logger.log("refresh_view_error", { error: viewError.message });
    } else {
      console.log("  Done.");
    }
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
