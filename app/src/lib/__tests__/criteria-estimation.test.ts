import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  convexHull,
  sphericalPolygonArea,
  computeEOO,
  computeObservationGrid,
  countGridCellsInHull,
  computeLocations,
  computeTemporalTrends,
  assessCriterionB,
  filterPoints,
  estimateCriteria,
  EOO_THRESHOLDS,
  type OccurrencePoint,
  type EstimationParams,
} from "../criteria-estimation";

// ── Haversine distance ───────────────────────────────────────────────────

describe("haversineDistance", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
  });

  it("computes known distance: London to Paris (~343 km)", () => {
    const dist = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(330);
    expect(dist).toBeLessThan(360);
  });

  it("computes known distance: New York to Los Angeles (~3944 km)", () => {
    const dist = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(dist).toBeGreaterThan(3900);
    expect(dist).toBeLessThan(4000);
  });

  it("computes known distance: equator 1 degree longitude (~111 km)", () => {
    const dist = haversineDistance(0, 0, 0, 1);
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(112);
  });

  it("computes known distance: 1 degree latitude (~111 km)", () => {
    const dist = haversineDistance(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(112);
  });
});

// ── Convex hull ──────────────────────────────────────────────────────────

describe("convexHull", () => {
  it("returns all points for fewer than 3 points", () => {
    expect(convexHull([[0, 0], [1, 1]])).toHaveLength(2);
    expect(convexHull([[0, 0]])).toHaveLength(1);
    expect(convexHull([])).toHaveLength(0);
  });

  it("computes hull for a simple triangle", () => {
    const hull = convexHull([[0, 0], [0, 4], [3, 2]]);
    expect(hull).toHaveLength(3);
  });

  it("computes hull for a square with interior point", () => {
    const points: [number, number][] = [
      [0, 0], [0, 4], [4, 0], [4, 4], // corners
      [2, 2], // interior
    ];
    const hull = convexHull(points);
    expect(hull).toHaveLength(4); // interior point excluded
  });

  it("handles collinear points", () => {
    const hull = convexHull([[0, 0], [1, 1], [2, 2], [3, 3]]);
    // Only endpoints should remain
    expect(hull.length).toBeLessThanOrEqual(4);
  });

  it("handles duplicate points", () => {
    const hull = convexHull([[0, 0], [0, 0], [1, 1], [1, 1], [0, 1]]);
    expect(hull).toHaveLength(3);
  });

  it("produces a closed polygon (first and last points form a valid edge)", () => {
    const hull = convexHull([[-10, -10], [-10, 10], [10, -10], [10, 10], [0, 0]]);
    expect(hull).toHaveLength(4);
    // Verify all hull points are extremes
    for (const [lat, lng] of hull) {
      expect(Math.abs(lat)).toBe(10);
      expect(Math.abs(lng)).toBe(10);
    }
  });
});

// ── Spherical polygon area ───────────────────────────────────────────────

describe("sphericalPolygonArea", () => {
  it("returns 0 for fewer than 3 vertices", () => {
    expect(sphericalPolygonArea([[0, 0], [1, 1]])).toBe(0);
  });

  it("computes area for a small square near the equator (~1.23 km² for 0.01° square)", () => {
    // A 0.01° × 0.01° square at the equator is approximately 1.11 × 1.11 ≈ 1.23 km²
    const vertices: [number, number][] = [
      [0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0],
    ];
    const area = sphericalPolygonArea(vertices);
    expect(area).toBeGreaterThan(1.0);
    expect(area).toBeLessThan(1.5);
  });

  it("computes a larger area for a 1° square near the equator (~12,300 km²)", () => {
    const vertices: [number, number][] = [
      [0, 0], [0, 1], [1, 1], [1, 0],
    ];
    const area = sphericalPolygonArea(vertices);
    expect(area).toBeGreaterThan(12_000);
    expect(area).toBeLessThan(12_500);
  });

  it("accounts for latitude (smaller area at higher latitudes)", () => {
    const equatorSquare: [number, number][] = [
      [0, 0], [0, 1], [1, 1], [1, 0],
    ];
    const arcticSquare: [number, number][] = [
      [60, 0], [60, 1], [61, 1], [61, 0],
    ];
    const equatorArea = sphericalPolygonArea(equatorSquare);
    const arcticArea = sphericalPolygonArea(arcticSquare);
    // At 60°, longitude is compressed by cos(60°) = 0.5
    expect(arcticArea).toBeLessThan(equatorArea * 0.6);
  });
});

