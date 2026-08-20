/**
 * matchingRegions — the reverse mapping that lets a country selection be shown
 * (and re-ticked) as whole IUCN regions. The region picker round-trips through
 * this, so "tick a box, get that box back ticked" has to hold exactly.
 */
import { describe, it, expect } from "vitest";
import {
  matchingRegion,
  matchingRegions,
  iucnRegionCountries,
  IUCN_REGION_ORDER,
} from "../regions";

const EUROPE = iucnRegionCountries("Europe");
const NORTH_AMERICA = iucnRegionCountries("North America");
const SOUTH_AMERICA = iucnRegionCountries("South America");

describe("matchingRegions", () => {
  it("reports nothing for an empty selection", () => {
    expect(matchingRegions(new Set())).toEqual([]);
  });

  it("reports the one region a full single-region selection covers", () => {
    expect(matchingRegions(EUROPE)).toEqual(["Europe"]);
  });

  it("reports both regions when two are fully covered — Jemma's North + South America", () => {
    expect(matchingRegions([...NORTH_AMERICA, ...SOUTH_AMERICA]))
      .toEqual(["North America", "South America"]);
  });

  it("returns regions in IUCN_REGION_ORDER, not selection order", () => {
    const scrambled = [...SOUTH_AMERICA, ...EUROPE, ...NORTH_AMERICA];
    const got = matchingRegions(scrambled);
    const expectedOrder = IUCN_REGION_ORDER.filter((r) => got.includes(r));
    expect(got).toEqual(expectedOrder);
  });

  it("reports nothing when a region is only partly selected", () => {
    expect(matchingRegions(EUROPE.slice(0, 3))).toEqual([]);
  });

  it("reports nothing when a stray country sits outside the covered regions", () => {
    // A whole region plus one extra country is an arbitrary selection, not
    // "that region" — mislabelling it would make the checkbox lie.
    const stray = NORTH_AMERICA.find((c) => !EUROPE.includes(c))!;
    expect(matchingRegions([...EUROPE, stray])).toEqual([]);
  });

  it("round-trips: ticking every region selects every region's countries", () => {
    const all = IUCN_REGION_ORDER.flatMap((r) => iucnRegionCountries(r));
    expect(matchingRegions(all)).toEqual(IUCN_REGION_ORDER);
  });
});

describe("matchingRegion (single-region view, unchanged behaviour)", () => {
  it("still names a single fully-covered region", () => {
    expect(matchingRegion(EUROPE)).toBe("Europe");
  });

  it("still returns null once the selection spans two whole regions", () => {
    expect(matchingRegion([...NORTH_AMERICA, ...SOUTH_AMERICA])).toBeNull();
  });

  it("still returns null for an empty or partial selection", () => {
    expect(matchingRegion(new Set())).toBeNull();
    expect(matchingRegion(EUROPE.slice(0, 2))).toBeNull();
  });
});
