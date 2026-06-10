/**
 * build-parquet (#261): build the DuckDB read substrate from the per-group
 * Red List + GBIF CSVs + history. Three lineage-sorted parquets (split by the
 * assessed-vs-unassessed scale/schema asymmetry — assessed is bounded ~172k,
 * unassessed balloons under CoL):
 *
 *  - assessed.parquet     = Red List assessed species, enriched with GBIF
 *      occurrence counts summed across ALL their mapping links (canonical-
 *      preferred representative key). Rich schema; columns match SpeciesRow.
 *  - unassessed.parquet   = GBIF species not linked to any assessment (minus
 *      domesticated), category 'NE'. Lean schema — taxonomy + occurrence count
 *      only (no assessment-only columns, no obs-after-assessment-year).
 *  - assessments.parquet  = flattened assessment history (one row per past
 *      assessment, seq-ordered) for the species detail panel.
 *
 * Mirrors species-store.getSpecies + build-search-index. Sorted by lineage so
 * DuckDB row-group min/max prunes any taxonomic filter.
 *
 *   npx tsx scripts/build-parquet.ts
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR, REDLIST_DIR, GBIF_DIR } from "./utils";
import { EXCLUDED_DOMESTICATED_GBIF_KEYS } from "../src/lib/data/taxonomy-constants";

export async function run(): Promise<void> {
  const redlistGlob = path.join(REDLIST_DIR, "*.csv");
  const gbifGlob = path.join(GBIF_DIR, "*.csv");
  const mappingCsv = path.join(DATA_DIR, "mapping.csv");
  const historyDir = path.join(REDLIST_DIR, "history");
  const assessmentsOut = path.join(DATA_DIR, "assessments.parquet");
  const assessedOut = path.join(DATA_DIR, "assessed.parquet");
  const unassessedOut = path.join(DATA_DIR, "unassessed.parquet");
  const domesticated = [...EXCLUDED_DOMESTICATED_GBIF_KEYS].join(",");

  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();

  // GBIF rows keyed by species key (globally unique across group files).
  await conn.run(`
    CREATE TEMP TABLE gbif_all AS
      SELECT
        CAST(gbif_species_key AS BIGINT)         AS gbif_species_key,
        scientific_name, common_name,
        taxon_group_table1a                      AS taxon_group,
        lower(class_name) AS class_name, lower(order_name) AS order_name, lower(family) AS family,
        CAST(total_count AS BIGINT)              AS total_count,
        CAST(count_after_assessment_year AS BIGINT) AS count_after,
        countries
      FROM read_csv_auto('${gbifGlob}', union_by_name=true);
  `);

  await conn.run(`
    CREATE TEMP TABLE map AS
      SELECT CAST(sis_taxon_id AS BIGINT) AS sis_taxon_id,
             CAST(gbif_species_key AS BIGINT) AS gbif_species_key,
             name_source
      FROM read_csv_auto('${mappingCsv}')
      WHERE gbif_species_key IS NOT NULL;
  `);

  // sis_taxon_id → its Red List group (one per species). Used to restrict GBIF
  // enrichment to the species' OWN group, matching species-store's per-group
  // gbifMap lookup (cross-group linked keys are not counted).
  await conn.run(`
    CREATE TEMP TABLE rl AS
      SELECT DISTINCT CAST(sis_taxon_id AS BIGINT) AS sis_taxon_id, taxon_group_table1a AS taxon_group
      FROM read_csv_auto('${redlistGlob}', union_by_name=true);
  `);

  // Per-assessment GBIF enrichment: sum occurrence counts across all linked
  // GBIF rows that exist; representative key prefers a canonical-source match.
  await conn.run(`
    CREATE TEMP TABLE enrich AS
      SELECT
        m.sis_taxon_id,
        sum(g.total_count)  AS gbif_occurrence_count,
        sum(g.count_after)  AS gbif_observations_after_assessment_year,
        -- representative key: canonical-source preferred, then smallest key
        -- (deterministic; for multi-match species this may differ from v1's
        -- file-order pick, but is an equally-valid GBIF match for the species)
        arg_min(m.gbif_species_key, (CASE WHEN m.name_source='canonical' THEN 0 ELSE 1 END) * 1000000000 + m.gbif_species_key) AS gbif_species_key
      FROM map m
      JOIN rl ON rl.sis_taxon_id = m.sis_taxon_id
      JOIN gbif_all g ON g.gbif_species_key = m.gbif_species_key AND g.taxon_group = rl.taxon_group
      GROUP BY m.sis_taxon_id;
  `);

  // Assessed (IUCN Red List) — the hot, bounded, rich dataset.
  await conn.run(`
    COPY (
      SELECT
        CAST(r.sis_taxon_id AS BIGINT)   AS id,
        r.scientific_name, r.common_name,
        r.taxon_group_table1a            AS taxon_group,
        lower(r.class_name) AS class_name, lower(r.order_name) AS order_name, lower(r.family) AS family,
        r.iucn_category,
        CAST(r.assessment_id AS BIGINT)  AS assessment_id,
        -- keep as raw strings (read_csv may infer DATE/INT) to match the CSV path
        CAST(r.assessment_date AS VARCHAR) AS assessment_date,
        CAST(r.year_published AS VARCHAR)  AS year_published,
        r.countries,
        e.gbif_species_key,
        e.gbif_occurrence_count,
        e.gbif_observations_after_assessment_year,
        -- arrays kept as raw ';'-joined strings (query layer splits, matching
        -- loadRedlistForGroup); booleans as 'true'.
        nullif(r.population_trend, '')    AS population_trend,
        r.systems, r.growth_forms,
        nullif(r.movement_pattern, '')    AS movement_pattern,
        coalesce(CAST(r.possibly_extinct AS VARCHAR), '') = 'true'             AS possibly_extinct,
        coalesce(CAST(r.possibly_extinct_in_the_wild AS VARCHAR), '') = 'true' AS possibly_extinct_in_the_wild,
        nullif(r.criteria, '')            AS criteria,
        r.threat_codes,
        coalesce(CAST(r.has_map AS VARCHAR), '') = 'true'                      AS has_map
      FROM read_csv_auto('${redlistGlob}', union_by_name=true) r
      LEFT JOIN enrich e ON e.sis_taxon_id = r.sis_taxon_id
      ORDER BY class_name, order_name, family, scientific_name
    ) TO '${assessedOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  // Unassessed (GBIF species with no IUCN assessment) — cold, huge under CoL,
  // lean schema (no assessment-only columns).
  await conn.run(`
    COPY (
      SELECT
        -g.gbif_species_key              AS id,
        g.scientific_name, g.common_name,
        g.taxon_group, g.class_name, g.order_name, g.family,
        'NE'                             AS iucn_category,
        g.countries,
        g.gbif_species_key,
        g.total_count                    AS gbif_occurrence_count
      FROM gbif_all g
      WHERE g.gbif_species_key NOT IN (SELECT DISTINCT gbif_species_key FROM map)
        AND g.gbif_species_key NOT IN (${domesticated})
      ORDER BY class_name, order_name, family, scientific_name
    ) TO '${unassessedOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  // Assessments (history) — flatten the map-shaped history/*.json into rows
  // (one per past assessment), preserving array order via `seq` so the species
  // join can rebuild previous_assessments in the same order (index 0 = latest).
  const ndjson = path.join(DATA_DIR, "_assessments.ndjson");
  const ws = fs.createWriteStream(ndjson);
  if (fs.existsSync(historyDir)) {
    for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"))) {
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf-8")) as
        Record<string, Array<{ id: number; year: string; category: string; date: string | null; assessors: string | null; reviewers: string | null }>>;
      for (const [sis, arr] of Object.entries(data)) {
        arr.forEach((x, seq) => ws.write(JSON.stringify({ sis_taxon_id: Number(sis), seq, id: x.id, year: x.year, category: x.category, date: x.date, assessors: x.assessors, reviewers: x.reviewers }) + "\n"));
      }
    }
  }
  await new Promise<void>((res) => ws.end(res));
  await conn.run(`
    COPY (
      SELECT CAST(sis_taxon_id AS BIGINT) sis_taxon_id, CAST(seq AS INTEGER) seq,
             CAST(id AS BIGINT) id, CAST("year" AS VARCHAR) AS "year", category,
             CAST("date" AS VARCHAR) AS "date", assessors, reviewers
      FROM read_json_auto('${ndjson}', format='newline_delimited')
      ORDER BY sis_taxon_id, seq
    ) TO '${assessmentsOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);
  fs.unlinkSync(ndjson);

  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const a = (await q(`
    SELECT count(*) n,
           count(*) FILTER (gbif_occurrence_count IS NOT NULL) with_obs,
           count(*) FILTER (gbif_observations_after_assessment_year IS NOT NULL) with_caa
    FROM '${assessedOut}'`))[0];
  const ne = (await q(`SELECT count(*) n FROM '${unassessedOut}'`))[0];
  console.log(`Wrote ${assessedOut}: ${a.n} assessed (with occurrence_count ${a.with_obs}, with count-after ${a.with_caa})`);
  console.log(`Wrote ${unassessedOut}: ${ne.n} unassessed (NE)`);
  const h = (await q(`SELECT count(*) nrows, count(DISTINCT sis_taxon_id) species FROM '${assessmentsOut}'`))[0];
  console.log(`Wrote ${assessmentsOut}: ${h.nrows} assessment events across ${h.species} species`);
  const dup = (await q(`SELECT count(*) c FROM (SELECT gbif_species_key FROM gbif_all GROUP BY 1 HAVING count(*)>1)`))[0].c;
  console.log(`  duplicate GBIF keys across group files: ${dup}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-parquet.ts") || process.argv[1]?.endsWith("build-parquet.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
