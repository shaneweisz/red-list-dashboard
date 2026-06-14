import { describe, it, expect } from "vitest";
import {
  resolveThreats, resolveCategories, resolveTaxa, resolveCountries,
  categoryLabel, taxonLabel, threatDisplay, THREAT_LABEL,
} from "@/lib/filter-vocab";

describe("resolveThreats", () => {
  it("accepts codes, sub-codes, slugs and labels", () => {
    expect(resolveThreats(["climate-change"]).codes).toEqual(["11"]);
    expect(resolveThreats(["global warming"]).codes).toEqual(["11"]);
    expect(resolveThreats(["11"]).codes).toEqual(["11"]);
    expect(resolveThreats(["11.4"]).codes).toEqual(["11.4"]);
    expect(resolveThreats(["pollution"]).codes).toEqual(["9"]);
    expect(resolveThreats(["overfishing"]).codes).toEqual(["5.4"]);
    expect(resolveThreats(["Climate change"]).codes).toEqual(["11"]);
  });
  it("reports unresolved values but keeps the rest", () => {
    const r = resolveThreats(["climate-change", "asteroids"]);
    expect(r.codes).toEqual(["11"]);
    expect(r.unresolved).toEqual(["asteroids"]);
  });
});

describe("resolveCategories", () => {
  it("accepts codes, slugs, names, and expands groups", () => {
    expect(resolveCategories(["EN"]).codes).toEqual(["EN"]);
    expect(resolveCategories(["endangered"]).codes).toEqual(["EN"]);
    expect(resolveCategories(["Critically Endangered"]).codes).toEqual(["CR"]);
    expect(resolveCategories(["threatened"]).codes).toEqual(["CR", "EN", "VU"]);
    expect(resolveCategories(["extinct"]).codes).toEqual(["EX", "EW"]);
  });
  it("reports unresolved", () => {
    expect(resolveCategories(["doomed"]).unresolved).toEqual(["doomed"]);
  });
});

describe("resolveTaxa", () => {
  it("accepts node ids and common names", () => {
    expect(resolveTaxa(["corals"]).ids).toEqual(["corals"]);
    expect(resolveTaxa(["birds"]).ids).toEqual(["birds"]);
    expect(resolveTaxa(["aves"]).ids).toEqual(["birds"]); // legacy/latin alias normalizes
    expect(resolveTaxa(["frogs"]).ids).toEqual(["amphibians"]);
    expect(resolveTaxa(["mammals"]).ids).toEqual(["mammals"]);
    expect(resolveTaxa(["sharks"]).ids).toEqual(["sharks-rays"]);
  });
  it("treats 'all' as unresolved; passes single-word scientific names through as arbitrary-rank ids", () => {
    expect(resolveTaxa(["all"]).ids).toEqual([]);
    // a class/order/family with no curated node resolves to an arbitrary-rank id
    // (matched by rank in the read layer; a non-taxon just yields zero results).
    expect(resolveTaxa(["felidae"]).ids).toEqual(["felidae"]);
    // multi-word / punctuated values aren't taxa (species names go to `search`).
    expect(resolveTaxa(["not a taxon"]).unresolved).toEqual(["not a taxon"]);
  });
});

describe("resolveCountries", () => {
  it("accepts codes and names, case-insensitive", () => {
    expect(resolveCountries(["BR"]).codes).toEqual(["BR"]);
    expect(resolveCountries(["Brazil"]).codes).toEqual(["BR"]);
    expect(resolveCountries(["brazil"]).codes).toEqual(["BR"]);
    expect(resolveCountries(["USA"]).codes).toEqual(["US"]);
  });
  it("reports unresolved", () => {
    expect(resolveCountries(["Atlantis"]).unresolved).toEqual(["Atlantis"]);
  });
});

describe("labels", () => {
  it("renders human-readable labels", () => {
    expect(THREAT_LABEL["11"]).toBe("Climate change");
    expect(categoryLabel("EN")).toContain("Endangered");
    expect(taxonLabel("corals")).toMatch(/coral/i);
    // threat codes render with their top-level category for context; deep sub-codes
    // walk up to the nearest known label (no bare numbers)
    expect(threatDisplay("11.4")).toBe("Climate change (Storms & flooding)");
    expect(threatDisplay("5.4.1")).toBe("Harvesting (Fishing & harvesting)");
    expect(threatDisplay("11")).toBe("Climate change");
  });
});
