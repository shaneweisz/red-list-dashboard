/**
 * Great-circle distance, for the map's measuring tool.
 *
 * An assessor measuring on this map is asking questions with thresholds
 * attached — how far is this record from the nearest known population, is this
 * extent of occurrence under 100 km² — so the number needs to be the distance
 * over the ground, not the distance across a Mercator projection that stretches
 * by a factor of two at 60°.
 */

const EARTH_RADIUS_M = 6371008.8; // IUGG mean radius

export type LngLat = [number, number];

/** Metres between two points, along the surface. */
export function haversineMetres([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Total length of a path, in metres. */
export function pathLengthMetres(points: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMetres(points[i - 1], points[i]);
  return total;
}

/**
 * A distance as someone would say it out loud. Metres up to a kilometre, then
 * kilometres — three significant figures is well past what a click on a map can
 * justify, so anything longer is rounded rather than spelled out.
 */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres).toLocaleString()} m`;
  const km = metres / 1000;
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}
