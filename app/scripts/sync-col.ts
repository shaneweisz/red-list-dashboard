/**
 * sync-col: Catalogue of Life API → Supabase
 *
 * Resolves scientific names to COL IDs via the ChecklistBank API,
 * then merges duplicate rows that share a col_id.
 *
 * Prerequisites:
 *   Environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx scripts/sync-col.ts             # Resolve all species without col_id
 *   npx tsx scripts/sync-col.ts --full      # Re-resolve all species
 *   npx tsx scripts/sync-col.ts --merge     # Only run the merge step
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  loadEnvFiles,
  createServiceClient,
  SyncLogger,
} from "./sync-utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const COL_API_BASE = "https://api.checklistbank.org";
const COL_DATASET_KEY = "3LR"; // COL Living Release
const REQUEST_DELAY = 100; // ms between API calls
const BATCH_SIZE = 100; // Species processed per batch

// =============================================================================
// TYPES
// =============================================================================

interface ColMatchResult {
  type: "exact" | "variant" | "none";
  colId: string | null;
  matchedName: string | null;
}

// =============================================================================
// COL API
// =============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a scientific name to a COL ID via ChecklistBank API.
 */
export async function resolveColId(scientificName: string): Promise<ColMatchResult> {
  try {
    const params = new URLSearchParams({ q: scientificName });
    const url = `${COL_API_BASE}/dataset/${COL_DATASET_KEY}/match/nameusage?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      return { type: "none", colId: null, matchedName: null };
    }

    const data = await response.json();

    if (!data.usage || !data.usage.id) {
      return { type: "none", colId: null, matchedName: null };
    }

    const matchType = data.type === "exact" ? "exact" : "variant";
    return {
      type: matchType,
      colId: data.usage.id,
      matchedName: data.usage.name?.scientificName || null,
    };
  } catch {
    return { type: "none", colId: null, matchedName: null };
  }
}

// =============================================================================
// COL ID RESOLUTION
// =============================================================================

/**
 * Resolve COL IDs for species in Supabase.
 * Updates species.col_id for each resolved name.
 */
/**
 * A pending merge: a species that resolved to a col_id already owned by another row.
 */
export interface PendingMerge {
  speciesId: number;
  colId: string;
}

export async function resolveColIds(
  supabase: SupabaseClient,
  logger: SyncLogger,
  fullMode: boolean
): Promise<PendingMerge[]> {
  // Fetch species needing resolution
  let query = supabase
    .from("species")
    .select("id, scientific_name, col_id")
    .eq("status", "active");

  if (!fullMode) {
    query = query.is("col_id", null);
  }

  const { data: species, error } = await query;
  if (error) throw new Error(`Failed to fetch species: ${error.message}`);

  if (!species || species.length === 0) {
    console.log("  No species to resolve");
    return [];
  }

  console.log(`  Resolving ${species.length} species...`);
  const stats = { exact: 0, variant: 0, none: 0, errors: 0 };
  const pendingMerges: PendingMerge[] = [];

  for (let i = 0; i < species.length; i += BATCH_SIZE) {
    const batch = species.slice(i, i + BATCH_SIZE);

    for (const s of batch) {
      const result = await resolveColId(s.scientific_name);

      if (result.type === "none") {
        stats.none++;
        logger.log("col_no_match", { name: s.scientific_name, species_id: s.id });
      } else {
        const updateData: Record<string, unknown> = { col_id: result.colId };
        const { error: updateError } = await supabase
          .from("species")
          .update(updateData)
          .eq("id", s.id);

        if (updateError) {
          stats.errors++;
          // Unique constraint violation means another row already has this col_id
          if (updateError.code === "23505") {
            pendingMerges.push({ speciesId: s.id, colId: result.colId! });
            logger.log("col_duplicate_id", {
              name: s.scientific_name,
              species_id: s.id,
              col_id: result.colId,
              note: "Another row already has this col_id — will be merged",
            });
          } else {
            logger.log("error", { name: s.scientific_name, species_id: s.id, error: updateError.message });
          }
        } else {
          if (result.type === "exact") stats.exact++;
          else stats.variant++;
        }
      }

      await delay(REQUEST_DELAY);
    }

    const progress = Math.min(i + BATCH_SIZE, species.length);
    process.stdout.write(`\r  Resolved ${progress}/${species.length} (${stats.exact} exact, ${stats.variant} variant, ${stats.none} no match)`);
  }

  console.log("");
  console.log(`  Results: ${stats.exact} exact, ${stats.variant} variant, ${stats.none} no match, ${stats.errors} errors`);
  if (pendingMerges.length > 0) {
    console.log(`  ${pendingMerges.length} pending merges (duplicate col_ids)`);
  }
  return pendingMerges;
}

// =============================================================================
// DUPLICATE MERGING
// =============================================================================

/**
 * Merge species rows that resolved to the same COL ID.
 *
 * Due to the UNIQUE constraint on col_id, two rows can't simultaneously have
 * the same col_id. Instead, resolveColIds returns a list of pending merges:
 * cases where a species resolved to a col_id already owned by another row.
 *
 * For each pending merge:
 * 1. Fetch both the owner (row with col_id set) and the duplicate (row that couldn't set it)
 * 2. Pick survivor (prefer IUCN row)
 * 3. Merge GBIF columns from duplicate into survivor
 * 4. Delete the duplicate
 *
 * If both rows have sis_taxon_id (possible homonym), skip the merge and log a warning.
 */
export async function mergeDuplicateColIds(
  supabase: SupabaseClient,
  pendingMerges: PendingMerge[],
  logger: SyncLogger
): Promise<number> {
  if (pendingMerges.length === 0) return 0;

  let mergedCount = 0;

  for (const { speciesId: dupId, colId } of pendingMerges) {
    // Fetch the owner (has col_id set) and the duplicate
    const { data: owner } = await supabase
      .from("species")
      .select("id, scientific_name, sis_taxon_id, gbif_species_key, gbif_occurrence_count, gbif_occurrences_since_assessment, common_name")
      .eq("col_id", colId)
      .single();

    const { data: dup } = await supabase
      .from("species")
      .select("id, scientific_name, sis_taxon_id, gbif_species_key, gbif_occurrence_count, gbif_occurrences_since_assessment, common_name")
      .eq("id", dupId)
      .single();

    if (!owner || !dup) {
      logger.log("error", { col_id: colId, species_id: dupId, note: "Could not find owner or duplicate for merge" });
      continue;
    }

    // Check if both have sis_taxon_id — possible homonym, skip
    if (owner.sis_taxon_id !== null && dup.sis_taxon_id !== null) {
      logger.log("col_homonym_skip", {
        name: `${owner.scientific_name} / ${dup.scientific_name}`,
        col_id: colId,
        note: `Both rows have sis_taxon_id: ${owner.sis_taxon_id}, ${dup.sis_taxon_id}`,
      });
      continue;
    }

    // Pick survivor: prefer IUCN row
    const survivor = owner.sis_taxon_id !== null ? owner : (dup.sis_taxon_id !== null ? dup : owner);
    const toDelete = survivor.id === owner.id ? dup : owner;

    // If survivor is the dup (no col_id yet), we need to swap: set col_id on survivor and clear on owner
    if (survivor.id !== owner.id) {
      // Clear col_id on owner first to avoid unique violation
      await supabase.from("species").update({ col_id: null }).eq("id", owner.id);
      await supabase.from("species").update({ col_id: colId }).eq("id", survivor.id);
    }

    // Delete duplicate first (before GBIF merge to avoid unique constraint on gbif_species_key)
    const { error: deleteError } = await supabase
      .from("species")
      .delete()
      .eq("id", toDelete.id);

    // Merge GBIF data from toDelete into survivor if survivor lacks it
    if (!deleteError && !survivor.gbif_species_key && toDelete.gbif_species_key) {
      await supabase
        .from("species")
        .update({
          gbif_species_key: toDelete.gbif_species_key,
          gbif_occurrence_count: toDelete.gbif_occurrence_count,
          gbif_occurrences_since_assessment: toDelete.gbif_occurrences_since_assessment,
          common_name: survivor.common_name || toDelete.common_name,
        })
        .eq("id", survivor.id);
    }

    if (deleteError) {
      logger.log("error", {
        name: toDelete.scientific_name,
        species_id: toDelete.id,
        error: deleteError.message,
        note: "Failed to delete duplicate",
      });
    } else {
      mergedCount++;
      logger.log("col_merged", {
        name: `${toDelete.scientific_name} → ${survivor.scientific_name}`,
        col_id: colId,
        deleted_id: toDelete.id,
        survivor_id: survivor.id,
      });
    }
  }

  return mergedCount;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const fullMode = args.includes("--full");
  const mergeOnly = args.includes("--merge");

  console.log("sync-col: Catalogue of Life API → Supabase");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const supabase = createServiceClient();
  const logger = new SyncLogger("sync-col");

  try {
    let pendingMerges: PendingMerge[] = [];

    if (!mergeOnly) {
      console.log(`\nResolving COL IDs (${fullMode ? "full" : "incremental"} mode)...`);
      pendingMerges = await resolveColIds(supabase, logger, fullMode);
    }

    console.log("\nMerging duplicates with shared col_id...");
    const mergedCount = await mergeDuplicateColIds(supabase, pendingMerges, logger);
    console.log(`  ${mergedCount} duplicates merged`);

    // Print summary
    const counts = logger.getCounts();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    console.log("\n" + "=".repeat(50));
    console.log("sync-col complete:");
    if (!mergeOnly) {
      console.log(`  Exact match:      ${(counts.exact || 0).toLocaleString()}`);
      console.log(`  Variant match:    ${(counts.variant || 0).toLocaleString()}`);
      console.log(`  No match:         ${(counts.col_no_match || 0).toLocaleString()}`);
    }
    console.log(`  Duplicates merged: ${mergedCount}`);
    if (counts.col_homonym_skip) {
      console.log(`  Homonym skips:    ${counts.col_homonym_skip}`);
    }
    if (counts.error) {
      console.log(`  Errors:           ${counts.error.toLocaleString()}`);
    }
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("sync-col.ts") || process.argv[1]?.endsWith("sync-col.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
