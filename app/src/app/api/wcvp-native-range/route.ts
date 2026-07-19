import { NextRequest, NextResponse } from "next/server";
import { CACHE_5M } from "@/lib/cache-headers";
import wcvpNativeCountries from "@/lib/native-range-refdata/wcvp-native-countries.json";

/**
 * Looks up a species' native-country list (ISO 3166-1 alpha-2) from Kew's World
 * Checklist of Vascular Plants (WCVP) — the "POWO" native-range source in
 * OccurrenceMapRow.tsx (issue #82), alongside the Red List assessment-based one
 * already carried on every species as `s.countries`.
 *
 * A dedicated lazy route (not a field on /api/redlist/species) so this ~49MB
 * full-checklist lookup table only ever loads server-side, for the one species
 * whose GBIF tab is actually open — not bundled into the already-large
 * species-list payload, and never shipped to the browser at all.
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name parameter is required" }, { status: 400 });
  }
  const countries = (wcvpNativeCountries as Record<string, string[]>)[name] ?? null;
  return NextResponse.json({ countries }, { headers: CACHE_5M });
}
