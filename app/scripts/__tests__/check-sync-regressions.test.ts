import { describe, it, expect } from "vitest";
import { compareStats, type GroupStats, detectSystematicDrift } from "../check-sync-regressions";

const g = (
  taxonGroup: string,
  withKey: number,
  occurrences: number,
  unassessed = 0,
  unassessedNamed = 0,
  colDescribed = 0,
): GroupStats => ({
  taxonGroup,
  species: withKey,
  withKey,
  occurrences,
  unassessed,
  unassessedNamed,
  colDescribed,
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

describe("the unassessed half", () => {
  it("catches a browsable-species collapse the assessed numbers cannot see", () => {
    // brown_algae went 6,381 -> 710 browsable species while its assessed figures
    // barely moved. The check originally read only assessed.parquet, so 75% of
    // the dataset — and the entire browsing experience — had no guard at all.
    const deltas = compareStats(
      [g("brown_algae", 18, 500_000, 6381, 400)],
      [g("brown_algae", 18, 500_000, 710, 40)]
    );
    expect(deltas.map((d) => d.metric)).toContain("browsable species");
  });

  it("catches common names disappearing", () => {
    // 88,573 names went to zero once and shipped, because nothing counted them.
    const deltas = compareStats(
      [g("birds", 11000, 900_000_000, 5000, 4400)],
      [g("birds", 11000, 900_000_000, 5000, 0)]
    );
    const names = deltas.find((d) => d.metric === "common names");
    expect(names?.pctChange).toBe(-1);
  });
});

describe("detectSystematicDrift", () => {
  const group = (taxonGroup: string, unassessed: number): GroupStats => ({
    taxonGroup, species: 100, withKey: 100, occurrences: 100_000, unassessed, unassessedNamed: unassessed, colDescribed: 200_000,
  });

  it("catches every group moving the same way, far below the per-group threshold", () => {
    // The case that slipped through: two releases of curated-checklist
    // reconciliation moved browsable species down in 22 groups and up in none,
    // a total of 0.11% — a hundredth of MATERIAL_CHANGE, so compareStats was
    // silent, and a human noticed the numbers instead.
    const before = Array.from({ length: 22 }, (_, i) => group(`g${i}`, 100_000));
    const after = Array.from({ length: 22 }, (_, i) => group(`g${i}`, 99_890));
    expect(compareStats(before, after)).toEqual([]);          // magnitude test: silent
    const drift = detectSystematicDrift(before, after);
    const browsable = drift.find((d) => d.metric === "browsable species")!;
    expect(browsable.groupsDown).toBe(22);
    expect(browsable.groupsUp).toBe(0);
    expect(browsable.pctChange).toBeCloseTo(-0.0011, 5);
  });

  it("stays quiet when groups disagree, which is what noise looks like", () => {
    const before = Array.from({ length: 22 }, (_, i) => group(`g${i}`, 100_000));
    const after = before.map((g, i) => group(g.taxonGroup, i % 2 ? 100_120 : 99_880));
    expect(detectSystematicDrift(before, after).some((d) => d.metric === "browsable species")).toBe(false);
  });

  it("stays quiet on too few groups to read a direction from", () => {
    const before = Array.from({ length: 4 }, (_, i) => group(`g${i}`, 100_000));
    const after = Array.from({ length: 4 }, (_, i) => group(`g${i}`, 99_890));
    expect(detectSystematicDrift(before, after)).toEqual([]);
  });

  it("stays quiet when nothing really moved, so rounding can't raise an alarm", () => {
    const before = Array.from({ length: 22 }, (_, i) => group(`g${i}`, 1_000_000));
    const after = Array.from({ length: 22 }, (_, i) => group(`g${i}`, 999_999));
    expect(detectSystematicDrift(before, after).some((d) => d.metric === "browsable species")).toBe(false);
  });
});

describe("CoL described species", () => {
  it("catches a described denominator collapsing, which no GBIF metric sees", () => {
    // Every other metric here comes from the GBIF-derived parquets. col_described
    // comes from the CoL universe, so a group losing its described count was
    // invisible to all of them — and it is the denominator under every
    // "% assessed" figure on the dashboard.
    const before = [g("plants", 100, 100_000, 0, 0, 356_867)];
    const after = [g("plants", 100, 100_000, 0, 0, 200_000)];
    const d = compareStats(before, after).find((x) => x.metric === "CoL described species");
    expect(d).toBeDefined();
    expect(d!.pctChange).toBeLessThan(-0.4);
  });

  it("reports a one-directional described drift too small for the magnitude test", () => {
    // The real case: -0.11% across 22 groups, none up.
    const before = Array.from({ length: 22 }, (_, i) => g(`g${i}`, 100, 100_000, 0, 0, 100_000));
    const after = Array.from({ length: 22 }, (_, i) => g(`g${i}`, 100, 100_000, 0, 0, 99_890));
    expect(compareStats(before, after)).toEqual([]);
    const drift = detectSystematicDrift(before, after).find((x) => x.metric === "CoL described species");
    expect(drift).toBeDefined();
    expect(drift!.groupsDown).toBe(22);
    expect(drift!.groupsUp).toBe(0);
  });
});
