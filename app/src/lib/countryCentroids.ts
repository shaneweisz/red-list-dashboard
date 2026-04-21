/**
 * Detects GBIF records that were georeferenced to a country centroid rather
 * than a real collection locality — a common artefact for older herbarium /
 * museum specimens, flagged in the R `CoordinateCleaner` package as `cc_cen`.
 *
 * The centroid table is generated from Natural Earth's 10m Admin 0 countries
 * dataset (LABEL_X / LABEL_Y — cartographic label point per country) and is
 * rebuilt via `scripts/fetch-country-centroids.ts`. Natural Earth is public
 * domain.
 */

import centroids from "../../data/country-centroids.json";

const CENTROIDS = centroids as unknown as Record<string, [number, number]>;

/** Buffer radius (km) around each country centroid within which a record is
 * treated as "likely a country-centroid artefact". Chosen generously enough
 * to catch records with rounded coordinates (e.g. (1.5, 42.5) vs NE label
 * (1.5394, 42.5476)) while still being a small fraction of any country's
 * extent. */
export const CENTROID_BUFFER_KM = 20;

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
