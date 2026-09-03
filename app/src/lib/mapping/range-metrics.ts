/**
 * Extent of Occurrence and Area of Occupancy, as GeoCAT computes them.
 *
 * This is a deliberate like-for-like replication of the IUCN's own GeoCAT
 * (geocat.iucnredlist.org), so the numbers here can be checked against it
 * directly. That means copying its choices, including the ones that are
 * arguably wrong — they're marked below, and are the obvious things to improve
 * once the two agree:
 *
 *   - the AOO grid is fixed at the projection's origin and never minimised,
 *     where the Red List Guidelines §4.10.2 say that if different grid
 *     placements give different answers, the minimum should be reported.
 *     Grid placement alone moves AOO by up to 80% (Moat et al. 2018,
 *     Conservation Biology 32:1278).
 *   - the grid is laid out in a global cylindrical equal-area projection,
 *     which preserves area but not shape: at 60° latitude a "2 x 2 km" cell is
 *     about 1 km east-west by 4 km north-south on the ground.
 *
 * What this does NOT do, on purpose, is output a Red List category. Both
 * GeoCAT and rCAT invent a Near Threatened threshold that appears nowhere in
 * the criteria. Meeting a B1 or B2 threshold is not a listing: criterion B also
 * requires at least two of (a) severe fragmentation or few locations,
 * (b) continuing decline, (c) extreme fluctuations, none of which can be
 * derived from occurrence points.
 */

export interface MetricPoint {
  lon: number;
  lat: number;
}

/** GeoCAT areas come from the Google Maps geometry library, on this sphere. */
const EOO_EARTH_RADIUS_M = 6_378_137;
/** Its AOO projection uses a hair more, which is a GeoCAT quirk, kept. */
const AOO_EARTH_RADIUS_M = 6_378_137.79;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Convex hull by monotone chain, in lon/lat.
 *
 * Returned counter-clockwise and without the closing point. Fewer than three
 * distinct points have no hull — a line has no area — which is also why GeoCAT
 * refuses to analyse below three.
 */
export function convexHull(points: readonly MetricPoint[]): MetricPoint[] {
  const sorted = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const unique = sorted.filter(
    (p, i) => i === 0 || p.lon !== sorted[i - 1].lon || p.lat !== sorted[i - 1].lat
  );
  if (unique.length < 3) return unique;

  const cross = (o: MetricPoint, a: MetricPoint, b: MetricPoint) =>
    (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);

  const build = (input: MetricPoint[]) => {
    const chain: MetricPoint[] = [];
    for (const p of input) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };

  return [...build(unique), ...build([...unique].reverse())];
}

/**
 * Area of a polygon on the sphere, by spherical excess.
 *
 * The same algorithm as google.maps.geometry.spherical.computeArea, which is
 * what GeoCAT reports — so the numbers match rather than merely agree.
 */
export function sphericalAreaM2(ring: readonly MetricPoint[]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  const last = ring[ring.length - 1];
  let previousTan = Math.tan((Math.PI / 2 - toRad(last.lat)) / 2);
  let previousLng = toRad(last.lon);
  for (const point of ring) {
    const tan = Math.tan((Math.PI / 2 - toRad(point.lat)) / 2);
    const lng = toRad(point.lon);
    const deltaLng = previousLng - lng;
    const t = tan * previousTan;
    total += 2 * Math.atan2(t * Math.sin(deltaLng), 1 + t * Math.cos(deltaLng));
    previousTan = tan;
    previousLng = lng;
  }
  return Math.abs(total * EOO_EARTH_RADIUS_M * EOO_EARTH_RADIUS_M);
}

/**
 * Points shifted so a cloud straddling the antimeridian stays in one piece.
 *
 * Without it, records either side of 180° produce a hull wrapped the long way
 * round the planet — an EOO of half the Pacific. GeoCAT does the same thing;
 * this is the one place its heuristic is worth keeping verbatim.
 */
function unwrapAntimeridian(points: readonly MetricPoint[]): MetricPoint[] {
  if (points.length === 0) return [];
  let west = Infinity;
  let east = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  if (east - west <= 180) return [...points];
  return points.map((p) => (p.lon < 0 ? { ...p, lon: p.lon + 360 } : { ...p }));
}

