/**
 * Scope resolution for the Suggested Assessors / Suggested Reviewers tables.
 *
 * Both tables rank people by how many species they have already assessed (or
 * reviewed) in the selected taxon — a count taken from the per-group Red List
 * CSVs, filtered by the selected node's own static SpeciesFilter (see
 * getAssessorCandidatesByCountry in species-store.ts).
 *
 * Live taxonomic drilldown (dynamic-taxon.ts) added selections the static tree
 * has no node for — "mammals~order:rodentia~family:muridae" — and the candidate
 * queries had no branch for them: getTaxonGroupsForNode() treated the whole id
 * as a taxon-group name, matching no CSV, so both tabs went permanently empty
 * ("No assessor candidates found") for any drilled-in selection.
 *
 * Rather than teach the CSV scan the dynamic ranks, a drilled-in selection falls
 * back to its nearest static ancestor — Muridae is suggested from Mammals — and
 * the table says so, so the numbers are never read as being about the narrower
 * group. Narrowing the count to the drilled-in rank itself is a follow-up
 * (dynamicNodeFilter() already produces a filter matchesTaxonomyFilter() could
 * apply); this restores the feature to working rather than empty.
 */

import { findNode, nearestStaticNode } from "@/lib/taxonomy-utils";
import { isDynamicNodeId, dynamicNodeDisplayName } from "@/lib/dynamic-taxon";
import { canonicalizeTaxonId } from "@/lib/data/taxonomy-constants";
import { TAXA_BY_ID } from "@/config/taxa";

export interface SuggestionScope {
  /** The node the candidate query runs over — always one the static tree knows. */
  taxaId: string;
  /** Display name for that node, e.g. "Mammals". */
  taxaName: string;
  /**
   * Display name of the selection when it is NARROWER than `taxaId` (e.g.
   * "Muridae"), so the table can say which group the ranking is actually over.
   * Undefined when the selection is the scope.
   */
  narrowerName?: string;
}

/** Human-readable name for any taxon identifier: static node, dynamic drilldown id,
 *  bare taxon group, or an arbitrary rank token we know nothing about. */
export function taxonDisplayName(nodeId: string): string {
  const id = canonicalizeTaxonId(nodeId.trim());
  const staticName = findNode(id)?.name ?? TAXA_BY_ID[id]?.name;
  if (staticName) return staticName;
  if (isDynamicNodeId(id)) return dynamicNodeDisplayName(id);
  // An arbitrary-rank token the tree can't place ("turdidae") — a bare scientific
  // name, so capitalize it the same way dynamicNodeDisplayName does.
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Resolve the taxon the candidate tables should be computed for.
 *
 * `selectedNodeId` is the current sub-group (or taxon) selection, if any;
 * `fallbackTaxonGroup` is the species row's own taxon group, used when nothing is
 * selected or when the selection is an arbitrary rank the tree can't place.
 */
export function suggestionScope(
  selectedNodeId: string | undefined,
  fallbackTaxonGroup: string,
): SuggestionScope {
  const selected = (selectedNodeId ?? fallbackTaxonGroup).trim();
  const taxaId =
    nearestStaticNode(selected) ??
    nearestStaticNode(fallbackTaxonGroup) ??
    fallbackTaxonGroup;
  const scope: SuggestionScope = { taxaId, taxaName: taxonDisplayName(taxaId) };
  if (taxaId !== canonicalizeTaxonId(selected)) scope.narrowerName = taxonDisplayName(selected);
  return scope;
}
