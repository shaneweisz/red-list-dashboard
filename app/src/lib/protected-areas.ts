/**
 * The World Database on Protected Areas (WDPA), UNEP-WCMC & IUCN — the dataset
 * behind protectedplanet.net.
 *
 * We draw it as a transparent raster from UNEP-WCMC's own ArcGIS MapServer, so
 * a click can't hit-test anything client-side. The same MapServer answers the
 * ArcGIS `identify` operation, which turns a clicked point back into the
 * protected areas under it — no API key, no proxy (it reflects any origin in
 * its CORS headers), and it's the same service the tiles came from, so what you
 * click is guaranteed to be what you saw drawn.
 *
 * The Protected Planet API itself is not an option: it requires a key issued by
 * request, and its terms exclude commercial use.
 */

const MAP_SERVER =
  "https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer";

/** The rendered overlay: a transparent PNG per tile, via the {bbox} token. */
export const PROTECTED_AREAS_TILE_URL =
  `${MAP_SERVER}/export` +
  "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&format=png32&transparent=true&f=image";

export const PROTECTED_AREAS_ATTRIBUTION =
  '<a href="https://www.protectedplanet.net" target="_blank" rel="noopener noreferrer">WDPA</a> &copy; UNEP-WCMC &amp; IUCN';

/**
 * One designation covering the clicked point.
 *
 * `siteId` and `sitePid` are what the November 2025 WDPA/WD-OECM merge renamed
 * WDPAID and WDPA_PID to. A site with several parcels shares one `siteId` and
 * gives each parcel its own `sitePid` ("23_1"), which is why both are kept:
 * protectedplanet.net wants the id in the path and the parcel in the query.
 */
export interface ProtectedArea {
  siteId: string;
  sitePid: string;
  name: string;
  designation?: string;
  /** IUCN management category — Ia, Ib, II … VI, or "Not Reported". */
  iucnCategory?: string;
  status?: string;
  statusYear?: number | null;
  /** Whether WDPA holds this as a protected area or an OECM. */
  siteType?: string;
  /** Reported area in km², as the country declared it. */
  reportedAreaKm2?: number | null;
}

/**
 * The page for one site on protectedplanet.net.
 *
 * It has to be `/<siteId>?site_pid=<sitePid>`: a bare `/<sitePid>` 500s for any
 * multi-parcel site, whose parcel ids look like "23_1" and aren't valid paths.
 */
export function protectedPlanetUrl(area: Pick<ProtectedArea, "siteId" | "sitePid">): string {
  return `https://www.protectedplanet.net/${encodeURIComponent(area.siteId)}?site_pid=${encodeURIComponent(area.sitePid)}`;
}

interface IdentifyRequest {
  lng: number;
  lat: number;
  /** The map's current bounds, west/south/east/north, in degrees. */
  bounds: [number, number, number, number];
  /** Canvas size in pixels — the tolerance below is measured against it. */
  width: number;
  height: number;
  /** Click slop in screen pixels. */
  tolerance?: number;
}

/** The identify URL for a clicked point. Split out so it can be tested. */
export function identifyUrl({ lng, lat, bounds, width, height, tolerance = 5 }: IdentifyRequest): string {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    sr: "4326",
    tolerance: String(tolerance),
    mapExtent: bounds.join(","),
    imageDisplay: `${Math.round(width)},${Math.round(height)},96`,
    // `all` rather than the polygon sublayer alone: small sites are held only
    // as points (sublayer 0), and a polygon-only query drops them silently.
    layers: "all",
    returnGeometry: "false",
    f: "json",
  });
  return `${MAP_SERVER}/identify?${params}`;
}

function text(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  // ArcGIS writes these where a real value is missing; they aren't worth a line
  // of a popup.
  if (s === "" || s === "Null" || s === "N/A" || s === "Not Applicable" || s === "Not Reported") return undefined;
  return s;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads an ArcGIS identify response into designations.
 *
 * A single click routinely returns several — Yellowstone comes back as a
 * national park, a World Heritage site, a biosphere reserve and a recommended
 * wilderness — and they're all true at once, so all of them are kept. The order
 * ArcGIS returns them in carries no ranking, which is exactly why we can't just
 * take the first one.
 */
export function parseIdentifyResponse(json: unknown): ProtectedArea[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  const areas: ProtectedArea[] = [];
  for (const result of results) {
    const attributes = (result as { attributes?: Record<string, unknown> })?.attributes;
    if (!attributes) continue;
    const siteId = text(attributes.SITE_ID) ?? text(attributes.WDPAID);
    const sitePid = text(attributes.SITE_PID) ?? text(attributes.WDPA_PID) ?? siteId;
    if (!siteId || !sitePid) continue;
    if (seen.has(sitePid)) continue;
    seen.add(sitePid);
    areas.push({
      siteId,
      sitePid,
      name:
        text(attributes.NAME_ENG) ??
        text(attributes.NAME) ??
        text((result as { value?: unknown }).value) ??
        "Protected area",
      designation: text(attributes.DESIG_ENG) ?? text(attributes.DESIG),
      iucnCategory: text(attributes.IUCN_CAT),
      status: text(attributes.STATUS),
      statusYear: num(attributes.STATUS_YR) || null,
      siteType: text(attributes.SITE_TYPE),
      reportedAreaKm2: num(attributes.REP_AREA),
    });
  }
  return areas;
}

/** Looks up the protected areas at a point. Throws on a failed request. */
export async function identifyProtectedAreas(
  request: IdentifyRequest,
  signal?: AbortSignal
): Promise<ProtectedArea[]> {
  const response = await fetch(identifyUrl(request), { signal });
  if (!response.ok) throw new Error(`WDPA identify failed: ${response.status}`);
  return parseIdentifyResponse(await response.json());
}
