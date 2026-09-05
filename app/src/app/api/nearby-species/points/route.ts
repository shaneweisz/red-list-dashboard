/**
 * GET /api/nearby-species/points?lat=&lng=&radiusKm=&speciesKey=
 *
 * Where one neighbour's records actually are, inside the radius the panel is
 * describing — so a name in the list can be turned into dots on the map.
 *
 * One species at a time, deliberately. Drawing every neighbour at once would be
 * a thousand-odd anonymous dots over the records the assessor came to look at;
 * one species is a shape you can read — a valley, a roadside, a single locality
 * that everything was collected from.
 */
import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";
import {
  NEARBY_POINTS_LIMIT,
  NEARBY_RADII_KM,
  NEARBY_RADIUS_DEFAULT,
  nearbyPointsUrl,
  type NearbyPoint,
} from "@/lib/mapping/nearby-species";

interface GbifOccurrence {
  decimalLatitude?: number;
  decimalLongitude?: number;
  year?: number;
  basisOfRecord?: string;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const speciesKey = sp.get("speciesKey");

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat and lng are required, and must be a real position" }, { status: 400 });
  }
  if (!speciesKey) {
    return NextResponse.json({ error: "speciesKey is required" }, { status: 400 });
  }
  const asked = Number(sp.get("radiusKm"));
  const radiusKm = (NEARBY_RADII_KM as readonly number[]).includes(asked) ? asked : NEARBY_RADIUS_DEFAULT;

  try {
    const res = await fetch(nearbyPointsUrl({ lat, lng, radiusKm, speciesKey }), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`GBIF returned ${res.status}`);
    const data = await res.json();

    const points: NearbyPoint[] = (data.results ?? [])
      .filter((r: GbifOccurrence) => Number.isFinite(r.decimalLatitude) && Number.isFinite(r.decimalLongitude))
      .map((r: GbifOccurrence) => ({
        lat: r.decimalLatitude as number,
        lng: r.decimalLongitude as number,
        year: Number.isFinite(r.year) ? (r.year as number) : null,
        basis: r.basisOfRecord ?? null,
      }));

    return NextResponse.json(
      {
        speciesKey,
        radiusKm,
        points,
        /** Every record GBIF holds for it here, which `points` may only sample. */
        total: data.count ?? points.length,
        sampled: (data.count ?? 0) > NEARBY_POINTS_LIMIT,
      },
      { headers: CACHE_1H }
    );
  } catch (error) {
    console.error("Nearby points lookup failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Nearby points lookup failed: ${message}` }, { status: 502 });
  }
}
