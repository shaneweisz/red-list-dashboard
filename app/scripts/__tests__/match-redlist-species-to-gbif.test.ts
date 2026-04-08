/**
 * Tests for the synonym-aware matching loop in match-redlist-species-to-gbif.
 *
 * Uses the testable `matchSpeciesList` entrypoint, which takes inputs and a
 * mock matchFn explicitly so tests don't need a live IUCN DB or GBIF API.
 */

import { describe, it, expect } from "vitest";
import { SyncLogger } from "../utils";
import {
  matchSpeciesList,
  type SpeciesInput,
  type MatchFn,
  type MappingEntry,
} from "../match-redlist-species-to-gbif";

function speciesOf(sis: number, name: string, synonyms: string[] = []): SpeciesInput {
  return { sis_taxon_id: sis, scientific_name: name, synonyms };
}

/** Build a matchFn from a name → result table. */
function matchFromTable(table: Record<string, { key: number | null; matchType: string }>): MatchFn {
  return async (name: string) => table[name] ?? { key: null, matchType: "NONE" };
}

const logger = SyncLogger.noop();

function linked(entries: MappingEntry[]): MappingEntry[] {
  return entries.filter((e) => e.gbif_species_key !== null);
}
function diagnostics(entries: MappingEntry[]): MappingEntry[] {
  return entries.filter((e) => e.gbif_species_key === null);
}

