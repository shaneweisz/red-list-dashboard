/**
 * runBrowseQuery — the shared query logic behind both /browse and the /api/mcp
 * tools. The DuckDB read layer is mocked so these stay hermetic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { querySpecies, searchSpecies } = vi.hoisted(() => ({ querySpecies: vi.fn(), searchSpecies: vi.fn() }));
vi.mock("@/lib/data/species-duckdb", () => ({ querySpecies, searchSpecies }));

import { runBrowseQuery } from "../browse-query";

function row(over: Record<string, unknown> = {}) {
  return {
    id: Math.floor(Math.random() * 1e9), scientific_name: "Acropora sp.", common_name: null,
    category: "EN", countries: ["AU"], systems: [], population_trend: null, movement_pattern: null,
    threat_codes: ["11.4"], has_map: false, growth_forms: [], gbif_occurrence_count: 5,
    assessment_date: "2020-01-01", taxon_group: "corals", class_name: "anthozoa",
    order_name: "scleractinia", family: "acroporidae",
    latest_assessors: "Smith, J.A.", latest_reviewers: "Jones, B.", described_year: 2000, ...over,
  };
}

beforeEach(() => {
  querySpecies.mockReset(); searchSpecies.mockReset();
  querySpecies.mockResolvedValue({ species: [], truncated: false, tooLarge: false, neTotal: null });
  searchSpecies.mockResolvedValue([]);
});

describe("runBrowseQuery", () => {
  it("flags noSelector when no taxon or search is given", async () => {
    const r = await runBrowseQuery({});
    expect(r.noSelector).toBe(true);
    expect(querySpecies).not.toHaveBeenCalled();
  });

  it("browses a taxon: total, breakdown, and threats carry the parent category", async () => {
    querySpecies.mockResolvedValue({ species: [row(), row({ category: "VU" })], truncated: false, tooLarge: false, neTotal: null });
    const r = await runBrowseQuery({ taxa: ["corals"] });
    expect(querySpecies).toHaveBeenCalledWith(expect.objectContaining({ taxon: "corals" }));
    expect(r.total).toBe(2);
    expect(r.breakdown).toEqual({ EN: 1, VU: 1 });
    expect(r.species[0].threats[0]).toEqual({ code: "11.4", label: "Climate change (Storms & flooding)" });
  });

  it("applies a category filter", async () => {
    querySpecies.mockResolvedValue({ species: [row({ category: "EN" }), row({ category: "LC" })], truncated: false, tooLarge: false, neTotal: null });
    const r = await runBrowseQuery({ taxa: ["corals"], categories: ["EN"] });
    expect(r.total).toBe(1);
  });

  it("looks up a species via searchSpecies (synonym-aware)", async () => {
    searchSpecies.mockResolvedValue([
      { id: -1, scientific_name: "Acinonyx jubatus", common_name: "Cheetah", taxon_id: "mammals",
        taxon_group: "mammals", category: "VU", gbif_species_key: null, assessment_id: null,
        assessment_date: "2021-01-01", countries: ["NA"], matched_synonym: "Felis jubata" },
    ]);
    const r = await runBrowseQuery({ search: "Felis jubata" });
    expect(querySpecies).not.toHaveBeenCalled();
    expect(r.species[0].scientific_name).toBe("Acinonyx jubatus");
    expect(r.species[0].matched_synonym).toBe("Felis jubata");
  });

  it("expands an IUCN region to its countries", async () => {
    const { iucnRegionCountries } = await import("@/lib/regions");
    const eu = iucnRegionCountries("Europe")[0];
    querySpecies.mockResolvedValue({ species: [row({ id: 1, countries: [eu] }), row({ id: 2, countries: ["ZZ"] })], truncated: false, tooLarge: false, neTotal: null });
    const r = await runBrowseQuery({ taxa: ["corals"], region: ["Europe"] });
    expect(r.total).toBe(1);
  });

  it("computes country_count and carries primary-source identifiers", async () => {
    querySpecies.mockResolvedValue({
      species: [row({ countries: ["AU", "FJ", "ID"], sis_taxon_id: 42, assessment_id: 99, gbif_species_key: 7, col_id: "X1" })],
      truncated: false, tooLarge: false, neTotal: null,
    });
    const r = await runBrowseQuery({ taxa: ["corals"] });
    expect(r.species[0].country_count).toBe(3);
    expect(r.species[0]).toMatchObject({ sis_taxon_id: 42, assessment_id: 99, gbif_species_key: 7, col_id: "X1" });
    // No country/region filter → endemism is undeterminable.
    expect(r.species[0].endemic_to_query).toBeNull();
  });

  it("flags endemic_to_query when every range country is inside the filter", async () => {
    querySpecies.mockResolvedValue({
      species: [
        row({ id: 1, scientific_name: "Endemic sp.", countries: ["ZA"] }),
        row({ id: 2, scientific_name: "Wide sp.", countries: ["ZA", "MZ", "AU"] }),
      ],
      truncated: false, tooLarge: false, neTotal: null,
    });
    const r = await runBrowseQuery({ taxa: ["corals"], countries: ["ZA"] });
    const endemic = r.species.find((s) => s.scientific_name === "Endemic sp.");
    const wide = r.species.find((s) => s.scientific_name === "Wide sp.");
    expect(endemic?.endemic_to_query).toBe(true);
    expect(wide?.endemic_to_query).toBe(false);
  });

  it("aggregates groupBy over the full matched set, not just the capped list", async () => {
    querySpecies.mockResolvedValue({
      species: [
        row({ id: 1, threat_codes: ["5.1"], population_trend: "Decreasing" }),
        row({ id: 2, threat_codes: ["5.4", "11.4"], population_trend: "Decreasing" }),
        row({ id: 3, threat_codes: ["11.1"], population_trend: "Stable" }),
      ],
      truncated: false, tooLarge: false, neTotal: null,
    });
    const r = await runBrowseQuery({ taxa: ["corals"], groupBy: ["threat", "trend"] });
    // Threats counted once per distinct top-level code: code 5 → 2 species, code 11 → 2 species.
    // Equal counts tie-break on the string value ("11" sorts before "5").
    expect(r.groups.threat).toEqual([
      { value: "11", label: "Climate change", count: 2 },
      { value: "5", label: "Harvesting", count: 2 },
    ]);
    expect(r.groups.trend).toEqual([
      { value: "Decreasing", count: 2 },
      { value: "Stable", count: 1 },
    ]);
  });

  it("groups by endemism relative to the query country set", async () => {
    querySpecies.mockResolvedValue({
      species: [row({ id: 1, countries: ["ZA"] }), row({ id: 2, countries: ["ZA", "AU"] })],
      truncated: false, tooLarge: false, neTotal: null,
    });
    const r = await runBrowseQuery({ taxa: ["corals"], countries: ["ZA"], groupBy: ["endemism"] });
    const map = Object.fromEntries(r.groups.endemism.map((b) => [b.value, b.count]));
    expect(map).toEqual({ endemic_to_query: 1, not_endemic_to_query: 1 });
  });

  it("surfaces a narrowing note when a colloquial taxon silently narrows", async () => {
    querySpecies.mockResolvedValue({ species: [row()], truncated: false, tooLarge: false, neTotal: null });
    const r = await runBrowseQuery({ taxa: ["plants"] });
    expect(r.narrowingNotes.join(" ")).toMatch(/Flowering Plants only/i);
  });
});
