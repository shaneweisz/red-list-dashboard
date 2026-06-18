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

/** Find the default-view ancestor for a node (one of the 8 display roots). */
export function getViewRootForNode(nodeId: string): string | null {
  if (DEFAULT_VIEW_ROOTS.has(nodeId)) return nodeId;
  for (const a of getAncestors(nodeId)) {
    if (DEFAULT_VIEW_ROOTS.has(a)) return a;
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

  return true;
}

/**
 * Client-side filter: does a species row match a taxonomy node?
 *
 * Replaces the old `speciesMatchesSubgroup`. Uses the same filter logic
 * but checks CSV group membership first.
 */
export function speciesMatchesNode(
  species: { taxon_group: string; class_name: string | null; order_name: string | null; family?: string | null },
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

