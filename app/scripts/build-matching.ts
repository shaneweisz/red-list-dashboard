/**
 * build-matching (#271, Phase 3): reconcile our IUCN/GBIF species to the CoL
 * backbone, producing species_link.parquet — the bridge `{sis_taxon_id,
 * gbif_species_key} → col_id` that attaches our conservation/occurrence overlays
 * onto the CoL tree.
 *
 * Matching ladder (Red List primary, then GBIF, then CoL — see #271):
 *  1. accepted-name match → a CoL accepted species. Homonyms (same name, >1
 *     accepted id) are broken by our own family then class_name.
 *  2. synonym-name match → resolve to the accepted taxon via backbone.parent_id.
 *  3. else unmatched.
 *
 * Name-join only (no GBIF resolver exists yet — see #271); kingdom/rank tie-break
 * approximated here by family/class. IUCN synonyms as extra match keys are a
 * later refinement (they aren't carried into assessed.parquet yet).
 *
 * Inputs (all from earlier sync steps): data/species/ + data/backbone.parquet
 * (build-backbone), data/assessed.parquet + data/unassessed.parquet (build-parquet).
 *
 *   npx tsx scripts/build-matching.ts
 */
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";

export async function run(): Promise<void> {
  const speciesGlob = path.join(DATA_DIR, "species", "**", "*.parquet");
  const backbone = path.join(DATA_DIR, "backbone.parquet");
  const assessed = path.join(DATA_DIR, "assessed.parquet");
  const unassessed = path.join(DATA_DIR, "unassessed.parquet");
  const out = path.join(DATA_DIR, "species_link.parquet");

  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();

  // CoL accepted species: name → col_id + lineage (may be homonymous).
  await conn.run(`
    CREATE TEMP TABLE col_acc AS
      SELECT lower(scientific_name) AS nm, col_id, class_name, family
      FROM read_parquet('${speciesGlob}', hive_partitioning=true);
  `);
  // CoL synonyms (species rank): name → accepted col_id (the synonym's parent).
  await conn.run(`
    CREATE TEMP TABLE col_syn AS
      SELECT nm, col_id FROM (
        SELECT lower(scientific_name) AS nm, parent_id AS col_id,
               row_number() OVER (PARTITION BY lower(scientific_name) ORDER BY parent_id) rn
        FROM read_parquet('${backbone}')
        WHERE rank = 'species' AND status LIKE '%synonym%' AND parent_id IS NOT NULL
      ) WHERE rn = 1;
  `);
  // Our species (both sources), lineage lowercased to match CoL.
  await conn.run(`
    CREATE TEMP TABLE ours AS
      SELECT 'redlist' AS src, id, id AS sis_taxon_id, gbif_species_key,
             lower(scientific_name) AS nm, class_name, family, scientific_name
      FROM read_parquet('${assessed}')
      UNION ALL
      SELECT 'gbif' AS src, id, NULL::BIGINT AS sis_taxon_id, gbif_species_key,
             lower(scientific_name) AS nm, class_name, family, scientific_name
      FROM read_parquet('${unassessed}');
  `);

  // (1) accepted match, homonym tie-break by family > class_name.
  await conn.run(`
    CREATE TEMP TABLE acc_match AS
      SELECT id, col_id, ncand FROM (
        SELECT o.id, c.col_id,
               count(*) OVER (PARTITION BY o.id) AS ncand,
               row_number() OVER (PARTITION BY o.id ORDER BY
                 (CASE WHEN o.family = c.family THEN 3 WHEN o.class_name = c.class_name THEN 2 ELSE 1 END) DESC, c.col_id) AS rn
        FROM ours o JOIN col_acc c ON o.nm = c.nm
      ) WHERE rn = 1;
  `);

  // Assemble: accepted (or accepted_homonym), else synonym, else unmatched.
  await conn.run(`
    COPY (
      SELECT o.src, o.id, o.sis_taxon_id, o.gbif_species_key, o.scientific_name,
             coalesce(a.col_id, s.col_id) AS col_id,
             CASE WHEN a.col_id IS NOT NULL AND a.ncand = 1 THEN 'accepted'
                  WHEN a.col_id IS NOT NULL THEN 'accepted_homonym'
                  WHEN s.col_id IS NOT NULL THEN 'synonym'
                  ELSE 'unmatched' END AS match_method
      FROM ours o
      LEFT JOIN acc_match a ON a.id = o.id
      LEFT JOIN col_syn s ON s.nm = o.nm AND a.col_id IS NULL
    ) TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  // ── verification ───────────────────────────────────────────────────────────
  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  for (const src of ["redlist", "gbif"]) {
    const r = (await q(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE match_method <> 'unmatched') AS matched,
             count(*) FILTER (WHERE match_method = 'accepted') AS acc,
             count(*) FILTER (WHERE match_method = 'accepted_homonym') AS hom,
             count(*) FILTER (WHERE match_method = 'synonym') AS syn,
             count(*) FILTER (WHERE match_method = 'unmatched') AS un
      FROM '${out}' WHERE src = '${src}'`))[0];
    const t = Number(r.total), m = Number(r.matched);
    console.log(`${src}: ${t.toLocaleString()} | matched ${(100 * m / t).toFixed(1)}% ` +
      `(accepted ${Number(r.acc).toLocaleString()}, via-synonym ${Number(r.syn).toLocaleString()}, homonym-resolved ${Number(r.hom).toLocaleString()}, unmatched ${Number(r.un).toLocaleString()})`);
  }
  const ex = await q(`SELECT scientific_name FROM '${out}' WHERE src='redlist' AND match_method='unmatched' LIMIT 6`);
  console.log("  redlist unmatched examples:", ex.map((x) => x.scientific_name).join(" | "));
}

const isDirectRun = process.argv[1]?.endsWith("build-matching.ts") || process.argv[1]?.endsWith("build-matching.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
