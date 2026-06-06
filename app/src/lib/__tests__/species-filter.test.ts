import { describe, it, expect } from "vitest";
import { matchesSpeciesFilter, type FilterableSpecies } from "@/lib/species-filter";

function sp(overrides: Partial<FilterableSpecies> = {}): FilterableSpecies {
  return {
    category: "VU",
    countries: ["BR"],
    systems: ["Marine"],
    population_trend: "Decreasing",
    movement_pattern: null,
    threat_codes: ["11.4"],
    has_map: true,
    growth_forms: [],
    scientific_name: "Acropora cervicornis",
    common_name: "Staghorn coral",
    ...overrides,
  };
}

describe("matchesSpeciesFilter", () => {
  it("matches everything with empty criteria", () => {
    expect(matchesSpeciesFilter(sp(), {})).toBe(true);
  });

  it("matches category exactly", () => {
    expect(matchesSpeciesFilter(sp({ category: "CR" }), { categories: new Set(["CR"]) })).toBe(true);
    expect(matchesSpeciesFilter(sp({ category: "EN" }), { categories: new Set(["CR"]) })).toBe(false);
  });

  it("matches threats by prefix", () => {
    expect(matchesSpeciesFilter(sp({ threat_codes: ["11.4"] }), { threats: new Set(["11"]) })).toBe(true);
    expect(matchesSpeciesFilter(sp({ threat_codes: ["11"] }), { threats: new Set(["11"]) })).toBe(true);
    expect(matchesSpeciesFilter(sp({ threat_codes: ["5.4"] }), { threats: new Set(["11"]) })).toBe(false);
    // prefix must be on a dot boundary, not a substring
    expect(matchesSpeciesFilter(sp({ threat_codes: ["110"] }), { threats: new Set(["11"]) })).toBe(false);
  });

  it("ORs multiple values within one filter", () => {
    const f = { threats: new Set(["11", "9"]) };
    expect(matchesSpeciesFilter(sp({ threat_codes: ["9.1"] }), f)).toBe(true);
    expect(matchesSpeciesFilter(sp({ threat_codes: ["11.2"] }), f)).toBe(true);
    expect(matchesSpeciesFilter(sp({ threat_codes: ["2.1"] }), f)).toBe(false);
  });

  it("ANDs across different filters", () => {
    const f = { threats: new Set(["11"]), categories: new Set(["CR"]) };
    expect(matchesSpeciesFilter(sp({ threat_codes: ["11.1"], category: "CR" }), f)).toBe(true);
    expect(matchesSpeciesFilter(sp({ threat_codes: ["11.1"], category: "EN" }), f)).toBe(false);
    expect(matchesSpeciesFilter(sp({ threat_codes: ["5.4"], category: "CR" }), f)).toBe(false);
  });

  it("matches countries (OR) and systems", () => {
    expect(matchesSpeciesFilter(sp({ countries: ["US", "MX"] }), { countries: new Set(["MX"]) })).toBe(true);
    expect(matchesSpeciesFilter(sp({ countries: ["US"] }), { countries: new Set(["MX"]) })).toBe(false);
    expect(matchesSpeciesFilter(sp({ systems: ["Freshwater"] }), { systems: new Set(["Marine"]) })).toBe(false);
  });

  it("matches population trend and movement", () => {
    expect(matchesSpeciesFilter(sp({ population_trend: "Decreasing" }), { populationTrends: new Set(["Decreasing"]) })).toBe(true);
    expect(matchesSpeciesFilter(sp({ population_trend: null }), { populationTrends: new Set(["Decreasing"]) })).toBe(false);
  });

  it("matches hasMap", () => {
    expect(matchesSpeciesFilter(sp({ has_map: true }), { hasMap: "yes" })).toBe(true);
    expect(matchesSpeciesFilter(sp({ has_map: true }), { hasMap: "no" })).toBe(false);
    expect(matchesSpeciesFilter(sp({ has_map: false }), { hasMap: "no" })).toBe(true);
  });

  it("matches name search (scientific or common), needle pre-lowercased", () => {
    expect(matchesSpeciesFilter(sp(), { search: "acropora" })).toBe(true);
    expect(matchesSpeciesFilter(sp(), { search: "staghorn" })).toBe(true);
    expect(matchesSpeciesFilter(sp(), { search: "tiger" })).toBe(false);
    expect(matchesSpeciesFilter(sp({ common_name: null }), { search: "staghorn" })).toBe(false);
  });

  it("handles missing optional arrays safely", () => {
    expect(matchesSpeciesFilter(sp({ threat_codes: null }), { threats: new Set(["11"]) })).toBe(false);
    expect(matchesSpeciesFilter(sp({ systems: null }), { systems: new Set(["Marine"]) })).toBe(false);
  });
});
