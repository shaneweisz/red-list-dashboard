/**
 * Taxonomy tree utilities — cached indexes and helpers.
 *
 * Built once at import time from the taxonomy tree config.
 * Replaces the old taxa-hierarchy helpers (getSubgroupDef, speciesMatchesSubgroup)
 * and taxon-groups (getTaxonGroups).
 */

import { TAXONOMY_TREE, type TaxonomyNode, type SpeciesFilter } from "@/config/taxonomy-tree";
import { TAXONOMY_VIEWS } from "@/config/taxonomy-views";
import { canonicalizeTaxonId } from "@/lib/data/taxonomy-constants";
import { NODE_DESCRIPTION_OVERRIDES, COL_NODE_TOOLTIP_NOTES } from "@/config/col-described-overrides";
import COL_TAXON_IDS from "@/config/col-taxon-ids.json";

// ─── Indexes (built once at import) ──────────────────────────────────

/** O(1) node lookup by ID */
export const NODE_INDEX = new Map<string, TaxonomyNode>();

/** child ID → parent ID */
export const PARENT_INDEX = new Map<string, string>();

function indexTree(node: TaxonomyNode, parentId?: string) {
  NODE_INDEX.set(node.id, node);
  if (parentId) PARENT_INDEX.set(node.id, parentId);
  if (node.children) {
    for (const child of node.children) {
      indexTree(child, node.id);
    }
  }
}

indexTree(TAXONOMY_TREE);

// ─── Lookup helpers ──────────────────────────────────────────────────

/** Find a node by ID, or undefined if not found. */
export function findNode(id: string): TaxonomyNode | undefined {
  return NODE_INDEX.get(id);
}

/** Get ancestor IDs from immediate parent up to root (exclusive). */
export function getAncestors(id: string): string[] {
  const ancestors: string[] = [];
  let current = PARENT_INDEX.get(id);
  while (current) {
    ancestors.push(current);
    current = PARENT_INDEX.get(current);
  }
  return ancestors;
}

/** Does this node have children? */
export function hasChildren(id: string): boolean {
  const node = NODE_INDEX.get(id);
  return !!node?.children && node.children.length > 0;
}

/** Get the path from root to this node (inclusive), as an array of IDs. */
export function getNodePath(id: string): string[] {
  return [...getAncestors(id).reverse(), id];
}

// ─── View root resolution ────────────────────────────────────────────

const DEFAULT_VIEW_ROOTS = new Set(TAXONOMY_VIEWS.default.roots);

// Nodes whose "# Described Species" figure is genuinely IUCN's own published number
// (the Table 1a PDF) rather than a third-party citation (MDD, Reptile Database,
// AmphibiaWeb, Eschmeyer, Zhang 2011, …) or a hand-typed approximation (the SSC
// pilot groups). That's exactly the 8 default-view summary taxa plus Table 1a's own
// 21 rows (28 CSV groups, with "insects" as one row) — every node one level deeper
// (Rodents, Bats, Beetles, every SSC group, …) cites something else, which — unlike
// the CoL-derived colDescribed figure — never gets automatically re-verified as the
// underlying species data changes. Used to pick the "# Described" default per row:
// IUCN for these, CoL for everything else. See TaxaSummary.tsx's applySource.
export const OFFICIAL_IUCN_DESCRIBED_NODE_IDS = new Set([
  "all", // the grand total across the 8 summary taxa — itself an IUCN-sourced sum
  ...TAXONOMY_VIEWS.default.roots,
  ...TAXONOMY_VIEWS.table1a.roots,
]);

// SSC Specialist Group leaves live under "ssc-groups" — a separate wrapper kept
// OUT of the "mammals" tree node (so it doesn't pollute the normal Mammals
// subgroup list) and out of the default view (so it isn't a 9th landing-page
// taxon). But for URL persistence + click-through navigation they behave like a
// "mammals" sub-group (onNavigateToSubgroup("mammals", sscLeafId)) — so redirect
// their view-root resolution to "mammals" without actually re-parenting them.
const VIEW_ROOT_OVERRIDES: Record<string, string> = { "ssc-groups": "mammals" };

/** Find the default-view ancestor for a node (one of the 8 display roots). */
export function getViewRootForNode(nodeId: string): string | null {
  if (DEFAULT_VIEW_ROOTS.has(nodeId)) return nodeId;
  for (const a of getAncestors(nodeId)) {
    if (DEFAULT_VIEW_ROOTS.has(a)) return a;
    if (VIEW_ROOT_OVERRIDES[a]) return VIEW_ROOT_OVERRIDES[a];
  }
  return null;
}