export interface EooResult {
  areaKm2: number;
  /** The hull, closed, ready to draw. Null below three distinct points. */
  hull: GeoJSON.Polygon | null;
  pointCount: number;
}

/** Extent of occurrence: the minimum convex polygon around the records. */
export function computeEoo(points: readonly MetricPoint[]): EooResult {
  const unwrapped = unwrapAntimeridian(points);
  const hull = convexHull(unwrapped);
  if (hull.length < 3) return { areaKm2: 0, hull: null, pointCount: points.length };
  const ring = [...hull, hull[0]].map((p) => [p.lon, p.lat] as [number, number]);
  return {
    areaKm2: sphericalAreaM2(hull) / 1e6,
    hull: { type: "Polygon", coordinates: [ring] },
    pointCount: points.length,
  };
}

export interface AooResult {
  areaKm2: number;
  cellCount: number;
  cellSizeMetres: number;
  /** The occupied cells, for drawing. */
  cells: GeoJSON.Polygon[];
}

/**
 * Area of occupancy: occupied cells on a 2 x 2 km grid, times the cell area.
 *
 * The Guidelines are firm that 2 km is the scale to use — finer is not
 * permitted, and 3.2 km or coarser makes the CR threshold (AOO < 10 km²)
 * unreachable — so the size is a parameter only for comparison against GeoCAT,
 * which offers a box for it.
 */
export function computeAoo(points: readonly MetricPoint[], cellSizeMetres = 2000): AooResult {
  const cells = new Map<string, GeoJSON.Polygon>();
  for (const p of points) {
    // Global cylindrical equal-area, exactly as GeoCAT projects for the grid.
    const x = toRad(p.lon) * AOO_EARTH_RADIUS_M;
    const y = Math.sin(toRad(p.lat)) * AOO_EARTH_RADIUS_M;
    const i = Math.floor(x / cellSizeMetres);
    const j = Math.floor(y / cellSizeMetres);
    const key = `${i},${j}`;
    if (cells.has(key)) continue;
    const lonOf = (cellX: number) => toDeg(cellX / AOO_EARTH_RADIUS_M);
    const latOf = (cellY: number) => toDeg(Math.asin(Math.max(-1, Math.min(1, cellY / AOO_EARTH_RADIUS_M))));
    const west = lonOf(i * cellSizeMetres);
    const east = lonOf((i + 1) * cellSizeMetres);
    const south = latOf(j * cellSizeMetres);
    const north = latOf((j + 1) * cellSizeMetres);
    cells.set(key, {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    });
  }
  const cellAreaKm2 = (cellSizeMetres / 1000) ** 2;
  return {
    areaKm2: cells.size * cellAreaKm2,
    cellCount: cells.size,
    cellSizeMetres,
    cells: [...cells.values()],
  };
}

/** The categories criterion B's area thresholds can reach. Never a listing. */
export type CriterionBThreshold = "CR" | "EN" | "VU" | null;

/** B1 thresholds, IUCN Categories and Criteria v3.1. */
export function b1Threshold(eooKm2: number): CriterionBThreshold {
  if (eooKm2 < 100) return "CR";
  if (eooKm2 < 5_000) return "EN";
  if (eooKm2 < 20_000) return "VU";
  return null;
}

/** B2 thresholds, IUCN Categories and Criteria v3.1. */
export function b2Threshold(aooKm2: number): CriterionBThreshold {
  if (aooKm2 < 10) return "CR";
  if (aooKm2 < 500) return "EN";
  if (aooKm2 < 2_000) return "VU";
  return null;
}

/** Rounded the way an assessment would quote it. */
export function formatAreaKm2(km2: number): string {
  if (km2 === 0) return "0 km²";
  if (km2 < 10) return `${km2.toFixed(2)} km²`;
  if (km2 < 1000) return `${km2.toFixed(1)} km²`;
  return `${Math.round(km2).toLocaleString()} km²`;
}
