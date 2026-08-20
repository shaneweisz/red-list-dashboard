/**
 * build-col-no-match: the "possible taxonomic revision" flag for the main
 * dashboard → data/col-no-match.json
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
 * → { reason, detail } map the dashboard can load in one request.
 *
 * Scope note: unscoped, "classified_elsewhere" (CoL puts this name under a
 * different class/order/family than the *node* being viewed) can't arise —
 * there's no node to disagree with — so the global flag carries the seven
 * reasons that are properties of the species itself.
 *
 * Usage:
 *   npx tsx scripts/build-col-no-match.ts
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

// Keep in sync with build-taxa-summary.ts / species-duckdb.ts.
const EXCLUDED_COL_IDS_SQL = `('6MB3T')`; // Homo sapiens

export interface ColNoMatchFile {
  /** Reason counts, so the dashboard can size its chart without walking the map. */
  counts: Record<string, number>;
  total: number;
  /** sis_taxon_id → [reason, detail?, detailId?] — a tuple, not an object, to
   *  keep the shipped file small (it carries one entry per flagged species). */
  species: Record<string, [string, string?, number?]>;
}

export async function run(): Promise<void> {
  const link = path.join(DATA_DIR, "species_link.parquet");
  const assessedPath = path.join(DATA_DIR, "assessed.parquet");
  const speciesGlob = path.join(DATA_DIR, "species", "**", "*.parquet");
  const backbonePath = path.join(DATA_DIR, "backbone.parquet");
  const outPath = path.join(DATA_DIR, "col-no-match.json");

  if (!fs.existsSync(path.join(DATA_DIR, "species")) || !fs.existsSync(link)) {
    console.log("  CoL no-match: species/ or species_link.parquet missing — skipping.");
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
    console.log("  CoL no-match: backbone.parquet missing — infraspecific/provisional reasons unavailable.");
  }

  const ctx: BreakdownQueryContext = {
    conn, speciesGlob, assessedPath, linkPath: link,
    universeSql, assessedCidsTable: "assessed_cids",
    excludedColIdsSql: EXCLUDED_COL_IDS_SQL, hasBackbone, backbonePath,
  };

  const started = Date.now();
  const details: NoMatchDetail[] = await computeNoMatchDetails(ctx, "true", "true");

  const counts: Record<string, number> = {};
  const species: ColNoMatchFile["species"] = {};
  for (const d of details) {
    counts[d.reason] = (counts[d.reason] ?? 0) + 1;
    species[String(d.id)] = d.detailId != null ? [d.reason, d.detail, d.detailId]
      : d.detail != null ? [d.reason, d.detail]
      : [d.reason];
  }
  const out: ColNoMatchFile = { counts, total: details.length, species };
  fs.writeFileSync(outPath, JSON.stringify(out));
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`  CoL no-match: ${details.length} flagged species → ${outPath} (${kb} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  for (const [reason, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`    ${reason.padEnd(24)} ${n}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-col-no-match.ts") || process.argv[1]?.endsWith("build-col-no-match.js");
if (isDirectRun) {
  loadEnvFiles();
  console.log("build-col-no-match: assessed.parquet + CoL backbone → col-no-match.json");
  console.log("=".repeat(50));
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
