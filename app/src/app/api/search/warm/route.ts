import { NextResponse } from "next/server";
import { warmSearchIndex } from "@/lib/data/species-store";
import { CACHE_5M } from "@/lib/cache-headers";

/**
 * GET /api/search/warm
 * Pre-loads the search index into memory so subsequent searches are fast.
 * Called on page load to eliminate cold-start latency on first search.
 */
export async function GET() {
  warmSearchIndex();
  return NextResponse.json({ ok: true }, { headers: CACHE_5M });
}
