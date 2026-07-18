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
  isNearCapital,
  isNearCentroid,
  isNearInstitution,
  isInOcean,
  isInUrbanArea,
  isNearArtificialHotspot,
  isOutsideReportedCountry,
  flagDuplicateCoordinates,
  getQualityFlags,
} from "../coordinate-cleaning";

// A point in the Southern Ocean, ~3,300-3,700km from the nearest capital, country
// centroid, biodiversity institution, and artificial hotspot in the reference data
// (verified against the real datasets), also outside every land/urban-area polygon
// and every country polygon — a reliable "clean" fixture for all point-gazetteer/
// polygon checks at once (isOutsideReportedCountry needs a countryCode passed in
// separately to actually flag, since an unset countryCode is never flagged).
const FAR_FROM_EVERYTHING = { lon: -140, lat: -60 };

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

describe("isNearCapital", () => {
  it("flags a point exactly at a real capital (London)", () => {
    expect(isNearCapital({ lat: 51.49999, lon: -0.11672 })).toBe(true);
  });

  it("flags within the default 10km buffer, clears within a tighter custom buffer", () => {
    // ~1112m from London — inside the 10km default, outside a 1000m custom buffer
    const nearLondon = { lat: 51.50999, lon: -0.11672 };
    expect(isNearCapital(nearLondon)).toBe(true);
    expect(isNearCapital(nearLondon, 1000)).toBe(false);
  });

  it("clears a point far from every capital", () => {
    expect(isNearCapital(FAR_FROM_EVERYTHING)).toBe(false);
  });
});

describe("isNearCentroid", () => {
  it("flags a point exactly at a real country centroid (France)", () => {
    expect(isNearCentroid({ lat: 46, lon: 2 })).toBe(true);
  });

  it("flags within the default 1km buffer, clears within a tighter custom buffer", () => {
    // ~556m from France's centroid — inside the 1000m default, outside a 100m custom buffer
    const nearCentroid = { lat: 46.005, lon: 2 };
    expect(isNearCentroid(nearCentroid)).toBe(true);
    expect(isNearCentroid(nearCentroid, 100)).toBe(false);
  });

  it("clears a point far from every centroid", () => {
    expect(isNearCentroid(FAR_FROM_EVERYTHING)).toBe(false);
  });
});

describe("isNearInstitution", () => {
  it("flags a point exactly at a real institution", () => {
    expect(isNearInstitution({ lat: 45.1578, lon: 10.79772 })).toBe(true);
  });

  it("flags within the default 100m buffer, clears within a tighter custom buffer", () => {
    // ~55.6m from the institution — inside the 100m default, outside a 10m custom buffer
    const nearInst = { lat: 45.1583, lon: 10.79772 };
    expect(isNearInstitution(nearInst)).toBe(true);
    expect(isNearInstitution(nearInst, 10)).toBe(false);
  });

  it("clears a point far from every institution", () => {
    expect(isNearInstitution(FAR_FROM_EVERYTHING)).toBe(false);
  });
});

describe("isInOcean", () => {
  it("flags a point in the middle of the Pacific", () => {
    expect(isInOcean({ lon: -140, lat: 0 })).toBe(true);
  });

  it("clears a point on land, far from any coastline", () => {
    expect(isInOcean({ lon: 15, lat: 23 })).toBe(false); // middle of the Sahara
  });

  it("clears a point far from every land polygon's own reference", () => {
    expect(isInOcean(FAR_FROM_EVERYTHING)).toBe(true); // Southern Ocean
  });

  it("regression: flags a real offshore GBIF record the coarser 110m data missed", () => {
    // A real Breviceps macrops (Desert Rain Frog) occurrence off the Namibian coast,
    // confirmed several km out in open water via satellite imagery. At Natural Earth's
    // 110m land scale (this check's original resolution), the coastline was simplified
    // several km out to sea at this exact spot, so this point read as "on land" and the
    // record went unflagged. Upgrading to 50m (see coordinate-cleaning-refdata/README.md)
    // fixed it — this test pins that fix so a future resolution downgrade doesn't regress it.
    expect(isInOcean({ lon: 16.812475, lat: -29.285752 })).toBe(true);
  });
});

