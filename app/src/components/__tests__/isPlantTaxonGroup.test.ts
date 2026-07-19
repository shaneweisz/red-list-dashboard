import { describe, it, expect } from "vitest";
import { isPlantTaxonGroup } from "../OccurrenceMapRow";
import { ALL_CSV_GROUPS } from "@/config/taxonomy-tree";

// ---------------------------------------------------------------------------
// isPlantTaxonGroup — decides whether "Native range only" should default to ON
// for a given species' CSV taxon group (issue #82). Narrower than
// isPlantOrFungiTaxonGroup: plants only, not fungi, since the cultivated/
// naturalized botanical-garden problem this filter targets is plant-specific.
// ---------------------------------------------------------------------------
describe("isPlantTaxonGroup", () => {
  it.each([
    "flowering_plants",
    "gymnosperms",
    "ferns_and_allies",
    "mosses",
    "green_algae",
    "red_algae",
  ])("returns true for plant group %s", (group) => {
    expect(isPlantTaxonGroup(group)).toBe(true);
  });

  it.each([
    "mushrooms",
    "brown_algae",
  ])("returns false for fungi group %s", (group) => {
    expect(isPlantTaxonGroup(group)).toBe(false);
  });

  it.each([
    "mammals",
    "birds",
    "reptiles",
    "amphibians",
    "fishes",
    "beetles",
    "other_insects",
    "arachnids",
    "molluscs",
    "crustaceans",
    "corals",
    "other_invertebrates",
    "velvet_worms",
    "horseshoe_crabs",
  ])("returns false for animal group %s", (group) => {
    expect(isPlantTaxonGroup(group)).toBe(false);
  });

  it("returns false when taxonGroup is undefined", () => {
    expect(isPlantTaxonGroup(undefined)).toBe(false);
  });

  it("returns false for an unknown taxon group", () => {
    expect(isPlantTaxonGroup("not_a_real_group")).toBe(false);
  });

  it("covers every Table 1a CSV group", () => {
    for (const group of ALL_CSV_GROUPS) {
      const result = isPlantTaxonGroup(group);
      expect(typeof result).toBe("boolean");
    }
  });
});