// ─── Flat taxa-token URL mapping ─────────────────────────────────────────
//
// The URL carries a single, flat `taxa` list. Internally a selection is a
// display-root + (optional) sub-group node (e.g. `invertebrates` + `inv-corals`,
// because species rows store the coarse root taxon_id: corals → invertebrates).
// These helpers translate between the two so the URL stays clean while the
// dashboard's two-level model is unchanged.
//
// A node's flat token is its id with the virtual-root prefix stripped
// (inv-corals → corals); display roots and arbitrary scientific ranks are their
// own token. The token↔node mapping must be a bijection over the default view —
// enforced by a whole-tree round-trip test (taxonomy-tree.test.ts).

const NODE_ID_PREFIX_RE = /^(inv-|pl-|fu-)/;

/** A node id with its virtual-root prefix (inv-/pl-/fu-) removed. */
export const stripNodePrefix = (id: string) => id.replace(NODE_ID_PREFIX_RE, "");

// token → default-view sub-group node id (built once at import). Only nodes BELOW
// a default root are indexed; the flat Table-1a clones live under `all` and are
// excluded (getViewRootForNode === null), so a token never resolves to one.
const DEFAULT_VIEW_TOKEN_INDEX = new Map<string, string>();
for (const id of NODE_INDEX.keys()) {
  if (DEFAULT_VIEW_ROOTS.has(id)) continue;
  if (!getViewRootForNode(id)) continue;
  const token = stripNodePrefix(id);
  if (!DEFAULT_VIEW_TOKEN_INDEX.has(token)) DEFAULT_VIEW_TOKEN_INDEX.set(token, id);
}

/**
 * Expand one flat URL token into the internal selection it represents:
 * `{ taxa }` for a display root or an arbitrary scientific rank, or
 * `{ taxa, subgroup }` for a default-view sub-group (corals → invertebrates +
 * inv-corals). Accepts legacy/prefixed ids too (canonicalized first).
 */
export function expandTaxaToken(token: string): { taxa: string; subgroup?: string } {
  const id = canonicalizeTaxonId(token.trim());
  if (DEFAULT_VIEW_ROOTS.has(id)) return { taxa: id };
  const nodeId = DEFAULT_VIEW_TOKEN_INDEX.get(id) ?? DEFAULT_VIEW_TOKEN_INDEX.get(stripNodePrefix(id));
  if (nodeId) {
    const root = getViewRootForNode(nodeId);
    if (root) return { taxa: root, subgroup: nodeId };
  }
  return { taxa: id }; // a display root outside the default view, or an arbitrary rank
}

/**
 * Collapse an internal taxa + subgroups selection into the flat URL token list.
 * A selected sub-group is emitted as its token (and its root is dropped, since the
 * sub-group implies it); a root with no sub-group is emitted whole.
 */
export function collapseTaxaToTokens(taxa: Iterable<string>, subgroups: Iterable<string>): string[] {
  const tokens = new Set<string>();
  const rootsWithSubgroup = new Set<string>();
  for (const sg of subgroups) {
    tokens.add(stripNodePrefix(sg));
    const root = getViewRootForNode(sg);
    if (root) rootsWithSubgroup.add(root);
  }
  for (const t of taxa) {
    if (rootsWithSubgroup.has(t)) continue; // represented by its sub-group token(s)
    tokens.add(stripNodePrefix(t));
  }
  return [...tokens];
}

// ─── CSV group resolution ────────────────────────────────────────────

/** Get the CSV groups needed to load data for a node. */
export function getCsvGroupsForNode(nodeId: string): string[] {
  const id = canonicalizeTaxonId(nodeId); // map legacy IDs (e.g. mammalia → mammals)
  const node = NODE_INDEX.get(id);
  if (!node) return [id]; // Fallback: treat as CSV group name
  return node.filter.csvGroups;
}

// ─── Filter matching ─────────────────────────────────────────────────

/**
 * Does a species row match a SpeciesFilter?
 *
 * Works both server-side (with RedlistRow/GbifRow) and client-side
 * (with SpeciesRow). Caller must ensure the row comes from one of
 * the filter's csvGroups.
 *
 * Falls back to class_name when order_name is empty (GBIF taxonomy quirk).
 */
