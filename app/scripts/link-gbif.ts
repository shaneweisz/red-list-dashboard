/**
 * link-gbif: GBIF Species Match API → Supabase species table
 *
 * Resolves Red List scientific names to GBIF species keys using
 * GBIF's fuzzy matching API, then sets species.gbif_species_key.
 *
 * This solves name mismatches (e.g. "mackloti" vs "macklotii") by
 * delegating matching to GBIF's own taxonomic backbone.
 *
 * Incremental: only processes unlinked species on subsequent runs.
 *
 * Prerequisites:
 *   1. sync-redlist has run (redlist_species populated)
 *   2. sync-gbif --counts-only has run (gbif_species populated)
 *
 * Usage:
 *   npx tsx scripts/link-gbif.ts
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  loadEnvFiles,
  createServiceClient,
  fetchAllRows,
  SyncLogger,
} from "./sync-utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const MATCH_CONCURRENCY = 50;
const UPSERT_BATCH_SIZE = 1000;
const MAX_RETRIES = 5;

// =============================================================================
// TYPES
// =============================================================================

export interface LinkStats {
  exact: number;
  fuzzy: number;
  no_match: number;
  no_gbif_data: number;
  already_linked: number;
  errors: number;
}

interface GbifMatchResponse {
  usageKey?: number;
  acceptedUsageKey?: number;
  canonicalName?: string;
  matchType?: string; // EXACT, FUZZY, HIGHERRANK, NONE
  rank?: string;
  confidence?: number;
  synonym?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// =============================================================================
// GBIF MATCH API
// =============================================================================

export type MatchFn = (name: string) => Promise<{ key: number | null; matchType: string }>;

/**
 * Call GBIF Species Match API for a single name.
 * Returns the resolved gbif_species_key or null.
 */
export async function matchGbifSpecies(
  name: string
): Promise<{ key: number | null; matchType: string }> {
  const params = new URLSearchParams({ name, strict: "true" });

  let response: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    response = await fetch(`https://api.gbif.org/v1/species/match?${params}`);
    if (response.status === 429) {
      const wait = Math.pow(2, attempt + 1) * 1000;
      await delay(wait);
      continue;
    }
    break;
  }
  if (!response || !response.ok) {
    throw new Error(`GBIF Match API error: ${response?.status} ${response?.statusText}`);
  }

  const data: GbifMatchResponse = await response.json();

  if (!data.matchType || data.matchType === "NONE" || data.matchType === "HIGHERRANK") {
    return { key: null, matchType: data.matchType || "NONE" };
  }

  if (data.rank !== "SPECIES") {
    return { key: null, matchType: "WRONG_RANK" };
  }

  // Use acceptedUsageKey if it's a synonym, otherwise usageKey
  const resolvedKey = data.acceptedUsageKey || data.usageKey || null;

  return { key: resolvedKey, matchType: data.matchType };
}

// =============================================================================
// MAIN LOGIC
// =============================================================================

