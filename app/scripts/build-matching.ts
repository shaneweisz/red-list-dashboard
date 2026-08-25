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
 *  4. accepted-name match on the NORMALISED name → passes 1-3 all join on the name
 *     as spelled, so a difference in a Latin termination defeats every one of them:
 *     Ochotona pallasii / Ochotona pallasi, Sminthopsis fuliginosa / fuliginosus.
 *     Both codes deem such names identical (ICZN Art. 58, ICN Art. 53.3), so this
 *     repeats pass 1 against the normalised name (see name-variants.ts).
 *  5. synonym-name match on the normalised name → as pass 2, resolving to the
 *     accepted parent.
 *  6. provisionally-accepted match → a separate gap rather than a spelling one:
 *     col_acc is the displayable universe (status='accepted' only), so a name CoL
 *     lists as provisionally accepted never linked at all, even spelled identically.
 *  7. else unmatched.
 *
 * Passes 4-6 refuse an ambiguous normalised key outright instead of guessing.
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
import { loadEnvFiles, DATA_DIR, CSV_QUOTING } from "./utils";
import { speciesNameParts, normalisedKey } from "./name-variants";

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
          FROM read_csv('${redlistGlob}', header=true, all_varchar=true, union_by_name=true, ${CSV_QUOTING})
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

  // (4-6) Variant and provisional passes, for the Red List rows the three exact-name
  // passes left unmatched.
  //
  // Passes 1-3 all join on the name AS SPELLED, so a difference in a Latin
  // termination defeats every one of them — Ochotona pallasii vs CoL's Ochotona
  // pallasi, Sminthopsis fuliginosa vs CoL's Sminthopsis fuliginosus. Both codes
  // deem such names identical (ICZN Art. 58, ICN Art. 53.3), so these passes redo
  // the same three lookups against the normalised name (see name-variants.ts).
  //
  // Pass 6 is a different bug wearing the same clothes: col_acc is the displayable
  // universe, which is status='accepted' only, so a name CoL lists as
  // PROVISIONALLY accepted never linked at all — not even when spelled identically.
  //
  // Candidates are narrowed by genus first. The genus must match exactly anyway
  // (a differing genus is a taxonomic act, not a spelling), so fetching only the
  // backbone rows in the ~few hundred genera involved keeps this to tens of
  // thousands of rows instead of normalising all 3.8M — and keeps ONE
  // implementation of the normalisation, in TypeScript, where it is unit-tested.
  //
  // Red List rows only: the 'gbif' rows ARE CoL species, so there is no second
  // spelling to reconcile.
  const unmatched = await (await conn.run(`
    SELECT o.id, o.scientific_name
    FROM ours o
    LEFT JOIN acc_match a ON a.id = o.id
    LEFT JOIN col_syn s ON s.nm = o.nm
    LEFT JOIN iucn_match i ON i.id = o.id
    WHERE o.src = 'redlist'
      AND a.col_id IS NULL AND s.col_id IS NULL AND i.col_id IS NULL;
  `)).getRowObjects();

  type Tier = "accepted" | "synonym" | "provisional";
  /** Normalised "genus epithet" → the species of ours waiting on it. */
  const wanted = new Map<string, number[]>();
  const genera = new Set<string>();
  for (const r of unmatched) {
    const parts = speciesNameParts(String(r.scientific_name));
    const key = parts && normalisedKey(String(r.scientific_name));
    if (!parts || !key) continue;
    genera.add(parts[0]);
    const bucket = wanted.get(key);
    if (bucket) bucket.push(Number(r.id));
    else wanted.set(key, [Number(r.id)]);
  }

  const generaList = [...genera].map((g) => `'${g.replace(/'/g, "''")}'`).join(",");
  const colRows = generaList
    ? await (await conn.run(`
        SELECT col_id, parent_id, status, scientific_name
        FROM read_parquet('${backbone}')
        WHERE rank = 'species'
          AND lower(split_part(scientific_name, ' ', 1)) IN (${generaList});
      `)).getRowObjects()
    : [];

  /** normalised key → tier → the distinct col_ids CoL offers at that tier. */
  const offers = new Map<string, Map<Tier, Set<string>>>();
  for (const r of colRows) {
    const key = normalisedKey(String(r.scientific_name));
    if (!key || !wanted.has(key)) continue;
    const status = String(r.status ?? "");
    // A synonym resolves to its accepted parent, exactly as pass 2 does. Anything
    // that is neither accepted nor a synonym is skipped — notably 'misapplied',
    // which records that a name was used WRONGLY for a taxon and is therefore
    // evidence AGAINST the two names being one name.
    let tier: Tier | null = null;
    let colId: string | null = null;
    if (status === "accepted") { tier = "accepted"; colId = String(r.col_id); }
    else if (status === "provisionally accepted") { tier = "provisional"; colId = String(r.col_id); }
    else if (status.includes("synonym")) { tier = "synonym"; colId = r.parent_id as string | null; }
    if (!tier || !colId) continue;
    let byTier = offers.get(key);
    if (!byTier) offers.set(key, (byTier = new Map()));
    let ids = byTier.get(tier);
    if (!ids) byTier.set(tier, (ids = new Set()));
    ids.add(colId);
  }

  // Strongest tier wins: an accepted concept beats a synonymy, and both beat a name
  // CoL has only provisionally accepted.
  //
  // Ambiguity is refused outright rather than falling through to a weaker tier. Two
  // accepted species in one genus cannot legitimately differ only by a termination —
  // the codes make them the same name — so a collision means CoL holds one species
  // twice (Ascaltis lamarckii / Ascaltis lamarcki), and guessing between the two
  // records would hand an assessment to whichever sorted first. Measured against the
  // current backbone this never fires, which is exactly why it is counted and logged
  // rather than assumed away.
  const TIERS: [Tier, string][] = [
    ["accepted", "accepted_variant"],
    ["synonym", "synonym_variant"],
    ["provisional", "provisional"],
  ];
  const variantPairs: { id: number; colId: string; method: string }[] = [];
  let ambiguous = 0;
  for (const [key, ids] of wanted) {
    const byTier = offers.get(key);
    if (!byTier) continue;
    const hit = TIERS.map(([tier, method]) => ({ found: byTier.get(tier), method })).find((t) => t.found?.size);
    if (!hit?.found) continue;
    if (hit.found.size > 1) { ambiguous += ids.length; continue; }
    const colId = [...hit.found][0];
    for (const id of ids) variantPairs.push({ id, colId, method: hit.method });
  }

  await conn.run(`CREATE TEMP TABLE variant_match (id BIGINT, col_id VARCHAR, method VARCHAR);`);
  for (let i = 0; i < variantPairs.length; i += 1000) {
    const chunk = variantPairs.slice(i, i + 1000)
      .map((p) => `(${p.id}, '${p.colId.replace(/'/g, "''")}', '${p.method}')`).join(",");
    await conn.run(`INSERT INTO variant_match VALUES ${chunk};`);
  }
  if (ambiguous > 0) {
    console.log(`  ${ambiguous} species left unmatched: their normalised name offers more than one CoL record`);
  }

  // Primary link — one row per species (its single best match).
  await conn.run(`
    CREATE TEMP TABLE primary_link AS
      SELECT o.src, o.id, o.sis_taxon_id, o.gbif_species_key, o.scientific_name,
             coalesce(a.col_id, s.col_id, i.col_id, v.col_id) AS col_id,
             CASE WHEN a.col_id IS NOT NULL AND a.ncand = 1 THEN 'accepted'
                  WHEN a.col_id IS NOT NULL THEN 'accepted_homonym'
                  WHEN s.col_id IS NOT NULL THEN 'synonym'
                  WHEN i.col_id IS NOT NULL THEN 'iucn_synonym'
                  WHEN v.col_id IS NOT NULL THEN v.method
                  ELSE 'unmatched' END AS match_method
      FROM ours o
      LEFT JOIN acc_match a ON a.id = o.id
      LEFT JOIN col_syn s ON s.nm = o.nm AND a.col_id IS NULL
      LEFT JOIN iucn_match i ON i.id = o.id AND a.col_id IS NULL AND s.col_id IS NULL
      LEFT JOIN variant_match v ON v.id = o.id;
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
             count(*) FILTER (WHERE match_method = 'accepted_variant') AS accvar,
             count(*) FILTER (WHERE match_method = 'synonym_variant') AS synvar,
             count(*) FILTER (WHERE match_method = 'provisional') AS prov,
             count(*) FILTER (WHERE match_method = 'unmatched') AS un
      FROM '${out}' WHERE src = '${src}' AND match_method <> 'iucn_synonym_covered'`))[0];
    const t = Number(r.total), m = Number(r.matched);
    console.log(`${src}: ${t.toLocaleString()} | matched ${(100 * m / t).toFixed(1)}% ` +
      `(accepted ${Number(r.acc).toLocaleString()}, via-CoL-synonym ${Number(r.syn).toLocaleString()}, via-IUCN-synonym ${Number(r.isyn).toLocaleString()}, via-variant-accepted ${Number(r.accvar).toLocaleString()}, via-variant-synonym ${Number(r.synvar).toLocaleString()}, via-provisional ${Number(r.prov).toLocaleString()}, homonym-resolved ${Number(r.hom).toLocaleString()}, unmatched ${Number(r.un).toLocaleString()})`);
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
