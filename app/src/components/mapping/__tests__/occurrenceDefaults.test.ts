/**
 * What the occurrence viewer shows before anyone touches a filter.
 *
 * These defaults decide what an assessor sees first, and for plants and fungi
 * the old ones hid most of the evidence: specimens off, and cleaning checks
 * trimming points on plausibility heuristics. Worth pinning down.
 */
import { describe, it, expect } from "vitest";
import { defaultCheckedTypes, defaultAppliedChecks } from "../OccurrenceMapRow";

const PLANT_AND_FUNGI_GROUPS = ["flowering_plants", "gymnosperms", "ferns_and_allies", "mushrooms"];
const ANIMAL_GROUPS = ["mammals", "birds", "reptiles", "amphibians", "fishes"];

describe("defaultCheckedTypes", () => {
  it.each(PLANT_AND_FUNGI_GROUPS)("selects every record type for %s", (group) => {
    expect(Object.values(defaultCheckedTypes(group)).every(Boolean)).toBe(true);
  });

  it.each(ANIMAL_GROUPS)("keeps specimens and citations off for %s", (group) => {
    const types = defaultCheckedTypes(group);
    expect(types.preservedSpecimen).toBe(false);
    expect(types.fossilSpecimen).toBe(false);
    expect(types.materialCitation).toBe(false);
    // Field observations stay on, which is what these counts have always meant.
    expect(types.humanObservation).toBe(true);
    expect(types.machineObservation).toBe(true);
  });

  it("falls back to the narrower set when the taxon group is unknown", () => {
    expect(defaultCheckedTypes(undefined).preservedSpecimen).toBe(false);
  });
});

describe("defaultAppliedChecks", () => {
  it.each(PLANT_AND_FUNGI_GROUPS)("applies no cleaning check for %s", (group) => {
    expect(Object.values(defaultAppliedChecks(group)).some(Boolean)).toBe(false);
  });

  it.each(ANIMAL_GROUPS)("still drops null island and duplicates for %s", (group) => {
    const checks = defaultAppliedChecks(group);
    expect(checks.ZERO_COORDINATE).toBe(true);
    expect(checks.DUPLICATE).toBe(true);
    // Everything else is opt-in: these are heuristics with false positives.
    expect(checks.NEAR_CAPITAL).toBe(false);
    expect(checks.URBAN_AREA).toBe(false);
    expect(checks.OUTSIDE_REPORTED_COUNTRY).toBe(false);
  });
});
