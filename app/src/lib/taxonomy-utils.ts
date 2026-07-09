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
import { NODE_DESCRIPTION_OVERRIDES, COL_NODE_TOOLTIP_NOTES, COL_EXCLUDE_ALL_NODES, COL_SPECIES_NAME_OVERRIDES } from "@/config/col-described-overrides";
import COL_TAXON_IDS from "@/config/col-taxon-ids.json";
import COL_RELEASE from "@/config/col-release.json";

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

  // CoL-only universe exclusions (domestic/feral forms, e.g. Felis catus, + names
  // reassigned to another node's species-name override, e.g. Bison) — never part of
  // ANY node's species universe. Mirrors filterToSql's COL_EXCLUDE_ALL_NODES
  // exclusion (build-taxa-summary.ts), which only ran server-side at build time; this
  // client-side path is what actually filters the species LIST shown when a user
  // drills into a node (e.g. clicking Cat SG's row) — without this, the "# Described"
  // count and the displayed species list would disagree (found via user report: the
  // count excluded Felis catus but the NE species list still showed it). Safe
  // unconditionally: none of these names are ever IUCN-assessed (verified against
  // assessed.parquet), so this can't hide a real assessed species.
  if (row.scientific_name && COL_EXCLUDE_ALL_NODES.includes(row.scientific_name.trim().toLowerCase())) return false;

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

  // Mirrors filterToSql's COL_SPECIES_NAME_OVERRIDES branch (build-taxa-summary.ts):
  // CoL lumps genus Bison into Bos, so a CoL-sourced row (NE species, named "Bos
  // bison") never matches Bison SG's own filter (genera: ["bison"]) — but an
  // IUCN-sourced row (assessed species, still named "Bison bison") DOES match the
  // normal filter directly, since IUCN hasn't adopted CoL's lumping. Added as an
  // extra match path, not a replacement, so both naming conventions work.
  const override = COL_SPECIES_NAME_OVERRIDES[nodeId];
  if (override) {
    const name = (species.scientific_name ?? "").trim().toLowerCase();
    if (override.includes(name)) return true;
  }

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

export const COL_SOURCE_URL = "https://www.catalogueoflife.org/";

// The exact CoL XR release colDescribed is built from (scripts/fetch-coldp.ts writes
// this alongside every sync) — cited by alias (e.g. "COL26.6 XR") and linked via its
// DOI, so "Source" points at the specific dataset version actually used instead of a
// generic, dateless homepage link that says nothing about which release produced the
// numbers on screen.
export const COL_RELEASE_LABEL = `Catalogue of Life (${COL_RELEASE.alias})`;
export const COL_RELEASE_URL = COL_RELEASE.doi ? `https://doi.org/${COL_RELEASE.doi}` : COL_SOURCE_URL;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Binomial convention: capitalize the genus, leave the species epithet lowercase.
const capitalizeSpeciesName = (s: string): string => s.split(" ").map((w, i) => (i === 0 ? capitalize(w) : w)).join(" ");

export type FilterRank = "class" | "order" | "family" | "genus" | "species";

// name → CoL taxon id, built by scripts/build-col-taxon-ids.ts from the taxonomy tree
// + backbone.parquet. Only covers names actually referenced by a SpeciesFilter
// somewhere in the tree — not every name resolves (CoL classifies a few things
// differently, e.g. Bison is lumped into Bos), in which case the segment below just
// has no href and renders as plain text.
const COL_TAXON_ID_MAP: Record<string, string> = COL_TAXON_IDS;

// A container rank (class/order/family/genus) links to a species-level search scoped
// to that taxon, with the same extant + accepted-only definition colDescribed itself
// uses (SPECIES_STATUS in scripts/build-backbone.ts) — so clicking through shows
// exactly the species being counted, not just a static profile page. Deliberately
// omits status=provisionally%20accepted: colDescribed excludes those names (they
// overshoot IUCN's own described-species totals — see the SPECIES_STATUS comment),
// so including them here would make the count look wrong on click-through even
// though it isn't. Known gap: a handful of nodes' colDescribed also includes
// CoL-extinct species IUCN has confirmed EX/EW (see createExEwAssessedTable in
// build-taxa-summary.ts) — those don't show up here since CoL's extinct=0/1 filter
// can't express "extinct, but only the IUCN-confirmed ones," so a clicked-through
// count can undercount colDescribed by that node's EX/EW additions. A species-rank
// name has no "species under it" to browse, so it links straight to its own taxon
// page instead.
function colHref(rank: FilterRank, colId: string): string {
  if (rank === "species") return `${COL_SOURCE_URL}data/taxon/${colId}`;
  return `${COL_SOURCE_URL}data/search?TAXON_ID=${colId}&extinct=0&rank=species&status=accepted`;
}

// Which of a filter's include fields enumerates this node's species (its "primary
// dimension") — the tree never sets more than one at a time (verified by
// taxonomy-tree.test.ts), so the first non-empty one is unambiguous. Mirrors
// primaryDimension() in scripts/build-taxa-summary.ts, which decides the same thing
// server-side to compute NodeSummary.colBreakdown.
export function primaryFilterRank(filter: SpeciesFilter): { rank: FilterRank; label: string } | null {
  if (filter.classNames?.length) return { rank: "class", label: "Class" };
  if (filter.orderNames?.length) return { rank: "order", label: "Order" };
  if (filter.families?.length) return { rank: "family", label: "Family" };
  if (filter.genera?.length) return { rank: "genus", label: "Genus" };
  if (filter.speciesNames?.length) return { rank: "species", label: "Species" };
  return null;
}

