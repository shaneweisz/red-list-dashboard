/**
 * fetch-redlist-species: IUCN Red List DB → CSV
 *
 * Connects to the IUCN Red List PostgreSQL database (via SSH tunnel)
 * and writes per-taxon species data to data/redlist/{taxonId}.csv.
 *
 * Prerequisites:
 *   1. SSH tunnel to IUCN DB (port 5433)
 *   2. Environment variables: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
 *
 * Usage:
 *   npx tsx scripts/fetch-redlist-species.ts [taxon]   # Sync one taxon (e.g. mammalia)
 *   npx tsx scripts/fetch-redlist-species.ts            # Sync all taxa
 */

import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import {
  loadEnvFiles,
  SyncLogger,
  writeCsv,
  readCsv,
  REDLIST_DIR,
} from "./utils";
import { getTaxa, type RedlistQuery, type Taxon } from "./taxa";

const POPULATION_TRENDS: Record<string, string> = {
  "0": "Increasing",
  "1": "Decreasing",
  "2": "Stable",
  "3": "Unknown",
};

// =============================================================================
// TYPES
// =============================================================================

export interface RedlistSpecies {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  common_name: string | null;
  class_name: string | null;
  order_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null; // YYYY-MM-DD
  year_published: string;
  population_trend: string | null;
  countries: string[];
  taxon_group_table1a: string;
}

// =============================================================================
// DATA FETCHING (from IUCN PostgreSQL)
// =============================================================================

