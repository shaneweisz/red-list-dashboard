/**
 * Place search, for finding the locality on a specimen label.
 *
 * The workflow this serves: a herbarium sheet says "Raudal de Yuruparí", and
 * you need to know where that is before you can decide whether the record's
 * coordinates are plausible — or supply them yourself.
 *
 * Photon (komoot) over OpenStreetMap data. Keyless, CORS-open, and it carries
 * the named natural features this work runs on: it finds "Raudal Pucarón
 * (Yuruparí)" as a waterfall in Vaupés, which Nominatim — OSM's own geocoder —
 * returns nothing for. Google was ruled out on licensing rather than cost: its
 * terms require results be shown on a Google map, and this is MapLibre.
 */

const PHOTON_URL = "https://photon.komoot.io/api/";

export const GEOCODER_ATTRIBUTION = "Search: Photon / © OpenStreetMap contributors";

export interface Place {
  /** Stable enough to key a list by. */
  id: string;
  name: string;
  /** Where it is, in words — "Vaupés, Colombia". */
  context: string;
  /** What OSM calls it: waterfall, hamlet, protected_area … */
  kind?: string;
  lat: number;
  lng: number;
  /** Bounds, where the place has an extent rather than being a point. */
  bbox?: [number, number, number, number];
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Reads Photon's GeoJSON into something a list can show.
 *
 * The context line is built from the largest-to-smallest administrative names
 * OSM happens to carry for that feature — they're inconsistently populated, so
 * it takes whichever exist rather than assuming a fixed shape.
 */
export function parsePhotonResponse(json: unknown): Place[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const places: Place[] = [];
  for (const feature of features as PhotonFeature[]) {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties;
    if (!coordinates || !properties) continue;
    const [lng, lat] = coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const name = text(properties.name);
    if (!name) continue;
    const context = [
      text(properties.city) ?? text(properties.district),
      text(properties.county),
      text(properties.state),
      text(properties.country),
    ]
      .filter(Boolean)
      // A feature can repeat a name across levels ("Cali, Cali, …").
      .filter((part, index, all) => all.indexOf(part) === index)
      .join(", ");
    // Photon's extent is [west, north, east, south] — note the order, which is
    // not the [w, s, e, n] every other part of this codebase uses.
    const extent = properties.extent as number[] | undefined;
    places.push({
      // Ends in the position within this result set, because Photon returns
      // the same OSM object more than once — the same node at different
      // granularities, or one place matched by two of its names. The id is pin
      // identity as well as a React key, so a collision silently dropped the
      // second pin and pointed rename and dismiss at the first.
      id: `${text(properties.osm_type) ?? "?"}${text(String(properties.osm_id)) ?? "?"}-${places.length}`,
      name,
      context,
      kind: text(properties.osm_value),
      lat,
      lng,
      bbox:
        Array.isArray(extent) && extent.length === 4
          ? [extent[0], extent[3], extent[2], extent[1]]
          : undefined,
    });
  }
  return places;
}

export interface SearchOptions {
  /** Bias results towards what you're looking at. */
  lat?: number;
  lng?: number;
  zoom?: number;
  limit?: number;
  signal?: AbortSignal;
}

/** Builds the query URL. Separate from the fetch so it can be tested. */
export function searchUrl(query: string, { lat, lng, zoom, limit = 6 }: SearchOptions = {}): string {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  // Biasing matters more here than it looks: a specimen label's place name is
  // often shared with a hotel or a street on the other side of the continent,
  // and the records already tell us which part of the world we're in.
  if (lat != null && lng != null) {
    params.set("lat", lat.toFixed(4));
    params.set("lon", lng.toFixed(4));
    if (zoom != null) params.set("zoom", String(Math.round(zoom)));
    params.set("location_bias_scale", "0.6");
  }
  return `${PHOTON_URL}?${params}`;
}

export async function searchPlaces(query: string, options: SearchOptions = {}): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const response = await fetch(searchUrl(trimmed, options), { signal: options.signal });
  if (!response.ok) throw new Error(`Place search failed: ${response.status}`);
  return parsePhotonResponse(await response.json());
}

/** OSM's feature values are snake_case; this is how you'd say them. */
export function formatKind(kind?: string): string {
  if (!kind) return "";
  return kind.replace(/_/g, " ");
}
