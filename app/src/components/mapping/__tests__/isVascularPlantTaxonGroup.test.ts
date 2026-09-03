import { describe, it, expect } from "vitest";
import { isVascularPlantTaxonGroup } from "../OccurrenceMapRow";

// ---------------------------------------------------------------------------
// isVascularPlantTaxonGroup — gates the POWO/WCVP native-range fetch, since WCVP
// only covers vascular plants (not mosses, algae, fungi, or animals).
// ---------------------------------------------------------------------------
describe("isVascularPlantTaxonGroup", () => {
  it.each(["flowering_plants", "gymnosperms", "ferns_and_allies"])(
    "returns true for vascular plant group %s",
    (group) => {
      expect(isVascularPlantTaxonGroup(group)).toBe(true);
    }
  );

  it.each(["mosses", "green_algae", "red_algae", "mushrooms", "brown_algae", "mammals", "birds"])(
    "returns false for non-vascular-plant group %s",
    (group) => {
      expect(isVascularPlantTaxonGroup(group)).toBe(false);
    }
  );

  it("returns false when taxonGroup is undefined", () => {
    expect(isVascularPlantTaxonGroup(undefined)).toBe(false);
  });
});
