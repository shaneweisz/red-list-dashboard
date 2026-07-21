/**
 * Translates a taxonomy node's SpeciesFilter into a SQL predicate, mirroring
 * matchesFilter() (taxonomy-utils.ts) exactly — including its `?? ""` null
 * handling (so a null order_name behaves like an empty string, not SQL NULL,
 * which would otherwise drop such rows from both an include and its
 * complementary exclude).
 *
 * Originally lived inline in scripts/build-taxa-summary.ts (used only against
 * the CoL species/ parquet, for colDescribed/colNe counts). Extracted so it can
 * also run against assessed.parquet at request time (src/lib/data/
 * country-taxa-summary-duckdb.ts) — the column names it references
 * (scientific_name/class_name/order_name/family/taxon_group) are shared by both
 * parquets, and expandClasses' CoL-specific class aliasing is a harmless no-op
 * superset when matched against IUCN's own (coarser) class names.
 */
import type { TaxonomyNode } from "@/config/taxonomy-tree";
import {
  COL_SPECIES_NAME_OVERRIDES,
  COL_EXCLUDE_ALL_NODES,
} from "@/config/col-described-overrides";

export type NodeFilter = TaxonomyNode["filter"];

// The display tree classifies fishes by the traditional GBIF/IUCN classes, but CoL XR
// uses finer classes — so a node filtering on `actinopterygii` matches zero CoL rows
// (which are `teleostei`, `holostei`, …). Expand those display classes to the CoL
// classes they contain so the four fish sub-groups count correctly. Identity for any
// class name that already exists in CoL (orders are unaffected).
const COL_CLASS_ALIASES: Record<string, string[]> = {
  actinopterygii: ["teleostei", "chondrostei", "cladistii", "holostei"],
  sarcopterygii: ["dipneusti", "coelacanthi"],
  chondrichthyes: ["elasmobranchii", "holocephali"],
};
function expandClasses(names: string[]): string[] {
  return names.flatMap((n) => COL_CLASS_ALIASES[n.toLowerCase()] ?? [n]);
}

// Reverse of COL_CLASS_ALIASES: collapses a raw CoL-side class value (which is
// always the finer name — CoL never literally uses "actinopterygii") to its
// IUCN-canonical coarse name before grouping. Needed by live-taxa-children.ts's
// class-level enumeration (Fishes only, today) — a plain `GROUP BY class_name`
// would otherwise show "Teleostei"/"Elasmobranchii"/etc. as their own buckets
// reading "0% assessed" (misleading: assessed.parquet only ever uses the coarse
// name), instead of folding into the one real-world class both datasets
// otherwise agree on. Same category of fix as canonicalOrderColumnSql, one rank up.
const COL_CLASS_TO_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(COL_CLASS_ALIASES).flatMap(([canonical, aliases]) => aliases.map((alias) => [alias, canonical])),
);

/** SQL expression collapsing a class_name column to its canonical value (see
 *  COL_CLASS_TO_CANONICAL) before the usual coalesce(lower(...), '') — for
 *  GROUP BY use, not filter matching (filterToSql/expandClasses handles that). */
export function canonicalClassColumnSql(col: string): string {
  const cases = Object.entries(COL_CLASS_TO_CANONICAL)
    .map(([alias, canonical]) => `WHEN '${alias}' THEN '${canonical}'`)
    .join(" ");
  return `coalesce(lower(CASE lower(${col}) ${cases} ELSE lower(${col}) END), '')`;
}

