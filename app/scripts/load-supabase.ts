/**
 * load-supabase: Local CSVs → Supabase
 *
 * Reads redlist-species.csv and gbif-species.csv,
 * merges them into a single species table, then truncates and reloads.
 *
 * Merge logic:
 *   - Each Red List row becomes a species row (with assessment data).
 *     If linked to GBIF, the GBIF key and counts are added.
 *   - Each GBIF row NOT linked to any Red List species becomes a
 *     GBIF-only species row (no assessment data).
 *
 * Prerequisites:
 *   1. CSV files exist in app/data/ (produced by pipeline scripts)
 *   2. Environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx scripts/load-supabase.ts              # Push all data
 *   npx tsx scripts/load-supabase.ts --dry-run    # Show what would be pushed
 */

import * as path from "path";
import {
  loadEnvFiles,
  createServiceClient,
  readCsv,
  DATA_DIR,
} from "./utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// CSV TYPES
// =============================================================================

interface RedlistCsvRow {
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

interface GbifCsvRow {
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

interface SpeciesDbRow {
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

function mergeSpecies(
  redlistRows: RedlistCsvRow[],
  gbifRows: GbifCsvRow[],
): SpeciesDbRow[] {
  const now = new Date().toISOString();

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
      synced_at: now,
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
      synced_at: now,
    });
  }

  return merged;
}

// =============================================================================
// MAIN
// =============================================================================

export async function run(opts: {
  dryRun?: boolean;
} = {}): Promise<void> {
  const dryRun = opts.dryRun ?? false;

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
  const merged = mergeSpecies(redlistRows, gbifRows);
  const redlistOnly = merged.filter((r) => r.sis_taxon_id !== null && r.gbif_species_key === null).length;
  const gbifOnly = merged.filter((r) => r.sis_taxon_id === null && r.gbif_species_key !== null).length;
  const both = merged.filter((r) => r.sis_taxon_id !== null && r.gbif_species_key !== null).length;
  console.log(`  Total rows:     ${merged.length.toLocaleString()}`);
  console.log(`  Red List only:  ${redlistOnly.toLocaleString()}`);
  console.log(`  GBIF only:      ${gbifOnly.toLocaleString()}`);
  console.log(`  Matched (both): ${both.toLocaleString()}`);

  if (dryRun) {
    console.log("\n--dry-run: no changes made.");
    return;
  }

  const supabase = createServiceClient();

  // Clear table
  console.log("\nClearing species table...");
  const { error: delError } = await supabase.from("species").delete().gte("id", 0);
  if (delError) throw new Error(`Failed to clear species: ${delError.message}`);
  console.log("  species: cleared");

  // Insert merged rows
  console.log("\nInserting species...");
  for (let i = 0; i < merged.length; i += BATCH_SIZE) {
    const batch = merged.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("species").insert(batch);
    if (error) {
      throw new Error(`Failed to insert species batch at ${i}: ${error.message}`);
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, merged.length)}/${merged.length}`);
  }
  if (merged.length > 0) console.log("");

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

  console.log("\n" + "=".repeat(50));
  console.log("load-supabase complete:");
  console.log(`  Species:        ${merged.length.toLocaleString()} rows`);
  console.log(`  Red List only:  ${redlistOnly.toLocaleString()}`);
  console.log(`  GBIF only:      ${gbifOnly.toLocaleString()}`);
  console.log(`  Matched (both): ${both.toLocaleString()}`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("load-supabase: Local CSVs → Supabase (single species table)");
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
