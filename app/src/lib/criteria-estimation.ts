/**
 * IUCN Criterion B parameter estimation from GBIF occurrence data.
 *
 * Computes:
 *   - EOO (Extent of Occurrence) — convex hull area
 *   - AOO (Area of Occupancy) — 2×2 km grid cell count
 *   - Number of locations — distance-based clustering
 *   - Temporal trends — EOO/AOO change over time
 *
 * All geographic computations use spherical approximations (WGS84
 * Earth radius) which are accurate for typical species ranges.
 * For species spanning >120° longitude, results should be treated
 * as rough approximations.
 *
 * Algorithms are implemented from scratch with no external dependencies.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface OccurrencePoint {
  lat: number;
  lng: number;
  year?: number;
  coordinateUncertainty?: number; // meters
  basisOfRecord?: string;
}

export interface EstimationParams {
  /** Minimum observation year to include. Default: 0 (all time). */
  minYear?: number;
  /** Maximum observation year to include. Default: current year. */
  maxYear?: number;
  /** Max coordinate uncertainty in meters. Default: 10000. */
  maxUncertaintyMeters?: number;
  /** Grid cell size for observation grid overlay in km. Default: 2 (IUCN standard). */
  gridSizeKm?: number;
  /** Distance threshold for location clustering in km. Default: 10. */
  clusterDistanceKm?: number;
  /** Remove outliers beyond this many km from centroid. 0 = off. Default: 0. */
  outlierDistanceKm?: number;
  /** Basis of record types to include. Default: all. */
  basisOfRecord?: string[];
  /**
   * Prevalence: estimated fraction of the base area (EOO or AOH) that the
   * species actually occupies (0–1). Used to estimate AOO as:
   *   AOO = baseArea × prevalence
   * Default: 1.0 (100% — assumes the species occupies its entire range).
   * Assessors should adjust downward based on expert knowledge.
   */
  prevalence?: number;
}

export interface EOOResult {
  /** Area of minimum convex polygon in km². */
  areaKm2: number;
  /** Vertices of the convex hull as [lat, lng] pairs. */
  hullVertices: [number, number][];
  /** Number of points used in computation (after filtering). */
  pointCount: number;
  /** Suggested IUCN category based on EOO thresholds, or null if above VU. */
  suggestedCategory: string | null;
}

export interface GridCellBounds {
  /** [southLat, westLng, northLat, eastLng] */
  bounds: [number, number, number, number];
  /** Number of occurrence points in this cell. */
  pointCount: number;
}

export interface AOOResult {
  /** AOO estimate in km² (= baseAreaKm2 × prevalence). */
  areaKm2: number;
  /**
   * The base area used for AOO estimation.
   * Currently EOO (convex hull area); in future, AOH (Area of Habitat)
   * will provide a tighter base by excluding unsuitable habitat.
   */
  baseAreaKm2: number;
  /** Source of the base area estimate. */
  baseAreaSource: "eoo" | "aoh";
  /**
   * Prevalence: estimated fraction of the base area actually occupied (0–1).
   * Defaults to 1.0 (100%). Assessors should adjust this based on expert
   * knowledge of the species' habitat use and distribution.
   */
  prevalence: number;
  /** Grid cell size used for observation overlay (km). */
  gridSizeKm: number;
  /** Number of grid cells containing GBIF observations (for reference, not used in AOO calculation). */
  observationCells: number;
  /** Center coordinates of each observation grid cell for map display. */
  cellCenters: [number, number][];
  /** Bounds of each observation grid cell for map rectangle display. */
  cellBounds: GridCellBounds[];
  /** Suggested IUCN category based on AOO thresholds, or null if above VU. */
  suggestedCategory: string | null;
}

export interface LocationCluster {
  centroid: [number, number];
  pointCount: number;
  /** Radius in km enclosing all points in this cluster. */
  radiusKm: number;
}

export interface LocationsResult {
  /** Estimated number of locations. */
  count: number;
  /** Cluster details for map display. */
  clusters: LocationCluster[];
  /** Distance threshold used for clustering (km). */
  clusterDistanceKm: number;
}

export interface TemporalTrend {
  earlierValue: number;
  laterValue: number;
  changePercent: number;
  earlierPeriod: string;
  laterPeriod: string;
}

