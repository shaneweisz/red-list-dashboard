import { describe, it, expect } from "vitest";
import {
  mergeSpecies,
  diffMerged,
  rowKey,
  type RedlistCsvRow,
  type GbifCsvRow,
  type SpeciesDbRow,
} from "../load-supabase";

// =============================================================================
// HELPERS
// =============================================================================

const TS = "2026-01-01T00:00:00.000Z";

function makeRedlist(overrides: Partial<RedlistCsvRow> & Pick<RedlistCsvRow, "sis_taxon_id" | "scientific_name" | "table1a_taxon_group">): RedlistCsvRow {
  return {
    common_name: null,
    class_name: null,
    order_name: null,
    family: null,
    assessment_id: null,
    iucn_category: null,
    assessment_date: null,
    year_published: null,
    population_trend: null,
    countries: [],
    gbif_species_key: null,
    ...overrides,
  };
}

function makeGbif(overrides: Partial<GbifCsvRow> & Pick<GbifCsvRow, "gbif_species_key" | "scientific_name" | "table1a_taxon_group">): GbifCsvRow {
  return {
    common_name: null,
    gbif_total_count: 0,
    gbif_count_since_assessment: null,
    ...overrides,
  };
}

function makeDbRow(overrides: Partial<SpeciesDbRow> & Pick<SpeciesDbRow, "scientific_name" | "table1a_taxon_group">): SpeciesDbRow {
  return {
    sis_taxon_id: null,
    gbif_species_key: null,
    common_name: null,
    class_name: null,
    order_name: null,
    family: null,
    assessment_id: null,
    iucn_category: null,
    assessment_date: null,
    year_published: null,
    population_trend: null,
    countries: [],
    gbif_total_count: null,
    gbif_count_since_assessment: null,
    synced_at: TS,
    ...overrides,
  };
}

// =============================================================================
// rowKey
// =============================================================================

describe("rowKey", () => {
  it("prefers sis_taxon_id over gbif_species_key", () => {
    const row = makeDbRow({
      sis_taxon_id: 100,
      gbif_species_key: 200,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
    });
    expect(rowKey(row)).toBe("sis:100");
  });

  it("falls back to gbif_species_key when sis_taxon_id is null", () => {
    const row = makeDbRow({
      gbif_species_key: 200,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
    });
    expect(rowKey(row)).toBe("gbif:200");
  });

  it("falls back to scientific_name when both keys are null", () => {
    const row = makeDbRow({
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
    });
    expect(rowKey(row)).toBe("name:Panthera leo");
  });
});

// =============================================================================
// mergeSpecies
// =============================================================================

describe("mergeSpecies", () => {
  it("creates a Red List-only row when no GBIF match", () => {
    const redlist = [makeRedlist({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      iucn_category: "VU",
    })];
    const merged = mergeSpecies(redlist, [], TS);

    expect(merged).toHaveLength(1);
    expect(merged[0].sis_taxon_id).toBe(1);
    expect(merged[0].gbif_species_key).toBeNull();
    expect(merged[0].gbif_total_count).toBeNull();
    expect(merged[0].iucn_category).toBe("VU");
  });

  it("links Red List species to GBIF data when gbif_species_key matches", () => {
    const redlist = [makeRedlist({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_species_key: 500,
    })];
    const gbif = [makeGbif({
      gbif_species_key: 500,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_total_count: 10000,
      gbif_count_since_assessment: 3000,
    })];
    const merged = mergeSpecies(redlist, gbif, TS);

    expect(merged).toHaveLength(1);
    expect(merged[0].sis_taxon_id).toBe(1);
    expect(merged[0].gbif_species_key).toBe(500);
    expect(merged[0].gbif_total_count).toBe(10000);
    expect(merged[0].gbif_count_since_assessment).toBe(3000);
  });

  it("creates GBIF-only rows for unclaimed GBIF species", () => {
    const gbif = [makeGbif({
      gbif_species_key: 999,
      scientific_name: "Homo sapiens",
      table1a_taxon_group: "mammalia",
      gbif_total_count: 50000,
    })];
    const merged = mergeSpecies([], gbif, TS);

    expect(merged).toHaveLength(1);
    expect(merged[0].sis_taxon_id).toBeNull();
    expect(merged[0].gbif_species_key).toBe(999);
    expect(merged[0].iucn_category).toBeNull();
    expect(merged[0].gbif_total_count).toBe(50000);
  });

  it("excludes GBIF rows claimed by Red List species", () => {
    const redlist = [makeRedlist({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_species_key: 500,
    })];
    const gbif = [
      makeGbif({ gbif_species_key: 500, scientific_name: "Panthera leo", table1a_taxon_group: "mammalia", gbif_total_count: 10000 }),
      makeGbif({ gbif_species_key: 999, scientific_name: "Homo sapiens", table1a_taxon_group: "mammalia", gbif_total_count: 50000 }),
    ];
    const merged = mergeSpecies(redlist, gbif, TS);

    // 1 linked Red List + 1 unclaimed GBIF-only
    expect(merged).toHaveLength(2);
    expect(merged[0].sis_taxon_id).toBe(1);
    expect(merged[0].gbif_species_key).toBe(500);
    expect(merged[1].sis_taxon_id).toBeNull();
    expect(merged[1].gbif_species_key).toBe(999);
  });

  it("handles Red List species with unresolved GBIF key (not in GBIF CSV)", () => {
    const redlist = [makeRedlist({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_species_key: 500, // claimed but not in GBIF CSV
    })];
    const merged = mergeSpecies(redlist, [], TS);

    expect(merged).toHaveLength(1);
    expect(merged[0].gbif_species_key).toBe(500);
    expect(merged[0].gbif_total_count).toBeNull(); // no GBIF data available
  });
});

