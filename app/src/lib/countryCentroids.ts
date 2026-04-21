/**
 * Detects GBIF records that were georeferenced to a country centroid rather
 * than a real collection locality — a common artefact for older herbarium /
 * museum specimens, flagged by the R `CoordinateCleaner` package's `cc_cen`
 * function.
 *
 * Matches CoordinateCleaner's country-centroid defaults:
 *   - Centroids: Natural Earth 10m Admin 0 label points (public domain).
 *   - Buffer: 1 km — tight enough that false positives are negligible even
 *     in small countries, so no area-based exclusions are needed.
 *
 * The centroid table is rebuilt via `scripts/fetch-country-centroids.ts`.
 */

import centroids from "../../data/country-centroids.json";

const CENTROIDS = centroids as unknown as Record<string, [number, number]>;

/** Default buffer radius (km) — matches CoordinateCleaner's `buffer = 1000`
 * (metres) default for `cc_cen`. */
export const CENTROID_BUFFER_KM = 1;

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two (lat, lon) points. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Whether (lat, lon) is within `bufferKm` of the Natural Earth label point
 * for the given ISO 3166-1 alpha-2 country code. Returns false if the code
 * is unknown — we never flag a point we can't verify.
 */
export function isLikelyCountryCentroid(
  lat: number,
  lon: number,
  countryCode: string | null | undefined,
  bufferKm: number = CENTROID_BUFFER_KM,
): boolean {
  if (!countryCode) return false;
  const centroid = CENTROIDS[countryCode.toUpperCase()];
  if (!centroid) return false;
  const [cLon, cLat] = centroid;
  return haversineKm(lat, lon, cLat, cLon) <= bufferKm;
}

/** Exposed for tests / debugging. */
export function getCentroid(countryCode: string): [number, number] | null {
  return CENTROIDS[countryCode.toUpperCase()] ?? null;
}
