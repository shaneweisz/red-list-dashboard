/**
 * v2 lazy assessment history (#260 Phase 2). The species list no longer carries
 * the full per-species history array (it's ~half the payload); the detail panel
 * fetches it here on open. ?id=<sisTaxonId> → { previous_assessments }.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAssessmentHistory } from "@/lib/data/species-duckdb";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "missing or invalid id" }, { status: 400 });
  }
  try {
    const previous_assessments = await getAssessmentHistory(id);
    return NextResponse.json({ previous_assessments }, { headers: CACHE_5M });
  } catch (error) {
    console.error("v2 history query error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `v2 history query failed: ${message}` }, { status: 500 });
  }
}