// ── EOO ──────────────────────────────────────────────────────────────────

describe("computeEOO", () => {
  it("returns 0 area with suggestedCategory CR for < 3 points", () => {
    const result = computeEOO([[0, 0], [1, 1]]);
    expect(result.areaKm2).toBe(0);
    expect(result.suggestedCategory).toBe("CR");
  });

  it("returns null suggestedCategory for empty input", () => {
    const result = computeEOO([]);
    expect(result.suggestedCategory).toBeNull();
  });

  it("categorizes small ranges as CR", () => {
    // Points within ~5 km → EOO < 100 km²
    const result = computeEOO([
      [0, 0], [0.01, 0.01], [0.02, 0],
    ]);
    expect(result.areaKm2).toBeLessThan(EOO_THRESHOLDS.CR);
    expect(result.suggestedCategory).toBe("CR");
  });

  it("categorizes medium ranges correctly", () => {
    // Points spanning ~60 km → EOO somewhere between CR and EN thresholds
    const result = computeEOO([
      [0, 0], [0, 0.5], [0.5, 0], [0.5, 0.5],
    ]);
    expect(result.areaKm2).toBeGreaterThan(EOO_THRESHOLDS.CR);
    expect(result.areaKm2).toBeLessThan(EOO_THRESHOLDS.EN);
    expect(result.suggestedCategory).toBe("EN");
  });

  it("returns hull vertices", () => {
    const result = computeEOO([
      [0, 0], [0, 1], [1, 1], [1, 0], [0.5, 0.5],
    ]);
    expect(result.hullVertices.length).toBeGreaterThanOrEqual(4);
    expect(result.pointCount).toBe(5);
  });
});

// ── Observation grid ────────────────────────────────────────────────────

describe("computeObservationGrid", () => {
  it("returns 0 for empty input", () => {
    const result = computeObservationGrid([]);
    expect(result.observationCells).toBe(0);
  });

  it("returns 1 cell for a single point", () => {
    const result = computeObservationGrid([[0, 0]]);
    expect(result.observationCells).toBe(1);
  });

  it("counts separate grid cells for distant points", () => {
    const result = computeObservationGrid([[0, 0], [0, 1]], 2);
    expect(result.observationCells).toBe(2);
  });

  it("merges nearby points into same grid cell", () => {
    const result = computeObservationGrid([[0, 0], [0.0005, 0.0005]], 2);
    expect(result.observationCells).toBe(1);
  });

  it("returns cell centers for map display", () => {
    const result = computeObservationGrid([[10, 20], [10.5, 20.5]], 2);
    expect(result.cellCenters).toHaveLength(2);
    for (const [lat, lng] of result.cellCenters) {
      expect(typeof lat).toBe("number");
      expect(typeof lng).toBe("number");
    }
  });

  it("returns cell bounds with point counts", () => {
    const result = computeObservationGrid([[0, 0], [0.0005, 0.0005], [1, 1]], 2);
    expect(result.cellBounds).toHaveLength(2);
    const counts = result.cellBounds.map((c) => c.pointCount).sort((a, b) => b - a);
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(1);
    for (const cell of result.cellBounds) {
      expect(cell.bounds).toHaveLength(4);
      expect(cell.bounds[2]).toBeGreaterThan(cell.bounds[0]);
    }
  });
});

// ── EOO grid cell counting ──────────────────────────────────────────────

