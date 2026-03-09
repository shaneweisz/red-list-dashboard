/**
 * push-to-db: Local CSVs → Supabase
 *
 * Reads redlist-species.csv, gbif-species.csv, and species-links.csv,
 * then truncates and reloads all three database tables.
 *
 * This is the only script that writes to Supabase. The sync/link scripts
 * only produce local CSV files.
 *
 * Prerequisites:
 *   1. CSV files exist in app/data/ (produced by sync-redlist, sync-gbif, link-gbif)
 *   2. Environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx scripts/push-to-db.ts              # Push all tables
 *   npx tsx scripts/push-to-db.ts --dry-run    # Show what would be pushed
 */

import * as path from "path";
import {
  loadEnvFiles,
  createServiceClient,
  readCsv,
  DATA_DIR,
  SyncLogger,
} from "./sync-utils";

// =============================================================================
// CONFIGURATION
// =============================================================================

const BATCH_SIZE = 1000;

// =============================================================================
// CSV PARSERS
// =============================================================================

function parseRedlistRow(r: Record<string, string>) {
  return {
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || null,
    class_name: r.class_name || null,
    order_name: r.order_name || null,
    family: r.family || null,
    taxon_group_table1a: r.taxon_group_table1a,
    assessment_id: r.assessment_id ? parseInt(r.assessment_id, 10) : null,
    iucn_category: r.iucn_category || null,
    assessment_date: r.assessment_date || null,
    year_published: r.year_published || null,
    population_trend: r.population_trend || null,
    countries: r.countries ? r.countries.split(";").filter(Boolean) : [],
    synced_at: new Date().toISOString(),
  };
}

function parseGbifRow(r: Record<string, string>) {
  return {
    gbif_species_key: parseInt(r.gbif_species_key, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || null,
    taxon_group_table1a: r.taxon_group_table1a,
    total_count: r.total_count ? parseInt(r.total_count, 10) : 0,
    count_after_assessment_year: r.count_after_assessment_year ? parseInt(r.count_after_assessment_year, 10) : null,
    synced_at: new Date().toISOString(),
  };
}

function parseLinkRow(r: Record<string, string>) {
  return {
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    gbif_species_key: r.gbif_species_key ? parseInt(r.gbif_species_key, 10) : null,
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("push-to-db: Local CSVs → Supabase");
  if (dryRun) console.log("Mode: --dry-run (no writes)");
  console.log("=".repeat(50));

  const startTime = Date.now();

  // Read CSVs
  console.log("\nReading CSVs...");

  const redlistPath = path.join(DATA_DIR, "redlist-species.csv");
  const gbifPath = path.join(DATA_DIR, "gbif-species.csv");
  const linksPath = path.join(DATA_DIR, "species-links.csv");

  const redlistRows = readCsv(redlistPath, parseRedlistRow);
  console.log(`  redlist-species.csv: ${redlistRows.length.toLocaleString()} rows`);

  const gbifRows = readCsv(gbifPath, parseGbifRow);
  console.log(`  gbif-species.csv:    ${gbifRows.length.toLocaleString()} rows`);

  const linkRows = readCsv(linksPath, parseLinkRow);
  const linkedRows = linkRows.filter((r) => r.gbif_species_key !== null);
  const unlinkedRows = linkRows.filter((r) => r.gbif_species_key === null);
  console.log(`  species-links.csv:   ${linkRows.length.toLocaleString()} rows (${linkedRows.length.toLocaleString()} linked)`);

  if (dryRun) {
    console.log("\n--dry-run: no changes made.");
    return;
  }

  const supabase = createServiceClient();
  const logger = new SyncLogger("push-to-db");

  try {
    logger.log("push_start", {
      redlist_count: redlistRows.length,
      gbif_count: gbifRows.length,
      link_count: linkRows.length,
    });

    // Step 1: Delete all rows (child table first due to FKs)
    console.log("\nClearing tables...");

    const { error: delSpecies } = await supabase.from("species").delete().gte("id", 0);
    if (delSpecies) throw new Error(`Failed to clear species: ${delSpecies.message}`);
    console.log("  species: cleared");

    const { error: delRedlist } = await supabase.from("redlist_species").delete().gte("sis_taxon_id", 0);
    if (delRedlist) throw new Error(`Failed to clear redlist_species: ${delRedlist.message}`);
    console.log("  redlist_species: cleared");

    const { error: delGbif } = await supabase.from("gbif_species").delete().gte("gbif_species_key", 0);
    if (delGbif) throw new Error(`Failed to clear gbif_species: ${delGbif.message}`);
    console.log("  gbif_species: cleared");

    // Step 2: Insert redlist_species
    console.log("\nInserting redlist_species...");
    for (let i = 0; i < redlistRows.length; i += BATCH_SIZE) {
      const batch = redlistRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("redlist_species").insert(batch);
      if (error) {
        logger.log("error", { table: "redlist_species", error: error.message, batch_start: i });
        throw new Error(`Failed to insert redlist_species batch at ${i}: ${error.message}`);
      }
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, redlistRows.length)}/${redlistRows.length}`);
    }
    if (redlistRows.length > 0) console.log("");

    // Step 3: Insert gbif_species
    console.log("Inserting gbif_species...");
    for (let i = 0; i < gbifRows.length; i += BATCH_SIZE) {
      const batch = gbifRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("gbif_species").insert(batch);
      if (error) {
        logger.log("error", { table: "gbif_species", error: error.message, batch_start: i });
        throw new Error(`Failed to insert gbif_species batch at ${i}: ${error.message}`);
      }
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, gbifRows.length)}/${gbifRows.length}`);
    }
    if (gbifRows.length > 0) console.log("");

    // Step 4: Insert species links
    // All redlist species get a row; linked ones also have gbif_species_key
    console.log("Inserting species links...");
    const allLinkRows = [
      ...linkedRows,
      ...unlinkedRows.map((r) => ({ sis_taxon_id: r.sis_taxon_id })),
    ];
    for (let i = 0; i < allLinkRows.length; i += BATCH_SIZE) {
      const batch = allLinkRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("species").insert(batch);
      if (error) {
        logger.log("error", { table: "species", error: error.message, batch_start: i });
        throw new Error(`Failed to insert species batch at ${i}: ${error.message}`);
      }
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, allLinkRows.length)}/${allLinkRows.length}`);
    }
    if (allLinkRows.length > 0) console.log("");

    // Step 5: Refresh materialized view
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

    logger.log("push_complete", {
      redlist_count: redlistRows.length,
      gbif_count: gbifRows.length,
      link_count: allLinkRows.length,
      linked_count: linkedRows.length,
      duration_seconds: Number(elapsed),
    });

    console.log("\n" + "=".repeat(50));
    console.log("push-to-db complete:");
    console.log(`  redlist_species: ${redlistRows.length.toLocaleString()} rows`);
    console.log(`  gbif_species:    ${gbifRows.length.toLocaleString()} rows`);
    console.log(`  species links:   ${allLinkRows.length.toLocaleString()} rows (${linkedRows.length.toLocaleString()} linked)`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("push-to-db.ts") || process.argv[1]?.endsWith("push-to-db.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
