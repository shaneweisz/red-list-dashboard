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
 *  3. IUCN-synonym match → if neither of the above hit on the canonical name, try
 *     the species's own IUCN-recorded synonyms (taxon_synonyms, carried in the
 *     redlist CSVs) against CoL accepted names then CoL synonyms. This catches the
 *     reverse of (2): where CoL's synonymy is incomplete but IUCN lists the
 *     CoL-accepted name (e.g. a genus reassignment IUCN knows but CoL doesn't).
 *  4. else unmatched.
 *
 * Name-join only (no GBIF resolver exists yet — see #271); kingdom/rank tie-break
 * approximated here by family/class. Canonical wins over synonym; an accepted hit
 * wins over a CoL-synonym hit; the canonical name wins over IUCN synonyms.
 *
 * Inputs (all from earlier sync steps): data/species/ + data/backbone.parquet
 * (build-backbone), data/assessed.parquet + data/unassessed.parquet (build-parquet),
 * data/redlist/*.csv (fetch-redlist-species — the IUCN synonym source).
 *
 *   npx tsx scripts/build-matching.ts
 */
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";

export async function run(opts: { dataDir?: string } = {}): Promise<void> {
  const dir = opts.dataDir || DATA_DIR;
  const speciesGlob = path.join(dir, "species", "**", "*.parquet");
  const backbone = path.join(dir, "backbone.parquet");
  const assessed = path.join(dir, "assessed.parquet");
  const unassessed = path.join(dir, "unassessed.parquet");
  const redlistGlob = path.join(dir, "redlist", "*.csv");
  const out = path.join(dir, "species_link.parquet");

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
  // IUCN-recorded synonyms (redlist only): sis_taxon_id → synonym name. The redlist
  // CSV encodes them as ';'-joined `name:status` pairs (encodeSynonyms); take the
  // names, lowercased. These are already ambiguity-filtered upstream.
  await conn.run(`
    CREATE TEMP TABLE syn_keys AS
      SELECT DISTINCT id, nm FROM (
        SELECT CAST(sis_taxon_id AS BIGINT) AS id,
               lower(trim(split_part(p, ':', 1))) AS nm
        FROM (
          SELECT sis_taxon_id, unnest(string_split(synonyms, ';')) AS p
          FROM read_csv('${redlistGlob}', header=true, all_varchar=true, union_by_name=true)
          WHERE synonyms IS NOT NULL AND synonyms <> ''
        )
      ) WHERE nm <> '';
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

  // (3) IUCN-synonym match: best CoL hit across a species's IUCN synonyms — an
  // accepted hit (kind 0, family/class tie-break) beats a CoL-synonym hit (kind 1).
  await conn.run(`
    CREATE TEMP TABLE iucn_match AS
      SELECT id, col_id FROM (
        SELECT sk.id, m.col_id,
               row_number() OVER (PARTITION BY sk.id ORDER BY m.kind,
                 (CASE WHEN o.family = m.family THEN 3 WHEN o.class_name = m.class_name THEN 2 ELSE 1 END) DESC, m.col_id) AS rn
        FROM syn_keys sk
        JOIN ours o ON o.id = sk.id AND o.src = 'redlist'
        JOIN (
          SELECT nm, col_id, class_name, family, 0 AS kind FROM col_acc
          UNION ALL SELECT nm, col_id, NULL AS class_name, NULL AS family, 1 AS kind FROM col_syn
        ) m ON m.nm = sk.nm
      ) WHERE rn = 1;
  `);

  // Primary link — one row per species (its single best match).
  await conn.run(`
    CREATE TEMP TABLE primary_link AS
      SELECT o.src, o.id, o.sis_taxon_id, o.gbif_species_key, o.scientific_name,
             coalesce(a.col_id, s.col_id, i.col_id) AS col_id,
             CASE WHEN a.col_id IS NOT NULL AND a.ncand = 1 THEN 'accepted'
                  WHEN a.col_id IS NOT NULL THEN 'accepted_homonym'
                  WHEN s.col_id IS NOT NULL THEN 'synonym'
                  WHEN i.col_id IS NOT NULL THEN 'iucn_synonym'
                  ELSE 'unmatched' END AS match_method
      FROM ours o
      LEFT JOIN acc_match a ON a.id = o.id
      LEFT JOIN col_syn s ON s.nm = o.nm AND a.col_id IS NULL
      LEFT JOIN iucn_match i ON i.id = o.id AND a.col_id IS NULL AND s.col_id IS NULL;
  `);
  // Covered col_ids — a Red List species's OTHER names (its IUCN synonyms) can each
  // resolve to a CoL accepted concept beyond its primary match. This matters when CoL
  // carries the same species as two accepted concepts from different sources: IUCN
  // Verreauxia africana matched CoL's (non-Base) "Verreauxia africana", but its synonym
  // "Sasia africana" is CoL's in-Base accepted name. Recording every covered col_id as
  // an extra row (match_method 'iucn_synonym_covered') lets the NE de-dup exclude BOTH,
  // so an assessed species never resurfaces as a new candidate under CoL's alternate
  // name. Read layer de-dups on DISTINCT redlist col_id, so these rows are picked up
  // automatically; the spine/overlay (later) filters to the primary rows.
  await conn.run(`
    CREATE TEMP TABLE covered AS
      SELECT DISTINCT 'redlist' AS src, o.id, o.sis_taxon_id, o.gbif_species_key, o.scientific_name,
             m.col_id, 'iucn_synonym_covered' AS match_method
      FROM syn_keys sk
      JOIN ours o ON o.id = sk.id AND o.src = 'redlist'
      JOIN (SELECT nm, col_id FROM col_acc UNION SELECT nm, col_id FROM col_syn) m ON m.nm = sk.nm
      WHERE NOT EXISTS (SELECT 1 FROM primary_link p WHERE p.id = o.id AND p.col_id = m.col_id);
  `);
  await conn.run(`
    COPY (SELECT * FROM primary_link UNION ALL SELECT * FROM covered)
    TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  // ── verification ───────────────────────────────────────────────────────────
  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  for (const src of ["redlist", "gbif"]) {
    // Primary rows only (one per species) for the match rate; covered rows are extra.
    const r = (await q(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE match_method <> 'unmatched') AS matched,
             count(*) FILTER (WHERE match_method = 'accepted') AS acc,
             count(*) FILTER (WHERE match_method = 'accepted_homonym') AS hom,
             count(*) FILTER (WHERE match_method = 'synonym') AS syn,
             count(*) FILTER (WHERE match_method = 'iucn_synonym') AS isyn,
             count(*) FILTER (WHERE match_method = 'unmatched') AS un
      FROM '${out}' WHERE src = '${src}' AND match_method <> 'iucn_synonym_covered'`))[0];
    const t = Number(r.total), m = Number(r.matched);
    console.log(`${src}: ${t.toLocaleString()} | matched ${(100 * m / t).toFixed(1)}% ` +
      `(accepted ${Number(r.acc).toLocaleString()}, via-CoL-synonym ${Number(r.syn).toLocaleString()}, via-IUCN-synonym ${Number(r.isyn).toLocaleString()}, homonym-resolved ${Number(r.hom).toLocaleString()}, unmatched ${Number(r.un).toLocaleString()})`);
  }
  const cov = Number((await q(`SELECT count(*) c FROM '${out}' WHERE match_method = 'iucn_synonym_covered'`))[0].c);
  console.log(`  + ${cov.toLocaleString()} extra col_ids covered via IUCN synonyms (NE-dedup only — e.g. Sasia/Verreauxia africana)`);
  const ex = await q(`SELECT scientific_name FROM '${out}' WHERE src='redlist' AND match_method='unmatched' LIMIT 6`);
  console.log("  redlist unmatched examples:", ex.map((x) => x.scientific_name).join(" | "));
}

const isDirectRun = process.argv[1]?.endsWith("build-matching.ts") || process.argv[1]?.endsWith("build-matching.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
