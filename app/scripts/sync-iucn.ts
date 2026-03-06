/**
 * sync-iucn: IUCN Red List DB → Supabase
 *
 * Connects to the IUCN SIS Connect PostgreSQL database (via SSH tunnel)
 * and upserts species data into Supabase.
 *
 * Prerequisites:
 *   1. SSH tunnel to IUCN DB (port 5433)
 *   2. Environment variables: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD,
 *      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx scripts/sync-iucn.ts [taxon]   # Sync one taxon (e.g. mammalia)
 *   npx tsx scripts/sync-iucn.ts            # Sync all 15 taxa
 */

import { Client } from "pg";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  loadEnvFiles,
  createServiceClient,
  fetchAllRows,
  buildSpeciesIndex,
  findMatch,
  SyncLogger,
  IUCN_TAXA,
  IucnTaxonConfig,
  POPULATION_TRENDS,
  ExistingSpecies,
} from "./sync-utils";

// =============================================================================
// TYPES
// =============================================================================

export interface IucnSpeciesRow {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  common_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null; // YYYY-MM-DD
  year_published: string;
  population_trend: string | null;
  countries: string[];
  taxon_group: string;
}

// =============================================================================
// DATA FETCHING (from IUCN PostgreSQL)
// =============================================================================

/**
 * Fetch species from IUCN DB for a single taxon group.
 * Extracted for testability — tests mock this and call upsertIucnSpecies directly.
 */
export async function fetchFromIucnDb(
  pgClient: Client,
  taxon: IucnTaxonConfig
): Promise<IucnSpeciesRow[]> {
  // Main query: latest global assessment per species
  const mainQuery = `
    SELECT DISTINCT ON (t.sis_id)
      t.sis_id as sis_taxon_id,
      a.redlist_id as assessment_id,
      t.scientific_name,
      tcn.name as common_name,
      t.family_name as family,
      rlc.code as category,
      a.assessment_date,
      a.year_published,
      pt.code as population_trend_code
    FROM taxons t
    JOIN assessments a ON a.taxon_id = t.id
    JOIN assessment_scopes ascope ON ascope.assessment_id = a.id
    JOIN red_list_category_lookup rlc ON rlc.id = a.red_list_category_id
    LEFT JOIN taxon_common_names tcn ON tcn.taxon_id = t.id
      AND tcn.language_id = 609 AND tcn.main = true
    LEFT JOIN population_trend_lookup pt ON pt.id = a.population_trend_id
    WHERE t.${taxon.filterColumn} = ANY($1)
      AND t.latest = true
      AND a.latest = true
      AND a.suppress = false
      AND ascope.scope_lookup_id = 15
      AND t.infra_name IS NULL
      AND t.subpopulation_name IS NULL
    ORDER BY t.sis_id, a.assessment_date DESC
  `;

  const mainResult = await pgClient.query(mainQuery, [taxon.filterValues]);

  // Build species list and collect assessment IDs for country fetch
  const species: IucnSpeciesRow[] = [];
  const assessmentIds: number[] = [];

  for (const row of mainResult.rows) {
    const assessmentDate = row.assessment_date
      ? new Date(row.assessment_date).toISOString().split("T")[0]
      : null;

    const assessmentId = Number(row.assessment_id);
    species.push({
      sis_taxon_id: Number(row.sis_taxon_id),
      assessment_id: assessmentId,
      scientific_name: row.scientific_name,
      common_name: row.common_name || null,
      family: row.family || null,
      category: row.category,
      assessment_date: assessmentDate,
      year_published: row.year_published,
      population_trend: POPULATION_TRENDS[row.population_trend_code] || null,
      countries: [],
      taxon_group: taxon.id,
    });
    assessmentIds.push(assessmentId);
  }

  // Batch fetch countries
  if (assessmentIds.length > 0) {
    const countriesQuery = `
      SELECT
        a.redlist_id as assessment_id,
        ll.code as country_code
      FROM assessments a
      JOIN assessment_locations al ON al.assessment_id = a.id
      JOIN location_lookup ll ON ll.id = al.location_id
      JOIN legend_lookup leg ON leg.id = al.legend_id
      WHERE a.redlist_id = ANY($1)
        AND leg.origin = 'Native'
        AND leg.presence = 'Extant'
        AND LENGTH(ll.code) = 2
    `;

    const countriesResult = await pgClient.query(countriesQuery, [assessmentIds]);

    const countriesByAssessment = new Map<number, Set<string>>();
    for (const row of countriesResult.rows) {
      const aid = Number(row.assessment_id);
      if (!countriesByAssessment.has(aid)) {
        countriesByAssessment.set(aid, new Set());
      }
      countriesByAssessment.get(aid)!.add(row.country_code);
    }

    for (const s of species) {
      const countries = countriesByAssessment.get(s.assessment_id);
      if (countries) {
        s.countries = Array.from(countries).sort();
      }
    }
  }

  return species;
}

