/**
 * Tests for the synonym CSV roundtrip in fetch-redlist-species.
 *
 * The DB fetch itself isn't unit-testable without a live IUCN Postgres, but
 * the encode/decode of the new `synonyms` column is pure and worth covering
 * because it's the on-disk schema other scripts depend on.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  encodeSynonyms,
  decodeSynonyms,
  writeRedlistCsv,
  readRedlistCsv,
  type RedlistSpecies,
} from "../fetch-redlist-species";

function makeSpecies(overrides: Partial<RedlistSpecies> = {}): RedlistSpecies {
  return {
    sis_taxon_id: 58565,
    assessment_id: 1,
    scientific_name: "Aquarana catesbeianus",
    common_name: "American Bullfrog",
    class_name: "amphibia",
    order_name: "anura",
    family: "ranidae",
    category: "LC",
    assessment_date: "2020-01-01",
    year_published: "2020",
    population_trend: "Stable",
    countries: ["US", "CA"],
    taxon_group_table1a: "amphibia",
    systems: ["Freshwater"],
    growth_forms: [],
    movement_pattern: null,
    possibly_extinct: false,
    possibly_extinct_in_the_wild: false,
    criteria: null,
    threat_codes: [],
    habitat_codes: [],
    synonyms: [],
    ...overrides,
  };
}

describe("encodeSynonyms / decodeSynonyms", () => {
  it("roundtrips multiple synonyms with varied statuses", () => {
    const synonyms = [
      { name: "Lithobates catesbeianus", status: "NEW" },
      { name: "Rana catesbeiana", status: "ACCEPTED" },
      { name: "Lithobates catesbeiana", status: "ACCEPTED" },
    ];
    expect(decodeSynonyms(encodeSynonyms(synonyms))).toEqual(synonyms);
  });

  it("encodes empty list as empty string and decodes back to []", () => {
    expect(encodeSynonyms([])).toBe("");
    expect(decodeSynonyms("")).toEqual([]);
    expect(decodeSynonyms(undefined)).toEqual([]);
  });

  it("decodes a single synonym with no trailing semicolon", () => {
    expect(decodeSynonyms("Lithobates catesbeianus:NEW")).toEqual([
      { name: "Lithobates catesbeianus", status: "NEW" },
    ]);
  });

  it("tolerates legacy entries without a status (no colon)", () => {
    expect(decodeSynonyms("Lithobates catesbeianus")).toEqual([
      { name: "Lithobates catesbeianus", status: "" },
    ]);
  });
});

describe("writeRedlistCsv / readRedlistCsv (synonyms column)", () => {
  // readRedlistCsv reads from REDLIST_DIR/<taxonId>.csv. Use a unique taxon id
  // string per test to avoid collisions and clean up after.
  function tmpTaxonPath(taxonId: string): string {
    // The redlist dir is hardcoded under scripts/../data/redlist; tests use
    // unique filenames so they can coexist with real data.
    const REDLIST_DIR = path.join(__dirname, "../../data/redlist");
    return path.join(REDLIST_DIR, `${taxonId}.csv`);
  }
  function cleanup(taxonId: string) {
    try { fs.unlinkSync(tmpTaxonPath(taxonId)); } catch { /* ignore */ }
  }

  it("preserves synonyms array through write→read roundtrip", () => {
    const taxonId = `__test_synonyms_${process.pid}_${Date.now()}`;
    const species = makeSpecies({
      taxon_group_table1a: taxonId,
      synonyms: [
        { name: "Lithobates catesbeianus", status: "NEW" },
        { name: "Rana catesbeiana", status: "ACCEPTED" },
      ],
    });
    try {
      writeRedlistCsv([species], tmpTaxonPath(taxonId));
      const parsed = readRedlistCsv(taxonId);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].synonyms).toEqual(species.synonyms);
    } finally {
      cleanup(taxonId);
    }
  });

  it("species with empty synonyms roundtrips as empty array (not [{name:'',status:''}])", () => {
    const taxonId = `__test_empty_syn_${process.pid}_${Date.now()}`;
    const species = makeSpecies({ taxon_group_table1a: taxonId, synonyms: [] });
    try {
      writeRedlistCsv([species], tmpTaxonPath(taxonId));
      const parsed = readRedlistCsv(taxonId);
      expect(parsed[0].synonyms).toEqual([]);
    } finally {
      cleanup(taxonId);
    }
  });

  it("tolerates legacy CSVs missing the synonyms column entirely", () => {
    // Simulate an old-format CSV (pre-synonyms) by writing one with the
    // header missing the synonyms column.
    const taxonId = `__test_legacy_${process.pid}_${Date.now()}`;
    const REDLIST_DIR = path.join(__dirname, "../../data/redlist");
    fs.mkdirSync(REDLIST_DIR, { recursive: true });
    const csvPath = tmpTaxonPath(taxonId);
    const header = [
      "sis_taxon_id", "scientific_name", "common_name", "class_name", "order_name",
      "family", "taxon_group_table1a", "assessment_id", "iucn_category", "assessment_date",
      "year_published", "population_trend", "countries", "systems", "growth_forms",
      "movement_pattern", "possibly_extinct", "possibly_extinct_in_the_wild",
      "criteria", "threat_codes",
    ].join(",");
    const row = [
      "58565", "Aquarana catesbeianus", "American Bullfrog", "amphibia", "anura",
      "ranidae", taxonId, "1", "LC", "2020-01-01",
      "2020", "Stable", "US;CA", "Freshwater", "",
      "", "", "", "", "",
    ].join(",");
    fs.writeFileSync(csvPath, header + "\n" + row + "\n");
    try {
      const parsed = readRedlistCsv(taxonId);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].synonyms).toEqual([]);
    } finally {
      cleanup(taxonId);
    }
  });
});
