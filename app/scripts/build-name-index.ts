/**
 * build-name-index: one name-sorted index over every name the search fast path can
 * match, so a typeahead prefix query prunes to a row group or two instead of scanning
 * both species parquets end to end.
 *
 * assessed.parquet and unassessed.parquet are written ORDER BY class_name, order_name,
 * family (they're browse-ordered, which is what the species LISTS want), so a name
 * predicate can't prune a single row group: names are scattered across all of them. The
 * search hot path therefore read ~25MB off R2 per keystroke — ~2.2s per uncached query
 * in production, and the reason species-duckdb materializes search_idx in memory at all.
 *
 * This is the same trick synonym-index.parquet already uses (sorted by name, prefix-range
 * query, ~1 row group read) applied to the fast path. Sorted by name_lo, so:
 *
 *   WHERE name_lo >= 'panth' AND name_lo < 'panth' || chr(1114111)
 *
 * touches one row group. ROW_GROUP_SIZE is tuned for that read rather than left at the
 * default: 20k rows puts ~0.97MB in a group (103 of them), so a prefix query pulls about
 * a megabyte where the old path pulled ~25MB — and unlike the in-memory index it needs no
 * warm container to be fast. Measured locally: 9-13ms per query.
 *
 * One row per SEARCHABLE NAME, not per species — a species contributes its scientific
 * name, its common name, and its epithet, so "panthera", "lion" and "leo" all reach
 * Panthera leo by prefix. name_kind carries which, because the dropdown's ranking is
 * defined in those terms (exact common name > common-name prefix > scientific prefix).
 *
 * Rows carry the whole SearchResult payload, including the col_id the NE list keys on —
 * so a hit needs no join back to the species parquets and no species_link lookup, which
 * on the old path was another R2 read per search.
 *
 * Covers the fast path only (assessed ∪ GBIF-observed). The CoL-only and synonym tiers
 * are reached solely when nothing here matches, and they already have their own answer:
 * synonym-index.parquet is name-sorted, and species-duckdb primes both at warm-up.
 *
 * Input: data/assessed.parquet, data/unassessed.parquet, data/species_link.parquet.
 * Output: data/name-index.parquet.
 *
 *   npx tsx scripts/build-name-index.ts
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";

/** Ranking tiers, mirrored by searchSpecies' ORDER BY. Keep the two in step. */
export const NAME_KIND = { scientific: 0, common: 1, epithet: 2, commonWord: 3 } as const;

export async function run(opts: { dataDir?: string } = {}): Promise<void> {
  const dir = opts.dataDir || DATA_DIR;
  const assessed = path.join(dir, "assessed.parquet");
  const unassessed = path.join(dir, "unassessed.parquet");
  const link = path.join(dir, "species_link.parquet");
  for (const f of [assessed, unassessed, link]) {
    if (!fs.existsSync(f)) throw new Error(`build-name-index: ${f} not found (run build-parquet + build-matching first)`);
  }
  const out = path.join(dir, "name-index.parquet");

  const conn = await (await DuckDBInstance.create(":memory:")).connect();

  // The per-species payload, unioned once and then exploded into name rows below.
  // col_id is NULL for assessed rows on purpose: their row key is the SIS id, and
  // searchSpecies keys them that way (see species_key in SearchResult).
  await conn.run(`
    CREATE TEMP TABLE species AS
      SELECT id, scientific_name, common_name, taxon_group, iucn_category AS category,
             gbif_species_key, gbif_occurrence_count,
             assessment_id, CAST(assessment_date AS VARCHAR) AS assessment_date,
             countries, class_name, order_name, family,
             true AS assessed, CAST(NULL AS VARCHAR) AS col_id
      FROM read_parquet('${assessed}')
      UNION ALL
      SELECT u.id, u.scientific_name, u.common_name, u.taxon_group, u.iucn_category,
             u.gbif_species_key, u.gbif_occurrence_count,
             NULL, NULL,
             u.countries, u.class_name, u.order_name, u.family,
             false, l.col_id
      FROM read_parquet('${unassessed}') u
      LEFT JOIN (
        -- One col_id per GBIF key. 3,756 col_ids carry more than one key, but a key maps
        -- to at most one col_id, so this side of the relation needs no collapsing — the
        -- any_value guards against a duplicate row in the link table, not a real fan-out.
        SELECT gbif_species_key, any_value(col_id) AS col_id
        FROM read_parquet('${link}')
        WHERE src = 'gbif' AND col_id IS NOT NULL
        GROUP BY gbif_species_key
      ) l ON l.gbif_species_key = u.gbif_species_key`);

  const payload = `id, scientific_name, common_name, taxon_group, category, gbif_species_key,
    gbif_occurrence_count, assessment_id, assessment_date, countries,
    class_name, order_name, family, assessed, col_id`;

  await conn.run(`
    COPY (
      SELECT name_lo, matched_name, name_kind, ${payload} FROM (
        -- Scientific name.
        SELECT lower(scientific_name) AS name_lo, scientific_name AS matched_name,
               ${NAME_KIND.scientific} AS name_kind, ${payload}
        FROM species WHERE scientific_name IS NOT NULL AND scientific_name <> ''
        UNION ALL
        -- Common name. Stored '' rather than NULL when absent (see build-parquet).
        SELECT lower(common_name), common_name, ${NAME_KIND.common}, ${payload}
        FROM species WHERE nullif(common_name, '') IS NOT NULL
        UNION ALL
        -- Specific epithet, so the half of a binomial people actually remember ("leo",
        -- "tigris") is a prefix hit rather than an interior substring only the slow tier
        -- could find. Monomials contribute nothing here — their epithet row would just
        -- duplicate the scientific-name row.
        SELECT lower(split_part(scientific_name, ' ', 2)), scientific_name, ${NAME_KIND.epithet}, ${payload}
        FROM species
        WHERE scientific_name LIKE '% %' AND nullif(split_part(scientific_name, ' ', 2), '') IS NOT NULL
        UNION ALL
        -- Every word of a multi-word common name after the first, which is the one case a
        -- prefix index would otherwise lose to the old substring scan: "elephant" has to
        -- find African Elephant, and "eagle" Steller's Sea Eagle. Ranked below the tiers
        -- above (see name_kind), so a real prefix hit is never displaced by a word match.
        SELECT lower(w.word), s.common_name, ${NAME_KIND.commonWord}, ${payload}
        FROM species s, unnest(string_split(s.common_name, ' ')) WITH ORDINALITY AS w(word, pos)
        WHERE nullif(s.common_name, '') IS NOT NULL AND w.pos > 1 AND nullif(w.word, '') IS NOT NULL
      )
      ORDER BY name_lo
    ) TO '${out}' (FORMAT parquet, COMPRESSION ZSTD, ROW_GROUP_SIZE 20000)`);

  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const n = (await q(`SELECT count(*) n, count(DISTINCT name_lo) d FROM read_parquet('${out}')`))[0];
  const bytes = fs.statSync(out).size;
  console.log(`Wrote ${Number(n.n).toLocaleString()} name rows (${Number(n.d).toLocaleString()} distinct names, ` +
    `${(bytes / 1048576).toFixed(1)} MB) → ${out}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-name-index.ts") || process.argv[1]?.endsWith("build-name-index.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((e) => { console.error(e); process.exit(1); });
}
