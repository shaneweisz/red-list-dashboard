/**
 * TypeScript port of a subset of R's CoordinateCleaner package
 * (Zizka et al. 2019, https://github.com/ropensci/CoordinateCleaner), reimplemented
 * from the published algorithms and roxygen examples rather than transcribed from the
 * GPL-3 source. Flags GBIF geo-referencing artifacts that GBIF's own `issues` array
 * doesn't catch.
 *
 * Each function mirrors one upstream `cc_*` test at its documented default threshold:
 * - isZeroCoordinate  -> cc_zero  (buffer = 0.5 decimal degrees)
 * - isEqualLatLon     -> cc_equ   (test = "absolute", the package default)
 * - isNearGbifHeadquarters -> cc_gbif (buffer = 1000m geodesic, geod = TRUE)
 * - flagDuplicateCoordinates -> cc_dupl (species + lon/lat key, no extra columns)
 * - isNearCapital     -> cc_cap  (buffer = 10000m geodesic, geod = TRUE)
 * - isNearCentroid    -> cc_cen  (buffer = 1000m geodesic, geod = TRUE, test = "country" only —
 *                                 upstream default also tests province centroids, skipped here;
 *                                 no independently-sourced province-centroid dataset was worth
 *                                 the added complexity)
 * - isNearInstitution -> cc_inst (buffer = 100m geodesic — upstream's own standalone default is
 *                                 geod=FALSE with the buffer in decimal degrees, which is a
 *                                 confusing/inconsistent default relative to the rest of the
 *                                 package; using geodesic meters here for consistency with
 *                                 every other check in this file)
 * - isInOcean         -> cc_sea  (point-in-polygon against Natural Earth land polygons; flagged
 *                                 when the point falls outside every land polygon)
 * - isInUrbanArea     -> cc_urb  (point-in-polygon against Natural Earth urban-area polygons)
 * - isNearArtificialHotspot -> cc_aohi (buffer = 10000m geodesic, geod = TRUE, taxa = all four —
 *                                 matches upstream's own defaults; see coordinate-cleaning-refdata/README.md
 *                                 for why this one's reference data comes straight from the AHOI
 *                                 authors' own CC0 deposit rather than CoordinateCleaner's bundled copy)
 * - isOutsideReportedCountry -> cc_coun (no buffer — matches upstream's own default, both standalone
 *                                 and via clean_coordinates(); point-in-polygon against the specific
 *                                 country named in the record's own countryCode field, not "any
 *                                 country" like cc_cap/cc_cen/cc_inst/cc_aohi test)
 *
 * None of the checks below implement upstream's optional `verify` step (re-checking whether a
 * flagged point is the *only* record for that species nearby, which would unflag it) — matches
 * the precedent set for cc_gbif in phase 1: skip it, keep the check as a simple proximity test.
 *
 * Reference data (src/lib/coordinate-cleaning-refdata/) is sourced independently of
 * CoordinateCleaner's own bundled GPL-3 tables — see that directory's README for
 * provenance.
 */

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import capitals from "./coordinate-cleaning-refdata/capitals.json";
import centroids from "./coordinate-cleaning-refdata/centroids.json";
import institutions from "./coordinate-cleaning-refdata/institutions.json";
import landPolygons from "./coordinate-cleaning-refdata/land-polygons.json";
import urbanAreas from "./coordinate-cleaning-refdata/urban-areas.json";
import artificialHotspots from "./coordinate-cleaning-refdata/aohi.json";
import countryPolygons from "./coordinate-cleaning-refdata/countries.json";

const EARTH_RADIUS_METERS = 6371000;

const GBIF_HQ = { lon: 12.58, lat: 55.67 };

export type QualityFlag =
  | "ZERO_COORDINATE"
  | "EQUAL_COORDINATES"
  | "GBIF_HEADQUARTERS"
  | "DUPLICATE"
  | "NEAR_CAPITAL"
  | "NEAR_CENTROID"
  | "NEAR_INSTITUTION"
  | "OCEAN"
  | "URBAN_AREA"
  | "ARTIFICIAL_HOTSPOT"
  | "OUTSIDE_REPORTED_COUNTRY";