export interface TemporalResult {
  eooTrend: TemporalTrend | null;
  aooTrend: TemporalTrend | null;
  locationsTrend: TemporalTrend | null;
  splitYear: number;
  earlierPointCount: number;
  laterPointCount: number;
}

export interface CriterionBAssessment {
  b1: {
    eooCategory: string | null;
    meetsThreshold: boolean;
  };
  b2: {
    aooCategory: string | null;
    meetsThreshold: boolean;
  };
  subcriteria: {
    /** (a) Number of locations qualifies. */
    a: boolean;
    /** (b)(i) Continuing decline in EOO. */
    bi: boolean;
    /** (b)(ii) Continuing decline in AOO. */
    bii: boolean;
    /** (b)(iii-v) Cannot estimate from occurrence data alone. */
  };
  /** Most severe category if B1 or B2 threshold met AND ≥2 subcriteria. */
  overallCategory: string | null;
}

export interface CriteriaEstimationResult {
  eoo: EOOResult;
  aoo: AOOResult;
  locations: LocationsResult;
  temporal: TemporalResult;
  criterionB: CriterionBAssessment;
  /** Filtered occurrence points used in the estimation (for map rendering). */
  filteredPoints: OccurrencePoint[];
  meta: {
    totalPoints: number;
    usedPoints: number;
    filteredOut: {
      uncertainty: number;
      year: number;
      basisOfRecord: number;
      outlier: number;
      duplicate: number;
    };
    params: Required<EstimationParams>;
  };
}

// ── IUCN Criterion B thresholds ──────────────────────────────────────────

export const EOO_THRESHOLDS = {
  CR: 100,
  EN: 5_000,
  VU: 20_000,
} as const;

export const AOO_THRESHOLDS = {
  CR: 10,
  EN: 500,
  VU: 2_000,
} as const;

export const LOCATION_THRESHOLDS = {
  CR: 1,
  EN: 5,
  VU: 10,
} as const;

// ── Constants ────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 111.32;

/** Minimum points required for a convex hull (and thus EOO). */
const MIN_HULL_POINTS = 3;

/** Minimum points in each temporal half for trend analysis. */
const MIN_TEMPORAL_POINTS = 10;

// ── Default parameters ───────────────────────────────────────────────────

const DEFAULT_PARAMS: Required<EstimationParams> = {
  minYear: 0,
  maxYear: new Date().getFullYear(),
  maxUncertaintyMeters: 10_000,
  gridSizeKm: 2,
  clusterDistanceKm: 10,
  outlierDistanceKm: 0,
  basisOfRecord: [],
  prevalence: 1.0,
};

// ── Haversine distance ───────────────────────────────────────────────────

/** Great-circle distance between two points in km. */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// ── Convex hull (Andrew's monotone chain) ────────────────────────────────

/**
 * Compute the convex hull of a set of 2D points.
 * Uses Andrew's monotone chain algorithm — O(n log n).
 * Returns hull vertices in counterclockwise order.
 */
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < MIN_HULL_POINTS) return [...points];

  // Sort by x (lng), then by y (lat)
  const sorted = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  // Remove exact duplicates
  const unique: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] !== sorted[i - 1][0] || sorted[i][1] !== sorted[i - 1][1]) {
      unique.push(sorted[i]);
    }
  }
  if (unique.length < MIN_HULL_POINTS) return unique;

  const cross = (O: [number, number], A: [number, number], B: [number, number]) =>
    (A[1] - O[1]) * (B[0] - O[0]) - (A[0] - O[0]) * (B[1] - O[1]);

  // Build lower hull
  const lower: [number, number][] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Build upper hull
  const upper: [number, number][] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// ── Spherical polygon area ───────────────────────────────────────────────

/**
 * Compute the area of a polygon on a sphere using the trapezoidal
 * integration formula. Vertices are [lat, lng] in degrees.
 *
 * Accurate for polygons not spanning >120° longitude. For larger
 * polygons, results are approximate.
 *
 * Returns area in km².
 */