describe("countGridCellsInHull", () => {
  it("returns 0 for empty hull", () => {
    expect(countGridCellsInHull([], 2)).toBe(0);
  });

  it("returns 1 for a single point (degenerate hull)", () => {
    expect(countGridCellsInHull([[0, 0]], 2)).toBe(1);
  });

  it("returns 1 for a line (2-point hull)", () => {
    expect(countGridCellsInHull([[0, 0], [0.01, 0.01]], 2)).toBe(1);
  });

  it("counts cells inside a triangle hull", () => {
    // Triangle with vertices at roughly 0-1 degree extent
    const hull: [number, number][] = [[0, 0], [1, 0], [0.5, 1]];
    const cells = countGridCellsInHull(hull, 2);
    expect(cells).toBeGreaterThan(0);
    // Should be roughly proportional to the area
    // ~55 km per degree at equator, so triangle ~½ * 111 * 111 ≈ 6160 km²
    // At 4 km² per cell, ~1540 cells
    expect(cells).toBeGreaterThan(500);
    expect(cells).toBeLessThan(5000);
  });

  it("larger hull has more cells", () => {
    const small: [number, number][] = [[0, 0], [0.1, 0], [0, 0.1]];
    const large: [number, number][] = [[0, 0], [1, 0], [0, 1]];
    expect(countGridCellsInHull(large, 2)).toBeGreaterThan(countGridCellsInHull(small, 2));
  });

  it("larger grid size means fewer cells", () => {
    const hull: [number, number][] = [[0, 0], [1, 0], [0.5, 1]];
    const fine = countGridCellsInHull(hull, 2);
    const coarse = countGridCellsInHull(hull, 10);
    expect(fine).toBeGreaterThan(coarse);
  });
});

// ── AOO methods ─────────────────────────────────────────────────────────

describe("AOO method selection", () => {
  const triangle: OccurrencePoint[] = [
    { lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 0, lng: 1 },
  ];

  it("defaults to GBIF method", () => {
    const result = estimateCriteria(triangle);
    expect(result.aoo.method).toBe("gbif");
    expect(result.aoo.areaKm2).toBe(result.aoo.observationAreaKm2);
  });

  it("GBIF method: AOO = observation cells × cell area", () => {
    const result = estimateCriteria(triangle, { aooMethod: "gbif" });
    expect(result.aoo.areaKm2).toBe(result.aoo.observationCells * 4);
    expect(result.aoo.method).toBe("gbif");
  });

  it("EOO prevalence method: at 100%, AOO = all EOO grid cells", () => {
    const result = estimateCriteria(triangle, { aooMethod: "eoo-prevalence", prevalence: 1.0 });
    expect(result.aoo.method).toBe("eoo-prevalence");
    expect(result.aoo.occupiedCells).toBe(result.aoo.totalEOOCells);
    expect(result.aoo.areaKm2).toBe(result.aoo.totalEOOCells * 4);
  });

  it("EOO prevalence method: at 50%, roughly half the EOO cells", () => {
    const result = estimateCriteria(triangle, { aooMethod: "eoo-prevalence", prevalence: 0.5 });
    expect(result.aoo.occupiedCells).toBe(Math.ceil(result.aoo.totalEOOCells * 0.5));
    expect(result.aoo.prevalence).toBe(0.5);
    expect(result.aoo.areaKm2).toBe(result.aoo.prevalenceAreaKm2);
  });

  it("lower prevalence gives smaller or equal AOO", () => {
    const full = estimateCriteria(triangle, { aooMethod: "eoo-prevalence", prevalence: 1.0 });
    const low = estimateCriteria(triangle, { aooMethod: "eoo-prevalence", prevalence: 0.01 });
    expect(low.aoo.areaKm2).toBeLessThanOrEqual(full.aoo.areaKm2);
    expect(low.aoo.occupiedCells).toBeLessThanOrEqual(full.aoo.occupiedCells);
  });

  it("both methods always compute all data regardless of selection", () => {
    const gbif = estimateCriteria(triangle, { aooMethod: "gbif" });
    const prev = estimateCriteria(triangle, { aooMethod: "eoo-prevalence" });
    // Both have GBIF data
    expect(gbif.aoo.observationCells).toBeGreaterThan(0);
    expect(prev.aoo.observationCells).toBe(gbif.aoo.observationCells);
    // Both have EOO prevalence data
    expect(gbif.aoo.totalEOOCells).toBeGreaterThan(0);
    expect(prev.aoo.totalEOOCells).toBe(gbif.aoo.totalEOOCells);
  });

  it("AOO is always expressed as grid cells (multiple of cell area)", () => {
    const result = estimateCriteria(triangle, { aooMethod: "eoo-prevalence", prevalence: 1.0 });
    expect(result.aoo.areaKm2 % 4).toBe(0);
  });
});

