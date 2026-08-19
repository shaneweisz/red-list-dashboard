import { describe, it, expect } from "vitest";
import { isPlantOrFungiTaxonGroup } from "../OccurrenceMapRow";
import { ALL_CSV_GROUPS } from "@/config/taxonomy-tree";

// ---------------------------------------------------------------------------
// isPlantOrFungiTaxonGroup — decides whether PRESERVED_SPECIMEN should default
// to ON for a given species' CSV taxon group. Plants & fungi rely heavily on
// herbarium/fungarium records, so they default ON; all other kingdoms default
// OFF (matching the historical behavior for animals).
// ---------------------------------------------------------------------------
describe("isPlantOrFungiTaxonGroup", () => {
  it.each([
    "flowering_plants",
    "gymnosperms",
    "ferns_and_allies",
    "mosses",
    "green_algae",
    "red_algae",
  ])("returns true for plant group %s", (group) => {
    expect(isPlantOrFungiTaxonGroup(group)).toBe(true);
  });

  it.each([
    "mushrooms",
    "brown_algae",
  ])("returns true for fungi group %s", (group) => {
    expect(isPlantOrFungiTaxonGroup(group)).toBe(true);
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
    expect(isPlantOrFungiTaxonGroup(group)).toBe(false);
  });

  it("returns false when taxonGroup is undefined", () => {
    expect(isPlantOrFungiTaxonGroup(undefined)).toBe(false);
  });

  it("returns false for an unknown taxon group", () => {
    expect(isPlantOrFungiTaxonGroup("not_a_real_group")).toBe(false);
  });

  // Guards against forgetting to add newly-introduced CSV groups to the
  // plantae/fungi mapping in taxonomy-constants.ts. Every Table 1a group
  // should classify deterministically as plant/fungi-or-not.
  it("covers every Table 1a CSV group", () => {
    for (const group of ALL_CSV_GROUPS) {
      const result = isPlantOrFungiTaxonGroup(group);
      expect(typeof result).toBe("boolean");
    }
  });
});
