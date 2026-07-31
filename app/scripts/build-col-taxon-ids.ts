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

/**
 * Names the tree mentions, and for each the other names mentioned in the SAME
 * node — which is what disambiguates a homonym. The node that asks for the genus
 * Posidonia also asks for Posidoniaceae, Cymodoceaceae and Zosteraceae, so the
 * seagrass is the candidate sitting under one of those; the sponge is not.
 */
const siblings = new Map<string, Set<string>>();

/**
 * Homonyms the data cannot disambiguate on its own.
 *
 * Nomenclature codes are independent, so the same genus name can be validly used
 * in animals, plants and fungi at once — four accepted genera are called
 * Posidonia. Where the taxonomy tree's own context settles it (Posidonia sits in
 * the eponymous Posidoniaceae, which the same tree node names) the rules below
 * find it. Where it does not, guessing is worse than stating the answer: this
 * shipped with genus:posidonia pointing at a sponge, and re-running the generator
 * produced different answers on different runs.
 *
 * Each entry says which organism the tree means and why.
 */
const HOMONYM_OVERRIDES: Record<string, { id: string; why: string }> = {
  // Dung beetle (Scarabaeidae: Onthophagini), not the fungus in Thelebolaceae.
  "genus:caccobius": { id: "62K45", why: "Thomson, 1859 — the scarab, in Onthophagini" },
  // Seagrass (Hydrocharitaceae), not the bryozoan in Bugulidae. The tree lists it
  // among seagrasses; main had the bryozoan, so this corrects a pre-existing bug.
  "genus:halophila": { id: "VK6PF", why: "Thouars — the seagrass, in Hydrocharitaceae" },
};

