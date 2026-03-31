import { NextRequest, NextResponse } from "next/server";
import { searchSpecies } from "@/lib/data/species-store";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 50);

  if (query.length < 2) {
    return NextResponse.json({ results: [] }, { headers: CACHE_5M });
  }

  try {
    const results = searchSpecies(query, limit);
    return NextResponse.json({ results }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Search error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Search failed: ${message}` },
      { status: 500 }
    );
  }
}
