import { NextRequest, NextResponse } from "next/server";
import { getAssessorCandidatesByCountry } from "@/lib/data/species-store";
import { getCsvGroupsForNode } from "@/lib/taxonomy-utils";
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
  const groups = getCsvGroupsForNode(taxaId);

  try {
    const candidates = getAssessorCandidatesByCountry(groups, countries);
    return NextResponse.json({ candidates }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Assessor candidates by country error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Assessor candidates by country query failed: ${message}` },
      { status: 500 }
    );
  }
}
