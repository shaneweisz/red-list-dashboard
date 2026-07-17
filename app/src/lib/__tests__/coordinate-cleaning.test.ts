/**
 * Cases below marked "upstream example" are transcribed from CoordinateCleaner's own
 * roxygen @examples blocks (R/cc_zero.R, R/cc_gbif.R — see
 * docs/gbif-coordinate-cleaning-scoping.md), so results here should match calling the
 * real R functions with `value = "flagged"` (inverted, since R's convention is
 * TRUE = passed/clean, not TRUE = flagged).
 */
import { describe, it, expect } from "vitest";
import {
  isZeroCoordinate,
  isEqualLatLon,
  isNearGbifHeadquarters,
  flagDuplicateCoordinates,
  getQualityFlags,
} from "../coordinate-cleaning";

describe("isZeroCoordinate", () => {
  it("upstream example: flags lon==0, lat==0, and (0,0), clears a real point", () => {
    const points = [
      { lon: 0, lat: 23.08 },
      { lon: 34.84, lat: 0 },
      { lon: 0, lat: 0 },
      { lon: 33.98, lat: 15.98 },
    ];
    expect(points.map(isZeroCoordinate)).toEqual([true, true, true, false]);
  });

  it("flags points within the default 0.5 degree buffer of the origin, inclusive", () => {
    expect(isZeroCoordinate({ lon: 0.3, lat: 0.4 })).toBe(true); // hypot == 0.5 exactly
  });

  it("clears points just outside the default buffer", () => {
    expect(isZeroCoordinate({ lon: 0.36, lat: 0.48 })).toBe(false); // hypot == 0.6
  });

  it("respects a custom buffer", () => {
    expect(isZeroCoordinate({ lon: 1, lat: 1 }, 2)).toBe(true);
    expect(isZeroCoordinate({ lon: 1, lat: 1 }, 1)).toBe(false);
  });
});

describe("isEqualLatLon", () => {
  it("flags identical lon/lat", () => {
    expect(isEqualLatLon({ lon: 10, lat: 10 })).toBe(true);
  });

  it("flags absolute-equal lon/lat with differing sign (test='absolute' default)", () => {
    expect(isEqualLatLon({ lon: 10, lat: -10 })).toBe(true);
  });

  it("clears unequal coordinates", () => {
    expect(isEqualLatLon({ lon: 10, lat: -11 })).toBe(false);
  });
});

describe("isNearGbifHeadquarters", () => {
  it("upstream example: flags the exact HQ point, clears a distant point at the same longitude", () => {
    const atHq = { lon: 12.58, lat: 55.67 };
    const farAway = { lon: 12.58, lat: 30.0 };
    expect(isNearGbifHeadquarters(atHq)).toBe(true);
    expect(isNearGbifHeadquarters(farAway)).toBe(false);
  });

  it("clears a point a few km outside the default 1000m buffer", () => {
    expect(isNearGbifHeadquarters({ lon: 12.7, lat: 55.67 })).toBe(false);
  });
});

describe("flagDuplicateCoordinates", () => {
  it("flags every repeat of a coordinate pair after the first", () => {
    const records = [
      { lon: 1, lat: 1 },
      { lon: 2, lat: 2 },
      { lon: 1, lat: 1 },
      { lon: 1, lat: 1 },
      { lon: 3, lat: 3 },
    ];
    expect(flagDuplicateCoordinates(records)).toEqual([false, false, true, true, false]);
  });

  it("treats an empty list as having no duplicates", () => {
    expect(flagDuplicateCoordinates([])).toEqual([]);
  });
});

describe("getQualityFlags", () => {
  it("combines independent checks per record", () => {
    const records = [
      { lon: 0, lat: 0 }, // zero + equal
      { lon: 12.58, lat: 55.67 }, // gbif hq
      { lon: 12.58, lat: 55.67 }, // gbif hq + duplicate of the record above
      { lon: 10, lat: 20 }, // clean
    ];
    const flags = getQualityFlags(records);
    expect(flags[0].sort()).toEqual(["EQUAL_COORDINATES", "ZERO_COORDINATE"].sort());
    expect(flags[1]).toEqual(["GBIF_HEADQUARTERS"]);
    expect(flags[2].sort()).toEqual(["DUPLICATE", "GBIF_HEADQUARTERS"].sort());
    expect(flags[3]).toEqual([]);
  });
});