export function matchesFilter(
  row: {
    class_name: string | null;
    order_name: string | null;
    family?: string | null;
    scientific_name?: string | null;
  },
  filter: SpeciesFilter,
): boolean {
  // Class include filter
  if (filter.classNames && filter.classNames.length > 0) {
    const cls = (row.class_name ?? "").toLowerCase();
    if (!filter.classNames.includes(cls)) return false;
  }

  // Class exclude filter
  if (filter.excludeClasses && filter.excludeClasses.length > 0) {
    const cls = (row.class_name ?? "").toLowerCase();
    if (cls && filter.excludeClasses.includes(cls)) return false;
  }

  // Order include filter (with class_name fallback when order_name is empty)
  if (filter.orderNames && filter.orderNames.length > 0) {
    const ord = (row.order_name ?? "").toLowerCase();
    const cls = (row.class_name ?? "").toLowerCase();
    if (!filter.orderNames.includes(ord) && !(ord === "" && filter.orderNames.includes(cls))) return false;
  }

  // Order exclude filter (same class_name fallback)
  if (filter.excludeOrders && filter.excludeOrders.length > 0) {
    const ord = (row.order_name ?? "").toLowerCase();
    const cls = (row.class_name ?? "").toLowerCase();
    if (filter.excludeOrders.includes(ord) || (ord === "" && filter.excludeOrders.includes(cls))) return false;
  }

  // Family include filter
  if (filter.families && filter.families.length > 0) {
    const fam = (row.family ?? "").toLowerCase();
    if (!filter.families.includes(fam)) return false;
  }

  // Family exclude filter
  if (filter.excludeFamilies && filter.excludeFamilies.length > 0) {
    const fam = (row.family ?? "").toLowerCase();
    if (fam && filter.excludeFamilies.includes(fam)) return false;
  }

  // Genus include/exclude filter (derived from the first token of scientific_name)
  if (filter.genera?.length || filter.excludeGenera?.length) {
    const genus = (row.scientific_name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (filter.genera && filter.genera.length > 0 && !filter.genera.includes(genus)) return false;
    if (filter.excludeGenera && filter.excludeGenera.length > 0 && genus && filter.excludeGenera.includes(genus)) return false;
  }

  // Full scientific name include/exclude filter (for species-level carve-outs)
  if (filter.speciesNames?.length || filter.excludeSpeciesNames?.length) {
    const name = (row.scientific_name ?? "").trim().toLowerCase();
    if (filter.speciesNames && filter.speciesNames.length > 0 && !filter.speciesNames.includes(name)) return false;
    if (filter.excludeSpeciesNames && filter.excludeSpeciesNames.length > 0 && name && filter.excludeSpeciesNames.includes(name)) return false;
  }

  return true;
}

/**
 * Client-side filter: does a species row match a taxonomy node?
 *
 * Replaces the old `speciesMatchesSubgroup`. Uses the same filter logic
 * but checks CSV group membership first.
 */
export function speciesMatchesNode(
  species: { taxon_group: string; class_name: string | null; order_name: string | null; family?: string | null; scientific_name?: string | null },
  nodeId: string,
): boolean {
  const node = NODE_INDEX.get(nodeId);
  if (!node) return true; // Unknown node → don't filter

  const f = node.filter;

  // Must belong to one of the filter's CSV groups
  if (!f.csvGroups.includes(species.taxon_group)) return false;

  return matchesFilter(species, f);
}

/**
 * Look up a node definition by its ID.
 * Returns { node, parentId } or null if not found.
 *
 * Drop-in replacement for the old `getSubgroupDef` — callers that used
 * `result.def` can use `result.node`, and `result.taxonId` → `result.parentId`.
 */
export function getNodeDef(nodeId: string): { node: TaxonomyNode; parentId: string } | null {
  const node = NODE_INDEX.get(nodeId);
  if (!node) return null;
  const parentId = PARENT_INDEX.get(nodeId);
  if (!parentId) return null; // Root node
  return { node, parentId };
}

// ─── Plain-language filter description (for the "# Described Species" tooltip) ──

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Binomial convention: capitalize the genus, leave the species epithet lowercase.
const capitalizeSpeciesName = (s: string): string => s.split(" ").map((w, i) => (i === 0 ? capitalize(w) : w)).join(" ");

type FilterRank = "class" | "order" | "family" | "genus" | "species";

// name → CoL taxon id (catalogueoflife.org/data/taxon/<id>), built by
// scripts/build-col-taxon-ids.ts from the taxonomy tree + backbone.parquet. Only
// covers names actually referenced by a SpeciesFilter somewhere in the tree — not
// every name resolves (CoL classifies a few things differently, e.g. Bison is lumped
// into Bos), in which case the segment below just has no colId and renders as plain text.
const COL_TAXON_ID_MAP: Record<string, string> = COL_TAXON_IDS;

/** One piece of a describeFilter() result: plain text, or a taxon name to link. */
export interface DescribeFilterSegment {
  text: string;
  /** Present when this segment is a taxon name we could resolve to a CoL page. */
  colId?: string;
}

// Long exclude/include lists (e.g. Antelope SG's 14-genus excludeGenera) would make an
// unreadable tooltip — cap what's spelled out and summarize the rest by count. Each
// shown name becomes its own segment, linked when we have a CoL id for it.
function joinCappedSegments(rank: FilterRank, names: string[], max = 4): DescribeFilterSegment[] {
  const segs: DescribeFilterSegment[] = [];
  names.slice(0, max).forEach((n, i) => {
    if (i > 0) segs.push({ text: ", " });
    segs.push({ text: capitalize(n), colId: COL_TAXON_ID_MAP[`${rank}:${n.toLowerCase()}`] });
  });
  if (names.length > max) segs.push({ text: `, +${names.length - max} more` });
  return segs;
}

function speciesSegments(names: string[]): DescribeFilterSegment[] {
  const segs: DescribeFilterSegment[] = [];
  names.forEach((n, i) => {
    if (i > 0) segs.push({ text: ", " });
    segs.push({ text: capitalizeSpeciesName(n), colId: COL_TAXON_ID_MAP[`species:${n.toLowerCase()}`] });
  });
  return segs;
}

/**
 * Render a node's SpeciesFilter as a short, human-readable description for the
 * "# Described Species" tooltip — e.g. "Family: Felidae" or "Genus: Bos, Bubalus,
 * Pseudoryx (excluding Bison, Bos taurus)". Checks NODE_DESCRIPTION_OVERRIDES first
 * for filters too broad/exclusion-heavy to summarize automatically (e.g. the SSC
 * "No SSC Group" catch-all), then appends a COL_NODE_TOOLTIP_NOTES note (if any)
 * explaining a CoL-specific quirk (lumped genus, domestic-form exclusion, coverage gap).
 *
 * Returns segments rather than a plain string so the caller can render each taxon
 * name as a link to its Catalogue of Life page where we have one (see COL_TAXON_IDS).
 */
export function describeFilter(filter: SpeciesFilter, nodeId?: string): DescribeFilterSegment[] {
  const override = nodeId ? NODE_DESCRIPTION_OVERRIDES[nodeId] : undefined;
  const note = nodeId ? COL_NODE_TOOLTIP_NOTES[nodeId] : undefined;

  if (override) {
    const segs: DescribeFilterSegment[] = [{ text: override }];
    if (note) segs.push({ text: ` — ${note}` });
    return segs;
  }

  const segs: DescribeFilterSegment[] = [];
  let hasPart = false;
  const addPart = (label: string, rank: FilterRank, names: string[] | undefined) => {
    if (!names?.length) return;
    if (hasPart) segs.push({ text: "; " });
    hasPart = true;
    segs.push({ text: `${label}: ` }, ...joinCappedSegments(rank, names));
  };
  addPart("Class", "class", filter.classNames);
  addPart("Order", "order", filter.orderNames);
  addPart("Family", "family", filter.families);
  addPart("Genus", "genus", filter.genera);
  if (filter.speciesNames?.length) {
    if (hasPart) segs.push({ text: "; " });
    hasPart = true;
    segs.push({ text: "Species: " }, ...speciesSegments(filter.speciesNames));
  }
  if (!hasPart) segs.push({ text: "All species in this group" });

  const excludeSegs: DescribeFilterSegment[] = [];
  let hasExclude = false;
  const addExclude = (rank: FilterRank, names: string[] | undefined) => {
    if (!names?.length) return;
    if (hasExclude) excludeSegs.push({ text: "; " });
    hasExclude = true;
    excludeSegs.push(...joinCappedSegments(rank, names));
  };
  addExclude("class", filter.excludeClasses);
  addExclude("order", filter.excludeOrders);
  addExclude("family", filter.excludeFamilies);
  addExclude("genus", filter.excludeGenera);
  if (filter.excludeSpeciesNames?.length) {
    if (hasExclude) excludeSegs.push({ text: "; " });
    hasExclude = true;
    excludeSegs.push(...speciesSegments(filter.excludeSpeciesNames));
  }
  if (hasExclude) segs.push({ text: " (excluding " }, ...excludeSegs, { text: ")" });

  if (note) segs.push({ text: ` — ${note}` });
  return segs;
}

