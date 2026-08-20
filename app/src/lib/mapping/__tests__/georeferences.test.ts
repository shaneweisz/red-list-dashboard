import { describe, it, expect } from "vitest";
import {
  validateGeoreference,
  parseCoordinatePair,
  uncertaintyCircle,
} from "../georeferences";

describe("validateGeoreference", () => {
  it("accepts a point with a radius", () => {
    expect(
      validateGeoreference({
        decimalLatitude: 1.1958,
        decimalLongitude: -76.9256,
        coordinateUncertaintyInMeters: 1500,
      }).ok
    ).toBe(true);
  });

  it("requires an uncertainty radius", () => {
    const result = validateGeoreference({
      decimalLatitude: 1.1958,
      decimalLongitude: -76.9256,
      coordinateUncertaintyInMeters: null,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/uncertainty/i);
  });

  it("rejects out-of-range coordinates", () => {
    const result = validateGeoreference({
      decimalLatitude: 91,
      decimalLongitude: -200,
      coordinateUncertaintyInMeters: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("rejects null island, the error the cleaning checks exist to catch", () => {
    const result = validateGeoreference({
      decimalLatitude: 0,
      decimalLongitude: 0,
      coordinateUncertaintyInMeters: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/0, 0/);
  });
});

describe("parseCoordinatePair", () => {
  it.each([
    ["1.1958, -76.9256", 1.1958, -76.9256],
    ["1.1958,-76.9256", 1.1958, -76.9256],
    ["1.1958 -76.9256", 1.1958, -76.9256],
    ["-0.6667; -77.6667", -0.6667, -77.6667],
  ])("parses %s", (text, lat, lon) => {
    expect(parseCoordinatePair(text)).toEqual({ lat, lon });
  });

  it.each(["", "1.1958", "not a coordinate", "95, 10", "10, 200"])(
    "returns null for %s",
    (text) => {
      expect(parseCoordinatePair(text)).toBeNull();
    }
  );
});

describe("uncertaintyCircle", () => {
  it("closes the ring", () => {
    const ring = uncertaintyCircle(1.1958, -76.9256, 1500).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("is a circle on the ground, not in degrees — wider in longitude away from the equator", () => {
    const spanAt = (lat: number) => {
      const ring = uncertaintyCircle(lat, 0, 10_000).coordinates[0];
      const lons = ring.map(([lon]) => lon);
      return Math.max(...lons) - Math.min(...lons);
    };
    // At 60°N a degree of longitude is half a degree at the equator, so the same
    // ground radius has to span about twice the degrees.
    expect(spanAt(60) / spanAt(0)).toBeCloseTo(2, 1);
  });

  it("spans roughly twice the radius across", () => {
    const ring = uncertaintyCircle(0, 0, 111_320).coordinates[0];
    const lats = ring.map(([, lat]) => lat);
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(2, 1);
  });
});
