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
// isLikelyCountryCentroid — matches CoordinateCleaner::cc_cen defaults
// ---------------------------------------------------------------------------
describe("isLikelyCountryCentroid", () => {
  it("flags a point exactly at the country's Natural Earth label", () => {
    const za = getCentroid("ZA")!;
    const [lon, lat] = za;
    expect(isLikelyCountryCentroid(lat, lon, "ZA")).toBe(true);
  });

  it("flags a point a few hundred metres from the centroid", () => {
    const [lon, lat] = getCentroid("MG")!;
    // ~0.005° ≈ 555 m north — still within the 1 km default buffer.
    expect(isLikelyCountryCentroid(lat + 0.005, lon, "MG")).toBe(true);
  });

  it("does not flag a point more than 1 km from the centroid", () => {
    const [lon, lat] = getCentroid("MG")!;
    // ~0.02° ≈ 2.2 km north — outside the default 1 km buffer.
    expect(isLikelyCountryCentroid(lat + 0.02, lon, "MG")).toBe(false);
  });

  it("does not flag a point far from the centroid", () => {
    // Cape Agulhas (southern tip of South Africa) is hundreds of km from the
    // ZA label point.
    expect(isLikelyCountryCentroid(-34.83, 20.0, "ZA")).toBe(false);
  });

  it("does not flag when the country code is unknown / null / empty", () => {
    expect(isLikelyCountryCentroid(0, 0, "XX")).toBe(false);
    expect(isLikelyCountryCentroid(0, 0, null)).toBe(false);
    expect(isLikelyCountryCentroid(0, 0, undefined)).toBe(false);
    expect(isLikelyCountryCentroid(0, 0, "")).toBe(false);
  });

  it("respects a custom buffer", () => {
    const [lon, lat] = getCentroid("ZA")!;
    const farLon = lon + 1.5; // ~165 km east at this latitude
    expect(isLikelyCountryCentroid(lat, farLon, "ZA")).toBe(false);
    expect(isLikelyCountryCentroid(lat, farLon, "ZA", 300)).toBe(true);
  });

  it("is case-insensitive on the country code", () => {
    const [lon, lat] = getCentroid("ZA")!;
    expect(isLikelyCountryCentroid(lat, lon, "za")).toBe(true);
  });

  it("uses CoordinateCleaner's 1 km default buffer", () => {
    expect(CENTROID_BUFFER_KM).toBe(1);
  });
});
