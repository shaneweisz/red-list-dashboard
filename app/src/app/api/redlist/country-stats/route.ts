import { NextResponse } from "next/server";
import { getCountryStats } from "@/lib/data/species-store";
import { CACHE_1H } from "@/lib/cache-headers";

/**
 * Per-country totals across ALL species (unfiltered by taxon) — the
 * country-view landing page's world map reads this instead of loading the
 * full species dataset client-side just to aggregate it in the browser.
 * Distinct from /api/country/stats, which queries GBIF observation counts
 * (a different data source) per taxon.
 */
export async function GET() {
  try {
    const stats = getCountryStats();
    return NextResponse.json({ stats }, { headers: CACHE_1H });
  } catch (error) {
    console.error("Country stats error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Country stats failed: ${message}` },
      { status: 500 }
    );
  }
}
