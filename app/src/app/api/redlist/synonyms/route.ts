import { NextRequest, NextResponse } from "next/server";
import { getSynonyms } from "@/lib/data/species-duckdb";
import { CACHE_1H } from "@/lib/cache-headers";

// Synonyms + accepted name for the detail panel's Catalogue of Life tab.
// ?col=<col_id> (NE rows carry it) or ?sis=<sis_taxon_id> (assessed).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const col = sp.get("col");
  const sisRaw = sp.get("sis");
  const sis = sisRaw != null ? parseInt(sisRaw, 10) : null;
  if (!col && (sis == null || Number.isNaN(sis))) {
    return NextResponse.json({ error: "Provide ?col or ?sis" }, { status: 400 });
  }
  try {
    const data = await getSynonyms({ col, sis });
    return NextResponse.json(data, { headers: CACHE_1H });
  } catch (error) {
    console.error("synonyms error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `synonyms failed: ${message}` }, { status: 500 });
  }
}
