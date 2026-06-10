import { describe, it, expect } from "vitest";
import { resolveWhere, toSpeciesRow } from "@/lib/data/species-duckdb";

// Unit tests for the parity-critical pure logic of the DuckDB read layer (#261):
// the taxon→SQL resolver and the row→SpeciesRow mapping. (Full v1-vs-v2 parity is
// verified manually against the live data — it can't run in CI without the R2 data.)

describe("resolveWhere", () => {
  it("returns no predicate for 'all'", () => {
    expect(resolveWhere("all")).toEqual({ clauses: [], params: {} });
  });

  it("filters a taxonomy node by its csvGroups", () => {
    const w = resolveWhere("mammals");
    expect(w.clauses).toEqual(["taxon_group = ANY(string_split($g, '|'))"]);
    expect(w.params.g).toBe("mammals");
  });

  it("expands a virtual node to all its csvGroups", () => {
    const groups = resolveWhere("insecta").params.g.split("|");
    expect(groups).toContain("beetles");
    expect(groups).toContain("other_insects");
    expect(groups).toHaveLength(8);
  });

  it("canonicalizes a legacy alias before resolving (mammalia → mammals)", () => {
    expect(resolveWhere("mammalia").params.g).toBe("mammals");
  });

  it("matches an arbitrary rank (non-node) at class/order/family", () => {
    const w = resolveWhere("turdidae");
    expect(w.clauses).toEqual(["(class_name = $arv OR order_name = $arv OR family = $arv)"]);
    expect(w.params.arv).toBe("turdidae");
  });

  it("lowercases arbitrary values", () => {
    expect(resolveWhere("Turdidae").params.arv).toBe("turdidae");
  });
});

describe("toSpeciesRow", () => {
  it("maps an assessed row: splits ';' arrays, numifies BigInts, parses history", () => {
    const row = toSpeciesRow({
      id: BigInt(18),
      scientific_name: "Aotus lemurinus",
      common_name: "Lemurine Night Monkey",
      family: "aotidae",
      category: "VU",
      assessment_date: "2016-03-01",
      year_published: "2018",
      population_trend: "Decreasing",
      countries: "CO;EC",
      class_name: "mammalia",
      order_name: "primates",
      taxon_group: "mammals",
      gbif_species_key: BigInt(2436503),
      gbif_occurrence_count: BigInt(1273),
      gbif_observations_after_assessment_year: BigInt(42),
      systems: "Terrestrial",
      growth_forms: "",
      movement_pattern: null,
      possibly_extinct: false,
      possibly_extinct_in_the_wild: false,
      criteria: "A2c",
      threat_codes: "1.1;2.2.1",
      has_map: true,
      previous_assessments: JSON.stringify([
        { id: 100, year: "2016", category: "VU", date: "2016-03-01", assessors: "X", reviewers: "Y" },
      ]),
    });
    expect(row.sis_taxon_id).toBe(18);
    expect(row.countries).toEqual(["CO", "EC"]);
    expect(row.systems).toEqual(["Terrestrial"]);
    expect(row.growth_forms).toEqual([]);
    expect(row.threat_codes).toEqual(["1.1", "2.2.1"]);
    expect(row.gbif_occurrence_count).toBe(1273);
    expect(row.gbif_observations_after_assessment_year).toBe(42);
    expect(row.taxon_id).toBe("mammals"); // mapTaxonId fallthrough (display root)
    expect(row.has_map).toBe(true);
    expect(row.previous_assessments).toEqual([
      { id: 100, year: "2016", category: "VU", date: "2016-03-01", assessors: "X", reviewers: "Y" },
    ]);
  });

  it("maps an NE row: negative id → null sis_taxon_id, no history, group → invertebrates", () => {
    const row = toSpeciesRow({
      id: -BigInt(99),
      scientific_name: "Beetlus novus",
      common_name: null,
      family: "x",
      category: "NE",
      countries: "",
      class_name: "insecta",
      order_name: "coleoptera",
      taxon_group: "beetles",
      gbif_species_key: BigInt(99),
      gbif_occurrence_count: BigInt(5),
    });
    expect(row.sis_taxon_id).toBeNull();
    expect(row.previous_assessments).toEqual([]);
    expect(row.taxon_id).toBe("invertebrates"); // mapTaxonId("beetles")
    expect(row.gbif_observations_after_assessment_year).toBeNull();
    expect(row.has_map).toBe(false);
  });
});
