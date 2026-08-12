import { NextResponse } from "next/server";
import { getSpeciesByGbifKey } from "@/lib/data/species-duckdb";
import { CACHE_5M } from "@/lib/cache-headers";

/**
 * The little a standalone occurrence page needs to know about its species.
 *
 * The dashboard gets this from the species list it has already loaded; a
 * shared /occurrences/<key> link has nothing, and reading the whole list to
 * find one row would undo the point of that page being light.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  try {
    const species = await getSpeciesByGbifKey(key);
    if (!species) {
      return NextResponse.json({ error: "Species not found" }, { status: 404 });
    }
    return NextResponse.json(species, { headers: CACHE_5M });
  } catch (error) {
    console.error("species summary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