export function sphericalPolygonArea(vertices: [number, number][]): number {
  if (vertices.length < MIN_HULL_POINTS) return 0;

  const n = vertices.length;
  let sum = 0;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lng1 = vertices[j][1] * DEG_TO_RAD;
    const lat1 = vertices[j][0] * DEG_TO_RAD;
    const lng2 = vertices[i][1] * DEG_TO_RAD;
    const lat2 = vertices[i][0] * DEG_TO_RAD;
    sum += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs(sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2);
}

// ── EOO computation ──────────────────────────────────────────────────────

/**
 * Compute Extent of Occurrence (EOO) as the area of the minimum
 * convex polygon enclosing all occurrence points.
 */
export function computeEOO(points: [number, number][]): EOOResult {
  if (points.length < MIN_HULL_POINTS) {
    return {
      areaKm2: 0,
      hullVertices: points.length > 0 ? [...points] : [],
      pointCount: points.length,
      suggestedCategory: points.length > 0 ? "CR" : null,
    };
  }

  const hull = convexHull(points);
  const areaKm2 = sphericalPolygonArea(hull);
  const suggestedCategory = categorizeByThreshold(areaKm2, EOO_THRESHOLDS);

  return {
    areaKm2: Math.round(areaKm2 * 100) / 100,
    hullVertices: hull,
    pointCount: points.length,
    suggestedCategory,
  };
}

// ── GBIF observation grid ────────────────────────────────────────────────

/**
 * Overlay a grid on GBIF occurrence points and count cells with observations.
 * Returns grid cell details for map visualization.
 *
 * **This is NOT an AOO calculation.** It only shows where GBIF records exist.
 * AOO is estimated separately using EOO × prevalence (or AOH × prevalence
 * in future). The grid cells are displayed on the map as context for the
 * assessor.
 */
export function computeObservationGrid(
  points: [number, number][],
  gridSizeKm: number = 2,
): { observationCells: number; cellCenters: [number, number][]; cellBounds: GridCellBounds[] } {
  if (points.length === 0) {
    return { observationCells: 0, cellCenters: [], cellBounds: [] };
  }

  const cellSizeLat = gridSizeKm / KM_PER_DEG_LAT;
  const occupiedSet = new Set<string>();
  const cellCenterMap = new Map<string, [number, number]>();
  const cellBoundsMap = new Map<string, { bounds: [number, number, number, number]; count: number }>();

  for (const [lat, lng] of points) {
    const cellSizeLng = cellSizeLat / Math.max(Math.cos(lat * DEG_TO_RAD), 0.01);

    const cellY = Math.floor(lat / cellSizeLat);
    const cellX = Math.floor(lng / cellSizeLng);
    const key = `${cellX},${cellY}`;

    if (!occupiedSet.has(key)) {
      occupiedSet.add(key);
      cellCenterMap.set(key, [
        (cellY + 0.5) * cellSizeLat,
        (cellX + 0.5) * cellSizeLng,
      ]);
      cellBoundsMap.set(key, {
        bounds: [
          cellY * cellSizeLat,
          cellX * cellSizeLng,
          (cellY + 1) * cellSizeLat,
          (cellX + 1) * cellSizeLng,
        ],
        count: 1,
      });
    } else {
      const entry = cellBoundsMap.get(key)!;
      entry.count++;
    }
  }

  return {
    observationCells: occupiedSet.size,
    cellCenters: Array.from(cellCenterMap.values()),
    cellBounds: Array.from(cellBoundsMap.values()).map((v) => ({
      bounds: v.bounds,
      pointCount: v.count,
    })),
  };
}

// ── Location clustering ──────────────────────────────────────────────────

/**
 * Estimate the number of locations using single-linkage clustering.
 *
 * Two points are in the same cluster if they are within
 * `clusterDistanceKm` of each other (transitively). This
 * approximates IUCN's "location" concept — geographically distinct
 * areas where a single threat could affect all individuals.
 *
 * Uses union-find for efficient clustering.
 */
