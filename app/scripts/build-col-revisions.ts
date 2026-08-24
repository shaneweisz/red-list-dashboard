/**
 * build-col-revisions: the "possible taxonomic revision" flag for the main
 * dashboard → data/col-revisions.json
 *
 * The SSC-group view already flags, per group, which IUCN-assessed species have
 * no clean 1:1 Catalogue of Life match and why (build-taxa-summary.ts →
 * colBreakdown[].noMatchDetails). That diagnostic is computed per breakdown
 * *name*, so it only exists for the static tree's official/SSC nodes — the
 * primary assessed dashboard, which filters an arbitrary species set, has no
 * such lookup.
 *
 * This runs the SAME diagnostic (computeNoMatchDetails, shared with
 * build-taxa-summary via lib/data/col-breakdown) exactly once, unscoped — over
 * every assessed species in every taxon group — and writes a flat sis_taxon_id
 * → flag map the dashboard can load in one request.
 *
 * It also carries the SECOND, independent revision signal: the species CoL has
 * likely split OUT of an assessed one. That reuses split_candidates (the same
 * temp table the SSC view's "Likely split from" note is built from) inverted —
 * assessed parent → the Not Evaluated names carved off it — scoped to exactly
 * the NE universe the group view counts. A species can carry both signals; only
 * ~151 of ~9.7k do.
 *
 * Scope note: unscoped, "classified_elsewhere" (CoL puts this name under a
 * different class/order/family than the *node* being viewed) can't arise —
 * there's no node to disagree with — so the global flag carries the seven
 * reasons that are properties of the species itself.
 *
 * Usage:
 *   npx tsx scripts/build-col-revisions.ts
 */

import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";
import {
  computeNoMatchDetails,
  SPLIT_CANDIDATES_SQL,
  COL_TO_ASSESSED_SQL,
  type BreakdownQueryContext,
  type NoMatchDetail,
} from "../src/lib/data/col-breakdown";
import { SPLIT_REASON, UNFLAGGED_REASONS } from "../src/lib/col-revision";

// Keep in sync with build-taxa-summary.ts / species-duckdb.ts.
const EXCLUDED_COL_IDS_SQL = `('6MB3T')`; // Homo sapiens

export interface ColRevisionsFile {
  /** Per-signal counts, so the dashboard can size its chart without walking the
   *  map. These do NOT sum to `total`: a species carrying both a no-match reason
   *  and splits counts in two of them. */
  counts: Record<string, number>;
  /** Distinct species carrying at least one signal. */
  total: number;
  /** sis_taxon_id → the flag, with short keys and absent fields omitted — one
   *  entry per flagged species, so the shipped file stays small.
   *  r = no-match reason (absent on a split-only flag), d = detail (the species
   *  it's lumped with / demoted under), i = that species' own SIS id, dc = that
   *  species' CoL id, c = the CoL id to link to, n = CoL's own accepted name for
   *  that col_id, s = [name, col_id, previous name, previous col_id] of each
   *  species CoL likely split out of this one ("previous" being the old
   *  infraspecific name that now resolves there — the evidence for the split). */
  species: Record<string, { r?: string; d?: string; i?: number; dc?: string; c?: string; n?: string;
    s?: [string, string, string, string][] }>;
}

