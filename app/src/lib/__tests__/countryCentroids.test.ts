import { describe, it, expect } from "vitest";
import {
  haversineKm,
  isLikelyCountryCentroid,
  getCentroid,
  CENTROID_BUFFER_KM,
} from "../countryCentroids";

// ---------------------------------------------------------------------------
// haversineKm
// ---------------------------------------------------------------------------
describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0);
    expect(haversineKm(45.123, -120.5, 45.123, -120.5)).toBeCloseTo(0, 6);
  });

  it("computes known distances", () => {
    // London → Paris: ~344 km
    const d = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });

  it("is symmetric", () => {
    const a = haversineKm(10, 20, 30, 40);
    const b = haversineKm(30, 40, 10, 20);
    expect(a).toBeCloseTo(b, 6);
  });

  it("handles antipodal points (~20000 km)", () => {
    const d = haversineKm(0, 0, 0, 180);
    expect(d).toBeGreaterThan(20000);
    expect(d).toBeLessThan(20040);
  });
});

// ---------------------------------------------------------------------------
// getCentroid
// ---------------------------------------------------------------------------
describe("getCentroid", () => {
  it("returns a [lon, lat] pair for known ISO-2 codes", () => {
    const za = getCentroid("ZA");
    expect(za).not.toBeNull();
    expect(za![0]).toBeGreaterThan(15); // South Africa longitude in 15..35
    expect(za![0]).toBeLessThan(35);
    expect(za![1]).toBeLessThan(-20); // latitude in -35..-20
    expect(za![1]).toBeGreaterThan(-35);
  });

  it("is case-insensitive", () => {
    expect(getCentroid("za")).toEqual(getCentroid("ZA"));
  });

  it("returns null for unknown codes", () => {
    expect(getCentroid("XX")).toBeNull();
    expect(getCentroid("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isLikelyCountryCentroid
// ---------------------------------------------------------------------------
describe("isLikelyCountryCentroid", () => {
  it("flags a point exactly at the country's Natural Earth label", () => {
    const za = getCentroid("ZA")!;
    const [lon, lat] = za;
    expect(isLikelyCountryCentroid(lat, lon, "ZA")).toBe(true);
  });

  it("flags a point with rounded-centroid coordinates (e.g. 1-decimal)", () => {
    // Andorra NE label ≈ (1.5394, 42.5476). A record at (42.5, 1.5) is a
    // classic rounded country centroid; ~6.5 km from the NE label.
    expect(isLikelyCountryCentroid(42.5, 1.5, "AD")).toBe(true);
  });

  it("does not flag a point far from the centroid", () => {
    // Cape Agulhas (southern tip of South Africa) is hundreds of km from the
    // ZA label point, so it must not be flagged.
    expect(isLikelyCountryCentroid(-34.83, 20.0, "ZA")).toBe(false);
  });

  it("does not flag a point if the country code is unknown", () => {
    expect(isLikelyCountryCentroid(0, 0, "XX")).toBe(false);
  });

  it("does not flag when countryCode is null/undefined/empty", () => {
    expect(isLikelyCountryCentroid(0, 0, null)).toBe(false);
    expect(isLikelyCountryCentroid(0, 0, undefined)).toBe(false);
    expect(isLikelyCountryCentroid(0, 0, "")).toBe(false);
  });

  it("respects a custom buffer", () => {
    // 100 km west of the Andorra label should NOT be flagged at the default
    // 20km buffer…
    const [lon, lat] = getCentroid("AD")!;
    const farLon = lon + 2; // ~165 km east at this latitude
    expect(isLikelyCountryCentroid(lat, farLon, "AD")).toBe(false);
    // …but should be at a 200 km buffer.
    expect(isLikelyCountryCentroid(lat, farLon, "AD", 200)).toBe(true);
  });

  it("is case-insensitive on the country code", () => {
    const [lon, lat] = getCentroid("AD")!;
    expect(isLikelyCountryCentroid(lat, lon, "ad")).toBe(true);
  });

  it("exposes a sensible default buffer", () => {
    // Sanity check: the buffer is small vs. any real country's extent.
    expect(CENTROID_BUFFER_KM).toBeGreaterThan(0);
    expect(CENTROID_BUFFER_KM).toBeLessThan(100);
  });
});
