/**
 * Synthetic node ids for the dynamic (live-query) taxonomic drilldown — a rank
 * chain grafted onto one of the static default-view roots, e.g.
 * "mammals~order:rodentia~family:muridae". `~` never appears in a real static
 * node id (taxonomy-tree.ts ids are all lowercase-hyphen), so isDynamicNodeId is
 * unambiguous and never collides with NODE_INDEX or the unrelated bare-token
 * arbitrary-rank search feature (species-duckdb.ts's resolveWhere/suggestTaxa,
 * used by the search bar to jump straight to e.g. "turdidae" as a root
 * selection — untouched by this module).
 *
 * matchesFilter/filterToSql already support multiple simultaneous positive
 * dimensions ANDed together and already coalesce null order_name/family to ""
 * before comparing — so a filter segment with value "" naturally matches
 * exactly the Unclassified bucket for that rank, with no special-case code here.
 */
import { NODE_INDEX, getAncestors } from "@/lib/taxonomy-utils";
import type { SpeciesFilter } from "@/config/taxonomy-tree";

export type DynamicRank = "class" | "order" | "family" | "genus";
export interface DynamicSegment {
  rank: DynamicRank;
  value: string; // lowercase; "" = Unclassified bucket for this rank
}

const SEP = "~";
const RANK_TO_FILTER_FIELD: Record<DynamicRank, "classNames" | "orderNames" | "families" | "genera"> = {
  class: "classNames",
  order: "orderNames",
  family: "families",
  genus: "genera",
};
const ALL_RANKS = new Set<DynamicRank>(["class", "order", "family", "genus"]);

// Every root drills order -> family -> genus by default. Fishes is the one
// exception today: its static tree already splits at CLASS first (Ray-finned
// vs. Lobe-finned vs. Sharks & Rays — Actinopterygii/Sarcopterygii/
// Chondrichthyes), a biologically meaningful distinction (bony vs. cartilaginous
// fish) that would silently vanish if live enumeration jumped straight to order.
// Single-class roots (Mammals, Birds, Reptiles, Amphibians) deliberately skip
// "class" — enumerating it would return exactly one redundant bucket. Extend
// this map if a future root (e.g. a live Molluscs/Crustaceans split) turns out
// to span multiple classes too.
const DEFAULT_RANK_ORDER: DynamicRank[] = ["order", "family", "genus"];
const ROOT_RANK_ORDER: Record<string, DynamicRank[]> = {
  fishes: ["class", "order", "family", "genus"],
};
function rankOrderFor(rootId: string): DynamicRank[] {
  return ROOT_RANK_ORDER[rootId] ?? DEFAULT_RANK_ORDER;
}

export function isDynamicNodeId(id: string): boolean {
  return id.includes(SEP);
}

export function buildDynamicNodeId(rootId: string, segments: DynamicSegment[]): string {
  return [rootId, ...segments.map((s) => `${s.rank}:${s.value}`)].join(SEP);
}

export function parseDynamicNodeId(id: string): { rootId: string; segments: DynamicSegment[] } | null {
  if (!id.includes(SEP)) return null;
  const [rootId, ...rest] = id.split(SEP);
  const segments: DynamicSegment[] = [];
  for (const part of rest) {
    const idx = part.indexOf(":");
    if (idx === -1) return null;
    const rank = part.slice(0, idx);
    if (!ALL_RANKS.has(rank as DynamicRank)) return null;
    segments.push({ rank: rank as DynamicRank, value: part.slice(idx + 1) });
  }
  return { rootId, segments };
}

/** The rank one level below this node's deepest segment (or the root's own
 *  starting rank for a bare root — "order" for most roots, "class" for Fishes)
 *  — the rank getLiveRankChildren should enumerate when expanding it. */
export function nextDynamicRank(id: string): DynamicRank | null {
  const parsed = parseDynamicNodeId(id);
  const rootId = parsed ? parsed.rootId : id;
  const depth = parsed ? parsed.segments.length : 0;
  return rankOrderFor(rootId)[depth] ?? null; // null once already at genus (a leaf)
}

/** Root's own filter with every segment's rank ANDed in. Null for a malformed id
 *  or an unknown root. */
export function dynamicNodeFilter(id: string): SpeciesFilter | null {
  const parsed = parseDynamicNodeId(id);
  if (!parsed) return null;
  const root = NODE_INDEX.get(parsed.rootId);
  if (!root) return null;
  const filter: SpeciesFilter = { csvGroups: root.filter.csvGroups };
  for (const seg of parsed.segments) {
    filter[RANK_TO_FILTER_FIELD[seg.rank]] = [seg.value];
  }
  return filter;
}

