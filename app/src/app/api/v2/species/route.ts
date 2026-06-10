/**
 * #261 v2: DuckDB/Parquet-backed species list. Drop-in for /api/redlist/species
 * (same params + response), plus arbitrary-rank filtering (e.g. ?taxon=turdidae).
 */
import { NextRequest, NextResponse } from "next/server";
import { querySpecies } from "@/lib/data/species-duckdb";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const taxon = sp.get("taxon") || "all";
  const category = sp.get("category");

  try {
    const includeNE = category === "NE";
    let species = await querySpecies({ taxon, includeNE });
    if (category === "NE") species = species.filter((s) => s.category === "NE");

    return NextResponse.json({ species, total: species.length }, { headers: CACHE_5M });
  } catch (error) {
    console.error("v2 species query error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `v2 species query failed: ${message}` }, { status: 500 });
  }
}