export interface CleanableCoordinate {
  lon: number;
  lat: number;
  // ISO 3166-1 alpha-2 country code reported for this specific record (GBIF's own
  // `countryCode` field), used only by isOutsideReportedCountry. Optional — records
  // without one simply can't be checked by that test.
  countryCode?: string;
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
  OCEAN: "In the ocean",
  URBAN_AREA: "Inside an urban area",
  ARTIFICIAL_HOTSPOT: "Known artificial coordinate hotspot",
  OUTSIDE_REPORTED_COUNTRY: "Outside its reported country",
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
  OCEAN:
    "Falls in the ocean, outside every Natural Earth land polygon — often a GPS sign error or a marine coordinate wrongly applied to a terrestrial species, though correct for genuinely marine/coastal species.",
  URBAN_AREA:
    "Falls within a Natural Earth-mapped urban area — often a specimen defaulted to a city/town address rather than the true find location, though correct for genuinely urban-adapted or captive species.",
  ARTIFICIAL_HOTSPOT:
    "Within 10km of a coordinate independently confirmed by Park et al. (2023) as an artificial aggregation point — grid/geopolitical centroids and similar recurring defaults that accumulated thousands of unrelated records, not real observation sites.",
  OUTSIDE_REPORTED_COUNTRY:
    "Falls outside the political borders of the country GBIF reports for this specific record — often a sign of a longitude/latitude swap or a sign error. Independent of, and can catch cases missed by, GBIF's own COUNTRY_COORDINATE_MISMATCH issue flag. Records with no reported country can't be checked and are never flagged.",
};

// External source for each check's reference data — only present where the check actually
// draws on an independently-sourced dataset (not for the four self-contained/algorithmic
// checks: ZERO_COORDINATE, EQUAL_COORDINATES, GBIF_HEADQUARTERS, DUPLICATE). Shown as a
// linked info icon next to the check in the coordinate-cleaning filter.
export const QUALITY_FLAG_SOURCES: Partial<Record<QualityFlag, { label: string; url: string }>> = {
  NEAR_CAPITAL: {
    label: "Natural Earth 1:50m populated places",
    url: "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-populated-places/",
  },
  NEAR_CENTROID: {
    label: "mledoze/countries",
    url: "https://github.com/mledoze/countries",
  },
  NEAR_INSTITUTION: {
    label: "GBIF GRSciColl registry",
    url: "https://www.gbif.org/grscicoll",
  },
  OCEAN: {
    label: "Natural Earth 1:50m land",
    url: "https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/",
  },
  URBAN_AREA: {
    label: "Natural Earth 1:50m urban areas",
    url: "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-urban-areas/",
  },
  ARTIFICIAL_HOTSPOT: {
    label: "Park et al. (2023) AHOI dataset",
    url: "https://zenodo.org/records/7268229",
  },
  OUTSIDE_REPORTED_COUNTRY: {
    label: "Natural Earth 1:50m admin-0 countries",
    url: "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries/",
  },
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

interface RawPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

interface IndexedPolygon {
  polygon: RawPolygon;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
}

function indexPolygons(polygons: readonly RawPolygon[]): IndexedPolygon[] {
  return polygons.map((polygon) => {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const ring of polygon.coordinates) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    return { polygon, bbox: [minLon, minLat, maxLon, maxLat] };
  });
}

// Precomputed once at module load — a cheap bounding-box pre-filter avoids running the exact
// (and much more expensive) point-in-polygon test against every polygon on every record.
const indexedLandPolygons = indexPolygons(landPolygons as RawPolygon[]);
const indexedUrbanAreas = indexPolygons(urbanAreas as RawPolygon[]);

interface CountryPolygon {
  iso_a2: string;
  polygon: RawPolygon;
}

