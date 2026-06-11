/**
 * Species list — DuckDB/Parquet-backed (querying the parquets in R2), plus
 * arbitrary-rank filtering (e.g. ?taxon=turdidae). Same params + response as
 * before; the full per-species assessment history is fetched lazily via the
 * /api/redlist/species/history sub-route.
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
    console.error("species query error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `species query failed: ${message}` }, { status: 500 });
  }
}
