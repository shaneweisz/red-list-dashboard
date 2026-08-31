import { NextRequest, NextResponse } from "next/server";
import { getAssessorCandidatesByCountry } from "@/lib/data/species-store";
import { findNode, getTaxonGroupsForNode, nearestStaticNode } from "@/lib/taxonomy-utils";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxaId = searchParams.get("taxaId");
  const countriesParam = searchParams.get("countries");

  if (!taxaId || !countriesParam) {
    return NextResponse.json(
      { error: "taxaId and countries are required" },
      { status: 400 }
    );
  }

  const countries = countriesParam.split(";").filter(Boolean);
  // Candidates are counted off the per-group Red List CSVs under a node's own
  // static filter, which a live-drilldown id ("mammals~order:rodentia") has no
  // entry for — getTaxonGroupsForNode would treat the whole id as a taxon-group
  // name and match no CSV, returning an empty list. Suggest from the nearest
  // static ancestor instead (see suggestion-scope.ts; the client resolves the
  // same way for its labels, so this is normally already a static id).
  const scopeId = nearestStaticNode(taxaId) ?? taxaId;
  const groups = getTaxonGroupsForNode(scopeId);

  // Extract taxonomy filter from the node (orderNames, classNames, etc.)
  const node = findNode(scopeId);
  const filter = node?.filter;
  const taxonomyFilter = filter ? {
    classNames: filter.classNames,
    orderNames: filter.orderNames,
    families: filter.families,
    excludeClasses: filter.excludeClasses,
    excludeOrders: filter.excludeOrders,
    excludeFamilies: filter.excludeFamilies,
    genera: filter.genera,
    excludeGenera: filter.excludeGenera,
    speciesNames: filter.speciesNames,
    excludeSpeciesNames: filter.excludeSpeciesNames,
  } : undefined;

  try {
    const candidates = getAssessorCandidatesByCountry(groups, countries, taxonomyFilter);
    return NextResponse.json({ candidates, taxaId: scopeId }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Assessor candidates by country error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Assessor candidates by country query failed: ${message}` },
      { status: 500 }
    );
  }
}
