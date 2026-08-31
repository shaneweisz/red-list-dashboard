/**
 * The `taxa=` URL token a Suggested Assessors / Reviewers row should link to at a
 * given granularity.
 *
 * The candidate ranking is taken over the target species' own lineage, so a row
 * clicked while the table is showing family-level counts should open the dashboard
 * filtered to that family — not to the whole taxon group. That's the live-drilldown
 * node for the lineage prefix ending at the chosen rank, in its URL token form.
 */

// taxonomy-utils MUST be imported before dynamic-taxon: the two are mutually
// importing, and taxonomy-utils calls into dynamic-taxon at module-eval time (it
// builds DEFAULT_VIEW_TOKEN_INDEX via getViewRootForNode -> isDynamicNodeId).
// Entering that cycle from the dynamic-taxon side instead leaves its own consts
// uninitialized when taxonomy-utils reaches for them ("Cannot access 'SEP'
// before initialization").
import { taxaUrlToken, stripNodePrefix } from "@/lib/taxonomy-utils";
import { rankOrderFor, buildDynamicNodeId, type DynamicRank } from "@/lib/dynamic-taxon";
import type { CandidateRank } from "@/lib/data/species-store";

export type ScopeLineage = Partial<Record<DynamicRank, string | null | undefined>>;

export function candidateScopeToken(
  taxonGroup: string,
  rank: CandidateRank,
  lineage: ScopeLineage,
): string {
  const groupToken = stripNodePrefix(taxonGroup);
  if (rank === "group") return groupToken;

  // Dynamic node ids are positional: segments are a contiguous prefix of the
  // root's rank order, so reaching `rank` means naming every rank above it too.
  const order = rankOrderFor(taxonGroup);
  const depth = order.indexOf(rank as DynamicRank);
  if (depth === -1) return groupToken;

  const segments = [];
  for (const r of order.slice(0, depth + 1)) {
    const value = (lineage[r] ?? "").trim().toLowerCase();
    // A gap can't be skipped — an empty segment is the "Unclassified <rank>"
    // bucket, which would filter to species that have no value at all. Fall back
    // to the group rather than link somewhere that means something else.
    if (!value) return groupToken;
    segments.push({ rank: r, value });
  }
  return taxaUrlToken(buildDynamicNodeId(taxonGroup, segments));
}
