/**
 * /browse route tests. The DuckDB read layer (querySpecies/searchSpecies) is
 * mocked so these stay hermetic — they cover the route's own logic: mode
 * selection (taxon browse vs species search), the index/self-describe path,
 * filter application, and JSON shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { querySpecies, searchSpecies } = vi.hoisted(() => ({ querySpecies: vi.fn(), searchSpecies: vi.fn() }));
vi.mock("@/lib/data/species-duckdb", () => ({ querySpecies, searchSpecies }));

import { NextRequest } from "next/server";
import { iucnRegionCountries } from "@/lib/regions";
import { GET } from "../route";

function req(qs: string) {
  return new NextRequest(`https://example.test/browse${qs}`);
}
const json = (qs: string) => GET(req(qs)).then((r) => r.json());

// A minimal querySpecies row (the fields /browse reads).
function row(over: Record<string, unknown> = {}) {
  return {
    id: Math.floor(Math.random() * 1e9), scientific_name: "Acropora sp.", common_name: null,
    category: "EN", countries: ["AU"], systems: [], population_trend: null, movement_pattern: null,
    threat_codes: ["11.1"], has_map: false, growth_forms: [], gbif_occurrence_count: 5,
    assessment_date: "2020-01-01", taxon_group: "corals", class_name: "anthozoa",
    order_name: "scleractinia", family: "acroporidae",
    latest_assessors: "Smith, J.A.", latest_reviewers: "Jones, B.", described_year: 2000, ...over,
  };
}

beforeEach(() => {
  querySpecies.mockReset();
  searchSpecies.mockReset();
  querySpecies.mockResolvedValue({ species: [], truncated: false, tooLarge: false, neTotal: null });
  searchSpecies.mockResolvedValue([]);
});

describe("/browse", () => {
  it("returns a self-describing index when called bare (json)", async () => {
    const d = await json("?format=json");
    expect(d.params.taxa.length).toBeGreaterThan(0);
    expect(d.examples.length).toBeGreaterThan(0);
    expect(querySpecies).not.toHaveBeenCalled();
  });

  it("browses a taxon via querySpecies and reports total + breakdown", async () => {
    querySpecies.mockResolvedValue({ species: [row(), row({ category: "VU" })], truncated: false, tooLarge: false, neTotal: null });
    const d = await json("?taxa=corals&format=json");
    expect(querySpecies).toHaveBeenCalledWith(expect.objectContaining({ taxon: "corals" }));
    expect(d.total).toBe(2);
    expect(d.breakdown).toEqual({ EN: 1, VU: 1 });
  });

  it("applies a category filter to the queried rows", async () => {
    querySpecies.mockResolvedValue({ species: [row({ category: "EN" }), row({ category: "LC" })], truncated: false, tooLarge: false, neTotal: null });
    const d = await json("?taxa=corals&categories=EN&format=json");
    expect(d.total).toBe(1);
    expect(d.species[0].category).toBe("EN");
  });

  it("looks up a species via searchSpecies (synonym-aware), not querySpecies", async () => {
    searchSpecies.mockResolvedValue([
      { id: -1, scientific_name: "Acinonyx jubatus", common_name: "Cheetah", taxon_id: "mammals",
        taxon_group: "mammals", category: "VU", gbif_species_key: null, assessment_id: null,
        assessment_date: "2021-01-01", countries: ["NA"], matched_synonym: "Felis jubata" },
    ]);
    const d = await json("?search=Felis+jubata&format=json");
    expect(searchSpecies).toHaveBeenCalled();
    expect(querySpecies).not.toHaveBeenCalled();
    expect(d.species[0].scientific_name).toBe("Acinonyx jubatus");
    expect(d.species[0].matched_synonym).toBe("Felis jubata");
  });

  it("reports unresolved values", async () => {
    const d = await json("?taxa=birds&threats=asteroids&format=json");
    expect(d.unresolved).toContain("threats=asteroids");
  });

  it("expands an IUCN region to its countries (country filter)", async () => {
    const euCode = iucnRegionCountries("Europe")[0];
    querySpecies.mockResolvedValue({ species: [row({ id: 1, countries: [euCode] }), row({ id: 2, countries: ["ZZ"] })], truncated: false, tooLarge: false, neTotal: null });
    const d = await json("?taxa=corals&region=Europe&format=json");
    expect(d.total).toBe(1);
    expect(d.species[0].countries).toEqual([euCode]);
  });

  it("filters by assessor name (substring)", async () => {
    querySpecies.mockResolvedValue({ species: [row({ id: 1, latest_assessors: "Smith, J.A." }), row({ id: 2, latest_assessors: "Jones, B." })], truncated: false, tooLarge: false, neTotal: null });
    expect((await json("?taxa=corals&assessors=smith&format=json")).total).toBe(1);
    expect((await json("?taxa=corals&assessors=nobody&format=json")).total).toBe(0);
  });

  it("filters by described-year bounds", async () => {
    querySpecies.mockResolvedValue({ species: [row({ id: 1, described_year: 1850 }), row({ id: 2, described_year: 2010 })], truncated: false, tooLarge: false, neTotal: null });
    const d = await json("?taxa=corals&minDescribedYear=1900&format=json");
    expect(d.total).toBe(1);
  });
});