// =============================================================================
// UPSERT LOGIC
// =============================================================================

const BATCH_SIZE = 500;

export interface UpsertStats {
  inserted: number;
  matched_by_id: number;
  matched_by_col_id: number;
  matched_by_name: number;
  errors: number;
}

/**
 * Upsert IUCN species into Supabase.
 * Uses 3-tier matching: sis_taxon_id → col_id → normalized name.
 * Returns the set of sis_taxon_ids seen and upsert stats.
 */
export async function upsertIucnSpecies(
  supabase: SupabaseClient,
  species: IucnSpeciesRow[],
  logger: SyncLogger
): Promise<{ seenSisTaxonIds: Set<number>; stats: UpsertStats }> {
  // Load existing species for matching (paginated to avoid 1000-row default limit)
  const existing = await fetchAllRows<ExistingSpecies>(
    supabase, "species", "id, scientific_name, sis_taxon_id, gbif_species_key, col_id"
  );

  const index = buildSpeciesIndex(existing);
  const seenSisTaxonIds = new Set<number>();
  const stats: UpsertStats = { matched_by_id: 0, matched_by_col_id: 0, matched_by_name: 0, inserted: 0, errors: 0 };

  // Classify species into inserts vs updates using in-memory matching
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: number; row: Record<string, unknown>; source: IucnSpeciesRow; matchType: string }> = [];

  for (const s of species) {
    seenSisTaxonIds.add(s.sis_taxon_id);

    const result = findMatch(index, {
      primaryId: { type: "sis_taxon_id", value: s.sis_taxon_id },
      scientificName: s.scientific_name,
    });

    const row = {
      scientific_name: s.scientific_name,
      common_name: s.common_name,
      family: s.family,
      taxon_group: s.taxon_group,
      sis_taxon_id: s.sis_taxon_id,
      assessment_id: s.assessment_id,
      iucn_category: s.category,
      assessment_date: s.assessment_date,
      year_published: s.year_published,
      population_trend: s.population_trend,
      countries: s.countries,
      status: "active",
      synced_at: new Date().toISOString(),
    };

    if (result.match === "none") {
      toInsert.push(row);
    } else {
      toUpdate.push({ id: result.species.id, row, source: s, matchType: result.match });
    }
  }

  // Batch inserts
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("species").insert(batch);
    if (error) {
      stats.errors += batch.length;
      logger.log("error", { error: error.message, context: "batch_insert", count: batch.length });
    } else {
      stats.inserted += batch.length;
    }
    process.stdout.write(`\r  Inserted ${Math.min(i + BATCH_SIZE, toInsert.length)}/${toInsert.length}`);
  }
  if (toInsert.length > 0) console.log("");

  // Updates must be individual (each targets a different row by id)
  for (let i = 0; i < toUpdate.length; i++) {
    const { id, row, source, matchType } = toUpdate[i];
    const { error } = await supabase.from("species").update(row).eq("id", id);
    if (error) {
      stats.errors++;
      logger.log("error", { name: source.scientific_name, sis_taxon_id: source.sis_taxon_id, error: error.message });
    } else {
      if (matchType === "by_col_id") {
        stats.matched_by_col_id++;
        logger.log("matched_by_col_id", { name: source.scientific_name, sis_taxon_id: source.sis_taxon_id, matched_id: id });
      } else if (matchType === "by_name") {
        stats.matched_by_name++;
        logger.log("matched_by_name", { name: source.scientific_name, sis_taxon_id: source.sis_taxon_id, matched_id: id });
      } else {
        stats.matched_by_id++;
      }
    }
    if ((i + 1) % BATCH_SIZE === 0 || i === toUpdate.length - 1) {
      process.stdout.write(`\r  Updated ${i + 1}/${toUpdate.length}`);
    }
  }
  if (toUpdate.length > 0) console.log("");

  return { seenSisTaxonIds, stats };
}

/**
 * Mark species as superseded if their sis_taxon_id was not seen in the current sync.
 * These are species that have been delisted, split, or lumped in the latest Red List.
 */