function collectNames(): Map<string, Rank> {
  const names = new Map<string, Rank>();
  const add = (rank: Rank, list: string[] | undefined) => {
    for (const n of list ?? []) names.set(n.toLowerCase(), rank);
  };
  const walk = (node: TaxonomyNode) => {
    const f: SpeciesFilter = node.filter;
    const here = [
      ...(f.classNames ?? []), ...(f.orderNames ?? []), ...(f.families ?? []),
      ...(f.genera ?? []),
    ].map((n) => n.toLowerCase());
    for (const n of here) {
      if (!siblings.has(n)) siblings.set(n, new Set());
      for (const o of here) if (o !== n) siblings.get(n)!.add(o);
    }
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

  // Homonyms are real and this join finds all of them: four accepted genera are
  // named Posidonia — the seagrass, a bivalve, a grass, and a sponge. Taking rows
  // in whatever order the scan returns made the result a lottery, and it lost:
  // genus:posidonia shipped pointing at the sponge (Halisarcidae) instead of the
  // seagrass, and re-running produced different answers for two entries.
  //
  // Preference order, most specific first:
  //   1. the taxon whose lineage the taxonomy tree actually asks for, i.e. one
  //      whose ancestors include another id the tree already resolves;
  //   2. a taxon with authorship, which a bare unattributed name usually is not;
  //   3. lowest col_id, purely so the output is stable rather than arbitrary.
  // Ancestors, not just the immediate parent. The tree names families, but a
  // genus often hangs off a tribe or subfamily below one — Caccobius sits in
  // Onthophagini, inside the Scarabaeidae the tree actually asks for, so matching
  // on the parent alone found nothing and fell through to a fungus.
  const rows = await (await conn.run(`
    WITH RECURSIVE b AS (SELECT col_id, parent_id, rank, scientific_name, authorship, status
               FROM read_parquet('${backbonePath}')),
    lineage AS (
      SELECT col_id AS root, parent_id, 0 AS depth FROM b
      UNION ALL
      SELECT l.root, p.parent_id, l.depth + 1
      FROM lineage l JOIN b p ON p.col_id = l.parent_id
      WHERE l.depth < 8
    )
    SELECT n.rank, n.name, b.col_id, b.authorship,
           (SELECT p.scientific_name FROM b p WHERE p.col_id = b.parent_id) AS parent_name,
           list(DISTINCT lower(a.scientific_name)) AS ancestors
    FROM names n
    JOIN b ON b.rank = n.rank AND lower(b.scientific_name) = n.name AND b.status = 'accepted'
    LEFT JOIN lineage l ON l.root = b.col_id
    LEFT JOIN b a ON a.col_id = l.parent_id
    GROUP BY n.rank, n.name, b.col_id, b.authorship, b.parent_id
    ORDER BY n.rank, n.name, b.col_id
  `)).getRowObjects();

  const wanted = new Set([...names.keys()]);
  const byKey = new Map<string, Array<{ id: string; authorship: string; parent: string; ancestors: Set<string> }>>();
  for (const r of rows) {
    const k = `${r.rank}:${r.name}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push({
      id: String(r.col_id),
      authorship: r.authorship == null ? "" : String(r.authorship),
      parent: r.parent_name == null ? "" : String(r.parent_name).toLowerCase(),
      // DuckDB's list type arrives as a wrapper object, not a JS array.
      ancestors: new Set(
        (Array.isArray(r.ancestors) ? r.ancestors : (r.ancestors as { items?: unknown[] })?.items ?? [])
          .map((a) => String(a))
      ),
    });
  }

  const map: Record<string, string> = {};
  const ambiguous: string[] = [];
  for (const [k, cands] of byKey) {
    if (cands.length === 1) {
      map[k] = cands[0].id;
      continue;
    }
    const name = k.split(":").slice(1).join(":");
    const sibs = siblings.get(name) ?? new Set<string>();
    // Most specific first: the type genus of an eponymous family (Posidonia sits
    // in Posidoniaceae), then a parent the same tree node also names, then any
    // parent the tree knows, then a name that carries authorship at all.
    const tiers = [
      cands.filter((c) => c.parent.startsWith(name.split(" ")[0])),
      cands.filter((c) => [...sibs].some((sb) => c.ancestors.has(sb))),
      cands.filter((c) => [...c.ancestors].some((a) => wanted.has(a))),
      cands.filter((c) => c.authorship !== ""),
    ];
    const override = HOMONYM_OVERRIDES[k];
    const overridden = override && cands.find((c) => c.id === override.id);
    const pool = tiers.find((t) => t.length > 0) ?? cands;
    const chosen = overridden ?? pool.sort((a, b) => a.id.localeCompare(b.id))[0];
    if (override && !overridden) {
      throw new Error(
        `build-col-taxon-ids: ${k} is pinned to ${override.id} (${override.why}), but that id is no ` +
        `longer an accepted ${k.split(":")[0]} in this Catalogue of Life release. It was probably ` +
        `renumbered — re-pick it from the candidates and update HOMONYM_OVERRIDES.`
      );
    }
    map[k] = chosen.id;
    ambiguous.push(`${k} (${cands.length} accepted homonyms → ${chosen.id}${chosen.parent ? ` under ${chosen.parent}` : ""})`);
  }

  const sortedMap = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(outPath, JSON.stringify(sortedMap, null, 2) + "\n");

  const unresolved = [...names.entries()].filter(([n, r]) => !map[`${r}:${n}`]);
  console.log(`build-col-taxon-ids: resolved ${Object.keys(map).length}/${names.size} names → ${outPath}`);
  if (ambiguous.length) {
    console.log(`  homonyms resolved by lineage/authorship/id (${ambiguous.length}):`);
    for (const a of ambiguous) console.log(`    ${a}`);
  }
  if (unresolved.length) {
    console.log(`  unresolved (${unresolved.length}, left as plain text):`, unresolved.map(([n, r]) => `${r}:${n}`).join(", "));
  }
  return map;
}

const isDirectRun = process.argv[1]?.endsWith("build-col-taxon-ids.ts") || process.argv[1]?.endsWith("build-col-taxon-ids.js");
if (isDirectRun) {
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