// Countries with disjoint territory (islands, exclaves) contribute multiple polygon parts
// under the same iso_a2 — grouped here so isOutsideReportedCountry can test "is this point
// inside ANY part of the specific reported country" without scanning every country's polygons.
const indexedCountryPolygons = new Map<string, IndexedPolygon[]>();
for (const { iso_a2, polygon } of countryPolygons as CountryPolygon[]) {
  const indexed = indexPolygons([polygon])[0];
  const existing = indexedCountryPolygons.get(iso_a2);
  if (existing) existing.push(indexed);
  else indexedCountryPolygons.set(iso_a2, [indexed]);
}

function isInsideAny(coord: CleanableCoordinate, indexed: readonly IndexedPolygon[]): boolean {
  for (const { polygon, bbox } of indexed) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (coord.lon < minLon || coord.lon > maxLon || coord.lat < minLat || coord.lat > maxLat) continue;
    if (booleanPointInPolygon([coord.lon, coord.lat], polygon)) return true;
  }
  return false;
}

/**
 * Port of cc_sea: flags points that fall outside every Natural Earth land polygon, i.e. in
 * the ocean. Land polygons are 50m-scale — upgraded from Natural Earth's coarsest 110m
 * scale after a real GBIF record (a coastal-dwelling frog species) showed 110m was too
 * coarse: several genuinely-offshore points went undetected because the 110m coastline was
 * simplified several km out to sea at that location. 50m still won't resolve every small
 * island or narrow inlet, but is a meaningfully better trade-off for coastal species.
 */
export function isInOcean(coord: CleanableCoordinate): boolean {
  return !isInsideAny(coord, indexedLandPolygons);
}

/** Port of cc_urb: flags points inside a Natural Earth 50m-scale urban-area polygon. */
export function isInUrbanArea(coord: CleanableCoordinate): boolean {
  return isInsideAny(coord, indexedUrbanAreas);
}

/**
 * Port of cc_aohi (geod=TRUE default, taxa=all four): flags points within `bufferMeters` of
 * a coordinate in the Artificial Hotspot Occurrence Inventory (Park et al. 2023) — recurring
 * coordinates independently confirmed (determination="FALSE" in the source dataset, i.e. NOT
 * a genuine observation site) as geopolitical/grid centroids or similar geo-referencing
 * defaults that accumulated large numbers of unrelated records across birds, insects,
 * mammals, and plants.
 */
export function isNearArtificialHotspot(coord: CleanableCoordinate, bufferMeters = 10000): boolean {
  return isNearAny(coord, artificialHotspots, bufferMeters);
}

/**
 * Port of cc_coun (buffer=NULL, the package default — no tolerance around the border):
 * flags points falling outside the specific country reported for this record (matched
 * on ISO 3166-1 alpha-2 `countryCode`, e.g. GBIF's own field of that name), rather than
 * near any country like the other gazetteer checks in this file. Records with no
 * reported country, or one this reference data has no polygon for, aren't flagged —
 * there's nothing to contradict, and flagging on our own data gaps would be a false
 * positive, not a finding. Complements rather than replaces GBIF's own
 * COUNTRY_COORDINATE_MISMATCH issue flag (already excluded upstream of this check via
 * hasGeospatialIssue=false), which doesn't catch every mismatch.
 */
export function isOutsideReportedCountry(coord: CleanableCoordinate): boolean {
  if (!coord.countryCode) return false;
  const parts = indexedCountryPolygons.get(coord.countryCode.toUpperCase());
  if (!parts || parts.length === 0) return false;
  return !isInsideAny(coord, parts);
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
    if (isInOcean(record)) flags.push("OCEAN");
    if (isInUrbanArea(record)) flags.push("URBAN_AREA");
    if (isNearArtificialHotspot(record)) flags.push("ARTIFICIAL_HOTSPOT");
    if (isOutsideReportedCountry(record)) flags.push("OUTSIDE_REPORTED_COUNTRY");
    return flags;
  });
}
