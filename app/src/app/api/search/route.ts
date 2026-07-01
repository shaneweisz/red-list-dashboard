import { NextRequest, NextResponse } from "next/server";
import { searchSpecies, suggestTaxa } from "@/lib/data/species-duckdb";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 50);

  if (query.length < 2) {
    return NextResponse.json({ results: [], taxa: [] }, { headers: CACHE_5M });
  }

  try {
    // Species hits and higher-rank taxon suggestions scan the same warm parquets;
    // run them together so the dropdown can pin "Browse Felidae →" above the species.
    const [results, taxa] = await Promise.all([
      searchSpecies(query, limit),
      suggestTaxa(query),
    ]);
    return NextResponse.json({ results, taxa }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Search error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Search failed: ${message}` },
      { status: 500 }
    );
  }
}