// Same category of split as COL_CLASS_ALIASES, one rank down — but ADDITIVE, not
// a replacement: unlike actinopterygii (which CoL never uses literally, only its
// finer classes), CoL XR uses BOTH "artiodactyla" (498 mammal spp.) AND, for
// whales/dolphins/porpoises specifically, its own separate traditional order
// label "cetacea" (111 spp.) — while IUCN's assessed.parquet already reflects
// the modern Cetartiodactyla merger and files every cetacean under
// "artiodactyla" too. Without this, a node filtering on
// orderNames:["artiodactyla"] (e.g. the "Artiodactyls" node, or any live
// order-level drilldown bucket) silently misses every CoL-labeled cetacean.
// Same story for birds, found once Birds gained live order-level drilldown for the
// first time (it was a true static leaf before, so no prior code path ever
// GROUP-BY'd its orders against CoL): IUCN's assessed.parquet still uses two old
// lumped orders (pre-modern-taxonomy palaeognath/caprimulgiform classification),
// while CoL uses the finer modern splits. Confirmed via direct data query
// (2026-07-21): every family under each CoL-only order name here maps to exactly
// one IUCN order (a clean split, not an overlapping mess) —
// apodiformes/nyctibiiformes/steatornithiformes -> caprimulgiformes (619 CoL spp.
// folding into IUCN's single "Caprimulgiformes" bucket); tinamiformes/
// rheiformes/casuariiformes/apterygiformes -> struthioniformes (62 CoL spp.
// folding into IUCN's single "Struthioniformes" bucket, which despite the name
// covers all palaeognaths: ostriches, rheas, cassowaries, emus, kiwis, tinamous).
// Without this, a live "Caprimulgiformes" bucket showed 603 assessed vs. only 119
// CoL-described (533% "assessed"), and "Struthioniformes" showed 61 vs. 2 (3050%).
// Third instance of the same pattern, found rolling out live drilldown to
// Gymnosperms: IUCN's assessed.parquet lumps all conifers under the old
// "Pinales" (616 spp: Pinaceae/Cupressaceae/Taxaceae/Sciadopityaceae/
// Podocarpaceae/Araucariaceae), while CoL splits Cupressaceae/Taxaceae/
// Sciadopityaceae into "Cupressales" (231 spp) and Podocarpaceae/Araucariaceae
// into "Araucariales" (250 spp), keeping only Pinaceae under "Pinales" (300 spp)
// — confirmed via family-level cross-check (2026-07-21).
const COL_ORDER_ALIASES: Record<string, string[]> = {
  artiodactyla: ["cetacea"],
  caprimulgiformes: ["apodiformes", "nyctibiiformes", "steatornithiformes"],
  struthioniformes: ["tinamiformes", "rheiformes", "casuariiformes", "apterygiformes"],
  pinales: ["cupressales", "araucariales"],
};
function expandOrders(names: string[]): string[] {
  return names.flatMap((n) => [n, ...(COL_ORDER_ALIASES[n.toLowerCase()] ?? [])]);
}

// Reverse of COL_ORDER_ALIASES: collapses a raw CoL order value to its
// IUCN-canonical name before grouping. Needed by live-taxa-children.ts's
// order-level enumeration — a plain `GROUP BY order_name` would otherwise show
// "Cetacea" as its own bucket reading "0% assessed" (misleading: every one of
// those species IS assessed, just filed under "Artiodactyla" there), instead of
// folding into the same real-world order both datasets otherwise agree on.
const COL_ORDER_TO_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(COL_ORDER_ALIASES).flatMap(([canonical, aliases]) => aliases.map((alias) => [alias, canonical])),
);

// A handful of species whose CoL-side order_name is NULL despite having a real
// IUCN order — a CoL backbone data gap, not an assessment issue. Confirmed for
// Sphenodon punctatus (2026-07-21): the old static "Tuataras" node used an
// extraSpeciesNames escape hatch for the same gap (see taxonomy-tree.ts) before
// live order-rank enumeration existed to expose it as a GROUP BY problem too.
// Without this, such a species' CoL row falls into the "Unclassified Order"
// live bucket instead of its real order. Molluscs/Crustaceans/
// other_invertebrates have many more of these (thousands, per a direct data
// query) but aren't live-drillable yet — revisit generally once they are,
// rather than growing this one-off list further.
const COL_NULL_ORDER_SPECIES_OVERRIDE: Record<string, string> = {
  "sphenodon punctatus": "rhynchocephalia",
};

/** SQL expression collapsing an order_name column to its canonical value (see
 *  COL_ORDER_TO_CANONICAL and COL_NULL_ORDER_SPECIES_OVERRIDE) before the usual
 *  coalesce(lower(...), '') — for GROUP BY use, not filter matching
 *  (filterToSql/expandOrders handles that). sciNameCol backs the species-name
 *  override; omit it (e.g. when `col` isn't paired with a scientific_name
 *  column in this query) to skip that part and only apply the alias collapse. */
export function canonicalOrderColumnSql(col: string, sciNameCol?: string): string {
  const aliasCases = Object.entries(COL_ORDER_TO_CANONICAL)
    .map(([alias, canonical]) => `WHEN '${alias}' THEN '${canonical}'`)
    .join(" ");
  const aliasExpr = `CASE lower(${col}) ${aliasCases} ELSE lower(${col}) END`;
  if (!sciNameCol) return `coalesce(lower(${aliasExpr}), '')`;
  const sciCases = Object.entries(COL_NULL_ORDER_SPECIES_OVERRIDE)
    .map(([sci, order]) => `WHEN lower(${sciNameCol}) = '${sci}' THEN '${order}'`)
    .join(" ");
  return `coalesce(lower(CASE ${sciCases} ELSE ${aliasExpr} END), '')`;
}

