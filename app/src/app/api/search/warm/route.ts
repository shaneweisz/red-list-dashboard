import { NextResponse } from "next/server";
import { warmConnection } from "@/lib/data/species-duckdb";
import { CACHE_5M } from "@/lib/cache-headers";

/**
 * GET /api/search/warm
 * Primes the DuckDB connection (httpfs load + S3 config), builds the in-memory search
 * index, and walks the no-match fallback tiers once, so the first search isn't paying
 * any of it. Called on page load; the client fires it and ignores the response, so the
 * few seconds this takes on a cold container are invisible.
 */
// The build reads both parquets off R2 and the priming walks two more — comfortably
// under this, but well over the 10s a route gets by default.
export const maxDuration = 60;

export async function GET() {
  try {
    await warmConnection();
  } catch {
    // Best-effort warm-up; the search request will surface any real error.
  }
  return NextResponse.json({ ok: true }, { headers: CACHE_5M });
}
