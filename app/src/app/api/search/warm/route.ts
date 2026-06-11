import { NextResponse } from "next/server";
import { warmConnection } from "@/lib/data/species-duckdb";
import { CACHE_5M } from "@/lib/cache-headers";

/**
 * GET /api/search/warm
 * Primes the DuckDB connection (httpfs load + S3 config) so the first search
 * isn't paying cold-start init. Called on page load.
 */
export async function GET() {
  try {
    await warmConnection();
  } catch {
    // Best-effort warm-up; the search request will surface any real error.
  }
  return NextResponse.json({ ok: true }, { headers: CACHE_5M });
}
