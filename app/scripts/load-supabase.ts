/**
 * load-supabase: Local CSVs → Supabase (upsert)
 *
 * Reads redlist-species.csv and gbif-species.csv,
 * merges them into a single species table, then upserts into Supabase.
 *
 * Upsert strategy (cascading match):
 *   1. Promote: GBIF-only rows that now have a sis_taxon_id get updated
 *   2. Red List species: upsert ON CONFLICT (sis_taxon_id)
 *   3. GBIF-only species: upsert ON CONFLICT (gbif_species_key)
 *   4. Stale rows (not touched in this sync) are deleted
 *
 * Merge logic:
 *   - Each Red List row becomes a species row (with assessment data).
 *     If linked to GBIF, the GBIF key and counts are added.
 *   - Each GBIF row NOT linked to any Red List species becomes a
 *     GBIF-only species row (no assessment data).
 *
 * Prerequisites:
 *   1. CSV files exist in app/data/ (produced by pipeline scripts)
 *   2. Environment variables: SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Usage:
 *   npx tsx scripts/load-supabase.ts              # Push all data
 *   npx tsx scripts/load-supabase.ts --dry-run    # Diff backup vs current CSVs
 */

import * as path from "path";
import * as fs from "fs";
import {
  loadEnvFiles,
  createServiceClient,
  readCsv,
  DATA_DIR,
} from "./utils";
import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// CONFIGURATION
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// CSV TYPES
// =============================================================================

export interface RedlistCsvRow {
  sis_taxon_id: number;
  scientific_name: string;
  common_name: string | null;
  class_name: string | null;
  order_name: string | null;
  family: string | null;
  table1a_taxon_group: string;
  assessment_id: number | null;
  iucn_category: string | null;
  assessment_date: string | null;
  year_published: string | null;
  population_trend: string | null;
  countries: string[];
  gbif_species_key: number | null;
}

export interface GbifCsvRow {
  gbif_species_key: number;
  scientific_name: string;
  common_name: string | null;
  table1a_taxon_group: string;
  gbif_total_count: number;
  gbif_count_since_assessment: number | null;
}

// =============================================================================
// CSV PARSERS
// =============================================================================

function parseRedlistRow(r: Record<string, string>): RedlistCsvRow {
  return {
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || null,
    class_name: r.class_name || null,
    order_name: r.order_name || null,
    family: r.family || null,
    table1a_taxon_group: r.taxon_group_table1a,
    assessment_id: r.assessment_id ? parseInt(r.assessment_id, 10) : null,
    iucn_category: r.iucn_category || null,
    assessment_date: r.assessment_date || null,
    year_published: r.year_published || null,
    population_trend: r.population_trend || null,
    countries: r.countries ? r.countries.split(";").filter(Boolean) : [],
    gbif_species_key: r.gbif_species_key ? parseInt(r.gbif_species_key, 10) : null,
  };
}

