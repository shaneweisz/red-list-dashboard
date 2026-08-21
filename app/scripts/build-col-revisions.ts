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
import { SPLIT_REASON } from "../src/lib/col-revision";

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
   *  that col_id, s = [name, col_id] of each species CoL likely split out of
   *  this one. */
  species: Record<string, { r?: string; d?: string; i?: number; dc?: string; c?: string; n?: string; s?: [string, string][] }>;
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
  for (const d of details) {
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
    const splitRows = await (await conn.run(`
      WITH ne AS (
        SELECT col_id, scientific_name FROM read_parquet('${speciesGlob}', hive_partitioning=true)
        WHERE in_base AND ${universeSql} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}
          AND col_id NOT IN (SELECT col_id FROM assessed_cids)
      ),
      pairs AS (
        SELECT sc.parent_id AS parent_id, ne.scientific_name AS ne_name, ne.col_id AS ne_col_id
        FROM split_candidates sc
        JOIN ne ON ne.col_id = sc.ne_col_id
        WHERE sc.rn = 1
      ),
      parent_col AS (
        SELECT l.id AS id, any_value(l.col_id) AS col_id
        FROM read_parquet('${link}') l
        WHERE l.src = 'redlist' AND l.col_id IS NOT NULL AND l.match_method != 'iucn_synonym_covered'
        GROUP BY l.id
      )
      SELECT p.parent_id AS parent_id,
             list(struct_pack(name := p.ne_name, col_id := p.ne_col_id) ORDER BY p.ne_name) AS ne_names,
             any_value(pc.col_id) AS parent_col_id
      FROM pairs p LEFT JOIN parent_col pc ON pc.id = p.parent_id
      GROUP BY p.parent_id ORDER BY p.parent_id`)).getRowObjects();
    for (const r of splitRows) {
      const id = String(r.parent_id);
      // DuckDB hands a LIST back as its own value wrapper, not a JS array, and
      // each item as a struct wrapper of its own.
      const raw = r.ne_names as { items?: unknown[] } | unknown[];
      // A LIST arrives as { items: [...] } and each STRUCT inside it as
      // { entries: {...} } — neither is a plain JS value.
      const items = (Array.isArray(raw) ? raw : raw?.items ?? []) as { entries?: { name?: string; col_id?: string } }[];
      const names: [string, string][] = items
        .map((it) => [String(it?.entries?.name ?? ""), String(it?.entries?.col_id ?? "")] as [string, string])
        .filter(([n]) => n.length > 0);
      if (names.length === 0) continue;
      splitParents++;
      const entry = species[id] ?? {};
      entry.s = names;
      // Only supply a col_id when the no-match half didn't already choose one —
      // that one points at the record that DISAGREES with the assessment, which
      // is the more specific thing to link to.
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
  console.log(`  CoL revisions: ${out.total} flagged species (${details.length} no-match, ${splitParents} with splits) → ${outPath} (${kb} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  for (const [reason, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`    ${reason.padEnd(24)} ${n}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-col-revisions.ts") || process.argv[1]?.endsWith("build-col-revisions.js");
if (isDirectRun) {
  loadEnvFiles();
  console.log("build-col-revisions: assessed.parquet + CoL backbone → col-revisions.json");
  console.log("=".repeat(50));
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
