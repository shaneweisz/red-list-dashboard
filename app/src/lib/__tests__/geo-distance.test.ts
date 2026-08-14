import { describe, it, expect } from "vitest";
import {
  bearingDegrees,
  compassPoint,
  formatDistance,
  haversineMetres,
  pathLengthMetres,
} from "../geo-distance";

describe("haversineMetres", () => {
  it("is zero for a point and itself", () => {
    expect(haversineMetres([-75.8, 4.5], [-75.8, 4.5])).toBe(0);
  });

  // One degree of latitude is a little over 111 km anywhere on the globe.
  it("measures a degree of latitude", () => {
    expect(haversineMetres([0, 0], [0, 1])).toBeCloseTo(111195, 0);
  });

  /**
   * A degree of longitude shrinks with the cosine of the latitude. This is the
   * whole reason for measuring on the sphere: at 60° it is half what it is at
   * the equator, while on the Mercator map it looks the same width.
   */
  it("shrinks a degree of longitude towards the poles", () => {
    expect(haversineMetres([0, 0], [1, 0])).toBeCloseTo(111195, 0);
    expect(haversineMetres([0, 60], [1, 60])).toBeCloseTo(111195 / 2, -2);
  });

  it("measures a known long-haul pair", () => {
    // London to New York, ~5,570 km.
    const d = haversineMetres([-0.1276, 51.5072], [-74.006, 40.7128]);
    expect(d / 1000).toBeGreaterThan(5500);
    expect(d / 1000).toBeLessThan(5620);
  });

  it("crosses the antimeridian without going the long way", () => {
    const d = haversineMetres([179.5, 0], [-179.5, 0]);
    expect(d).toBeCloseTo(111195, -1);
  });
});

describe("pathLengthMetres", () => {
  it("has no length until there are two points", () => {
    expect(pathLengthMetres([])).toBe(0);
    expect(pathLengthMetres([[0, 0]])).toBe(0);
  });

  it("adds up the legs", () => {
    const legs = pathLengthMetres([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(legs).toBeCloseTo(haversineMetres([0, 0], [0, 1]) * 2, 3);
  });
});

describe("formatDistance", () => {
  it("uses metres below a kilometre", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(847.4)).toBe("847 m");
  });

  // Precision drops as the distance grows: a click on a map can't justify
  // metre-level accuracy across a hundred kilometres.
  it("uses kilometres above one, with sensible precision", () => {
    expect(formatDistance(1000)).toBe("1.00 km");
    expect(formatDistance(9999)).toBe("10.00 km");
    expect(formatDistance(12345)).toBe("12.3 km");
    expect(formatDistance(123456)).toBe("123 km");
    expect(formatDistance(5570000)).toBe("5,570 km");
  });
});

describe("bearingDegrees", () => {
  it("points at the cardinal directions", () => {
    expect(bearingDegrees([0, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(bearingDegrees([0, 0], [1, 0])).toBeCloseTo(90, 6);
    expect(bearingDegrees([0, 0], [0, -1])).toBeCloseTo(180, 6);
    expect(bearingDegrees([0, 0], [-1, 0])).toBeCloseTo(270, 6);
  });

  it("is always a positive angle", () => {
    expect(bearingDegrees([0, 0], [-1, 1])).toBeGreaterThan(180);
    expect(bearingDegrees([0, 0], [-1, 1])).toBeLessThan(360);
  });
});

describe("compassPoint", () => {
  it("rounds to the eight points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(44)).toBe("NE");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(200)).toBe("S");
    expect(compassPoint(315)).toBe("NW");
  });

  it("wraps rather than falling off the end", () => {
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(360)).toBe("N");
    expect(compassPoint(-45)).toBe("NW");
  });
});
