import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

/**
 * Protected-area polygons for a bounding box, from the authoritative WDPA
 * (World Database on Protected Areas, UNEP-WCMC & IUCN) ArcGIS FeatureServer.
 *
 * This is a thin same-origin proxy that:
 *  - keeps the (potentially flaky / CORS-restricted) upstream off the browser,
 *  - generalizes polygon geometry server-side to keep payloads small, and
 *  - lets Vercel's edge cache absorb repeat lookups for the same area.
 *
 * The client runs point-in-polygon locally (see lib/geo/pointInPolygon) to flag
 * which occurrences fall inside a protected area and compute the "% in PA" stat.
 */
const WDPA_QUERY_URL =
  "https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/FeatureServer/0/query";

export async function GET(request: NextRequest) {
  const bboxParam = request.nextUrl.searchParams.get("bbox");
  if (!bboxParam) {
    return NextResponse.json({ error: "bbox parameter is required (minLon,minLat,maxLon,maxLat)" }, { status: 400 });
  }

  const parts = bboxParam.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox must be 'minLon,minLat,maxLon,maxLat'" }, { status: 400 });
  }
  const [minLon, minLat, maxLon, maxLat] = parts;

  // Generalize geometry to ~the resolution we'd render at (degrees). Larger
  // bboxes get coarser polygons — enough for a point-in-polygon stat, far
  // smaller payloads than full-resolution WDPA boundaries.
  const span = Math.max(maxLon - minLon, maxLat - minLat);
  const maxAllowableOffset = Math.max(span / 1024, 0.0001);

  const params = new URLSearchParams({
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: "1=1",
    outFields: "WDPAID,NAME,DESIG_ENG",
    returnGeometry: "true",
    maxAllowableOffset: maxAllowableOffset.toString(),
    geometryPrecision: "5",
    f: "geojson",
  });

  try {
    const upstream = await fetch(`${WDPA_QUERY_URL}?${params}`, { cache: "no-store" });
    if (!upstream.ok) {
      throw new Error(`WDPA FeatureServer error: ${upstream.status} ${upstream.statusText}`);
    }
    const data = await upstream.json();

    // ArcGIS flags incomplete results (too many PAs in the bbox) so the client
    // can caveat the stat as a lower bound.
    const truncated = Boolean(data.exceededTransferLimit ?? data.properties?.exceededTransferLimit);

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features: Array.isArray(data.features) ? data.features : [],
        metadata: { truncated },
      },
      { headers: CACHE_1H },
    );
  } catch (error) {
    console.error("Error fetching protected areas:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 },
    );
  }
}