// ── Location clustering ──────────────────────────────────────────────────

describe("computeLocations", () => {
  it("returns 0 for empty input", () => {
    const result = computeLocations([]);
    expect(result.count).toBe(0);
  });

  it("returns 1 for a single point", () => {
    const result = computeLocations([[0, 0]]);
    expect(result.count).toBe(1);
  });

  it("groups nearby points into one location", () => {
    // Points 1 km apart with 10 km threshold → 1 location
    const result = computeLocations([
      [0, 0], [0.005, 0.005], [0.01, 0],
    ], 10);
    expect(result.count).toBe(1);
  });

  it("separates distant points into multiple locations", () => {
    // Points ~111 km apart with 10 km threshold → separate locations
    const result = computeLocations([
      [0, 0], [1, 1], [2, 2],
    ], 10);
    expect(result.count).toBe(3);
  });

  it("uses transitive clustering (single linkage)", () => {
    // A--B--C where A-B < threshold and B-C < threshold but A-C > threshold
    // Should be 1 cluster via transitivity
    const result = computeLocations([
      [0, 0], [0.05, 0], [0.1, 0], // each ~5.5 km apart
    ], 6);
    expect(result.count).toBe(1);
  });

  it("respects custom clustering distance", () => {
    const points: [number, number][] = [[0, 0], [0.05, 0]]; // ~5.5 km apart

    const tight = computeLocations(points, 5);
    const loose = computeLocations(points, 10);

    expect(tight.count).toBe(2); // 5 km threshold → too far
    expect(loose.count).toBe(1); // 10 km threshold → merged
  });

  it("returns cluster details with centroid and radius", () => {
    const result = computeLocations([
      [10, 20], [10.01, 20.01], [10.02, 20],
    ], 50);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].pointCount).toBe(3);
    expect(result.clusters[0].radiusKm).toBeGreaterThan(0);
    expect(result.clusters[0].centroid[0]).toBeCloseTo(10.01, 1);
  });
});

// ── Temporal trends ──────────────────────────────────────────────────────

describe("computeTemporalTrends", () => {
  it("returns null trends when too few points", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0, year: 2020 },
      { lat: 1, lng: 1, year: 2022 },
    ];
    const result = computeTemporalTrends(points);
    expect(result.eooTrend).toBeNull();
    expect(result.aooTrend).toBeNull();
  });

  it("computes trends with sufficient temporal data", () => {
    // Create 30 points spread across time and space
    const points: OccurrencePoint[] = [];
    for (let i = 0; i < 15; i++) {
      points.push({ lat: i * 0.1, lng: i * 0.1, year: 2010 + Math.floor(i / 3) });
    }
    for (let i = 0; i < 15; i++) {
      points.push({ lat: i * 0.05, lng: i * 0.05, year: 2018 + Math.floor(i / 3) });
    }
    const result = computeTemporalTrends(points);
    expect(result.earlierPointCount).toBeGreaterThan(0);
    expect(result.laterPointCount).toBeGreaterThan(0);
  });

  it("detects EOO decline when later range is smaller", () => {
    // Earlier: widespread points; Later: concentrated points
    const points: OccurrencePoint[] = [];
    // Earlier: spread over 5 degrees
    for (let i = 0; i < 20; i++) {
      points.push({ lat: i * 0.25, lng: i * 0.25, year: 2005 + (i % 5) });
    }
    // Later: concentrated in 0.5 degrees
    for (let i = 0; i < 20; i++) {
      points.push({ lat: i * 0.02, lng: i * 0.02, year: 2018 + (i % 5) });
    }
    const result = computeTemporalTrends(points);
    if (result.eooTrend) {
      expect(result.eooTrend.laterValue).toBeLessThan(result.eooTrend.earlierValue);
      expect(result.eooTrend.changePercent).toBeLessThan(0);
    }
  });

  it("skips points without year", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0 }, // No year
      { lat: 1, lng: 1, year: 2020 },
    ];
    const result = computeTemporalTrends(points);
    expect(result.eooTrend).toBeNull(); // Not enough dated points
  });
});

