import { NextRequest, NextResponse } from "next/server";
import { getSubgroupSummaries } from "@/lib/data/species-store";
import { TAXA_SUBGROUPS } from "@/config/taxa-hierarchy";
import { CACHE_1H } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const taxonId = request.nextUrl.searchParams.get("taxonId");

  if (!taxonId) {
    return NextResponse.json(
      { error: "Missing taxonId parameter" },
      { status: 400 }
    );
  }

  const subgroupDefs = TAXA_SUBGROUPS[taxonId];
  if (!subgroupDefs) {
    return NextResponse.json({ subgroups: [] }, { headers: CACHE_1H });
  }

  try {
    const subgroups = getSubgroupSummaries(subgroupDefs);
    return NextResponse.json({ subgroups }, { headers: CACHE_1H });
  } catch (error) {
    console.error(`Subgroup summary error for ${taxonId}:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Subgroup summary failed: ${message}` },
      { status: 500 }
    );
  }
}
