/**
 * CoL backbone — arbitrary-rank species listing (#271, Phase 3). Lists the CoL
 * accepted species under any taxon, matched at any rank (kingdom→genus) against
 * the denormalized lineage — e.g. ?taxon=Felidae returns every cat species in
 * the tree of life, most Not Evaluated. The hand-curated tree only drills into
 * predefined nodes; this works for any taxon CoL knows.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSpeciesUnder } from "@/lib/data/species-duckdb";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const taxon = request.nextUrl.searchParams.get("taxon")?.trim();
  if (!taxon) return NextResponse.json({ error: "missing taxon" }, { status: 400 });
  try {
    const result = await getSpeciesUnder(taxon);
    return NextResponse.json(result, { headers: CACHE_5M });
  } catch (error) {
    console.error("taxa species query error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `taxa species query failed: ${message}` }, { status: 500 });
  }
}
