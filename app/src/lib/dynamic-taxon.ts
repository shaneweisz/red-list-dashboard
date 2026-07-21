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

export type DynamicRank = "order" | "family" | "genus";
export interface DynamicSegment {
  rank: DynamicRank;
  value: string; // lowercase; "" = Unclassified bucket for this rank
}

const SEP = "~";
const RANK_TO_FILTER_FIELD: Record<DynamicRank, "orderNames" | "families" | "genera"> = {
  order: "orderNames",
  family: "families",
  genus: "genera",
};
const RANK_ORDER: DynamicRank[] = ["order", "family", "genus"];

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
    if (rank !== "order" && rank !== "family" && rank !== "genus") return null;
    segments.push({ rank, value: part.slice(idx + 1) });
  }
  return { rootId, segments };
}

/** The rank one level below this node's deepest segment (or "order" for a bare
 *  root) — the rank getLiveRankChildren should enumerate when expanding it. */
export function nextDynamicRank(id: string): DynamicRank | null {
  const parsed = parseDynamicNodeId(id);
  const depth = parsed ? parsed.segments.length : 0;
  return RANK_ORDER[depth] ?? null; // null once already at genus (a leaf)
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

const RANK_LABEL: Record<DynamicRank, string> = { order: "Order", family: "Family", genus: "Genus" };

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
// route.ts. Starts with just "mammals" (Phase 2); extended one root at a time
// through Phase 6 once the mechanism is proven. Deliberately NOT all 8 roots
// from day one — each addition is its own verified step.
export const DYNAMIC_DRILLDOWN_ROOTS = new Set<string>(["mammals"]);

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
};