export function computeLocations(
  points: [number, number][],
  clusterDistanceKm: number = 10,
): LocationsResult {
  if (points.length === 0) {
    return { count: 0, clusters: [], clusterDistanceKm };
  }
  if (points.length === 1) {
    return {
      count: 1,
      clusters: [{ centroid: points[0], pointCount: 1, radiusKm: 0 }],
      clusterDistanceKm,
    };
  }

  // Union-Find
  const parent = points.map((_, i) => i);
  const rank = new Array(points.length).fill(0);

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else { parent[rb] = ra; rank[ra]++; }
  }

  // Merge points within clustering distance
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (find(i) === find(j)) continue; // Already in same cluster
      const dist = haversineDistance(points[i][0], points[i][1], points[j][0], points[j][1]);
      if (dist <= clusterDistanceKm) {
        union(i, j);
      }
    }
  }

  // Group points by cluster
  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const root = find(i);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(i);
  }

  // Compute cluster centroids and radii
  const clusters: LocationCluster[] = [];
  for (const indices of clusterMap.values()) {
    let sumLat = 0, sumLng = 0;
    for (const idx of indices) {
      sumLat += points[idx][0];
      sumLng += points[idx][1];
    }
    const centroid: [number, number] = [
      sumLat / indices.length,
      sumLng / indices.length,
    ];

    let maxDist = 0;
    for (const idx of indices) {
      const dist = haversineDistance(centroid[0], centroid[1], points[idx][0], points[idx][1]);
      if (dist > maxDist) maxDist = dist;
    }

    clusters.push({
      centroid,
      pointCount: indices.length,
      radiusKm: Math.round(maxDist * 100) / 100,
    });
  }

  // Sort clusters by size (largest first)
  clusters.sort((a, b) => b.pointCount - a.pointCount);

  return {
    count: clusters.length,
    clusters,
    clusterDistanceKm,
  };
}

// ── Temporal trends ──────────────────────────────────────────────────────

/**
 * Compute temporal trends in EOO and AOO by splitting occurrences
 * into earlier and later periods around a split year.
 *
 * If no split year is provided, uses the median year of all points.
 */
export function computeTemporalTrends(
  points: OccurrencePoint[],
  gridSizeKm: number = 2,
  clusterDistanceKm: number = 10,
  splitYear?: number,
): TemporalResult {
  const withYear = points.filter((p) => p.year != null);

  if (withYear.length < MIN_TEMPORAL_POINTS * 2) {
    return {
      eooTrend: null,
      aooTrend: null,
      locationsTrend: null,
      splitYear: 0,
      earlierPointCount: 0,
      laterPointCount: 0,
    };
  }

  // Determine split year (default: median)
  const years = withYear.map((p) => p.year!).sort((a, b) => a - b);
  const actualSplitYear = splitYear ?? years[Math.floor(years.length / 2)];

  const earlierPoints: [number, number][] = [];
  const laterPoints: [number, number][] = [];
  for (const p of withYear) {
    const coord: [number, number] = [p.lat, p.lng];
    if (p.year! < actualSplitYear) earlierPoints.push(coord);
    else laterPoints.push(coord);
  }

  if (earlierPoints.length < MIN_TEMPORAL_POINTS || laterPoints.length < MIN_TEMPORAL_POINTS) {
    return {
      eooTrend: null,
      aooTrend: null,
      locationsTrend: null,
      splitYear: actualSplitYear,
      earlierPointCount: earlierPoints.length,
      laterPointCount: laterPoints.length,
    };
  }

  const minYear = years[0];
  const maxYear = years[years.length - 1];

  // EOO trend
  const earlierEOO = computeEOO(earlierPoints);
  const laterEOO = computeEOO(laterPoints);
  const eooTrend: TemporalTrend | null = earlierEOO.areaKm2 > 0 ? {
    earlierValue: earlierEOO.areaKm2,
    laterValue: laterEOO.areaKm2,
    changePercent: Math.round(((laterEOO.areaKm2 - earlierEOO.areaKm2) / earlierEOO.areaKm2) * 100),
    earlierPeriod: `${minYear}–${actualSplitYear - 1}`,
    laterPeriod: `${actualSplitYear}–${maxYear}`,
  } : null;

  // AOO trend (derived from EOO trend — AOO = EOO × prevalence, so % change tracks EOO)
  const aooTrend: TemporalTrend | null = earlierEOO.areaKm2 > 0 ? {
    earlierValue: earlierEOO.areaKm2,
    laterValue: laterEOO.areaKm2,
    changePercent: Math.round(((laterEOO.areaKm2 - earlierEOO.areaKm2) / earlierEOO.areaKm2) * 100),
    earlierPeriod: `${minYear}–${actualSplitYear - 1}`,
    laterPeriod: `${actualSplitYear}–${maxYear}`,
  } : null;

  // Locations trend
  const earlierLocs = computeLocations(earlierPoints, clusterDistanceKm);
  const laterLocs = computeLocations(laterPoints, clusterDistanceKm);
  const locationsTrend: TemporalTrend | null = earlierLocs.count > 0 ? {
    earlierValue: earlierLocs.count,
    laterValue: laterLocs.count,
    changePercent: Math.round(((laterLocs.count - earlierLocs.count) / earlierLocs.count) * 100),
    earlierPeriod: `${minYear}–${actualSplitYear - 1}`,
    laterPeriod: `${actualSplitYear}–${maxYear}`,
  } : null;

  return {
    eooTrend,
    aooTrend,
    locationsTrend,
    splitYear: actualSplitYear,
    earlierPointCount: earlierPoints.length,
    laterPointCount: laterPoints.length,
  };
}