// =============================================================================
// diffMerged
// =============================================================================

describe("diffMerged", () => {
  it("detects new species (added)", () => {
    const oldRows: SpeciesDbRow[] = [];
    const newRows = [makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
    })];
    const diff = diffMerged(oldRows, newRows);

    expect(diff.added).toHaveLength(1);
    expect(diff.updated).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toBe(0);
  });

  it("detects removed species", () => {
    const oldRows = [makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
    })];
    const diff = diffMerged(oldRows, []);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].scientific_name).toBe("Panthera leo");
  });

  it("detects unchanged species", () => {
    const row = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_total_count: 5000,
    });
    const diff = diffMerged([row], [{ ...row }]);

    expect(diff.unchanged).toBe(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.updated).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it("detects observation count updates", () => {
    const oldRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_total_count: 5000,
    });
    const newRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_total_count: 5050,
    });
    const diff = diffMerged([oldRow], [newRow]);

    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].changes).toHaveLength(1);
    expect(diff.updated[0].changes[0]).toEqual({
      field: "gbif_total_count",
      old: 5000,
      new: 5050,
    });
  });

  it("detects new GBIF linkage (null → key)", () => {
    const oldRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_species_key: null,
    });
    const newRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_species_key: 500,
    });
    const diff = diffMerged([oldRow], [newRow]);

    expect(diff.updated).toHaveLength(1);
    const gbifChange = diff.updated[0].changes.find((c) => c.field === "gbif_species_key");
    expect(gbifChange).toEqual({ field: "gbif_species_key", old: null, new: 500 });
  });

  it("detects common name correction", () => {
    const oldRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Mulinia lateralis",
      table1a_taxon_group: "mollusca",
      common_name: "Dwarf Surf Clamb",
    });
    const newRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Mulinia lateralis",
      table1a_taxon_group: "mollusca",
      common_name: "Dwarf Surfclam",
    });
    const diff = diffMerged([oldRow], [newRow]);

    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].changes[0]).toEqual({
      field: "common_name",
      old: "Dwarf Surf Clamb",
      new: "Dwarf Surfclam",
    });
  });

  // =========================================================================
  // Taxonomy edge cases
  // =========================================================================

  it("handles species split: one old species → two new species", () => {
    // e.g. Passer domesticus (sis:100) splits into two new sis_taxon_ids
    const oldRows = [makeDbRow({
      sis_taxon_id: 100,
      scientific_name: "Passer domesticus",
      table1a_taxon_group: "aves",
      iucn_category: "LC",
    })];
    const newRows = [
      makeDbRow({
        sis_taxon_id: 201,
        scientific_name: "Passer domesticus",
        table1a_taxon_group: "aves",
        iucn_category: "LC",
      }),
      makeDbRow({
        sis_taxon_id: 202,
        scientific_name: "Passer italiae",
        table1a_taxon_group: "aves",
        iucn_category: "LC",
      }),
    ];
    const diff = diffMerged(oldRows, newRows);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].sis_taxon_id).toBe(100);
    expect(diff.added).toHaveLength(2);
    expect(diff.added.map((r) => r.sis_taxon_id).sort()).toEqual([201, 202]);
  });

  it("handles species lump: two old species → one new species", () => {
    // e.g. Two species lumped into one under a single sis_taxon_id
    const oldRows = [
      makeDbRow({
        sis_taxon_id: 301,
        scientific_name: "Bos grunniens",
        table1a_taxon_group: "mammalia",
      }),
      makeDbRow({
        sis_taxon_id: 302,
        scientific_name: "Bos mutus",
        table1a_taxon_group: "mammalia",
      }),
    ];
    const newRows = [makeDbRow({
      sis_taxon_id: 301,
      scientific_name: "Bos grunniens",
      table1a_taxon_group: "mammalia",
    })];
    const diff = diffMerged(oldRows, newRows);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].sis_taxon_id).toBe(302);
    expect(diff.unchanged).toBe(1);
  });

  it("handles taxonomic rename: same sis_taxon_id, new scientific_name", () => {
    // e.g. Felis concolor → Puma concolor (same taxon, reclassified)
    const oldRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Felis concolor",
      table1a_taxon_group: "mammalia",
    });
    const newRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Puma concolor",
      table1a_taxon_group: "mammalia",
    });
    const diff = diffMerged([oldRow], [newRow]);

    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].changes).toContainEqual({
      field: "scientific_name",
      old: "Felis concolor",
      new: "Puma concolor",
    });
    // Matched by sis_taxon_id, not by name — row identity preserved
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it("handles GBIF-only species gaining a Red List assessment (promotion)", () => {
    // Old: GBIF-only row (sis=null, gbif=500)
    // New: linked row (sis=1, gbif=500) — matched by gbif_species_key since sis is new
    // Note: in the diff, the new row's key is "sis:1" (sis takes priority).
    // The old row's key is "gbif:500". These don't match — so it shows as
    // 1 removed (gbif:500) + 1 added (sis:1). This is expected; the actual
    // promotion logic in load-supabase handles preserving the DB row's id.
    const oldRow = makeDbRow({
      gbif_species_key: 500,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      gbif_total_count: 10000,
    });
    const newRow = makeDbRow({
      sis_taxon_id: 1,
      gbif_species_key: 500,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      iucn_category: "VU",
      gbif_total_count: 10000,
    });
    const diff = diffMerged([oldRow], [newRow]);

    // Diff sees different keys (gbif:500 vs sis:1)
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].gbif_species_key).toBe(500);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].sis_taxon_id).toBe(1);
  });

  it("handles category change (e.g. reassessment upgrades threat level)", () => {
    const oldRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      iucn_category: "VU",
      assessment_date: "2015-01-01",
    });
    const newRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      iucn_category: "EN",
      assessment_date: "2025-01-01",
    });
    const diff = diffMerged([oldRow], [newRow]);

    expect(diff.updated).toHaveLength(1);
    const fields = diff.updated[0].changes.map((c) => c.field);
    expect(fields).toContain("iucn_category");
    expect(fields).toContain("assessment_date");
  });

  it("handles multiple simultaneous changes on one species", () => {
    const oldRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      common_name: "Lion",
      gbif_total_count: 5000,
      gbif_species_key: null,
    });
    const newRow = makeDbRow({
      sis_taxon_id: 1,
      scientific_name: "Panthera leo",
      table1a_taxon_group: "mammalia",
      common_name: "African Lion",
      gbif_total_count: 5100,
      gbif_species_key: 500,
    });
    const diff = diffMerged([oldRow], [newRow]);

    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].changes).toHaveLength(3);
    const fields = diff.updated[0].changes.map((c) => c.field).sort();
    expect(fields).toEqual(["common_name", "gbif_species_key", "gbif_total_count"]);
  });

  it("handles empty old and new (no-op)", () => {
    const diff = diffMerged([], []);
    expect(diff.unchanged).toBe(0);
    expect(diff.added).toHaveLength(0);
    expect(diff.updated).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });
});