export async function linkGbifSpecies(
  supabase: SupabaseClient,
  logger: SyncLogger,
  matchFn: MatchFn = matchGbifSpecies
): Promise<LinkStats> {
  const stats: LinkStats = { exact: 0, fuzzy: 0, no_match: 0, no_gbif_data: 0, already_linked: 0, errors: 0 };

  // Track gbif keys already claimed (by this run or pre-existing)
  const claimedGbifKeys = new Set<number>();
  const existingLinks = await fetchAllRows<{ gbif_species_key: number }>(
    supabase, "species", "gbif_species_key",
    (q) => q.not("gbif_species_key", "is", null)
  );
  for (const row of existingLinks) claimedGbifKeys.add(row.gbif_species_key);

  // Load unlinked species (those with sis_taxon_id set but no gbif_species_key)
  const unlinkedSpecies = await fetchAllRows<{
    id: number;
    sis_taxon_id: number;
  }>(
    supabase, "species", "id, sis_taxon_id",
    (q) => q.not("sis_taxon_id", "is", null).is("gbif_species_key", null)
  );

  if (unlinkedSpecies.length === 0) {
    console.log("  No unlinked species to process.");
    return stats;
  }

  // Load Red List names
  const redlistRows = await fetchAllRows<{
    sis_taxon_id: number;
    scientific_name: string;
  }>(supabase, "redlist_species", "sis_taxon_id, scientific_name");

  const nameByTaxon = new Map<number, string>();
  for (const row of redlistRows) {
    nameByTaxon.set(row.sis_taxon_id, row.scientific_name);
  }

  // Load all gbif_species_keys we have data for
  const gbifRows = await fetchAllRows<{ gbif_species_key: number }>(
    supabase, "gbif_species", "gbif_species_key"
  );
  const gbifKeysInDb = new Set(gbifRows.map((r) => r.gbif_species_key));

  console.log(`  ${unlinkedSpecies.length} unlinked species to match`);
  console.log(`  ${gbifKeysInDb.size} GBIF species keys available`);

  // Phase 1: Match all names via GBIF API (no DB writes)
  let matched = 0;
  const matchResults = await mapConcurrent(
    unlinkedSpecies,
    MATCH_CONCURRENCY,
    async (species) => {
      const name = nameByTaxon.get(species.sis_taxon_id);
      if (!name) {
        stats.errors++;
        return null;
      }

      try {
        const { key, matchType } = await matchFn(name);
        matched++;
        if (matched % 1000 === 0) {
          process.stdout.write(`\r  Matched ${matched}/${unlinkedSpecies.length}`);
        }
        return { species, name, key, matchType };
      } catch (err) {
        stats.errors++;
        logger.log("error", { sis_taxon_id: species.sis_taxon_id, name, error: String(err) });
        return null;
      }
    }
  );
  process.stdout.write(`\r  Matched ${unlinkedSpecies.length}/${unlinkedSpecies.length}\n`);

  // Phase 2: Deduplicate and classify results
  const toUpdate: { sis_taxon_id: number; gbif_species_key: number }[] = [];

  for (const result of matchResults) {
    if (!result) continue;
    const { species, name, key, matchType } = result;

    if (key === null) {
      stats.no_match++;
      logger.log("no_match", { sis_taxon_id: species.sis_taxon_id, name, matchType });
    } else if (!gbifKeysInDb.has(key)) {
      stats.no_gbif_data++;
      logger.log("no_gbif_data", { sis_taxon_id: species.sis_taxon_id, name, gbif_key: key });
    } else if (claimedGbifKeys.has(key)) {
      stats.already_linked++;
      logger.log("already_linked", { sis_taxon_id: species.sis_taxon_id, name, gbif_key: key });
    } else {
      claimedGbifKeys.add(key);
      toUpdate.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: key });
      if (matchType === "EXACT") {
        stats.exact++;
      } else {
        stats.fuzzy++;
        logger.log("fuzzy_match", { sis_taxon_id: species.sis_taxon_id, name, gbif_key: key });
      }
    }
  }

  // Phase 3: Batch upsert into species table
  console.log(`  Updating ${toUpdate.length} species links...`);
  for (let i = 0; i < toUpdate.length; i += UPSERT_BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from("species")
      .upsert(batch, { onConflict: "sis_taxon_id" });

    if (error) {
      stats.errors += batch.length;
      logger.log("error", { error: error.message, context: "link_upsert", count: batch.length });
    }
    process.stdout.write(`\r  Updated ${Math.min(i + UPSERT_BATCH_SIZE, toUpdate.length)}/${toUpdate.length}`);
  }
  if (toUpdate.length > 0) console.log("");

  return stats;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  console.log("link-gbif: GBIF Match API → Supabase species table");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const supabase = createServiceClient();
  const logger = new SyncLogger("link-gbif");

  try {
    logger.log("link_start", {});

    const stats = await linkGbifSpecies(supabase, logger);

    // Refresh materialized view
    console.log("\nRefreshing taxa_summary materialized view...");
    const { error: viewError } = await supabase.rpc("refresh_taxa_summary");
    if (viewError) {
      console.error(`  Error: ${viewError.message}`);
      logger.log("refresh_view_error", { error: viewError.message });
    } else {
      console.log("  Done.");
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("link_complete", { ...stats, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("link-gbif complete:");
    console.log(`  Exact matches:     ${stats.exact.toLocaleString()}`);
    console.log(`  Fuzzy matches:     ${stats.fuzzy.toLocaleString()}`);
    console.log(`  No match:          ${stats.no_match.toLocaleString()}`);
    console.log(`  No GBIF data:      ${stats.no_gbif_data.toLocaleString()}`);
    if (stats.already_linked) {
      console.log(`  Already linked:    ${stats.already_linked.toLocaleString()}`);
    }
    if (stats.errors) {
      console.log(`  Errors:            ${stats.errors.toLocaleString()}`);
    }
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("link-gbif.ts") || process.argv[1]?.endsWith("link-gbif.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