function parseGbifRow(r: Record<string, string>): GbifCsvRow {
  return {
    gbif_species_key: parseInt(r.gbif_species_key, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || null,
    table1a_taxon_group: r.taxon_group_table1a,
    gbif_total_count: r.total_count ? parseInt(r.total_count, 10) : 0,
    gbif_count_since_assessment: r.count_after_assessment_year
      ? parseInt(r.count_after_assessment_year, 10)
      : null,
  };
}

// =============================================================================
// MERGE LOGIC
// =============================================================================

export interface SpeciesDbRow {
  sis_taxon_id: number | null;
  gbif_species_key: number | null;
  scientific_name: string;
  common_name: string | null;
  table1a_taxon_group: string;
  class_name: string | null;
  order_name: string | null;
  family: string | null;
  assessment_id: number | null;
  iucn_category: string | null;
  assessment_date: string | null;
  year_published: string | null;
  population_trend: string | null;
  countries: string[];
  gbif_total_count: number | null;
  gbif_count_since_assessment: number | null;
  synced_at: string;
}

export function mergeSpecies(
  redlistRows: RedlistCsvRow[],
  gbifRows: GbifCsvRow[],
  syncTimestamp: string,
): SpeciesDbRow[] {
  // Build GBIF lookup
  const gbifByKey = new Map<number, GbifCsvRow>();
  for (const g of gbifRows) gbifByKey.set(g.gbif_species_key, g);

  // Collect claimed GBIF keys from redlist rows
  const claimedGbifKeys = new Set<number>();
  for (const rl of redlistRows) {
    if (rl.gbif_species_key !== null) claimedGbifKeys.add(rl.gbif_species_key);
  }

  const merged: SpeciesDbRow[] = [];

  // Red List species (with optional GBIF data if linked)
  for (const rl of redlistRows) {
    const gbifKey = rl.gbif_species_key;
    const gbif = gbifKey !== null ? gbifByKey.get(gbifKey) : undefined;

    merged.push({
      sis_taxon_id: rl.sis_taxon_id,
      gbif_species_key: gbifKey,
      scientific_name: rl.scientific_name,
      common_name: rl.common_name,
      table1a_taxon_group: rl.table1a_taxon_group,
      class_name: rl.class_name,
      order_name: rl.order_name,
      family: rl.family,
      assessment_id: rl.assessment_id,
      iucn_category: rl.iucn_category,
      assessment_date: rl.assessment_date,
      year_published: rl.year_published,
      population_trend: rl.population_trend,
      countries: rl.countries,
      gbif_total_count: gbif?.gbif_total_count ?? null,
      gbif_count_since_assessment: gbif?.gbif_count_since_assessment ?? null,
      synced_at: syncTimestamp,
    });
  }

  // GBIF-only species (not linked to any Red List entry)
  for (const g of gbifRows) {
    if (claimedGbifKeys.has(g.gbif_species_key)) continue;

    merged.push({
      sis_taxon_id: null,
      gbif_species_key: g.gbif_species_key,
      scientific_name: g.scientific_name,
      common_name: g.common_name,
      table1a_taxon_group: g.table1a_taxon_group,
      class_name: null,
      order_name: null,
      family: null,
      assessment_id: null,
      iucn_category: null,
      assessment_date: null,
      year_published: null,
      population_trend: null,
      countries: [],
      gbif_total_count: g.gbif_total_count,
      gbif_count_since_assessment: g.gbif_count_since_assessment,
      synced_at: syncTimestamp,
    });
  }

  return merged;
}

// =============================================================================
// DRY-RUN DIFF (DB vs merged CSVs)
// =============================================================================

/** Key used to match rows across syncs */
export function rowKey(row: SpeciesDbRow): string {
  if (row.sis_taxon_id !== null) return `sis:${row.sis_taxon_id}`;
  if (row.gbif_species_key !== null) return `gbif:${row.gbif_species_key}`;
  return `name:${row.scientific_name}`;
}

/** Fields to compare for changes (exclude synced_at) */
const DIFF_FIELDS: (keyof SpeciesDbRow)[] = [
  "scientific_name", "common_name", "table1a_taxon_group",
  "class_name", "order_name", "family",
  "assessment_id", "iucn_category", "assessment_date", "year_published",
  "population_trend", "countries", "gbif_species_key", "sis_taxon_id",
  "gbif_total_count", "gbif_count_since_assessment",
];

interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

interface DiffResult {
  added: SpeciesDbRow[];
  removed: SpeciesDbRow[];
  updated: { row: SpeciesDbRow; changes: FieldChange[] }[];
  unchanged: number;
}

export function diffMerged(oldRows: SpeciesDbRow[], newRows: SpeciesDbRow[]): DiffResult {
  const oldByKey = new Map<string, SpeciesDbRow>();
  for (const r of oldRows) oldByKey.set(rowKey(r), r);

  const newByKey = new Map<string, SpeciesDbRow>();
  for (const r of newRows) newByKey.set(rowKey(r), r);

  const added: SpeciesDbRow[] = [];
  const updated: { row: SpeciesDbRow; changes: FieldChange[] }[] = [];
  let unchanged = 0;

  for (const [key, newRow] of newByKey) {
    const oldRow = oldByKey.get(key);
    if (!oldRow) {
      added.push(newRow);
      continue;
    }

    const changes: FieldChange[] = [];
    for (const field of DIFF_FIELDS) {
      const oldVal = oldRow[field];
      const newVal = newRow[field];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ field, old: oldVal, new: newVal });
      }
    }

    if (changes.length > 0) {
      updated.push({ row: newRow, changes });
    } else {
      unchanged++;
    }
  }

  const removed: SpeciesDbRow[] = [];
  for (const [key, oldRow] of oldByKey) {
    if (!newByKey.has(key)) removed.push(oldRow);
  }

  return { added, removed, updated, unchanged };
}