describe("matchSpeciesList — basic canonical matching", () => {
  it("canonical-only match produces one linked row (regression)", async () => {
    const species = [speciesOf(1, "Aquarana catesbeianus")];
    const matchFn = matchFromTable({
      "Aquarana catesbeianus": { key: 100, matchType: "EXACT" },
    });
    const entries = await matchSpeciesList(species, new Set([100]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
    ]);
    expect(diagnostics(entries)).toEqual([]);
  });

  it("canonical match with no GBIF data emits NO_GBIF_DATA diagnostic", async () => {
    const species = [speciesOf(1, "Aquarana catesbeianus")];
    const matchFn = matchFromTable({
      "Aquarana catesbeianus": { key: 999, matchType: "EXACT" },
    });
    // 999 not in available GBIF keys
    const entries = await matchSpeciesList(species, new Set([100]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([]);
    expect(diagnostics(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: null, match_type: "NO_GBIF_DATA", name_source: "" },
    ]);
  });

  it("species with no match anywhere emits a NONE diagnostic", async () => {
    const species = [speciesOf(1, "Imaginarius nonexistens")];
    const matchFn = matchFromTable({});
    const entries = await matchSpeciesList(species, new Set([100]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([]);
    expect(diagnostics(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: null, match_type: "NONE", name_source: "" },
    ]);
  });
});

describe("matchSpeciesList — synonyms", () => {
  it("synonym adds a second linked key for the same species", async () => {
    // The bullfrog case: canonical (Aquarana) and synonym (Lithobates) both
    // resolve to distinct GBIF keys; both should be linked.
    const species = [speciesOf(1, "Aquarana catesbeianus", ["Lithobates catesbeianus"])];
    const matchFn = matchFromTable({
      "Aquarana catesbeianus": { key: 100, matchType: "EXACT" },
      "Lithobates catesbeianus": { key: 200, matchType: "EXACT" },
    });
    const entries = await matchSpeciesList(species, new Set([100, 200]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
      { sis_taxon_id: 1, gbif_species_key: 200, match_type: "EXACT", name_source: "synonym" },
    ]);
    expect(diagnostics(entries)).toEqual([]);
  });

  it("synonym resolving to the same key as canonical does not duplicate", async () => {
    const species = [speciesOf(1, "Aquarana catesbeianus", ["Lithobates catesbeianus"])];
    const matchFn = matchFromTable({
      "Aquarana catesbeianus": { key: 100, matchType: "EXACT" },
      "Lithobates catesbeianus": { key: 100, matchType: "FUZZY" },
    });
    const entries = await matchSpeciesList(species, new Set([100]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
    ]);
  });

  it("species can claim three different GBIF keys via canonical + 2 synonyms", async () => {
    const species = [
      speciesOf(1, "Modernus name", ["Old name one", "Old name two"]),
    ];
    const matchFn = matchFromTable({
      "Modernus name": { key: 1, matchType: "EXACT" },
      "Old name one": { key: 2, matchType: "EXACT" },
      "Old name two": { key: 3, matchType: "EXACT" },
    });
    const entries = await matchSpeciesList(species, new Set([1, 2, 3]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: 1, match_type: "EXACT", name_source: "canonical" },
      { sis_taxon_id: 1, gbif_species_key: 2, match_type: "EXACT", name_source: "synonym" },
      { sis_taxon_id: 1, gbif_species_key: 3, match_type: "EXACT", name_source: "synonym" },
    ]);
  });
});

describe("matchSpeciesList — duplicate handling", () => {
  it("cross-species duplicate via synonym is rejected, canonical claimant keeps the key", async () => {
    // Species A has canonical key 500. Species B has the same key as a synonym.
    // B's synonym claim must be rejected; A keeps the link.
    const species = [
      speciesOf(1, "Species A canonical"),
      speciesOf(2, "Species B canonical", ["Species A canonical"]),
    ];
    const matchFn = matchFromTable({
      "Species A canonical": { key: 500, matchType: "EXACT" },
      "Species B canonical": { key: 600, matchType: "EXACT" },
    });
    const entries = await matchSpeciesList(species, new Set([500, 600]), logger, matchFn, 1);

    const linkedRows = linked(entries);
    expect(linkedRows).toEqual([
      { sis_taxon_id: 1, gbif_species_key: 500, match_type: "EXACT", name_source: "canonical" },
      { sis_taxon_id: 2, gbif_species_key: 600, match_type: "EXACT", name_source: "canonical" },
    ]);
    // Species 2 still gets a linked row for its canonical, so no diagnostic for it.
    expect(diagnostics(entries)).toEqual([]);
  });

  it("canonical wins synonym ties: B's canonical-claim of key 500 beats A's synonym-claim", async () => {
    // Critical correctness case: A is processed first but matches 500 only via
    // a synonym; B is processed second and matches 500 via its canonical.
    // The two-pass design means all canonicals are processed before any
    // synonyms — so B's canonical should win even though A appears first.
    const species = [
      speciesOf(1, "A canonical", ["Shared name"]),
      speciesOf(2, "Shared name"),
    ];
    const matchFn = matchFromTable({
      "A canonical": { key: 100, matchType: "EXACT" },
      "Shared name": { key: 500, matchType: "EXACT" },
    });
    const entries = await matchSpeciesList(species, new Set([100, 500]), logger, matchFn, 1);

    const linkedRows = linked(entries);
    // A keeps its canonical key (100); B keeps key 500 from canonical.
    // A's synonym claim on 500 is rejected because B (canonical) already has it.
    expect(linkedRows).toContainEqual(
      { sis_taxon_id: 1, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
    );
    expect(linkedRows).toContainEqual(
      { sis_taxon_id: 2, gbif_species_key: 500, match_type: "EXACT", name_source: "canonical" },
    );
    // A should NOT have a link to 500 (rejected as duplicate).
    expect(linkedRows.find((r) => r.sis_taxon_id === 1 && r.gbif_species_key === 500))
      .toBeUndefined();
  });

  it("species with only a duplicate-rejected synonym match emits DUPLICATE diagnostic", async () => {
    // A has key 500 canonically. B has no canonical match and only a synonym
    // that resolves to A's key. B should get a DUPLICATE diagnostic, not NONE.
    const species = [
      speciesOf(1, "A canonical"),
      speciesOf(2, "B canonical", ["Shared name"]),
    ];
    const matchFn = matchFromTable({
      "A canonical": { key: 500, matchType: "EXACT" },
      "Shared name": { key: 500, matchType: "EXACT" },
      // "B canonical" has no entry → resolves to NONE
    });
    const entries = await matchSpeciesList(species, new Set([500]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: 500, match_type: "EXACT", name_source: "canonical" },
    ]);
    expect(diagnostics(entries)).toEqual([
      { sis_taxon_id: 2, gbif_species_key: null, match_type: "DUPLICATE", name_source: "" },
    ]);
  });
});

describe("matchSpeciesList — defensive deduping", () => {
  it("synonym list containing the canonical name itself does not double-link", async () => {
    // Defensive: the SQL filters self-equal synonyms before they hit the CSV,
    // but if one ever leaks through (or is added by hand), the matching loop
    // must still dedupe — only one mapping row, sourced as canonical.
    const species = [speciesOf(1, "Aquarana catesbeianus", ["Aquarana catesbeianus"])];
    const matchFn = matchFromTable({
      "Aquarana catesbeianus": { key: 100, matchType: "EXACT" },
    });
    const entries = await matchSpeciesList(species, new Set([100]), logger, matchFn, 1);

    expect(linked(entries)).toEqual([
      { sis_taxon_id: 1, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
    ]);
    expect(diagnostics(entries)).toEqual([]);
  });
});

describe("matchSpeciesList — empty input", () => {
  it("returns empty array for empty species list", async () => {
    const entries = await matchSpeciesList([], new Set([100]), logger, matchFromTable({}), 1);
    expect(entries).toEqual([]);
  });
});
