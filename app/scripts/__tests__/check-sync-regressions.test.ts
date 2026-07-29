import { describe, it, expect } from "vitest";
import { compareStats, type GroupStats } from "../check-sync-regressions";

const g = (taxonGroup: string, withKey: number, occurrences: number): GroupStats => ({
  taxonGroup,
  species: withKey,
  withKey,
  occurrences,
});

describe("compareStats", () => {
  it("catches a group losing most of its occurrence data", () => {
    // The real case: corals kept most of their species but lost every octocoral,
    // taking 45% of the group's records with them. Nothing in the previous sync
    // reported it, so it shipped.
    const before = [g("corals", 5444, 27_680_954)];
    const after = [g("corals", 3222, 15_241_815)];

    const deltas = compareStats(before, after);
    expect(deltas.map((d) => d.metric)).toContain("occurrences");
    const occ = deltas.find((d) => d.metric === "occurrences")!;
    expect(occ.pctChange).toBeLessThan(-0.4);
  });

  it("catches a group whose species nearly all vanish", () => {
    // Mantodea: 1,110 species down to 97 after a key-space mismatch.
    const deltas = compareStats([g("other_insects", 1110, 371_880)], [g("other_insects", 97, 1_882)]);
    expect(deltas.filter((d) => d.pctChange < -0.9)).toHaveLength(2);
  });

  it("reports a group that disappeared entirely", () => {
    const deltas = compareStats([g("corals", 5444, 27_680_954)], []);
    expect(deltas).toEqual([
      { taxonGroup: "corals", metric: "species with GBIF data", before: 5444, after: 0, pctChange: -1 },
    ]);
  });

  it("stays quiet for the ordinary drift a resync produces", () => {
    // A taxonomy change moves every number a little; only material moves matter.
    const before = [g("mammals", 5000, 40_000_000)];
    const after = [g("mammals", 5010, 40_400_000)];
    expect(compareStats(before, after)).toEqual([]);
  });

  it("ignores groups too small to draw conclusions from", () => {
    // Horseshoe crabs are four species; one moving is not a signal.
    expect(compareStats([g("horseshoe_crabs", 4, 900)], [g("horseshoe_crabs", 2, 400)])).toEqual([]);
  });

  it("reports gains as well as losses, so a suspicious jump is visible too", () => {
    // 371 species jumped tenfold last time by inheriting another species' records.
    const deltas = compareStats([g("butterflies_and_moths", 800, 14_600_000)], [g("butterflies_and_moths", 800, 21_640_000)]);
    expect(deltas.some((d) => d.pctChange > 0.4)).toBe(true);
  });
});
