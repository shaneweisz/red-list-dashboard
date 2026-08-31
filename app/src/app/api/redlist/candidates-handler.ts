/**
 * Shared handler behind /api/redlist/{assessor,reviewer}-candidates-by-country.
 *
 * The two routes differ only in which credit line they rank people by, so they
 * both delegate here. Scope comes from the TARGET SPECIES' own lineage (its taxon
 * group, class, order, family, genus) rather than from the dashboard's selected
 * taxon — see getCreditCandidates. That is what lets the response carry a ranking
 * at every granularity at once, and it is also why the selected node (which live
 * drilldown could make an id the static tree has no entry for) no longer figures
 * in this query at all.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCreditCandidates, type CreditRole, type CandidateRank } from "@/lib/data/species-store";
import { findNode } from "@/lib/taxonomy-utils";
import { buildDynamicNodeId, dynamicNodeDisplayName } from "@/lib/dynamic-taxon";
import { ensureVernacularNamesLoaded } from "@/lib/data/vernacular-names";
import { CACHE_5M } from "@/lib/cache-headers";

/** "flowering_plants" -> "Flowering Plants", for a group with no tree node. */
const titleCase = (s: string) =>
  s.split(/[_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/**
 * Display label per rank: the taxon group's own name at the top, and the target's
 * scientific name at each rank below — with its common name where one is known.
 *
 * The vernacular lookup lives behind dynamicNodeDisplayName (the hand-curated
 * overrides plus the CoL-derived names), which is keyed by a dynamic node id, so
 * a one-segment id is built to ask it. Only the deepest segment is read, so the
 * root the id is built on doesn't matter.
 */
function rankLabels(
  ranks: CandidateRank[],
  target: { taxonGroup: string; scientificName?: string | null; className?: string | null; orderName?: string | null; family?: string | null },
): Partial<Record<CandidateRank, string>> {
  ensureVernacularNamesLoaded();
  const named = (rank: "class" | "order" | "family" | "genus", value: string | null | undefined) => {
    const v = (value ?? "").trim().toLowerCase();
    return v ? dynamicNodeDisplayName(buildDynamicNodeId(target.taxonGroup, [{ rank, value: v }])) : undefined;
  };
  const labels: Partial<Record<CandidateRank, string>> = {};
  for (const rank of ranks) {
    const label =
      rank === "group" ? (findNode(target.taxonGroup)?.name ?? titleCase(target.taxonGroup))
      : rank === "class" ? named("class", target.className)
      : rank === "order" ? named("order", target.orderName)
      : rank === "family" ? named("family", target.family)
      : named("genus", (target.scientificName ?? "").trim().split(/\s+/)[0]);
    if (label) labels[rank] = label;
  }
  return labels;
}

export function handleCandidatesRequest(request: NextRequest, role: CreditRole): NextResponse {
  const searchParams = request.nextUrl.searchParams;
  const taxonGroup = searchParams.get("taxonGroup");
  const countriesParam = searchParams.get("countries") ?? "";

  if (!taxonGroup) {
    return NextResponse.json({ error: "taxonGroup is required" }, { status: 400 });
  }

  const target = {
    taxonGroup,
    scientificName: searchParams.get("scientificName"),
    className: searchParams.get("class"),
    orderName: searchParams.get("order"),
    family: searchParams.get("family"),
  };
  const countries = countriesParam.split(";").filter(Boolean);

  try {
    const { candidates, ranks, defaultRank } = getCreditCandidates(role, target, countries);
    return NextResponse.json(
      { candidates, ranks, defaultRank, labels: rankLabels(ranks, target) },
      { headers: CACHE_5M },
    );
  } catch (error) {
    console.error(`${role} candidates error:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `${role} candidates query failed: ${message}` }, { status: 500 });
  }
}
