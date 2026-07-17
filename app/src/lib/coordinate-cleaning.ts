/**
 * TypeScript port of a subset of R's CoordinateCleaner package
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
 * - isNearCapital     -> cc_cap  (buffer = 10000m geodesic, geod = TRUE)
 * - isNearCentroid    -> cc_cen  (buffer = 1000m geodesic, geod = TRUE, test = "country" only —
 *                                 upstream default also tests province centroids, skipped here,
 *                                 see docs/gbif-coordinate-cleaning-scoping.md phase 2 scoping)
 * - isNearInstitution -> cc_inst (buffer = 100m geodesic — upstream's own standalone default is
 *                                 geod=FALSE with the buffer in decimal degrees, which is a
 *                                 confusing/inconsistent default relative to the rest of the
 *                                 package; using geodesic meters here for consistency with
 *                                 every other check in this file)
 *
 * None of the checks below implement upstream's optional `verify` step (re-checking whether a
 * flagged point is the *only* record for that species nearby, which would unflag it) — matches
 * the precedent set for cc_gbif in phase 1: skip it, keep the check as a simple proximity test.
 *
 * Reference data (src/lib/coordinate-cleaning-refdata/) is sourced independently of
 * CoordinateCleaner's own bundled GPL-3 tables — see that directory's README for
 * provenance.
 */

import capitals from "./coordinate-cleaning-refdata/capitals.json";
import centroids from "./coordinate-cleaning-refdata/centroids.json";
import institutions from "./coordinate-cleaning-refdata/institutions.json";

const EARTH_RADIUS_METERS = 6371000;

const GBIF_HQ = { lon: 12.58, lat: 55.67 };

export type QualityFlag =
  | "ZERO_COORDINATE"
  | "EQUAL_COORDINATES"
  | "GBIF_HEADQUARTERS"
  | "DUPLICATE"
  | "NEAR_CAPITAL"
  | "NEAR_CENTROID"
  | "NEAR_INSTITUTION";

export interface CleanableCoordinate {
  lon: number;
  lat: number;
}

// Human-readable labels for each check, in the order they're evaluated. Kept short
// for the hover tooltip; see QUALITY_FLAG_DESCRIPTIONS for the longer explanation
// shown in the coordinate-cleaning checkbox list.
export const QUALITY_FLAG_LABELS: Record<QualityFlag, string> = {
  ZERO_COORDINATE: "Zero / null-island coordinates",
  EQUAL_COORDINATES: "Latitude equals longitude",
  GBIF_HEADQUARTERS: "Near GBIF's Copenhagen office",
  DUPLICATE: "Repeated coordinates",
  NEAR_CAPITAL: "Near a country capital",
  NEAR_CENTROID: "Near a country centroid",
  NEAR_INSTITUTION: "Near a biodiversity institution",
};

// One-sentence explanation of exactly what each check does and doesn't do —
// shown as a tooltip on the checkbox in the coordinate-cleaning filter.
export const QUALITY_FLAG_DESCRIPTIONS: Record<QualityFlag, string> = {
  ZERO_COORDINATE:
    "Coordinates at exactly (0, 0), with latitude or longitude equal to 0, or within 0.5° of the origin — usually a GPS/data-entry default, not a real location.",
  EQUAL_COORDINATES:
    "Longitude equals latitude (or its negation), e.g. (12, 12) or (12, -12) — a classic data-entry mix-up.",
  GBIF_HEADQUARTERS:
    "Within 1km of GBIF's Copenhagen office (12.58°E, 55.67°N) — a common default when the true locality wasn't recorded. Can false-positive on species genuinely observed in Copenhagen.",
  DUPLICATE:
    "An exact repeat of another record's coordinates for this species. Only the repeat is hidden — the first occurrence at that location stays visible.",
  NEAR_CAPITAL:
    "Within 10km of a country's political capital — a common geo-referencing default when the true locality was unknown. Can false-positive on species genuinely found in capital cities.",
  NEAR_CENTROID:
    "Within 1km of a country's geographic centroid — another common default, often from software that geocodes \"Country: X\" to the middle of the country when no precise locality was given.",
  NEAR_INSTITUTION:
    "Within 100m of a museum, herbarium, zoo, university, or similar biodiversity institution — often a captive/cultivated specimen or a record defaulted to the collecting institution's address rather than the true find location.",
};

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

function isNearAny(coord: CleanableCoordinate, points: readonly CleanableCoordinate[], bufferMeters: number): boolean {
  for (const p of points) {
    if (haversineMeters(coord, p) <= bufferMeters) return true;
  }
  return false;
}

/**
 * Port of cc_cap (geod=TRUE default): flags points within `bufferMeters` of any country's
 * political capital — a common geo-referencing default when the true locality is unknown.
 * Tests proximity to every capital in the reference list, not just the record's own
 * reported country (matches upstream's behavior).
 */
export function isNearCapital(coord: CleanableCoordinate, bufferMeters = 10000): boolean {
  return isNearAny(coord, capitals, bufferMeters);
}

/**
 * Port of cc_cen (geod=TRUE default, test="country" — see file header for why province
 * centroids are out of scope here): flags points within `bufferMeters` of any country's
 * geographic centroid.
 */
export function isNearCentroid(coord: CleanableCoordinate, bufferMeters = 1000): boolean {
  return isNearAny(coord, centroids, bufferMeters);
}

/**
 * Port of cc_inst (buffer in geodesic meters here — see file header for why, vs.
 * upstream's own confusing default): flags points within `bufferMeters` of a biodiversity
 * institution (museum, herbarium, zoo, university, etc.) from GBIF's GRSciColl registry.
 */
export function isNearInstitution(coord: CleanableCoordinate, bufferMeters = 100): boolean {
  return isNearAny(coord, institutions, bufferMeters);
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
 * Runs all checks over a single species' occurrence records and returns each record's
 * failed-check names, mirroring clean_coordinates()'s per-test flag columns. Callers
 * should pass all records for one species (cc_dupl's duplicate key includes species,
 * which is constant across a single /api/occurrences request).
 */
export function getQualityFlags<T extends CleanableCoordinate>(records: readonly T[]): QualityFlag[][] {
  const duplicateFlags = flagDuplicateCoordinates(records);
  return records.map((record, i) => {
    const flags: QualityFlag[] = [];
    if (isZeroCoordinate(record)) flags.push("ZERO_COORDINATE");
    if (isEqualLatLon(record)) flags.push("EQUAL_COORDINATES");
    if (isNearGbifHeadquarters(record)) flags.push("GBIF_HEADQUARTERS");
    if (duplicateFlags[i]) flags.push("DUPLICATE");
    if (isNearCapital(record)) flags.push("NEAR_CAPITAL");
    if (isNearCentroid(record)) flags.push("NEAR_CENTROID");
    if (isNearInstitution(record)) flags.push("NEAR_INSTITUTION");
    return flags;
  });
}
