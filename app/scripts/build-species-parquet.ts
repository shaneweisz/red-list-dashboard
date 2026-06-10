/**
 * build-species-parquet (#261): unify the per-group Red List + GBIF CSVs into a
 * single lineage-sorted species.parquet — the query substrate for the DuckDB
 * read layer. Mirrors species-store.getSpecies + build-search-index:
 *
 *  - assessed = Red List species, enriched with GBIF occurrence counts summed
 *    across ALL their mapping links (canonical-preferred representative key),
 *  - NE = GBIF species not linked to any assessment (minus domesticated).
 *
 * Column names match SpeciesRow so the query layer is a thin pass-through.
 * Sorted by lineage so DuckDB row-group min/max prunes any taxonomic filter.
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
  const outPath = path.join(DATA_DIR, "species.parquet");
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

  await conn.run(`
    COPY (
      WITH assessed AS (
        SELECT
          CAST(r.sis_taxon_id AS BIGINT)   AS id,
          'assessed'                       AS source,
          r.scientific_name, r.common_name,
          r.taxon_group_table1a            AS taxon_group,
          lower(r.class_name) AS class_name, lower(r.order_name) AS order_name, lower(r.family) AS family,
          r.iucn_category,
          CAST(r.assessment_id AS BIGINT)  AS assessment_id,
          r.assessment_date, r.year_published, r.countries,
          e.gbif_species_key,
          e.gbif_occurrence_count,
          e.gbif_observations_after_assessment_year
        FROM read_csv_auto('${redlistGlob}', union_by_name=true) r
        LEFT JOIN enrich e ON e.sis_taxon_id = r.sis_taxon_id
      ),
      ne AS (
        SELECT
          -g.gbif_species_key              AS id,
          'ne'                             AS source,
          g.scientific_name, g.common_name,
          g.taxon_group, g.class_name, g.order_name, g.family,
          'NE'                             AS iucn_category,
          NULL::BIGINT                     AS assessment_id,
          NULL AS assessment_date, NULL AS year_published, g.countries,
          g.gbif_species_key,
          g.total_count                    AS gbif_occurrence_count,
          g.count_after                    AS gbif_observations_after_assessment_year
        FROM gbif_all g
        WHERE g.gbif_species_key NOT IN (SELECT DISTINCT gbif_species_key FROM map)
          AND g.gbif_species_key NOT IN (${domesticated})
      )
      SELECT * FROM assessed
      UNION ALL
      SELECT * FROM ne
      ORDER BY class_name, order_name, family, scientific_name
    ) TO '${outPath}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const stats = (await q(`
    SELECT count(*) total,
           count(*) FILTER (source='assessed') assessed,
           count(*) FILTER (source='ne') ne,
           count(*) FILTER (source='assessed' AND gbif_occurrence_count IS NOT NULL) assessed_with_obs,
           count(*) FILTER (source='assessed' AND gbif_observations_after_assessment_year IS NOT NULL) assessed_with_caa
    FROM '${outPath}'`))[0];
  console.log(`Wrote ${outPath}`);
  console.log(`  total ${stats.total} (assessed ${stats.assessed}, NE ${stats.ne})`);
  console.log(`  assessed with occurrence_count: ${stats.assessed_with_obs}; with count-after-assessment: ${stats.assessed_with_caa}`);
  // GBIF key uniqueness sanity (would double-count if a key spanned group files)
  const dup = (await q(`SELECT count(*) c FROM (SELECT gbif_species_key FROM gbif_all GROUP BY 1 HAVING count(*)>1)`))[0].c;
  console.log(`  duplicate GBIF keys across group files: ${dup}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-species-parquet.ts") || process.argv[1]?.endsWith("build-species-parquet.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