// ── Criterion B assessment ───────────────────────────────────────────────

/**
 * Assess IUCN Criterion B from computed metrics.
 *
 * Criterion B requires BOTH:
 *   1. EOO < threshold (B1) or AOO < threshold (B2)
 *   2. At least 2 of 3 subcriteria: (a) few locations, (b) decline, (c) fluctuations
 *
 * We can estimate (a) from location count and (b)(i-ii) from temporal trends.
 * Subcriteria (b)(iii-v) and (c) require data beyond GBIF occurrences.
 */
export function assessCriterionB(
  eoo: EOOResult,
  aoo: AOOResult,
  locations: LocationsResult,
  temporal: TemporalResult,
): CriterionBAssessment {
  const b1Category = eoo.suggestedCategory;
  const b2Category = aoo.suggestedCategory;

  // Subcriteria
  const locationCategory = categorizeByThreshold(
    locations.count,
    LOCATION_THRESHOLDS,
  );
  const subA = locationCategory !== null; // Locations below a threshold

  // Decline subcriteria: flag if the value decreased
  const subBi = temporal.eooTrend !== null && temporal.eooTrend.changePercent < -10;
  const subBii = temporal.aooTrend !== null && temporal.aooTrend.changePercent < -10;

  const subcriteriaCount = [subA, subBi, subBii].filter(Boolean).length;

  // Overall: need B1 or B2 threshold met AND at least 2 subcriteria
  let overallCategory: string | null = null;
  if (subcriteriaCount >= 2) {
    // Take the most severe category from B1/B2
    const candidates = [b1Category, b2Category].filter(Boolean) as string[];
    const order = ["CR", "EN", "VU"];
    for (const cat of order) {
      if (candidates.includes(cat)) {
        overallCategory = cat;
        break;
      }
    }
  }

  return {
    b1: { eooCategory: b1Category, meetsThreshold: b1Category !== null },
    b2: { aooCategory: b2Category, meetsThreshold: b2Category !== null },
    subcriteria: { a: subA, bi: subBi, bii: subBii },
    overallCategory,
  };
}

// ── Point filtering ──────────────────────────────────────────────────────

/**
 * Filter occurrence points based on assessor-configurable parameters.
 * Returns filtered points and counts of what was excluded.
 */
