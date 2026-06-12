/**
 * build-universe-names (#260 search): a compact, name-sorted index of the CoL extant
 * universe for fast free-text search, derived from data/species/.
 *
 * Why: searchSpecies' CoL-only fallback used to scan species/ (15 partition files, all
 * columns) from R2 — fine warm, but ~12s on a cold container. This is ONE file with just
 * the name columns, sorted by `name_lower`, so a prefix-range query prunes to ~1 row group
 * via Parquet min/max stats (reads a tiny slice, not the whole file) — fast even cold.
 *
 * Columns: col_id, scientific_name (display), taxon_group (→ leaf node for nav), name_lower
 * (lowercased sort/search key — stats on THIS column drive the pruning). Sorted by name_lower.
 *
 * Input: data/species/ (build-backbone). Output: data/universe-names.parquet.
 *
 *   npx tsx scripts/build-universe-names.ts
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";

// Kept out of the universe (matches species-duckdb / build-taxa-summary): Homo sapiens.
const EXCLUDED_COL_IDS_SQL = `('6MB3T')`;

export async function run(opts: { dataDir?: string } = {}): Promise<void> {
  const dir = opts.dataDir || DATA_DIR;
  const speciesDir = path.join(dir, "species");
  if (!fs.existsSync(speciesDir)) {
    throw new Error(`build-universe-names: species/ not found at ${speciesDir} (run build-backbone first)`);
  }
  const speciesGlob = path.join(dir, "species", "**", "*.parquet");
  const out = path.join(dir, "universe-names.parquet");

  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  await conn.run(`
    COPY (
      SELECT col_id, scientific_name, taxon_group, lower(scientific_name) AS name_lower
      FROM read_parquet('${speciesGlob}', hive_partitioning=true)
      WHERE in_base AND extinct IS NOT TRUE AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}
      ORDER BY lower(scientific_name)
    ) TO '${out}' (FORMAT parquet, ROW_GROUP_SIZE 50000)`);

  const rows = await (await conn.run(`SELECT count(*) AS n FROM read_parquet('${out}')`)).getRowObjects();
  const bytes = fs.statSync(out).size;
  console.log(`Wrote ${Number(rows[0].n).toLocaleString()} universe names (${(bytes / 1048576).toFixed(1)} MB) → ${out}`);
}

const isDirectRun = process.argv[1]?.endsWith("build-universe-names.ts") || process.argv[1]?.endsWith("build-universe-names.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
