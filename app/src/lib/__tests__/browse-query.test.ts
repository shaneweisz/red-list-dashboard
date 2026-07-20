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
    threat_codes: ["11.4"], growth_forms: [], gbif_occurrence_count: 5,
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
});