export async function run(): Promise<void> {
  const link = path.join(DATA_DIR, "species_link.parquet");
  const assessedPath = path.join(DATA_DIR, "assessed.parquet");
  const speciesGlob = path.join(DATA_DIR, "species", "**", "*.parquet");
  const backbonePath = path.join(DATA_DIR, "backbone.parquet");
  const outPath = path.join(DATA_DIR, "col-revisions.json");

  if (!fs.existsSync(path.join(DATA_DIR, "species")) || !fs.existsSync(link)) {
    console.log("  CoL revisions: species/ or species_link.parquet missing — skipping.");
    return;
  }

  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  await conn.run(
    `CREATE TEMP TABLE assessed_cids AS SELECT DISTINCT col_id FROM read_parquet('${link}') WHERE src = 'redlist' AND col_id IS NOT NULL`
  );
  // Same "extant, or CoL-extinct but IUCN-confirmed EX/EW" universe every other
  // CoL count uses — see build-taxa-summary.ts's createExEwAssessedTable.
  await conn.run(`
    CREATE TEMP TABLE ex_ew_assessed AS
      SELECT DISTINCT l.col_id
      FROM read_parquet('${link}') l
      JOIN read_parquet('${assessedPath}') a ON a.id = l.id
      WHERE l.src = 'redlist' AND l.col_id IS NOT NULL AND a.iucn_category IN ('EX', 'EW')`);
  const universeSql = `(extinct IS NOT TRUE OR col_id IN (SELECT col_id FROM ex_ew_assessed))`;

  const hasBackbone = fs.existsSync(backbonePath);
  if (hasBackbone) {
    // The infraspecific/provisional reasons need these; without backbone.parquet
    // they collapse into the blanket "missing_from_backbone".
    await conn.run(SPLIT_CANDIDATES_SQL(backbonePath, assessedPath, "assessed_cids"));
    await conn.run(COL_TO_ASSESSED_SQL(link, assessedPath));
  } else {
    console.log("  CoL revisions: backbone.parquet missing — infraspecific/provisional reasons unavailable.");
  }

  const ctx: BreakdownQueryContext = {
    conn, speciesGlob, assessedPath, linkPath: link,
    universeSql, assessedCidsTable: "assessed_cids",
    excludedColIdsSql: EXCLUDED_COL_IDS_SQL, hasBackbone, backbonePath,
  };

  const started = Date.now();
  const details: NoMatchDetail[] = await computeNoMatchDetails(ctx, "true", "true");

  const counts: Record<string, number> = {};
  const species: ColRevisionsFile["species"] = {};
  // A reason the dashboard doesn't flag is still diagnosed (and still reported by
  // the SSC group view, which reads the same classifier) — it just doesn't earn a
  // flag or a bar here. See UNFLAGGED_REASONS for why extinct_unconfirmed doesn't.
  const unflagged = new Set<string>(UNFLAGGED_REASONS);
  for (const d of details) {
    if (unflagged.has(d.reason)) continue;
    counts[d.reason] = (counts[d.reason] ?? 0) + 1;
    species[String(d.id)] = {
      r: d.reason,
      ...(d.detail != null ? { d: d.detail } : {}),
      ...(d.detailId != null ? { i: d.detailId } : {}),
      ...(d.detailColId != null ? { dc: d.detailColId } : {}),
      ...(d.colId != null ? { c: d.colId } : {}),
      // CoL's accepted name is only worth shipping when it says something the
      // other fields don't — otherwise it's the same string twice per entry.
      ...(d.colName != null && d.colName !== d.name && d.colName !== d.detail ? { n: d.colName } : {}),
    };
  }

  // Second signal: the Not Evaluated species CoL has likely split OUT of an
  // assessed one — split_candidates read the other way round. Scoped to exactly
  // the NE universe the SSC view counts (in_base, extant-or-EX/EW, not already
  // assessed, not excluded), so a name here is one the dashboard's Not Evaluated
  // list actually shows. Ordered by name for a file that's stable across re-runs.
  //
  // A split-only species usually has a perfectly clean CoL match, so it has no
  // NoMatchDetail and no col_id from the diagnostic above — the join to
  // species_link supplies its own CoL record for the flag to link to.
  let splitParents = 0;
  if (hasBackbone) {
    // The evidence behind every split: CoL keeps the old infraspecific name as a
    // synonym when one is promoted, so "which accepted species does the name
    // 'Vallonia costata var. montana' resolve to today" IS the signal. Same
    // resolution (including the autonym hop) as SPLIT_CANDIDATES_SQL, kept here
    // rather than added to that shared table so the committed
    // col-split-candidates.parquet keeps its current shape.
    await conn.run(`
      CREATE TEMP TABLE split_evidence AS
      SELECT b.col_id AS syn_col_id,
             b.scientific_name AS syn_name,
             b.authorship AS syn_authorship,
             lower(split_part(b.scientific_name, ' ', 1) || ' ' || split_part(b.scientific_name, ' ', 2)) AS binomial,
             CASE WHEN p.rank = 'species' THEN p.col_id
                  WHEN p.rank IN ('subspecies', 'infraspecific name', 'variety')
                       AND p.status IN ('accepted', 'provisionally accepted') THEN p.parent_id
             END AS target_col_id
      FROM read_parquet('${backbonePath}') b
      JOIN read_parquet('${backbonePath}') p ON p.col_id = b.parent_id
      WHERE b.status = 'synonym' AND b.rank IN ('subspecies', 'infraspecific name', 'variety')`);

    const splitRows = await (await conn.run(`
      WITH ne AS (
        SELECT col_id, scientific_name FROM read_parquet('${speciesGlob}', hive_partitioning=true)
        WHERE in_base AND ${universeSql} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}
          AND col_id NOT IN (SELECT col_id FROM assessed_cids)
      ),
      parent_col AS (
        SELECT l.id AS id, any_value(l.col_id) AS col_id
        FROM read_parquet('${link}') l
        WHERE l.src = 'redlist' AND l.col_id IS NOT NULL AND l.match_method != 'iucn_synonym_covered'
        GROUP BY l.id
      ),
      -- One split-off species per row, with the oldest-sorting synonym that
      -- points at it as the evidence. More than one can back a split (26% of
      -- pairs); one is enough to make the inference checkable by hand.
      pairs AS (
        SELECT sc.parent_id AS parent_id, ne.scientific_name AS ne_name, ne.col_id AS ne_col_id,
               min_by(ev.syn_name, ev.syn_name) AS prev_name,
               min_by(ev.syn_col_id, ev.syn_name) AS prev_col_id,
               min_by(ev.syn_authorship, ev.syn_name) AS prev_authorship
        FROM split_candidates sc
        JOIN ne ON ne.col_id = sc.ne_col_id
        LEFT JOIN split_evidence ev
          ON ev.target_col_id = sc.ne_col_id AND ev.binomial = lower(sc.parent_name)
        WHERE sc.rn = 1
        GROUP BY 1, 2, 3
      )
      SELECT p.parent_id AS parent_id,
             list(struct_pack(name := p.ne_name, col_id := p.ne_col_id, prev_name := p.prev_name,
                              prev_col_id := p.prev_col_id, prev_authorship := p.prev_authorship)
                  ORDER BY p.ne_name) AS ne_names,
             any_value(pc.col_id) AS parent_col_id
      FROM pairs p
      LEFT JOIN parent_col pc ON pc.id = p.parent_id
      GROUP BY p.parent_id ORDER BY p.parent_id`)).getRowObjects();

    const unwrap = (v: unknown): Record<string, unknown>[] => {
      // A LIST arrives as { items: [...] } and each STRUCT as { entries: {...} }.
      const raw = v as { items?: unknown[] } | unknown[] | null;
      const items = (Array.isArray(raw) ? raw : raw?.items ?? []) as { entries?: Record<string, unknown> }[];
      return items.map((it) => it?.entries ?? {});
    };
    // CoL writes authorship separately; the tooltip wants the name exactly as CoL
    // prints it — full binomial included, so it reads as a name someone can search
    // for rather than a bare epithet.
    const full = (name: unknown, authorship: unknown) =>
      `${String(name ?? "")}${authorship ? ` ${String(authorship)}` : ""}`.trim();

    for (const r of splitRows) {
      const id = String(r.parent_id);
      const names = unwrap(r.ne_names)
        .map((e) => [String(e.name ?? ""), String(e.col_id ?? ""), full(e.prev_name, e.prev_authorship), String(e.prev_col_id ?? "")] as [string, string, string, string])
        .filter(([n]) => n.length > 0);
      if (names.length === 0) continue;
      splitParents++;
      const entry = species[id] ?? {};
      entry.s = names;
      if (entry.c == null && r.parent_col_id != null) entry.c = String(r.parent_col_id);
      species[id] = entry;
    }
    counts[SPLIT_REASON] = splitParents;
  } else {
    console.log("  CoL revisions: backbone.parquet missing — split signal unavailable.");
  }

  const out: ColRevisionsFile = { counts, total: Object.keys(species).length, species };
  fs.writeFileSync(outPath, JSON.stringify(out));
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  const noMatchFlagged = details.filter((d) => !unflagged.has(d.reason)).length;
  const skipped = details.length - noMatchFlagged;
  console.log(`  CoL revisions: ${out.total} flagged species (${noMatchFlagged} no-match, ${splitParents} with splits) → ${outPath} (${kb} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (skipped) console.log(`    (${skipped} diagnosed but not flagged: ${UNFLAGGED_REASONS.join(", ")} — see col-revision.ts)`);
  for (const [reason, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`    ${reason.padEnd(24)} ${n}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-col-revisions.ts") || process.argv[1]?.endsWith("build-col-revisions.js");
if (isDirectRun) {
  loadEnvFiles();
  console.log("build-col-revisions: assessed.parquet + CoL backbone → col-revisions.json");
  console.log("=".repeat(50));
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
