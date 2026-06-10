/**
 * build-species-parquet (#261): build the DuckDB read substrate from the
 * per-group Red List + GBIF CSVs. Two lineage-sorted parquets (split by the
 * assessed-vs-unassessed scale/schema asymmetry — assessed is bounded ~172k,
 * unassessed balloons under CoL):
 *
 *  - redlist.parquet     = Red List assessed species, enriched with GBIF
 *      occurrence counts summed across ALL their mapping links (canonical-
 *      preferred representative key). Rich schema; columns match SpeciesRow.
 *  - unassessed.parquet  = GBIF species not linked to any assessment (minus
 *      domesticated), category 'NE'. Lean schema (no assessment-only columns).
 *
 * Mirrors species-store.getSpecies + build-search-index. Sorted by lineage so
 * DuckDB row-group min/max prunes any taxonomic filter.
 *
 *   npx tsx scripts/build-species-parquet.ts
 */
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR, REDLIST_DIR, GBIF_DIR } from "./utils";
import { EXCLUDED_DOMESTICATED_GBIF_KEYS } from "../src/lib/data/taxonomy-constants";

export async function run(): Promise<void> {
  const redlistGlob = path.join(REDLIST_DIR, "*.csv");
  const gbifGlob = path.join(GBIF_DIR, "*.csv");
  const mappingCsv = path.join(DATA_DIR, "mapping.csv");
  const redlistOut = path.join(DATA_DIR, "redlist.parquet");
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

  // Per-assessment GBIF enrichment: sum occurrence counts across all linked
  // GBIF rows that exist; representative key prefers a canonical-source match.
  await conn.run(`
    CREATE TEMP TABLE enrich AS
      SELECT
        m.sis_taxon_id,
        sum(g.total_count)  AS gbif_occurrence_count,
        sum(g.count_after)  AS gbif_observations_after_assessment_year,
        arg_min(m.gbif_species_key, CASE WHEN m.name_source='canonical' THEN 0 ELSE 1 END) AS gbif_species_key
      FROM map m JOIN gbif_all g USING (gbif_species_key)
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
    ) TO '${redlistOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
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
        g.total_count                    AS gbif_occurrence_count,
        g.count_after                    AS gbif_observations_after_assessment_year
      FROM gbif_all g
      WHERE g.gbif_species_key NOT IN (SELECT DISTINCT gbif_species_key FROM map)
        AND g.gbif_species_key NOT IN (${domesticated})
      ORDER BY class_name, order_name, family, scientific_name
    ) TO '${unassessedOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const a = (await q(`
    SELECT count(*) n,
           count(*) FILTER (gbif_occurrence_count IS NOT NULL) with_obs,
           count(*) FILTER (gbif_observations_after_assessment_year IS NOT NULL) with_caa
    FROM '${redlistOut}'`))[0];
  const ne = (await q(`SELECT count(*) n FROM '${unassessedOut}'`))[0];
  console.log(`Wrote ${redlistOut}: ${a.n} assessed (with occurrence_count ${a.with_obs}, with count-after ${a.with_caa})`);
  console.log(`Wrote ${unassessedOut}: ${ne.n} unassessed (NE)`);
  const dup = (await q(`SELECT count(*) c FROM (SELECT gbif_species_key FROM gbif_all GROUP BY 1 HAVING count(*)>1)`))[0].c;
  console.log(`  duplicate GBIF keys across group files: ${dup}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-species-parquet.ts") || process.argv[1]?.endsWith("build-species-parquet.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