describe("isInUrbanArea", () => {
  // Greater Tokyo — the single largest urban-area polygon in the reference data
  // (verified against the real dataset), a reliable "definitely urban" fixture.
  const inGreaterTokyo = { lon: 139.88725, lat: 36.1406 };

  it("flags a point inside a real urban area", () => {
    expect(isInUrbanArea(inGreaterTokyo)).toBe(true);
  });

  it("clears a point on land but outside any mapped urban area", () => {
    expect(isInUrbanArea({ lon: -2.5, lat: 52 })).toBe(false); // rural England
  });

  it("clears a point in the ocean", () => {
    expect(isInUrbanArea(FAR_FROM_EVERYTHING)).toBe(false);
  });
});

describe("isNearArtificialHotspot", () => {
  it("flags a point exactly at a known artificial hotspot", () => {
    // A grid-centroid point from the AHOI dataset (birds), confirmed artificial
    // (determination === "FALSE" in the source data — see coordinate-cleaning-refdata/README.md).
    expect(isNearArtificialHotspot({ lat: 56.2, lon: 16.4 })).toBe(true);
  });

  it("flags within the default 10km buffer, clears within a tighter custom buffer", () => {
    // ~1112m from the hotspot above — inside the 10km default, outside a 1000m custom buffer
    const nearHotspot = { lat: 56.21, lon: 16.4 };
    expect(isNearArtificialHotspot(nearHotspot)).toBe(true);
    expect(isNearArtificialHotspot(nearHotspot, 1000)).toBe(false);
  });

  it("clears a point far from every artificial hotspot", () => {
    expect(isNearArtificialHotspot(FAR_FROM_EVERYTHING)).toBe(false);
  });
});

describe("isOutsideReportedCountry", () => {
  it("clears a point inside its correctly-reported country (London, GB)", () => {
    expect(isOutsideReportedCountry({ lat: 51.49999, lon: -0.11672, countryCode: "GB" })).toBe(false);
  });

  it("flags a point reported as the wrong country (Paris claimed as GB)", () => {
    expect(isOutsideReportedCountry({ lat: 48.8566, lon: 2.3522, countryCode: "GB" })).toBe(true);
  });

  it("regression: France and Norway resolve correctly despite Natural Earth's own -99 ISO_A2 data quirk for these two countries (see coordinate-cleaning-refdata/README.md)", () => {
    expect(isOutsideReportedCountry({ lat: 48.8566, lon: 2.3522, countryCode: "FR" })).toBe(false); // Paris
    expect(isOutsideReportedCountry({ lat: 59.9139, lon: 10.7522, countryCode: "NO" })).toBe(false); // Oslo
  });

  it("doesn't flag a record with no reported country — nothing to contradict", () => {
    expect(isOutsideReportedCountry({ lat: 48.8566, lon: 2.3522 })).toBe(false);
  });

  it("doesn't flag a record whose reported country code has no matching reference polygon", () => {
    expect(isOutsideReportedCountry({ lat: 48.8566, lon: 2.3522, countryCode: "ZZ" })).toBe(false);
  });

  it("flags a point outside every country when one is reported", () => {
    expect(isOutsideReportedCountry({ ...FAR_FROM_EVERYTHING, countryCode: "US" })).toBe(true);
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
      { lon: -0.11672, lat: 51.49999 }, // London capital
    ];
    const flags = getQualityFlags(records);
    // (0,0) also happens to be ~7m from a real GRSciColl institution whose own
    // coordinates are themselves defaulted to null island (and, being in the Gulf of
    // Guinea, it's also in the ocean), and is itself a confirmed entry in the AHOI
    // dataset (a "geopolitical_centroid" — unsurprising, since null island is the
    // canonical artificial coordinate default); GBIF's Copenhagen HQ is genuinely
    // ~1.4km from Denmark's real national capital point, and its own (12.58, 55.67)
    // coordinate — only 2 decimal places, ~1km precision — lands in Copenhagen's
    // harbor rather than on the building itself, so it also reads as OCEAN even at
    // 50m; and London's capital point falls inside its own real urban-area polygon —
    // all honest overlaps in the live reference data, not bugs in this test.
    expect(flags[0].sort()).toEqual(
      ["EQUAL_COORDINATES", "NEAR_INSTITUTION", "OCEAN", "ZERO_COORDINATE", "ARTIFICIAL_HOTSPOT"].sort()
    );
    expect(flags[1].sort()).toEqual(["GBIF_HEADQUARTERS", "NEAR_CAPITAL", "OCEAN"].sort());
    expect(flags[2].sort()).toEqual(["DUPLICATE", "GBIF_HEADQUARTERS", "NEAR_CAPITAL", "OCEAN"].sort());
    expect(flags[3]).toEqual([]);
    expect(flags[4].sort()).toEqual(["NEAR_CAPITAL", "URBAN_AREA"].sort());
  });
});
