import { describe, it, expect } from "vitest";
import { resolveWhere, toSpeciesRow, colIdToSearchId, nodeIdForSpecies } from "@/lib/data/species-duckdb";

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

// Regression coverage for a real reported bug: querySpecies' NE branch used to assign
// each row a synthetic id from a counter that RESET on every single query (per-taxon
// fetch) — so the same species got a DIFFERENT id depending on which taxon scope it was
// fetched through, while two UNRELATED species from two different queries could easily
// land on the identical counter value. RedListView.tsx's client-side speciesDetails
// cache is keyed purely by id and never revalidates an existing entry, so the second
// species silently rendered under the first's cached iNaturalist photo/common name (a
// Giraffe's cached thumbnail showing for Fictidomys parvidens after drilling from
// Mammals into Rodentia — the Giraffe's query-local id and the squirrel's query-local id
// collided). Fixed by deriving the id from col_id via this function instead — stable
// across queries (same species, same id, however it was fetched) and collision-resistant
// across species (a hash, not a fixed decrementing range every query restarts).
describe("colIdToSearchId", () => {
  it("is stable: the same col_id always maps to the same id", () => {
    expect(colIdToSearchId("3LLS")).toBe(colIdToSearchId("3LLS"));
  });

  it("gives different col_ids different ids (spot-checked, not exhaustive)", () => {
    const ids = new Set(["3LLS", "6255W", "3Z5", "KTYZ7", "B3FVX"].map(colIdToSearchId));
    expect(ids.size).toBe(5);
  });

  it("is always negative, so it never collides with a real positive sis/gbif id", () => {
    for (const colId of ["3LLS", "6255W", "3Z5", "", "a", "zzzzzz"]) {
      expect(colIdToSearchId(colId)).toBeLessThan(0);
    }
  });
});

describe("toSpeciesRow", () => {
  it("maps an assessed row: splits ';' arrays, numifies BigInts, carries latest assessors", () => {
    const row = toSpeciesRow({
      id: BigInt(18),
      assessment_id: BigInt(123456),
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
      latest_assessors: "X, Y.",
      latest_reviewers: "Z, A.",
    });
    expect(row.sis_taxon_id).toBe(18);
    expect(row.assessment_id).toBe(123456);
    expect(row.countries).toEqual(["CO", "EC"]);
    expect(row.systems).toEqual(["Terrestrial"]);
    expect(row.growth_forms).toEqual([]);
    expect(row.threat_codes).toEqual(["1.1", "2.2.1"]);
    expect(row.gbif_occurrence_count).toBe(1273);
    expect(row.gbif_observations_after_assessment_year).toBe(42);
    expect(row.taxon_id).toBe("mammals"); // mapTaxonId fallthrough (display root)
    // latest assessors/reviewers are inline; full history is lazy (empty here).
    expect(row.latest_assessors).toBe("X, Y.");
    expect(row.latest_reviewers).toBe("Z, A.");
    expect(row.previous_assessments).toEqual([]);
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
  });
});

// Which node a search result opens in. The taxa table renders the ancestor chain of
// whatever is selected, so this is what puts a species' lineage on screen — and on the
// not-evaluated side it also decides whether the species can be listed at all, since that
// view loads exactly ONE node's NE list and refuses anything over NE_CAP (#453).
describe("nodeIdForSpecies", () => {
  const butterfly = { class_name: "insecta", order_name: "lepidoptera", family: "nymphalidae" };

  it("drills to the species' family", () => {
    expect(nodeIdForSpecies("butterflies_and_moths", butterfly))
      .toBe("inv-insects~order:lepidoptera~family:nymphalidae");
    expect(nodeIdForSpecies("mammals", { class_name: "mammalia", order_name: "carnivora", family: "felidae" }))
      .toBe("mammals~order:carnivora~family:felidae");
  });

  it("starts at class for a class-first root, skipping no rank", () => {
    expect(nodeIdForSpecies("molluscs", { class_name: "gastropoda", order_name: "littorinimorpha", family: "cypraeidae" }))
      .toBe("inv-molluscs~class:gastropoda~order:littorinimorpha~family:cypraeidae");
  });

  it("stops above a gap rather than showing an Unclassified rung", () => {
    // Velvet worms have no order in CoL; drilling to the family anyway would read
    // "Velvet Worms → Unclassified Order → Peripatidae".
    expect(nodeIdForSpecies("velvet_worms", { class_name: null, order_name: null, family: "peripatidae" }))
      .toBe("inv-velvet_worms");
    // A bivalve keeps the class it does have, and stops before the missing order.
    expect(nodeIdForSpecies("molluscs", { class_name: "bivalvia", order_name: null, family: "astartidae" }))
      .toBe("inv-molluscs~class:bivalvia");
  });

  it("accepts an Unclassified rung when the group's own node can't list the species", () => {
    // Insects is over NE_CAP, so stopping short would land on the drill-down prompt —
    // a gap is worth wearing to reach a node that can actually show the species.
    expect(nodeIdForSpecies("beetles", { class_name: "insecta", order_name: null, family: "coccinellidae" }))
      .toBe("inv-insects~order:~family:coccinellidae");
  });

  it("falls back to the group's own node when the species has no lineage at all", () => {
    expect(nodeIdForSpecies("beetles", {})).toBe("inv-insects");
    expect(nodeIdForSpecies("velvet_worms", {})).toBe("inv-velvet_worms");
  });

  it("never routes to a Specialist Group node — they hold a curated subset, not the group", () => {
    for (const [group, lineage] of [
      ["beetles", { class_name: "insecta", order_name: "coleoptera", family: "coccinellidae" }],
      ["dragonflies_and_damselflies", { class_name: "insecta", order_name: "odonata", family: "aeshnidae" }],
      ["reptiles", { class_name: "reptilia", order_name: "squamata", family: "dactyloidae" }],
    ] as const) {
      const id = nodeIdForSpecies(group, lineage);
      expect(id).not.toBeNull();
      expect(id!.startsWith("ssc-")).toBe(false); // "ssc-" is the id convention for them
    }
  });

  it("returns null for a group no taxonomy node covers", () => {
    expect(nodeIdForSpecies("not_a_real_group", butterfly)).toBeNull();
  });
});