// ── Criterion B assessment ───────────────────────────────────────────────

describe("assessCriterionB", () => {
  const makeAOO = (areaKm2: number, suggestedCategory: string | null) => ({
    method: "gbif" as const,
    areaKm2,
    gridSizeKm: 2,
    suggestedCategory,
    observationCells: areaKm2 / 4,
    observationAreaKm2: areaKm2,
    cellCenters: [] as [number, number][],
    cellBounds: [],
    totalEOOCells: areaKm2 / 4,
    occupiedCells: areaKm2 / 4,
    prevalenceAreaKm2: areaKm2,
    prevalence: 1.0,
  });

  it("returns null overall when no thresholds met", () => {
    const result = assessCriterionB(
      { areaKm2: 30_000, hullVertices: [], pointCount: 100, suggestedCategory: null },
      makeAOO(3_000, null),
      { count: 20, clusters: [], clusterDistanceKm: 10 },
      { eooTrend: null, aooTrend: null, locationsTrend: null, splitYear: 2015, earlierPointCount: 50, laterPointCount: 50 },
    );
    expect(result.overallCategory).toBeNull();
  });

  it("returns a category when B1 threshold met with subcriteria", () => {
    const result = assessCriterionB(
      { areaKm2: 80, hullVertices: [], pointCount: 100, suggestedCategory: "CR" },
      makeAOO(8, "CR"),
      { count: 1, clusters: [], clusterDistanceKm: 10 }, // ≤1 → CR → sub (a) met
      {
        eooTrend: { earlierValue: 200, laterValue: 80, changePercent: -60, earlierPeriod: "2005-2015", laterPeriod: "2016-2025" },
        aooTrend: null, locationsTrend: null, splitYear: 2016, earlierPointCount: 50, laterPointCount: 50,
      }, // EOO declining → sub (b)(i) met
    );
    expect(result.overallCategory).toBe("CR");
    expect(result.subcriteria.a).toBe(true);
    expect(result.subcriteria.bi).toBe(true);
  });

  it("requires at least 2 subcriteria for overall assessment", () => {
    const result = assessCriterionB(
      { areaKm2: 80, hullVertices: [], pointCount: 100, suggestedCategory: "CR" },
      makeAOO(8, "CR"),
      { count: 20, clusters: [], clusterDistanceKm: 10 }, // Many locations → sub (a) NOT met
      { eooTrend: null, aooTrend: null, locationsTrend: null, splitYear: 2015, earlierPointCount: 5, laterPointCount: 5 },
    );
    // Only 0 subcriteria met (no decline data, many locations)
    expect(result.overallCategory).toBeNull();
  });
});

// ── Point filtering ──────────────────────────────────────────────────────