export async function supersedeMissing(
  supabase: SupabaseClient,
  seenSisTaxonIds: Set<number>,
  logger: SyncLogger
): Promise<number> {
  // Fetch all active species with IUCN IDs (paginated)
  const activeIucn = await fetchAllRows<{ id: number; sis_taxon_id: number; scientific_name: string }>(
    supabase, "species", "id, sis_taxon_id, scientific_name",
    (q) => q.eq("status", "active").not("sis_taxon_id", "is", null)
  );

  let supersededCount = 0;

  for (const row of activeIucn || []) {
    if (!seenSisTaxonIds.has(row.sis_taxon_id)) {
      const { error: updateError } = await supabase
        .from("species")
        .update({
          status: "superseded",
          sis_taxon_id: null,
          assessment_id: null,
          iucn_category: null,
          assessment_date: null,
          year_published: null,
          population_trend: null,
          countries: [],
          synced_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (updateError) {
        logger.log("error", { name: row.scientific_name, event: "supersede_failed", error: updateError.message });
      } else {
        supersededCount++;
        logger.log("superseded", { name: row.scientific_name, sis_taxon_id: row.sis_taxon_id });
      }
    }
  }

  return supersededCount;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const taxonArg = args[0]?.toLowerCase();

  const taxaToSync = taxonArg
    ? IUCN_TAXA.filter((t) => t.id === taxonArg)
    : IUCN_TAXA;

  if (taxonArg && taxaToSync.length === 0) {
    console.error(`Unknown taxon: ${taxonArg}`);
    console.error("Available:", IUCN_TAXA.map((t) => t.id).join(", "));
    process.exit(1);
  }

  console.log("sync-iucn: IUCN Red List DB → Supabase");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const supabase = createServiceClient();
  const logger = new SyncLogger("sync-iucn");

  // Connect to IUCN database
  const pgClient = new Client({
    host: process.env.DB_HOST || "localhost",
    port: 5433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await pgClient.connect();
    console.log("Connected to IUCN database\n");

    logger.log("sync_start", {
      taxa: taxaToSync.map((t) => t.id),
      taxa_count: taxaToSync.length,
    });

    const allSeenIds = new Set<number>();
    const totals: UpsertStats = { inserted: 0, matched_by_id: 0, matched_by_col_id: 0, matched_by_name: 0, errors: 0 };

    for (const taxon of taxaToSync) {
      const taxonStart = Date.now();
      console.log(`\n${taxon.name} (${taxon.id}):`);

      // Fetch from IUCN DB
      const species = await fetchFromIucnDb(pgClient, taxon);
      console.log(`  Fetched ${species.length} species from IUCN DB`);

      logger.log("taxon_start", { taxon_group: taxon.id, taxon_name: taxon.name, fetched: species.length });

      // Upsert into Supabase
      const { seenSisTaxonIds, stats } = await upsertIucnSpecies(supabase, species, logger);
      for (const id of seenSisTaxonIds) allSeenIds.add(id);

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      logger.log("taxon_complete", { taxon_group: taxon.id, taxon_name: taxon.name, fetched: species.length, ...stats, duration_seconds: Number(taxonDuration) });

      // Accumulate totals
      for (const key of Object.keys(totals) as (keyof UpsertStats)[]) {
        totals[key] += stats[key];
      }
    }

    // Supersede missing species (only when syncing all taxa)
    let supersededCount = 0;
    if (!taxonArg) {
      console.log("\nChecking for superseded species...");
      supersededCount = await supersedeMissing(supabase, allSeenIds, logger);
      console.log(`  ${supersededCount} species marked as superseded`);
    }

    // Log + print summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", {
      ...totals,
      superseded: supersededCount,
      total_species: allSeenIds.size,
      duration_seconds: Number(elapsed),
    });

    console.log("\n" + "=".repeat(50));
    console.log("sync-iucn complete:");
    console.log(`  Matched by sis_taxon_id: ${totals.matched_by_id.toLocaleString()}`);
    console.log(`  Matched by col_id:       ${totals.matched_by_col_id.toLocaleString()}`);
    console.log(`  Matched by name:         ${totals.matched_by_name.toLocaleString()}`);
    console.log(`  Inserted new:            ${totals.inserted.toLocaleString()}`);
    console.log(`  Superseded:              ${supersededCount.toLocaleString()}`);
    if (totals.errors) {
      console.log(`  Errors:                  ${totals.errors.toLocaleString()}`);
    }
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    await pgClient.end();
    logger.close();
  }
}

// Only run main when executed directly (not when imported by tests)
const isDirectRun = process.argv[1]?.endsWith("sync-iucn.ts") || process.argv[1]?.endsWith("sync-iucn.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
