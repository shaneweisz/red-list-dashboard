import { NextRequest, NextResponse } from "next/server";
import { getDrillChildren, type DrillStep, type TaxonomyRank, TAXONOMY_RANKS } from "@/lib/data/species-store";
import { getTaxonGroups } from "@/lib/data/taxon-groups";
import { CACHE_1H } from "@/lib/cache-headers";

/**
 * GET /api/redlist/taxa-drill?taxonId=mammalia&drill=class:mammalia/order:rodentia
 *
 * Returns children at the next taxonomic rank for the given taxon and drill path.
 * The drill parameter encodes the path as rank:value pairs separated by '/'.
 */
export async function GET(request: NextRequest) {
  const taxonId = request.nextUrl.searchParams.get("taxonId");
  const drillParam = request.nextUrl.searchParams.get("drill") || "";

  if (!taxonId) {
    return NextResponse.json(
      { error: "Missing taxonId parameter" },
      { status: 400 }
    );
  }

  // Parse drill path
  const drillPath: DrillStep[] = [];
  if (drillParam) {
    for (const segment of drillParam.split("/")) {
      const colonIdx = segment.indexOf(":");
      if (colonIdx === -1) continue;
      const rank = segment.slice(0, colonIdx) as TaxonomyRank;
      const value = decodeURIComponent(segment.slice(colonIdx + 1));
      if (!TAXONOMY_RANKS.includes(rank)) {
        return NextResponse.json(
          { error: `Invalid rank: ${rank}` },
          { status: 400 }
        );
      }
      drillPath.push({ rank, value });
    }
  }

  try {
    const groups = getTaxonGroups(taxonId);
    const children = getDrillChildren(groups, drillPath);
    return NextResponse.json({ children }, { headers: CACHE_1H });
  } catch (error) {
    console.error(`Drill error for ${taxonId}:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Drill failed: ${message}` },
      { status: 500 }
    );
  }
}
