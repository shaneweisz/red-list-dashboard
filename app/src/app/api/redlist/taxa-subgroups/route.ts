import { NextRequest, NextResponse } from "next/server";
import { getPrecomputedChildrenSummaries } from "@/lib/data/species-store";
import { getCountryChildrenSummaries } from "@/lib/data/country-taxa-summary-duckdb";
import { findNode, hasChildren } from "@/lib/taxonomy-utils";
import { CACHE_1H } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const nodeId = request.nextUrl.searchParams.get("nodeId");
  // One or more comma-separated codes — see taxa-summary/route.ts's own comment.
  const countries = request.nextUrl.searchParams.get("country")?.split(",").map((c) => c.trim()).filter(Boolean) ?? [];
  const countryScoped = countries.length > 0;

  if (!nodeId) {
    return NextResponse.json(
      { error: "Missing nodeId parameter" },
      { status: 400 }
    );
  }

  if (!findNode(nodeId) || !hasChildren(nodeId)) {
    return NextResponse.json({ subgroups: [], countryScoped }, { headers: CACHE_1H });
  }

  try {
    // Country-scoped summaries carry zeroed estimatedDescribed/gbifNeSpeciesCount
    // (no country dimension exists in that data) — countryScoped tells the client
    // to hide those columns rather than render a misleading 0.
    const subgroups = countries.length > 0
      ? await getCountryChildrenSummaries(countries, nodeId)
      : getPrecomputedChildrenSummaries(nodeId);
    return NextResponse.json({ subgroups, countryScoped }, { headers: CACHE_1H });
  } catch (error) {
    console.error(`Node children summary error for ${nodeId}:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Node summary failed: ${message}` },
      { status: 500 }
    );
  }
}