export function filterPoints(
  points: OccurrencePoint[],
  params: Required<EstimationParams>,
): {
  filtered: OccurrencePoint[];
  filteredOut: CriteriaEstimationResult["meta"]["filteredOut"];
} {
  let uncertainty = 0, year = 0, basisOfRecord = 0, outlier = 0, duplicate = 0;

  // Step 1: Apply basic filters
  let filtered = points.filter((p) => {
    if (params.maxUncertaintyMeters > 0 && p.coordinateUncertainty != null &&
        p.coordinateUncertainty > params.maxUncertaintyMeters) {
      uncertainty++;
      return false;
    }
    if (params.minYear > 0 && p.year != null && p.year < params.minYear) {
      year++;
      return false;
    }
    if (params.maxYear > 0 && p.year != null && p.year > params.maxYear) {
      year++;
      return false;
    }
    if (params.basisOfRecord.length > 0 && p.basisOfRecord &&
        !params.basisOfRecord.includes(p.basisOfRecord)) {
      basisOfRecord++;
      return false;
    }
    return true;
  });

  // Step 2: Remove duplicate coordinates (same grid cell at ~100m resolution)
  const seen = new Set<string>();
  const deduped: OccurrencePoint[] = [];
  for (const p of filtered) {
    // Round to ~100m precision for deduplication
    const key = `${Math.round(p.lat * 1000)},${Math.round(p.lng * 1000)}`;
    if (seen.has(key)) {
      duplicate++;
      continue;
    }
    seen.add(key);
    deduped.push(p);
  }
  filtered = deduped;

  // Step 3: Outlier removal (optional, uses spatial median for robustness)
  if (params.outlierDistanceKm > 0 && filtered.length > 3) {
    // Spatial median is robust to outliers (unlike mean, which gets pulled)
    const sortedLats = filtered.map((p) => p.lat).sort((a, b) => a - b);
    const sortedLngs = filtered.map((p) => p.lng).sort((a, b) => a - b);
    const medianLat = sortedLats[Math.floor(sortedLats.length / 2)];
    const medianLng = sortedLngs[Math.floor(sortedLngs.length / 2)];

    const beforeOutlier = filtered.length;
    filtered = filtered.filter((p) => {
      const dist = haversineDistance(medianLat, medianLng, p.lat, p.lng);
      return dist <= params.outlierDistanceKm;
    });
    outlier = beforeOutlier - filtered.length;
  }

  return {
    filtered,
    filteredOut: { uncertainty, year, basisOfRecord, outlier, duplicate },
  };
}

// ── Main entry point ─────────────────────────────────────────────────────

/**
 * Run full criteria estimation on a set of occurrence points.
 * Applies configurable filters, computes all metrics, and
 * assesses Criterion B with IUCN thresholds.
 */
export function estimateCriteria(
  points: OccurrencePoint[],
  params: Partial<EstimationParams> = {},
): CriteriaEstimationResult {
  const fullParams: Required<EstimationParams> = { ...DEFAULT_PARAMS, ...params };

  // Filter points
  const { filtered, filteredOut } = filterPoints(points, fullParams);

  // Extract [lat, lng] pairs for geometric computations
  const coords: [number, number][] = filtered.map((p) => [p.lat, p.lng]);

  // Compute all metrics
  const eoo = computeEOO(coords);
  const grid = computeObservationGrid(coords, fullParams.gridSizeKm);
  const locations = computeLocations(coords, fullParams.clusterDistanceKm);
  const temporal = computeTemporalTrends(
    filtered,
    fullParams.gridSizeKm,
    fullParams.clusterDistanceKm,
  );

  // AOO = EOO × prevalence (in future: AOH × prevalence)
  const prevalence = Math.max(0, Math.min(1, fullParams.prevalence));
  const aooAreaKm2 = Math.round(eoo.areaKm2 * prevalence * 100) / 100;
  const aoo: AOOResult = {
    areaKm2: aooAreaKm2,
    baseAreaKm2: eoo.areaKm2,
    baseAreaSource: "eoo",
    prevalence,
    gridSizeKm: fullParams.gridSizeKm,
    observationCells: grid.observationCells,
    cellCenters: grid.cellCenters,
    cellBounds: grid.cellBounds,
    suggestedCategory: categorizeByThreshold(aooAreaKm2, AOO_THRESHOLDS),
  };

  const criterionB = assessCriterionB(eoo, aoo, locations, temporal);

  return {
    eoo,
    aoo,
    locations,
    temporal,
    criterionB,
    filteredPoints: filtered,
    meta: {
      totalPoints: points.length,
      usedPoints: filtered.length,
      filteredOut,
      params: fullParams,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Map a value to the most severe IUCN category it falls below. */
function categorizeByThreshold(
  value: number,
  thresholds: { CR: number; EN: number; VU: number },
): string | null {
  if (value <= thresholds.CR) return "CR";
  if (value <= thresholds.EN) return "EN";
  if (value <= thresholds.VU) return "VU";
  return null;
}
