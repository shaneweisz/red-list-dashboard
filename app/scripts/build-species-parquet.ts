/**
 * build-species-parquet (#261): unify the per-group Red List + GBIF CSVs into a
 * single lineage-sorted species.parquet — the query substrate for the DuckDB
 * read layer. Mirrors build-search-index's union: assessed Red List species +
 * GBIF "NE" species (those not linked to any assessment, minus domesticated).
 *
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

  // Representative GBIF key per assessment (for detail links).
  await conn.run(`
    CREATE TEMP TABLE linked AS
      SELECT sis_taxon_id, min(gbif_species_key) AS gbif_species_key
      FROM read_csv_auto('${mappingCsv}')
      WHERE gbif_species_key IS NOT NULL
      GROUP BY sis_taxon_id;
  `);

  // The full set of linked GBIF keys (a species can map to several), used to
  // exclude assessed species from the NE/GBIF side. Must be ALL keys, not the
  // per-assessment representative — else multi-mapped keys leak into NE.
  await conn.run(`
    CREATE TEMP TABLE linked_keys AS
      SELECT DISTINCT gbif_species_key
      FROM read_csv_auto('${mappingCsv}')
      WHERE gbif_species_key IS NOT NULL;
  `);

  await conn.run(`
    COPY (
      WITH assessed AS (
        SELECT
          CAST(r.sis_taxon_id AS BIGINT)        AS id,
          'assessed'                            AS source,
          r.scientific_name,
          r.common_name,
          r.taxon_group_table1a                 AS taxon_group,
          lower(r.class_name)                   AS class_name,
          lower(r.order_name)                   AS order_name,
          lower(r.family)                       AS family,
          r.iucn_category,
          CAST(r.assessment_id AS BIGINT)       AS assessment_id,
          r.assessment_date,
          r.year_published,
          r.countries,
          l.gbif_species_key                    AS gbif_species_key,
          NULL::BIGINT                          AS total_count
        FROM read_csv_auto('${redlistGlob}', union_by_name=true) r
        LEFT JOIN linked l ON l.sis_taxon_id = r.sis_taxon_id
      ),
      ne AS (
        SELECT
          -CAST(g.gbif_species_key AS BIGINT)   AS id,
          'ne'                                  AS source,
          g.scientific_name,
          g.common_name,
          g.taxon_group_table1a                 AS taxon_group,
          lower(g.class_name)                   AS class_name,
          lower(g.order_name)                   AS order_name,
          lower(g.family)                       AS family,
          'NE'                                  AS iucn_category,
          NULL::BIGINT                          AS assessment_id,
          NULL                                  AS assessment_date,
          NULL                                  AS year_published,
          g.countries,
          CAST(g.gbif_species_key AS BIGINT)    AS gbif_species_key,
          CAST(g.total_count AS BIGINT)         AS total_count
        FROM read_csv_auto('${gbifGlob}', union_by_name=true) g
        WHERE g.gbif_species_key NOT IN (SELECT gbif_species_key FROM linked_keys)
          AND g.gbif_species_key NOT IN (${domesticated})
      )
      SELECT * FROM assessed
      UNION ALL
      SELECT * FROM ne
      ORDER BY class_name, order_name, family, scientific_name
    ) TO '${outPath}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const total = (await q(`SELECT count(*) c FROM '${outPath}'`))[0].c;
  const assessed = (await q(`SELECT count(*) c FROM '${outPath}' WHERE source='assessed'`))[0].c;
  const ne = (await q(`SELECT count(*) c FROM '${outPath}' WHERE source='ne'`))[0].c;
  console.log(`Wrote ${outPath}`);
  console.log(`  total ${total}  (assessed ${assessed}, NE ${ne})`);
}

const isDirectRun = process.argv[1]?.endsWith("build-species-parquet.ts") || process.argv[1]?.endsWith("build-species-parquet.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
