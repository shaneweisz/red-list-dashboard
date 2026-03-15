import { NextRequest, NextResponse } from "next/server";
import { getAssessorCandidates } from "@/lib/data/species-store";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const scientificName = searchParams.get("scientificName");
  const taxonGroup = searchParams.get("taxonGroup");

  if (!scientificName || !taxonGroup) {
    return NextResponse.json(
      { error: "scientificName and taxonGroup are required" },
      { status: 400 }
    );
  }

  try {
    const candidates = getAssessorCandidates(scientificName, taxonGroup);
    return NextResponse.json({ candidates }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Assessor candidates error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Assessor candidates query failed: ${message}` },
      { status: 500 }
    );
  }
}