export async function fetchFromIucnDb(
  pgClient: Client,
  taxonId: string,
  query: RedlistQuery,
): Promise<RedlistSpecies[]> {
  const mainQuery = `
    SELECT DISTINCT ON (t.sis_id)
      t.sis_id as sis_taxon_id,
      a.id as assessment_id,
      t.scientific_name,
      tcn.name as common_name,
      t.class_name,
      t.order_name,
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
    WHERE t.${query.filterColumn} = ANY($1)
      AND t.latest = true
      AND a.latest = true
      AND a.suppress = false
      AND ascope.scope_lookup_id = 15
      AND t.infra_name IS NULL
      AND t.subpopulation_name IS NULL
    ORDER BY t.sis_id, a.assessment_date DESC
  `;

  const mainResult = await pgClient.query(mainQuery, [query.filterValues]);

  const species: RedlistSpecies[] = [];
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
      class_name: row.class_name?.toLowerCase() || null,
      order_name: row.order_name?.toLowerCase() || null,
      family: row.family?.toLowerCase() || null,
      category: row.category,
      assessment_date: assessmentDate,
      year_published: row.year_published,
      population_trend: POPULATION_TRENDS[row.population_trend_code] || null,
      countries: [],
      taxon_group_table1a: taxonId,
    });
    assessmentIds.push(assessmentId);
  }

  if (assessmentIds.length > 0) {
    const countriesQuery = `
      SELECT
        a.id as assessment_id,
        ll.code as country_code
      FROM assessments a
      JOIN assessment_locations al ON al.assessment_id = a.id
      JOIN location_lookup ll ON ll.id = al.location_id
      JOIN legend_lookup leg ON leg.id = al.legend_id
      WHERE a.id = ANY($1)
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
// ASSESSMENT HISTORY
// =============================================================================

export interface AssessmentHistoryEntry {
  id: number;
  year: string;
  category: string;
  date: string | null;
  assessors: string | null;
  reviewers: string | null;
}

export type AssessmentHistoryMap = Record<string, AssessmentHistoryEntry[]>;

export async function fetchAssessmentHistory(
  pgClient: Client,
  taxon: Taxon,
): Promise<AssessmentHistoryMap> {
  const result: AssessmentHistoryMap = {};

  for (const query of taxon.redlist) {
    const sql = `
      SELECT
        t.sis_id as sis_taxon_id,
        a.id as assessment_id,
        a.year_published,
        rlc.code as category,
        a.assessment_date,
        ac_assessors.supplementary_fields->>'full' as assessors,
        ac_reviewers.supplementary_fields->>'full' as reviewers
      FROM taxons t
      JOIN assessments a ON a.taxon_id = t.id
      JOIN assessment_scopes ascope ON ascope.assessment_id = a.id
      JOIN red_list_category_lookup rlc ON rlc.id = a.red_list_category_id
      LEFT JOIN assessment_credits ac_assessors ON ac_assessors.assessment_id = a.id AND ac_assessors.credit_type_id = 1
      LEFT JOIN assessment_credits ac_reviewers ON ac_reviewers.assessment_id = a.id AND ac_reviewers.credit_type_id = 2
      WHERE t.${query.filterColumn} = ANY($1)
        AND t.latest = true
        AND a.suppress = false
        AND ascope.scope_lookup_id = 15
        AND t.infra_name IS NULL
        AND t.subpopulation_name IS NULL
      ORDER BY t.sis_id, a.year_published DESC, a.id DESC
    `;

    const rows = (await pgClient.query(sql, [query.filterValues])).rows;

    for (const row of rows) {
      const sisTaxonId = String(row.sis_taxon_id);
      const yearPublished = String(row.year_published);

      if (!result[sisTaxonId]) result[sisTaxonId] = [];

      // Deduplicate: keep only the first (highest assessment_id) per year
      const existing = result[sisTaxonId];
      if (existing.length > 0 && existing[existing.length - 1].year === yearPublished) {
        continue;
      }

      const assessmentDate = row.assessment_date
        ? new Date(row.assessment_date).toISOString().split("T")[0]
        : null;

      existing.push({
        id: Number(row.assessment_id),
        year: yearPublished,
        category: row.category,
        date: assessmentDate,
        assessors: row.assessors || null,
        reviewers: row.reviewers || null,
      });
    }
  }

  return result;
}

// =============================================================================
// CSV OUTPUT
// =============================================================================

const REDLIST_CSV_COLUMNS = [
  "sis_taxon_id", "scientific_name", "common_name", "class_name", "order_name",
  "family", "taxon_group_table1a", "assessment_id", "iucn_category", "assessment_date",
  "year_published", "population_trend", "countries",
];

export function writeRedlistCsv(species: RedlistSpecies[], outputPath: string): void {
  const rows = species
    .map((s) => ({
      sis_taxon_id: s.sis_taxon_id,
      scientific_name: s.scientific_name,
      common_name: s.common_name,
      class_name: s.class_name,
      order_name: s.order_name,
      family: s.family,
      taxon_group_table1a: s.taxon_group_table1a,
      assessment_id: s.assessment_id,
      iucn_category: s.category,
      assessment_date: s.assessment_date,
      year_published: s.year_published,
      population_trend: s.population_trend,
      countries: s.countries.join(";"),
    }));

  writeCsv(rows, REDLIST_CSV_COLUMNS, outputPath);
}

export function readRedlistCsv(taxonId: string): RedlistSpecies[] {
  const csvPath = path.join(REDLIST_DIR, `${taxonId}.csv`);
  return readCsv<RedlistSpecies>(csvPath, (r) => ({
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    assessment_id: parseInt(r.assessment_id, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || null,
    class_name: r.class_name || null,
    order_name: r.order_name || null,
    family: r.family || null,
    category: r.iucn_category || "",
    assessment_date: r.assessment_date || null,
    year_published: r.year_published || "",
    population_trend: r.population_trend || null,
    countries: r.countries ? r.countries.split(";").filter(Boolean) : [],
    taxon_group_table1a: r.taxon_group_table1a,
  }));
}

// =============================================================================
// MAIN
// =============================================================================

export async function run(opts: {
  taxa?: string[];
  historyOnly?: boolean;
  logger?: SyncLogger;
} = {}): Promise<void> {
  const taxaToSync = getTaxa(opts.taxa);
  const historyOnly = opts.historyOnly ?? false;
  const logger = opts.logger ?? SyncLogger.noop();

  const startTime = Date.now();

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

    logger.log("fetch_redlist_species_start", {
      taxa: taxaToSync.map((t) => t.id),
      historyOnly,
    });

    let totalSpecies = 0;

    for (const taxon of taxaToSync) {
      const taxonStart = Date.now();
      console.log(`\n${taxon.name} (${taxon.id}):`);

      if (!historyOnly) {
        const taxonSpecies: RedlistSpecies[] = [];
        for (const query of taxon.redlist) {
          const species = await fetchFromIucnDb(pgClient, taxon.id, query);
          console.log(`  Fetched ${species.length} species`);
          taxonSpecies.push(...species);
        }

        const outputPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
        writeRedlistCsv(taxonSpecies, outputPath);
        console.log(`  Wrote ${taxonSpecies.length} species → ${outputPath}`);
        totalSpecies += taxonSpecies.length;
      }

      const history = await fetchAssessmentHistory(pgClient, taxon);
      const historyDir = path.join(REDLIST_DIR, "history");
      fs.mkdirSync(historyDir, { recursive: true });
      const historyPath = path.join(historyDir, `${taxon.id}.json`);
      fs.writeFileSync(historyPath, JSON.stringify(history) + "\n");
      console.log(`  Wrote history for ${Object.keys(history).length} species → ${historyPath}`);

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      logger.log("fetch_redlist_species_taxon", { taxon: taxon.id, fetched: totalSpecies, duration_seconds: Number(taxonDuration) });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("fetch_redlist_species_complete", {
      total_species: totalSpecies,
      duration_seconds: Number(elapsed),
    });

    console.log("\n" + "=".repeat(50));
    console.log("fetch-redlist-species complete:");
    if (!historyOnly) console.log(`  Species: ${totalSpecies.toLocaleString()}`);
    console.log(`  Output:  ${REDLIST_DIR}/`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    await pgClient.end();
  }
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const historyOnly = args.includes("--history-only");
  const taxonArg = args.find((a) => !a.startsWith("--"))?.toLowerCase();

  console.log(`fetch-redlist-species: IUCN Red List DB → ${historyOnly ? "history JSON" : "CSV + history JSON"}`);
  console.log("=".repeat(50));

  const logger = new SyncLogger("fetch-redlist-species");
  try {
    await run({ taxa: taxonArg ? [taxonArg] : undefined, historyOnly, logger });
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch-redlist-species.ts") || process.argv[1]?.endsWith("fetch-redlist-species.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