/** Ancestor chain from immediate parent up to the true root (exclusive of self) —
 *  same contract as taxonomy-utils.ts's getAncestors, which this delegates to
 *  once it reaches the real (non-dynamic) root id. */
export function dynamicNodeAncestors(id: string): string[] {
  const parsed = parseDynamicNodeId(id);
  if (!parsed) return [];
  const ancestors: string[] = [];
  for (let n = parsed.segments.length - 1; n >= 0; n--) {
    ancestors.push(buildDynamicNodeId(parsed.rootId, parsed.segments.slice(0, n)));
  }
  return [...ancestors, ...getAncestors(parsed.rootId)];
}

const RANK_LABEL: Record<DynamicRank, string> = { class: "Class", order: "Order", family: "Family", genus: "Genus" };

/** The rank + display label of a dynamic node's own (deepest) segment — e.g.
 *  {rank:"family", label:"Family"} for ".../family:muridae". Unlike
 *  taxonomy-utils.ts's primaryFilterRank (which picks the FIRST set dimension —
 *  correct for a static node's single-dimension filter, but wrong for a dynamic
 *  node's multi-dimension one: an order+family filter's "primary" rank for
 *  display purposes is the deepest one, not the first), this always reflects
 *  the node's actual identity. Null for a bare root (no segments yet). */
export function dynamicNodeRankInfo(id: string): { rank: DynamicRank; label: string } | null {
  const parsed = parseDynamicNodeId(id);
  if (!parsed || parsed.segments.length === 0) return null;
  const rank = parsed.segments[parsed.segments.length - 1].rank;
  return { rank, label: RANK_LABEL[rank] };
}

/** Display name for a dynamic node's own (deepest) segment — a curated common
 *  name where one exists (seeded from the tree nodes this feature replaces),
 *  else the capitalized scientific name; "" = "Unclassified <Rank>". */
export function dynamicNodeDisplayName(id: string): string {
  const parsed = parseDynamicNodeId(id);
  if (!parsed || parsed.segments.length === 0) return NODE_INDEX.get(id)?.name ?? id;
  const last = parsed.segments[parsed.segments.length - 1];
  if (last.value === "") return `Unclassified ${RANK_LABEL[last.rank]}`;
  return COMMON_NAME_BY_VALUE[last.value] ?? (last.value.charAt(0).toUpperCase() + last.value.slice(1));
}

// Static roots that get the new live, arbitrary-depth drilldown instead of the
// old precomputed node-children-summaries.json path — see taxa-subgroups/
// route.ts. Rolled out one root at a time (Phase 6) once the mechanism was
// proven on Mammals (Phase 2). Birds gains drilldown for the first time here
// (it's a true leaf in the static tree today, per taxonomy-tree.test.ts's own
// "Aves is a leaf" assertion) — isLiveDrilldownNode doesn't require existing
// static children, so this alone is enough for it to become expandable.
export const DYNAMIC_DRILLDOWN_ROOTS = new Set<string>(["mammals", "birds", "reptiles", "amphibians", "fishes"]);

/** Is `id` (a bare root or a dynamic id under one) inside DYNAMIC_DRILLDOWN_ROOTS? */
export function isLiveDrilldownNode(id: string): boolean {
  const parsed = parseDynamicNodeId(id);
  return DYNAMIC_DRILLDOWN_ROOTS.has(parsed ? parsed.rootId : id);
}

// Seeded from the curated node names this feature replaces (Decisions 3/9) —
// purely a display overlay over live-computed data, never used for filtering.
// Extend this as more taxa roll out (Phase 6).
export const COMMON_NAME_BY_VALUE: Record<string, string> = {
  // Mammals
  rodentia: "Rodents",
  chiroptera: "Bats",
  carnivora: "Carnivores",
  artiodactyla: "Artiodactyls",
  lagomorpha: "Rabbits & Hares",
  sirenia: "Sirenians",
  perissodactyla: "Odd-toed Ungulates",
  pholidota: "Pangolins",
  // Insects
  coleoptera: "Beetles",
  lepidoptera: "Butterflies & Moths",
  diptera: "Flies & Mosquitoes",
  hymenoptera: "Bees, Wasps & Ants",
  hemiptera: "True Bugs",
  orthoptera: "Grasshoppers, Crickets & Locusts",
  odonata: "Dragonflies & Damselflies",
  // Reptiles
  squamata: "Squamates",
  testudines: "Turtles & Tortoises",
  crocodylia: "Crocodilians",
  rhynchocephalia: "Tuataras",
  // Amphibians
  anura: "Frogs & Toads",
  caudata: "Salamanders & Newts",
  gymnophiona: "Caecilians",
  // Fishes (class-level split)
  actinopterygii: "Ray-finned Fishes",
  sarcopterygii: "Lobe-finned Fishes",
  chondrichthyes: "Sharks & Rays",
};
