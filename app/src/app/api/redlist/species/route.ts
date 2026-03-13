import { NextRequest, NextResponse } from "next/server";
import { getSpecies } from "@/lib/data/species-store";
import { getTaxonGroups } from "@/lib/data/taxon-groups";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "all";
  const category = searchParams.get("category");
  const groups = getTaxonGroups(taxonId);

  try {
    const includeNE = category === "NE";
    let species = getSpecies(groups, includeNE);

    if (category === "NE") {
      species = species.filter((s) => s.category === "NE");
    }

    return NextResponse.json(
      { species, total: species.length },
      { headers: CACHE_5M }
    );
  } catch (error) {
    console.error("Species query error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Species query failed: ${message}` },
      { status: 500 }
    );
  }
}
