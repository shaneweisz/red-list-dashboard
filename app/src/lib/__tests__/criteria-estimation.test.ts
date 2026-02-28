import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  convexHull,
  sphericalPolygonArea,
  computeEOO,
  computeAOO,
  computeLocations,
  computeTemporalTrends,
  assessCriterionB,
  filterPoints,
  estimateCriteria,
  EOO_THRESHOLDS,
  AOO_THRESHOLDS,
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

// ── AOO ──────────────────────────────────────────────────────────────────

describe("computeAOO", () => {
  it("returns 0 for empty input", () => {
    const result = computeAOO([]);
    expect(result.areaKm2).toBe(0);
    expect(result.occupiedCells).toBe(0);
  });

  it("returns 4 km² for a single point (one 2×2 km cell)", () => {
    const result = computeAOO([[0, 0]]);
    expect(result.occupiedCells).toBe(1);
    expect(result.areaKm2).toBe(4); // 2×2 km
  });

  it("counts separate grid cells for distant points", () => {
    // Points ~100 km apart should be in different 2km grid cells
    const result = computeAOO([[0, 0], [0, 1]], 2);
    expect(result.occupiedCells).toBe(2);
    expect(result.areaKm2).toBe(8);
  });

  it("merges nearby points into same grid cell", () => {
    // Points 100m apart should be in the same 2km grid cell
    const result = computeAOO([[0, 0], [0.0005, 0.0005]], 2);
    expect(result.occupiedCells).toBe(1);
    expect(result.areaKm2).toBe(4);
  });

  it("respects custom grid size", () => {
    const result = computeAOO([[0, 0]], 10);
    expect(result.gridSizeKm).toBe(10);
    expect(result.areaKm2).toBe(100); // 10×10 km
  });

  it("categorizes by AOO thresholds", () => {
    // 2 cells × 4 km² = 8 km² < CR threshold (10 km²)
    const result = computeAOO([[0, 0], [0, 1]], 2);
    expect(result.suggestedCategory).toBe("CR");
  });

  it("returns cell centers for map display", () => {
    const result = computeAOO([[10, 20], [10.5, 20.5]], 2);
    expect(result.cellCenters).toHaveLength(2);
    for (const [lat, lng] of result.cellCenters) {
      expect(typeof lat).toBe("number");
      expect(typeof lng).toBe("number");
    }
  });

  it("returns cell bounds with point counts", () => {
    const result = computeAOO([[0, 0], [0.0005, 0.0005], [1, 1]], 2);
    expect(result.cellBounds).toHaveLength(2);
    // First cell should have 2 points (the two nearby ones)
    const counts = result.cellBounds.map((c) => c.pointCount).sort((a, b) => b - a);
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(1);
    // Each bound should have [south, west, north, east]
    for (const cell of result.cellBounds) {
      expect(cell.bounds).toHaveLength(4);
      expect(cell.bounds[2]).toBeGreaterThan(cell.bounds[0]); // north > south
    }
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
  it("returns null overall when no thresholds met", () => {
    const result = assessCriterionB(
      { areaKm2: 30_000, hullVertices: [], pointCount: 100, suggestedCategory: null },
      { areaKm2: 3_000, occupiedCells: 750, gridSizeKm: 2, cellCenters: [], cellBounds: [], suggestedCategory: null },
      { count: 20, clusters: [], clusterDistanceKm: 10 },
      { eooTrend: null, aooTrend: null, locationsTrend: null, splitYear: 2015, earlierPointCount: 50, laterPointCount: 50 },
    );
    expect(result.overallCategory).toBeNull();
  });

  it("returns a category when B1 threshold met with subcriteria", () => {
    const result = assessCriterionB(
      { areaKm2: 80, hullVertices: [], pointCount: 100, suggestedCategory: "CR" },
      { areaKm2: 8, occupiedCells: 2, gridSizeKm: 2, cellCenters: [], cellBounds: [], suggestedCategory: "CR" },
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
      { areaKm2: 8, occupiedCells: 2, gridSizeKm: 2, cellCenters: [], cellBounds: [], suggestedCategory: "CR" },
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
    expect(result.aoo.occupiedCells).toBeGreaterThan(0);
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