function createLogStream(mode: "dry-run" | "load"): fs.WriteStream {
  const logsDir = path.join(__dirname, "../logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  const filename = `${ts}_load-supabase${mode === "dry-run" ? "_dry-run" : ""}.jsonl`;
  const filepath = path.join(logsDir, filename);
  console.log(`  Log file: ${filepath}`);
  return fs.createWriteStream(filepath, { flags: "a" });
}

function logLine(stream: fs.WriteStream, event: string, data: Record<string, unknown>): void {
  stream.write(JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n");
}

function writeDiffLog(stream: fs.WriteStream, diff: DiffResult): void {
  const { added, removed, updated, unchanged } = diff;

  // Summary
  logLine(stream, "diff_summary", {
    unchanged,
    added: added.length,
    updated: updated.length,
    removed: removed.length,
  });

  // Field change counts
  if (updated.length > 0) {
    const fieldCounts: Record<string, number> = {};
    for (const { changes } of updated) {
      for (const c of changes) {
        fieldCounts[c.field] = (fieldCounts[c.field] || 0) + 1;
      }
    }
    logLine(stream, "updated_fields", fieldCounts);
  }

  // Every addition
  for (const row of added) {
    logLine(stream, "added", {
      sis_taxon_id: row.sis_taxon_id,
      gbif_species_key: row.gbif_species_key,
      scientific_name: row.scientific_name,
      common_name: row.common_name,
      taxon_group: row.table1a_taxon_group,
    });
  }

  // Every update
  for (const { row, changes } of updated) {
    const changesObj: Record<string, { old: unknown; new: unknown }> = {};
    for (const c of changes) {
      changesObj[c.field] = { old: c.old, new: c.new };
    }
    logLine(stream, "updated", {
      sis_taxon_id: row.sis_taxon_id,
      gbif_species_key: row.gbif_species_key,
      scientific_name: row.scientific_name,
      taxon_group: row.table1a_taxon_group,
      changes: changesObj,
    });
  }

  // Every removal
  for (const row of removed) {
    logLine(stream, "removed", {
      sis_taxon_id: row.sis_taxon_id,
      gbif_species_key: row.gbif_species_key,
      scientific_name: row.scientific_name,
      taxon_group: row.table1a_taxon_group,
    });
  }
}

function printDiffSummary(diff: DiffResult): void {
  const { added, removed, updated, unchanged } = diff;

  console.log("\n--- Diff (DB → CSVs) ---\n");
  console.log(`  Unchanged: ${unchanged.toLocaleString()}`);
  console.log(`  Added:     ${added.length.toLocaleString()}`);
  console.log(`  Updated:   ${updated.length.toLocaleString()}`);
  console.log(`  Removed:   ${removed.length.toLocaleString()}`);

  if (updated.length > 0) {
    const fieldCounts: Record<string, number> = {};
    for (const { changes } of updated) {
      for (const c of changes) {
        fieldCounts[c.field] = (fieldCounts[c.field] || 0) + 1;
      }
    }
    console.log("\n  Updated fields:");
    for (const [field, count] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${field}: ${count.toLocaleString()} rows`);
    }
  }
}

// =============================================================================
// DATABASE HELPERS
// =============================================================================

interface ExistingSpecies {
  id: number;
  sis_taxon_id: number | null;
  gbif_species_key: number | null;
}

async function fetchAllSpecies(supabase: SupabaseClient, columns: string = "*"): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const PAGE_SIZE = 1_000; // Supabase API caps responses at 1000 rows
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("species")
      .select(columns)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to fetch species: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Record<string, unknown>[]));
    offset += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

function dbRowToSpeciesDbRow(row: Record<string, unknown>): SpeciesDbRow {
  return {
    sis_taxon_id: row.sis_taxon_id as number | null,
    gbif_species_key: row.gbif_species_key as number | null,
    scientific_name: row.scientific_name as string,
    common_name: row.common_name as string | null,
    table1a_taxon_group: row.table1a_taxon_group as string,
    class_name: row.class_name as string | null,
    order_name: row.order_name as string | null,
    family: row.family as string | null,
    assessment_id: row.assessment_id as number | null,
    iucn_category: row.iucn_category as string | null,
    assessment_date: row.assessment_date as string | null,
    year_published: row.year_published as string | null,
    population_trend: row.population_trend as string | null,
    countries: row.countries as string[] ?? [],
    gbif_total_count: row.gbif_total_count as number | null,
    gbif_count_since_assessment: row.gbif_count_since_assessment as number | null,
    synced_at: row.synced_at as string,
  };
}

// =============================================================================
// MAIN
// =============================================================================

export async function run(opts: {
  dryRun?: boolean;
} = {}): Promise<void> {
  const dryRun = opts.dryRun ?? false;
  const syncTimestamp = new Date().toISOString();

  if (dryRun) console.log("Mode: --dry-run (no writes)");

  const startTime = Date.now();

  // Read CSVs
  console.log("\nReading CSVs...");

  const redlistPath = path.join(DATA_DIR, "redlist-species.csv");
  const gbifPath = path.join(DATA_DIR, "gbif-species.csv");

  const redlistRows = readCsv(redlistPath, parseRedlistRow);
  const linkedCount = redlistRows.filter((r) => r.gbif_species_key !== null).length;
  console.log(`  redlist-species.csv: ${redlistRows.length.toLocaleString()} rows (${linkedCount.toLocaleString()} linked)`);

  const gbifRows = readCsv(gbifPath, parseGbifRow);
  console.log(`  gbif-species.csv:    ${gbifRows.length.toLocaleString()} rows`);

  // Merge
  console.log("\nMerging...");
  const merged = mergeSpecies(redlistRows, gbifRows, syncTimestamp);
  const redlistOnly = merged.filter((r) => r.sis_taxon_id !== null && r.gbif_species_key === null).length;
  const gbifOnly = merged.filter((r) => r.sis_taxon_id === null && r.gbif_species_key !== null).length;
  const both = merged.filter((r) => r.sis_taxon_id !== null && r.gbif_species_key !== null).length;
  console.log(`  Total rows:     ${merged.length.toLocaleString()}`);
  console.log(`  Red List only:  ${redlistOnly.toLocaleString()}`);
  console.log(`  GBIF only:      ${gbifOnly.toLocaleString()}`);
  console.log(`  Matched (both): ${both.toLocaleString()}`);

  const supabase = createServiceClient();

  // Fetch existing species from DB
  console.log("\nFetching existing species from DB...");
  const existingRaw = await fetchAllSpecies(supabase,
    dryRun ? "*" : "id, sis_taxon_id, gbif_species_key"
  );
  console.log(`  ${existingRaw.length.toLocaleString()} existing rows`);

  // Compute diff (used for both dry-run logging and live logging)
  const dbRows = dryRun
    ? existingRaw.map(dbRowToSpeciesDbRow)
    : null; // live path doesn't need full rows for diff — computed post-sync

  if (dryRun) {
    const diff = diffMerged(dbRows!, merged);
    const logStream = createLogStream("dry-run");
    writeDiffLog(logStream, diff);
    logStream.end();
    printDiffSummary(diff);
    console.log("\n--dry-run: no changes made.");
    return;
  }

  const existing = existingRaw as unknown as ExistingSpecies[];
  const logStream = createLogStream("load");
  logLine(logStream, "load_start", {
    merged_total: merged.length,
    redlist_only: redlistOnly,
    gbif_only: gbifOnly,
    matched_both: both,
    existing_in_db: existing.length,
  });

  const existingBySisTaxonId = new Map<number, ExistingSpecies>();
  const existingByGbifKey = new Map<number, ExistingSpecies>();
  for (const e of existing) {
    if (e.sis_taxon_id !== null) existingBySisTaxonId.set(e.sis_taxon_id, e);
    if (e.gbif_species_key !== null) existingByGbifKey.set(e.gbif_species_key, e);
  }

  // Phase 0: Handle promotions (GBIF-only → linked)
  // A Red List row with gbif_species_key=X might match an existing GBIF-only row.
  // We must add sis_taxon_id to the existing row first, so the Phase 1 upsert
  // ON CONFLICT (sis_taxon_id) matches it instead of violating the gbif_species_key unique constraint.
  const promotions = merged.filter((row) =>
    row.sis_taxon_id !== null &&
    row.gbif_species_key !== null &&
    !existingBySisTaxonId.has(row.sis_taxon_id) &&
    existingByGbifKey.has(row.gbif_species_key!) &&
    existingByGbifKey.get(row.gbif_species_key!)!.sis_taxon_id === null
  );

  if (promotions.length > 0) {
    console.log(`\nPromoting ${promotions.length} GBIF-only → linked...`);
    for (const p of promotions) {
      const { error } = await supabase
        .from("species")
        .update({ sis_taxon_id: p.sis_taxon_id })
        .eq("gbif_species_key", p.gbif_species_key!);
      if (error) {
        throw new Error(`Failed to promote gbif_species_key=${p.gbif_species_key}: ${error.message}`);
      }
      logLine(logStream, "promoted", {
        sis_taxon_id: p.sis_taxon_id,
        gbif_species_key: p.gbif_species_key,
        scientific_name: p.scientific_name,
      });
    }
    console.log("  Done.");
  }

  // Phase 1: Upsert Red List species ON CONFLICT (sis_taxon_id)
  const redlistMerged = merged.filter((r) => r.sis_taxon_id !== null);
  console.log(`\nUpserting ${redlistMerged.length.toLocaleString()} Red List species...`);
  for (let i = 0; i < redlistMerged.length; i += BATCH_SIZE) {
    const batch = redlistMerged.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("species")
      .upsert(batch, { onConflict: "sis_taxon_id" });
    if (error) {
      throw new Error(`Failed to upsert Red List batch at ${i}: ${error.message}`);
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, redlistMerged.length).toLocaleString()}/${redlistMerged.length.toLocaleString()}`);
  }
  if (redlistMerged.length > 0) console.log("");

  // Phase 2: Upsert GBIF-only species ON CONFLICT (gbif_species_key)
  const gbifOnlyMerged = merged.filter((r) => r.sis_taxon_id === null);
  console.log(`\nUpserting ${gbifOnlyMerged.length.toLocaleString()} GBIF-only species...`);
  for (let i = 0; i < gbifOnlyMerged.length; i += BATCH_SIZE) {
    const batch = gbifOnlyMerged.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("species")
      .upsert(batch, { onConflict: "gbif_species_key" });
    if (error) {
      throw new Error(`Failed to upsert GBIF batch at ${i}: ${error.message}`);
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, gbifOnlyMerged.length).toLocaleString()}/${gbifOnlyMerged.length.toLocaleString()}`);
  }
  if (gbifOnlyMerged.length > 0) console.log("");

  // Phase 3: Delete stale rows (not touched in this sync)
  console.log("\nDeleting stale rows...");
  const { count: totalDeleted, error: deleteError } = await supabase
    .from("species")
    .delete({ count: "exact" })
    .lt("synced_at", syncTimestamp);
  if (deleteError) {
    throw new Error(`Failed to delete stale rows: ${deleteError.message}`);
  }
  console.log(`  Deleted ${(totalDeleted ?? 0).toLocaleString()} stale rows.`);

  // Refresh materialized view
  console.log("\nRefreshing taxa_summary materialized view...");
  const { error: viewError } = await supabase.rpc("refresh_taxa_summary");
  if (viewError) {
    console.error(`  Error: ${viewError.message}`);
  } else {
    console.log("  Done.");
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;

  const summary = {
    species_total: merged.length,
    redlist_only: redlistOnly,
    gbif_only: gbifOnly,
    matched_both: both,
    promotions: promotions.length,
    stale_deleted: totalDeleted ?? 0,
    duration_seconds: Number(elapsed),
  };
  logLine(logStream, "load_complete", summary);
  logStream.end();

  console.log("\n" + "=".repeat(50));
  console.log("load-supabase complete:");
  console.log(`  Species:        ${merged.length.toLocaleString()} rows`);
  console.log(`  Red List only:  ${redlistOnly.toLocaleString()}`);
  console.log(`  GBIF only:      ${gbifOnly.toLocaleString()}`);
  console.log(`  Matched (both): ${both.toLocaleString()}`);
  console.log(`  Promotions:     ${promotions.length}`);
  console.log(`  Stale deleted:  ${totalDeleted ?? 0}`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("load-supabase: Local CSVs → Supabase (upsert)");
  console.log("=".repeat(50));

  await run({ dryRun });
}

const isDirectRun = process.argv[1]?.endsWith("load-supabase.ts") || process.argv[1]?.endsWith("load-supabase.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