export function sqlStrList(vals: string[]): string {
  return vals.map((v) => `'${v.toLowerCase().replace(/'/g, "''")}'`).join(", ");
}

// See config/col-described-overrides.ts for what these are and why — shared with the
// frontend so the "# Described Species" tooltip explains the same overrides applied
// here, instead of the two silently drifting apart.

// Translate a taxonomy node filter into a SQL predicate, mirroring matchesFilter()
// exactly. Children partition a group by class/order, which is exclusive in the CoL
// universe — so no claim-tracking needed. nodeId (optional) triggers the
// species-name overrides above when computing a node's own CoL described/
// not-evaluated counts — irrelevant when matching real IUCN-assessed rows (which
// don't go through this code path; matchesFilter() never applies it either).
export function filterToSql(filter: NodeFilter, nodeId?: string): string {
  const sciName = "coalesce(lower(scientific_name), '')";
  if (nodeId && COL_SPECIES_NAME_OVERRIDES[nodeId]) {
    return `taxon_group IN (${sqlStrList(filter.csvGroups)}) AND ${sciName} IN (${sqlStrList(COL_SPECIES_NAME_OVERRIDES[nodeId])})`;
  }
  const cls = "coalesce(lower(class_name), '')";
  const ord = "coalesce(lower(order_name), '')";
  const fam = "coalesce(lower(family), '')";
  const genus = "coalesce(lower(split_part(scientific_name, ' ', 1)), '')";
  const conds: string[] = [`taxon_group IN (${sqlStrList(filter.csvGroups)})`];
  if (filter.classNames?.length) conds.push(`${cls} IN (${sqlStrList(expandClasses(filter.classNames))})`);
  if (filter.excludeClasses?.length) conds.push(`${cls} NOT IN (${sqlStrList(expandClasses(filter.excludeClasses))})`);
  if (filter.orderNames?.length) {
    // The class_name fallback (order_name empty -> check class_name instead)
    // deliberately uses the UNEXPANDED list — expandOrders' cetacea alias is a
    // CoL-order-label quirk, not a class name, so it has no place in a
    // class-name comparison.
    conds.push(`(${ord} IN (${sqlStrList(expandOrders(filter.orderNames))}) OR (${ord} = '' AND ${cls} IN (${sqlStrList(filter.orderNames)})))`);
  }
  if (filter.excludeOrders?.length) {
    conds.push(`NOT (${ord} IN (${sqlStrList(expandOrders(filter.excludeOrders))}) OR (${ord} = '' AND ${cls} IN (${sqlStrList(filter.excludeOrders)})))`);
  }
  if (filter.families?.length) conds.push(`${fam} IN (${sqlStrList(filter.families)})`);
  if (filter.excludeFamilies?.length) conds.push(`${fam} NOT IN (${sqlStrList(filter.excludeFamilies)})`);
  if (filter.genera?.length) conds.push(`${genus} IN (${sqlStrList(filter.genera)})`);
  if (filter.excludeGenera?.length) conds.push(`${genus} NOT IN (${sqlStrList(filter.excludeGenera)})`);
  if (filter.speciesNames?.length) conds.push(`${sciName} IN (${sqlStrList(filter.speciesNames)})`);
  if (filter.excludeSpeciesNames?.length) conds.push(`${sciName} NOT IN (${sqlStrList(filter.excludeSpeciesNames)})`);
  // Domestic forms + species reassigned to another node's CoL override (see above) —
  // excluded from every node's count so they don't inflate one group's total or get
  // double-counted between two groups. matchesFilter() applies this same exclusion
  // unconditionally to every row (CoL, redlist, or GBIF), so it belongs here too.
  conds.push(`${sciName} NOT IN (${sqlStrList(COL_EXCLUDE_ALL_NODES)})`);
  const normalClause = conds.join(" AND ");
  // extraSpeciesNames: mirrors matchesFilter's OR escape hatch (taxonomy-utils.ts) —
  // species included regardless of the class/order/family/genus rule above. Still
  // scoped to this node's csvGroups and the universe-wide exclusions.
  if (filter.extraSpeciesNames?.length) {
    const extraClause = `taxon_group IN (${sqlStrList(filter.csvGroups)}) AND ${sciName} IN (${sqlStrList(filter.extraSpeciesNames)}) AND ${sciName} NOT IN (${sqlStrList(COL_EXCLUDE_ALL_NODES)})`;
    return `((${normalClause}) OR (${extraClause}))`;
  }
  return normalClause;
}