/** Display text for one breakdown row's name (binomial capitalization for species). */
export function breakdownDisplayName(rank: FilterRank, name: string): string {
  return rank === "species" ? capitalizeSpeciesName(name) : capitalize(name);
}

/** CoL page/search link for one breakdown row's name, if we could resolve its taxon id. */
export function breakdownHref(rank: FilterRank, name: string): string | undefined {
  const colId = COL_TAXON_ID_MAP[`${rank}:${name.toLowerCase()}`];
  return colId ? colHref(rank, colId) : undefined;
}

/**
 * Does a species row belong to one specific name within a filter rank — e.g. rank
 * "order", name "rodentia"? Used to narrow a node's species list down to a single
 * breakdown row (RedListView's `bd=` URL param, set when a described-species popover
 * breakdown row is clicked — see TaxaSummary.tsx's BreakdownList). Mirrors the same
 * order/class_name fallback matchesFilter() uses for the GBIF-taxonomy quirk where
 * order_name is sometimes empty.
 */
export function matchesBreakdownName(
  row: { class_name: string | null; order_name: string | null; family?: string | null; scientific_name?: string | null },
  rank: FilterRank,
  name: string,
): boolean {
  const n = name.toLowerCase();
  switch (rank) {
    case "class":
      return (row.class_name ?? "").toLowerCase() === n;
    case "order": {
      const ord = (row.order_name ?? "").toLowerCase();
      const cls = (row.class_name ?? "").toLowerCase();
      return ord === n || (ord === "" && cls === n);
    }
    case "family":
      return (row.family ?? "").toLowerCase() === n;
    case "genus":
      return ((row.scientific_name ?? "").trim().split(/\s+/)[0] ?? "").toLowerCase() === n;
    case "species":
      return (row.scientific_name ?? "").trim().toLowerCase() === n;
  }
}

/** One piece of a describeFilter() result: plain text, or a taxon name to link. */
export interface DescribeFilterSegment {
  text: string;
  /** Present when this segment is a taxon name we could resolve to a CoL page. */
  href?: string;
}

// Every name gets its own segment (linked when we have a CoL id for it) — no capping,
// so a skeptical reviewer can see and click through to every single name, even for a
// long list like Antelope SG's 14-genus excludeGenera.
function joinSegments(rank: FilterRank, names: string[]): DescribeFilterSegment[] {
  const segs: DescribeFilterSegment[] = [];
  names.forEach((n, i) => {
    if (i > 0) segs.push({ text: ", " });
    segs.push({ text: capitalize(n), href: breakdownHref(rank, n) });
  });
  return segs;
}

function speciesSegments(names: string[]): DescribeFilterSegment[] {
  const segs: DescribeFilterSegment[] = [];
  names.forEach((n, i) => {
    if (i > 0) segs.push({ text: ", " });
    segs.push({ text: capitalizeSpeciesName(n), href: breakdownHref("species", n) });
  });
  return segs;
}

/**
 * Render a node's SpeciesFilter as a short, human-readable description for the
 * "# Described Species" tooltip — e.g. "Family: Felidae" or "Genus: Bos, Bubalus,
 * Pseudoryx (excluding Bison, Bos taurus)". Checks NODE_DESCRIPTION_OVERRIDES first
 * for filters too broad/exclusion-heavy to summarize automatically (e.g. the SSC "No
 * SSC Group" catch-all), then appends a COL_NODE_TOOLTIP_NOTES note (if any)
 * explaining a CoL-specific quirk (lumped genus, domestic-form exclusion, coverage
 * gap).
 *
 * Returns segments rather than a plain string so the caller can render each taxon
 * name as a link to its Catalogue of Life page where we have one (see
 * COL_TAXON_IDS). `hideBreakdownRank` (pass true when the node has a NodeSummary
 * .colBreakdown) omits the primary include dimension here — the caller renders that
 * as an expandable per-name Assessed/Not-Evaluated list instead (see
 * BreakdownList in TaxaSummary.tsx), so it isn't shown twice.
 */
export function describeFilter(
  filter: SpeciesFilter,
  nodeId?: string,
  hideBreakdownRank?: boolean
): DescribeFilterSegment[] {
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
    if (!names?.length || hideBreakdownRank) return;
    if (hasPart) segs.push({ text: "; " });
    hasPart = true;
    segs.push({ text: `${label}: ` }, ...joinSegments(rank, names));
  };
  addPart("Class", "class", filter.classNames);
  addPart("Order", "order", filter.orderNames);
  addPart("Family", "family", filter.families);
  addPart("Genus", "genus", filter.genera);
  if (filter.speciesNames?.length && !hideBreakdownRank) {
    if (hasPart) segs.push({ text: "; " });
    hasPart = true;
    segs.push({ text: "Species: " }, ...speciesSegments(filter.speciesNames));
  }
  if (!hasPart && !hideBreakdownRank) segs.push({ text: "All species in this group" });

  const excludeSegs: DescribeFilterSegment[] = [];
  let hasExclude = false;
  const addExclude = (rank: FilterRank, names: string[] | undefined) => {
    if (!names?.length) return;
    if (hasExclude) excludeSegs.push({ text: "; " });
    hasExclude = true;
    excludeSegs.push(...joinSegments(rank, names));
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

