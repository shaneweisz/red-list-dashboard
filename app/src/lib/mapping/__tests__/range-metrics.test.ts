import { describe, it, expect } from "vitest";
import area from "@turf/area";
import {
  b1Threshold,
  b2Threshold,
  computeAoo,
  computeEoo,
  convexHull,
  formatAreaKm2,
  sphericalAreaM2,
  type MetricPoint,
} from "../range-metrics";

const point = (lon: number, lat: number): MetricPoint => ({ lon, lat });

describe("convexHull", () => {
  it("drops the points inside", () => {
    const hull = convexHull([
      point(0, 0), point(2, 0), point(2, 2), point(0, 2),
      point(1, 1), point(1.5, 0.5),
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(expect.arrayContaining([point(0, 0), point(2, 0), point(2, 2), point(0, 2)]));
  });

  // A line has no area, which is why GeoCAT won't analyse below three points.
  it("has no hull for fewer than three distinct points", () => {
    expect(convexHull([])).toHaveLength(0);
    expect(convexHull([point(1, 1)])).toHaveLength(1);
    expect(convexHull([point(1, 1), point(2, 2)])).toHaveLength(2);
    expect(convexHull([point(1, 1), point(1, 1), point(1, 1)])).toHaveLength(1);
  });

  it("keeps collinear points off the hull", () => {
    const hull = convexHull([point(0, 0), point(1, 0), point(2, 0), point(1, 2)]);
    expect(hull).toHaveLength(3);
    expect(hull).not.toContainEqual(point(1, 0));
  });
});

describe("sphericalAreaM2", () => {
  /**
   * Cross-checked against @turf/area, which is an independent implementation
   * (Chamberlain & Duquette) on a slightly smaller earth radius — so they
   * should agree closely but not exactly.
   */
  it("agrees with turf to within the difference in earth radius", () => {
    const ring = [point(-76.9, 3.0), point(-75.6, 3.0), point(-75.6, 4.5), point(-76.9, 4.5)];
    const ours = sphericalAreaM2(ring);
    const turf = area({
      type: "Polygon",
      coordinates: [[...ring, ring[0]].map((p) => [p.lon, p.lat])],
    });
    expect(Math.abs(ours - turf) / turf).toBeLessThan(0.005);
  });

  it("is independent of winding direction", () => {
    const ring = [point(0, 0), point(1, 0), point(1, 1), point(0, 1)];
    expect(sphericalAreaM2(ring)).toBeCloseTo(sphericalAreaM2([...ring].reverse()), 6);
  });

  it("has no area below three points", () => {
    expect(sphericalAreaM2([point(0, 0), point(1, 1)])).toBe(0);
  });

  // One degree square at the equator is about 111.3 km on a side.
  it("measures a degree square at the equator", () => {
    const km2 = sphericalAreaM2([point(0, 0), point(1, 0), point(1, 1), point(0, 1)]) / 1e6;
    expect(km2).toBeGreaterThan(12_300);
    expect(km2).toBeLessThan(12_400);
  });
});

describe("computeEoo", () => {
  it("reports the hull and its area", () => {
    const result = computeEoo([point(0, 0), point(1, 0), point(1, 1), point(0, 1), point(0.5, 0.5)]);
    expect(result.pointCount).toBe(5);
    expect(result.hull?.coordinates[0]).toHaveLength(5); // closed ring
    expect(result.areaKm2).toBeGreaterThan(12_300);
  });

  it("has no extent for a species known from one place", () => {
    const result = computeEoo([point(-75, 4), point(-75, 4)]);
    expect(result.areaKm2).toBe(0);
    expect(result.hull).toBeNull();
  });

  /**
   * Records either side of 180° otherwise produce a hull wrapped the long way
   * round the planet — an EOO of half the Pacific instead of a few hundred km².
   */
  it("doesn't wrap the wrong way round the antimeridian", () => {
    const result = computeEoo([point(179.5, 0), point(-179.5, 0), point(179.8, 0.5)]);
    expect(result.areaKm2).toBeLessThan(10_000);
  });
});

describe("computeAoo", () => {
  it("counts each occupied 2km cell once", () => {
    // Three records within a few hundred metres: one cell, 4 km².
    const result = computeAoo([point(-75.6, 4.5), point(-75.6005, 4.5005), point(-75.601, 4.5003)]);
    expect(result.cellCount).toBe(1);
    expect(result.areaKm2).toBe(4);
    expect(result.cells).toHaveLength(1);
  });

  it("separates records a few kilometres apart", () => {
    const result = computeAoo([point(-75.6, 4.5), point(-75.5, 4.5), point(-75.4, 4.5)]);
    expect(result.cellCount).toBe(3);
    expect(result.areaKm2).toBe(12);
  });

  // The scale is fixed by the Guidelines; the parameter exists to compare
  // against GeoCAT, which offers a box for it.
  it("scales with the cell size", () => {
    const points = [point(-75.6, 4.5), point(-75.5, 4.5)];
    expect(computeAoo(points, 10_000).areaKm2 % 100).toBe(0);
  });

  it("has no area with no records", () => {
    expect(computeAoo([])).toMatchObject({ cellCount: 0, areaKm2: 0 });
  });

  it("draws each cell as a closed box", () => {
    const [cell] = computeAoo([point(-75.6, 4.5)]).cells;
    expect(cell.coordinates[0]).toHaveLength(5);
    expect(cell.coordinates[0][0]).toEqual(cell.coordinates[0][4]);
  });
});

describe("criterion B thresholds", () => {
  // IUCN Categories and Criteria v3.1: B1 100 / 5,000 / 20,000 km².
  it("reads B1 off the extent", () => {
    expect(b1Threshold(99)).toBe("CR");
    expect(b1Threshold(100)).toBe("EN");
    expect(b1Threshold(4_999)).toBe("EN");
    expect(b1Threshold(5_000)).toBe("VU");
    expect(b1Threshold(19_999)).toBe("VU");
    expect(b1Threshold(20_000)).toBeNull();
  });

  // B2 10 / 500 / 2,000 km².
  it("reads B2 off the occupancy", () => {
    expect(b2Threshold(8)).toBe("CR");
    expect(b2Threshold(10)).toBe("EN");
    expect(b2Threshold(499)).toBe("EN");
    expect(b2Threshold(500)).toBe("VU");
    expect(b2Threshold(2_000)).toBeNull();
  });
});

describe("formatAreaKm2", () => {
  it("keeps precision where the thresholds are tight", () => {
    expect(formatAreaKm2(0)).toBe("0 km²");
    expect(formatAreaKm2(4)).toBe("4.00 km²");
    expect(formatAreaKm2(184)).toBe("184.0 km²");
    expect(formatAreaKm2(3240.4)).toBe("3,240 km²");
  });
});