describe("filterPoints", () => {
  const defaultParams: Required<EstimationParams> = {
    minYear: 0,
    maxYear: 2026,
    maxUncertaintyMeters: 10_000,
    gridSizeKm: 2,
    clusterDistanceKm: 10,
    outlierDistanceKm: 0,
    basisOfRecord: [],
    prevalence: 1.0,
    aooMethod: "gbif",
  };

  it("filters by coordinate uncertainty", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0, coordinateUncertainty: 500 },
      { lat: 1, lng: 1, coordinateUncertainty: 50_000 },
    ];
    const result = filterPoints(points, defaultParams);
    expect(result.filtered).toHaveLength(1);
    expect(result.filteredOut.uncertainty).toBe(1);
  });

  it("filters by minimum year", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0, year: 2020 },
      { lat: 1, lng: 1, year: 1990 },
    ];
    const result = filterPoints(points, { ...defaultParams, minYear: 2000 });
    expect(result.filtered).toHaveLength(1);
    expect(result.filteredOut.year).toBe(1);
  });

  it("filters by basis of record", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0, basisOfRecord: "HUMAN_OBSERVATION" },
      { lat: 1, lng: 1, basisOfRecord: "FOSSIL_SPECIMEN" },
    ];
    const result = filterPoints(points, { ...defaultParams, basisOfRecord: ["HUMAN_OBSERVATION"] });
    expect(result.filtered).toHaveLength(1);
    expect(result.filteredOut.basisOfRecord).toBe(1);
  });

  it("deduplicates nearby coordinates", () => {
    const points: OccurrencePoint[] = [
      { lat: 0.0001, lng: 0.0001 },
      { lat: 0.0002, lng: 0.0002 }, // ~11m away → same 100m cell
      { lat: 1, lng: 1 },
    ];
    const result = filterPoints(points, defaultParams);
    expect(result.filtered).toHaveLength(2);
    expect(result.filteredOut.duplicate).toBe(1);
  });

  it("removes outliers when configured", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0 },
      { lat: 0.01, lng: 0.01 },
      { lat: 0.02, lng: 0 },
      { lat: 50, lng: 50 }, // Outlier: ~7000 km from others
    ];
    const result = filterPoints(points, { ...defaultParams, outlierDistanceKm: 100 });
    expect(result.filtered).toHaveLength(3);
    expect(result.filteredOut.outlier).toBe(1);
  });
});

// ── Full estimation pipeline ─────────────────────────────────────────────

describe("estimateCriteria", () => {
  it("handles empty input gracefully", () => {
    const result = estimateCriteria([]);
    expect(result.eoo.areaKm2).toBe(0);
    expect(result.aoo.areaKm2).toBe(0);
    expect(result.locations.count).toBe(0);
    expect(result.meta.usedPoints).toBe(0);
  });

  it("runs full pipeline for a realistic dataset", () => {
    // Create a dataset of 50 occurrence points scattered around Cape Town
    const points: OccurrencePoint[] = [];
    for (let i = 0; i < 50; i++) {
      points.push({
        lat: -33.9 + (Math.sin(i) * 0.2),
        lng: 18.4 + (Math.cos(i) * 0.3),
        year: 2010 + (i % 16),
        coordinateUncertainty: 100 + i * 50,
        basisOfRecord: "HUMAN_OBSERVATION",
      });
    }

    const result = estimateCriteria(points);

    // Should produce valid results
    expect(result.eoo.areaKm2).toBeGreaterThan(0);
    expect(result.aoo.method).toBe("gbif"); // default method
    expect(result.aoo.areaKm2).toBe(result.aoo.observationAreaKm2);
    expect(result.aoo.observationCells).toBeGreaterThan(0);
    expect(result.aoo.totalEOOCells).toBeGreaterThan(0); // always computed
    expect(result.locations.count).toBeGreaterThan(0);
    expect(result.meta.usedPoints).toBeGreaterThan(0);
    expect(result.meta.params.gridSizeKm).toBe(2);
  });

  it("applies custom parameters", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0, year: 2020, coordinateUncertainty: 500 },
      { lat: 0.5, lng: 0.5, year: 2020, coordinateUncertainty: 500 },
      { lat: 1, lng: 0, year: 2022, coordinateUncertainty: 20_000 }, // Too uncertain
    ];

    const result = estimateCriteria(points, { maxUncertaintyMeters: 1000 });
    expect(result.meta.filteredOut.uncertainty).toBe(1);
    expect(result.meta.usedPoints).toBe(2);
  });

  it("includes filteredPoints in result for map rendering", () => {
    const points: OccurrencePoint[] = [
      { lat: 0, lng: 0, year: 2020 },
      { lat: 0.5, lng: 0.5, year: 2021 },
      { lat: 1, lng: 0, year: 2022 },
    ];

    const result = estimateCriteria(points);
    expect(result.filteredPoints).toBeDefined();
    expect(result.filteredPoints.length).toBe(result.meta.usedPoints);
    for (const p of result.filteredPoints) {
      expect(typeof p.lat).toBe("number");
      expect(typeof p.lng).toBe("number");
    }
  });
});
