/**
 * Phase-1 TypeScript port of a subset of R's CoordinateCleaner package
 * (Zizka et al. 2019, https://github.com/ropensci/CoordinateCleaner), reimplemented
 * from the published algorithms and roxygen examples rather than transcribed from the
 * GPL-3 source. Flags GBIF geo-referencing artifacts that GBIF's own `issues` array
 * doesn't catch (see docs/gbif-coordinate-cleaning-scoping.md).
 *
 * Each function mirrors one upstream `cc_*` test at its documented default threshold:
 * - isZeroCoordinate  -> cc_zero  (buffer = 0.5 decimal degrees)
 * - isEqualLatLon     -> cc_equ   (test = "absolute", the package default)
 * - isNearGbifHeadquarters -> cc_gbif (buffer = 1000m geodesic, geod = TRUE)
 * - flagDuplicateCoordinates -> cc_dupl (species + lon/lat key, no extra columns)
 */

const EARTH_RADIUS_METERS = 6371000;

const GBIF_HQ = { lon: 12.58, lat: 55.67 };

export type QualityFlag =
  | "ZERO_COORDINATE"
  | "EQUAL_COORDINATES"
  | "GBIF_HEADQUARTERS"
  | "DUPLICATE";

export interface CleanableCoordinate {
  lon: number;
  lat: number;
}

function haversineMeters(a: CleanableCoordinate, b: CleanableCoordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Port of cc_zero: flags exact zero on either axis, or within `bufferDegrees` of (0,0). */
export function isZeroCoordinate({ lon, lat }: CleanableCoordinate, bufferDegrees = 0.5): boolean {
  if (lon === 0 || lat === 0) return true;
  return Math.hypot(lon, lat) <= bufferDegrees;
}

/** Port of cc_equ (test="absolute", the package default): flags |lon| === |lat|. */
export function isEqualLatLon({ lon, lat }: CleanableCoordinate): boolean {
  return Math.abs(lon) === Math.abs(lat);
}

/**
 * Port of cc_gbif (geod=TRUE default): flags points within `bufferMeters` of GBIF's
 * Copenhagen headquarters — a common geo-referencing default when the true locality
 * is unknown. Not recommended when working with genuinely Danish/Copenhagen records.
 */
export function isNearGbifHeadquarters(coord: CleanableCoordinate, bufferMeters = 1000): boolean {
  return haversineMeters(coord, GBIF_HQ) <= bufferMeters;
}

/**
 * Port of cc_dupl (species + lon/lat key, no extra columns): within a single species'
 * record set, flags every occurrence of a (lon, lat) pair after the first.
 */
export function flagDuplicateCoordinates(records: readonly CleanableCoordinate[]): boolean[] {
  const seen = new Set<string>();
  return records.map(({ lon, lat }) => {
    const key = `${lon},${lat}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

/**
 * Runs all phase-1 checks over a single species' occurrence records and returns each
 * record's failed-check names, mirroring clean_coordinates()'s per-test flag columns.
 * Callers should pass all records for one species (cc_dupl's duplicate key includes
 * species, which is constant across a single /api/occurrences request).
 */
export function getQualityFlags<T extends CleanableCoordinate>(records: readonly T[]): QualityFlag[][] {
  const duplicateFlags = flagDuplicateCoordinates(records);
  return records.map((record, i) => {
    const flags: QualityFlag[] = [];
    if (isZeroCoordinate(record)) flags.push("ZERO_COORDINATE");
    if (isEqualLatLon(record)) flags.push("EQUAL_COORDINATES");
    if (isNearGbifHeadquarters(record)) flags.push("GBIF_HEADQUARTERS");
    if (duplicateFlags[i]) flags.push("DUPLICATE");
    return flags;
  });
}
