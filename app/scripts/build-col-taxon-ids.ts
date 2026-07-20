/**
 * build-col-taxon-ids: resolve every taxon name referenced in the taxonomy tree (and
 * the CoL override config) to its Catalogue of Life taxon id, so the "# Described
 * Species" tooltip can link each name straight to its CoL page
 * (catalogueoflife.org/data/taxon/<id>) instead of leaving it as plain text.
 *
 * backbone.parquet (built by build-backbone) already carries a col_id for every rank
 * (order/family/genus/species/…), not just species — so this is a lookup against data
 * we already sync locally, no extra network fetch. Output is small (~180 names) and
 * checked into git as src/config/col-taxon-ids.json, since it's derived from committed
 * source (the taxonomy tree) and changes rarely — re-run this whenever a node's filter
 * changes, or periodically to pick up new CoL releases.
 *
 * A name that doesn't resolve to an exact accepted match at its expected rank (CoL
 * classifies some things differently — e.g. Bison is lumped into Bos, a handful of
 * fish/flatworm classes are split differently) is simply omitted: the frontend leaves
 * an unresolved name as plain, unlinked text rather than link to a guess.
 *
 *   npx tsx scripts/build-col-taxon-ids.ts
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { DATA_DIR } from "./utils";
import { TAXONOMY_TREE, type TaxonomyNode, type SpeciesFilter } from "../src/config/taxonomy-tree";
import { COL_DOMESTIC_EXCLUDE_NAMES, COL_SPECIES_NAME_OVERRIDES } from "../src/config/col-described-overrides";

type Rank = "class" | "order" | "family" | "genus" | "species";

function collectNames(): Map<string, Rank> {
  const names = new Map<string, Rank>();
  const add = (rank: Rank, list: string[] | undefined) => {
    for (const n of list ?? []) names.set(n.toLowerCase(), rank);
  };
  const walk = (node: TaxonomyNode) => {
    const f: SpeciesFilter = node.filter;
    add("class", f.classNames);
    add("class", f.excludeClasses);
    add("order", f.orderNames);
    add("order", f.excludeOrders);
    add("family", f.families);
    add("family", f.excludeFamilies);
    add("genus", f.genera);
    add("genus", f.excludeGenera);
    add("species", f.speciesNames);
    add("species", f.excludeSpeciesNames);
    for (const c of node.children ?? []) walk(c);
  };
  walk(TAXONOMY_TREE);
  add("species", COL_DOMESTIC_EXCLUDE_NAMES);
  for (const arr of Object.values(COL_SPECIES_NAME_OVERRIDES)) add("species", arr);
  return names;
}

export async function run(opts: { backbonePath?: string; outPath?: string } = {}): Promise<Record<string, string>> {
  const backbonePath = opts.backbonePath ?? path.join(DATA_DIR, "backbone.parquet");
  const outPath = opts.outPath ?? path.join(__dirname, "../src/config/col-taxon-ids.json");
  if (!fs.existsSync(backbonePath)) {
    throw new Error(`build-col-taxon-ids: backbone.parquet not found at ${backbonePath} — run build-backbone first.`);
  }

  const names = collectNames();
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  await conn.run(`CREATE TEMP TABLE names(rank VARCHAR, name VARCHAR);`);
  const values = [...names.entries()].map(([n, r]) => `('${r}', '${n.replace(/'/g, "''")}')`).join(",");
  await conn.run(`INSERT INTO names VALUES ${values};`);

  const rows = await (await conn.run(`
    SELECT n.rank, n.name, b.col_id
    FROM names n
    JOIN read_parquet('${backbonePath}') b
      ON b.rank = n.rank AND lower(b.scientific_name) = n.name AND b.status = 'accepted'
  `)).getRowObjects();

  const map: Record<string, string> = {};
  for (const r of rows) map[`${r.rank}:${r.name}`] = String(r.col_id);

  const sortedMap = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(outPath, JSON.stringify(sortedMap, null, 2) + "\n");

  const unresolved = [...names.entries()].filter(([n, r]) => !map[`${r}:${n}`]);
  console.log(`build-col-taxon-ids: resolved ${rows.length}/${names.size} names → ${outPath}`);
  if (unresolved.length) {
    console.log(`  unresolved (${unresolved.length}, left as plain text):`, unresolved.map(([n, r]) => `${r}:${n}`).join(", "));
  }
  return map;
}

const isDirectRun = process.argv[1]?.endsWith("build-col-taxon-ids.ts") || process.argv[1]?.endsWith("build-col-taxon-ids.js");
if (isDirectRun) {
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
