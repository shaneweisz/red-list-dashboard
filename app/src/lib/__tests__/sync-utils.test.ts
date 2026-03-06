import { describe, it, expect } from "vitest";
import {
  normalizeSpeciesName,
  buildSpeciesIndex,
  findMatch,
  ExistingSpecies,
} from "../../../scripts/sync-utils";

describe("normalizeSpeciesName", () => {
  it("lowercases and trims", () => {
    expect(normalizeSpeciesName("  Panthera Leo  ")).toBe("panthera leo");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeSpeciesName("Homo  sapiens")).toBe("homo sapiens");
  });

  it("handles empty string", () => {
    expect(normalizeSpeciesName("")).toBe("");
  });

  it("preserves single spaces", () => {
    expect(normalizeSpeciesName("Felis catus")).toBe("felis catus");
  });
});

describe("buildSpeciesIndex", () => {
  const rows: ExistingSpecies[] = [
    { id: 1, scientific_name: "Panthera leo", sis_taxon_id: 100, gbif_species_key: 200, col_id: "ABC" },
    { id: 2, scientific_name: "Homo sapiens", sis_taxon_id: null, gbif_species_key: 300, col_id: null },
    { id: 3, scientific_name: "Felis catus", sis_taxon_id: 400, gbif_species_key: null, col_id: "DEF" },
  ];

  const index = buildSpeciesIndex(rows);

  it("indexes by sis_taxon_id", () => {
    expect(index.bySisTaxonId.get(100)?.id).toBe(1);
    expect(index.bySisTaxonId.get(400)?.id).toBe(3);
    expect(index.bySisTaxonId.has(300)).toBe(false);
  });

  it("indexes by gbif_species_key", () => {
    expect(index.byGbifSpeciesKey.get(200)?.id).toBe(1);
    expect(index.byGbifSpeciesKey.get(300)?.id).toBe(2);
  });

  it("indexes by col_id", () => {
    expect(index.byColId.get("ABC")?.id).toBe(1);
    expect(index.byColId.get("DEF")?.id).toBe(3);
  });

  it("indexes by normalized name", () => {
    expect(index.byNormalizedName.get("panthera leo")?.id).toBe(1);
    expect(index.byNormalizedName.get("homo sapiens")?.id).toBe(2);
  });

  it("skips null values in lookup maps", () => {
    expect(index.bySisTaxonId.size).toBe(2);
    expect(index.byGbifSpeciesKey.size).toBe(2);
    expect(index.byColId.size).toBe(2);
    expect(index.byNormalizedName.size).toBe(3); // all 3 have names
  });
});

describe("findMatch", () => {
  const rows: ExistingSpecies[] = [
    { id: 1, scientific_name: "Panthera leo", sis_taxon_id: 100, gbif_species_key: 200, col_id: "ABC" },
    { id: 2, scientific_name: "Puma concolor", sis_taxon_id: null, gbif_species_key: 300, col_id: "DEF" },
    { id: 3, scientific_name: "Felis catus", sis_taxon_id: 400, gbif_species_key: null, col_id: null },
  ];

  const index = buildSpeciesIndex(rows);

  it("matches by primary ID first (sis_taxon_id)", () => {
    const result = findMatch(index, {
      primaryId: { type: "sis_taxon_id", value: 100 },
      colId: "XYZ",
      scientificName: "Different Name",
    });
    expect(result.match).toBe("by_primary_id");
    if (result.match !== "none") expect(result.species.id).toBe(1);
  });

  it("matches by primary ID first (gbif_species_key)", () => {
    const result = findMatch(index, {
      primaryId: { type: "gbif_species_key", value: 300 },
      scientificName: "Different Name",
    });
    expect(result.match).toBe("by_primary_id");
    if (result.match !== "none") expect(result.species.id).toBe(2);
  });

  it("falls through to col_id when primary ID not found", () => {
    const result = findMatch(index, {
      primaryId: { type: "sis_taxon_id", value: 999 },
      colId: "DEF",
      scientificName: "Different Name",
    });
    expect(result.match).toBe("by_col_id");
    if (result.match !== "none") expect(result.species.id).toBe(2);
  });

  it("falls through to name when primary ID and col_id not found", () => {
    const result = findMatch(index, {
      primaryId: { type: "sis_taxon_id", value: 999 },
      colId: "ZZZ",
      scientificName: "Felis catus",
    });
    expect(result.match).toBe("by_name");
    if (result.match !== "none") expect(result.species.id).toBe(3);
  });

  it("matches by name case-insensitively", () => {
    const result = findMatch(index, {
      scientificName: "  PANTHERA LEO  ",
    });
    expect(result.match).toBe("by_name");
    if (result.match !== "none") expect(result.species.id).toBe(1);
  });

  it("returns none when no match found", () => {
    const result = findMatch(index, {
      primaryId: { type: "sis_taxon_id", value: 999 },
      colId: "ZZZ",
      scientificName: "Unknown species",
    });
    expect(result.match).toBe("none");
  });

  it("skips col_id matching when colId is null", () => {
    const result = findMatch(index, {
      primaryId: { type: "sis_taxon_id", value: 999 },
      colId: null,
      scientificName: "Unknown species",
    });
    expect(result.match).toBe("none");
  });

  it("skips primary ID matching when not provided", () => {
    const result = findMatch(index, {
      scientificName: "Puma concolor",
    });
    expect(result.match).toBe("by_name");
    if (result.match !== "none") expect(result.species.id).toBe(2);
  });
});
