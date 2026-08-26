/**
 * classifyNoMatch's 8-way reason branching had zero test coverage despite
 * being the single most complex piece of logic behind the described-count
 * breakdown's "why doesn't this species have a clean 1:1 CoL match"
 * diagnostic — every reason a user actually sees in the UI (TaxaSummary.tsx's
 * noMatchSentence, lib/col-revision.ts) traces back to exactly one branch here. It's a pure
 * function of a plain row object, so this needs no DuckDB connection or
 * fixture data — just the row shapes computeBreakdownEntry's diagRows query
 * actually produces (see that query's SELECT list in col-breakdown.ts).
 */
import { describe, it, expect } from "vitest";
import { classifyNoMatch } from "../col-breakdown";

// Every field classifyNoMatch might read, defaulted to the "no useful info"
// value — each test overrides only the fields its branch actually depends on,
// so a future field addition doesn't silently break unrelated cases.
const baseRow = {
  id: 1,
  name: "Testus example",
  linked_col_id: null,
  linked_name: null,
  linked_in_base: null,
  linked_extinct: null,
  winner_name: null,
  winner_id: null,
  bk_rank: null,
  parent_name: null,
  parent_assessed_id: null,
  parent_assessed_name: null,
};

describe("classifyNoMatch", () => {
  it("unmatched: never matched to any CoL name at all", () => {
    const result = classifyNoMatch({ ...baseRow, linked_col_id: null });
    expect(result).toEqual({ id: 1, name: "Testus example", reason: "unmatched" });
  });

  it("provisional: linked col_id is species-rank in the backbone, but only provisionally accepted", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: null, bk_rank: "species",
    });
    expect(result.reason).toBe("provisional");
  });

  it("infraspecific: demoted to a subspecies of an IUCN-assessed parent — names + links the parent", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: null, bk_rank: "subspecies",
      parent_assessed_name: "Arctocephalus philippii", parent_assessed_id: 42,
    });
    expect(result).toEqual({
      id: 1, name: "Testus example", reason: "infraspecific",
      detail: "Arctocephalus philippii", detailId: 42, rank: "subspecies", colId: "ABC123",
    });
  });

  it("infraspecific: demoted to a subspecies whose parent isn't itself IUCN-assessed — names the parent, no link", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: null, bk_rank: "subspecies",
      parent_assessed_name: null, parent_name: "Some unassessed parent",
    });
    expect(result).toEqual({
      id: 1, name: "Testus example", reason: "infraspecific",
      detail: "Some unassessed parent", rank: "subspecies", colId: "ABC123",
    });
  });

  it("missing_from_backbone: linked col_id has no row in the backbone at all (no bk_rank, no parent info)", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: null, bk_rank: null,
    });
    expect(result.reason).toBe("missing_from_backbone");
  });

  it("unmatched: the linked record is a GENUS, so there is no species record to point at", () => {
    // Amazona violacea matches the genus Amazona, whose parent is the family.
    // Reported as infraspecific it read "a subspecies of Psittacidae".
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "TC4", linked_name: null, bk_rank: "genus",
      parent_assessed_name: null, parent_name: "Psittacidae",
    });
    expect(result).toEqual({ id: 1, name: "Testus example", reason: "unmatched", colId: "TC4" });
  });

  it("missing_from_backbone: backbone row exists (non-species rank) but neither parent field resolved — falls through rather than guessing", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: null, bk_rank: "variety",
      parent_assessed_name: null, parent_name: null,
    });
    expect(result.reason).toBe("missing_from_backbone");
  });

  it("lumped: linked col_id is real, but a different assessed species won the accepted-name tie-break", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: "Testus realus",
      winner_name: "Testus winnerus", winner_id: 99,
    });
    expect(result).toEqual({
      id: 1, name: "Testus example", reason: "lumped",
      detail: "Testus winnerus", detailId: 99,
      // The CoL record the flag points at, plus CoL's own accepted name for it
      // — what lets the UI say "both are now called X" (see noMatchSentence).
      // detailColId is the SAME record: a lump means both names share one col_id,
      // so linking the winner's name links there too.
      colId: "ABC123", colName: "Testus realus", detailColId: "ABC123",
    });
  });

  it("not_in_base: linked col_id matches this name and has no rival winner, but isn't in CoL's curated Base checklist yet", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: "Testus realus",
      linked_in_base: false,
    });
    expect(result.reason).toBe("not_in_base");
  });

  it("extinct_unconfirmed: CoL flags the linked species extinct, but IUCN hasn't confirmed EX/EW", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: "Testus realus",
      linked_in_base: true, linked_extinct: true,
    });
    expect(result.reason).toBe("extinct_unconfirmed");
  });

  it("classified_elsewhere: linked col_id is real, in_base, extant, and uncontested — the only remaining explanation is a class/order/family mismatch", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: "Testus realus",
      linked_in_base: true, linked_extinct: false,
    });
    expect(result.reason).toBe("classified_elsewhere");
  });

  it("checks reasons in cheapest/most-specific order: a lumped match with an in-base rival still reports 'lumped', not 'classified_elsewhere'", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: "Testus realus",
      linked_in_base: true, linked_extinct: false,
      winner_name: "Testus winnerus", winner_id: 99,
    });
    expect(result.reason).toBe("lumped");
  });

  it("coerces numeric-looking id/name fields (DuckDB row objects aren't guaranteed JS number/string types)", () => {
    const result = classifyNoMatch({ ...baseRow, id: "7", name: 42 as unknown as string });
    expect(result).toEqual({ id: 7, name: "42", reason: "unmatched" });
  });
});

// Two reasons added after review found them misreported in the wild — both are
// specifically about NOT saying something misleading, so they get their own cases.
describe("classifyNoMatch — checklist coverage", () => {
  it("synonym_of: the checklist DOES hold the name, as a synonym — not 'not in the checklist yet'", () => {
    // Sorbus minima: its matched col_id is XR-only, but the curated checklist
    // covers the name as a synonym of Hedlundia minima (a genus transfer). The
    // evidence is the BACKBONE holding this name as a synonym — a claim a reader
    // can check on the page we link to.
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "VJSZQ", linked_name: "Sorbus minima", linked_in_base: false,
      syn_name: "Hedlundia minima", syn_col_id: "3JZCX",
    });
    expect(result.reason).toBe("synonym_of");
    expect(result.detail).toBe("Hedlundia minima");
    // Links to the ACCEPTED record, not the XR-only id CoL may since have retired.
    expect(result.colId).toBe("3JZCX");
    expect(result.detailColId).toBe("3JZCX");
  });

  it("synonym_of: also found via the backbone, for the names 'iucn_synonym_covered' misses", () => {
    // Accipiter cooperii -> Astur cooperii: the 2024 Accipiter break-up, which
    // build-matching writes no covered link for.
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "XRONLY", linked_name: "Accipiter cooperii", linked_in_base: false,
      syn_name: "Astur cooperii", syn_col_id: "CVW5J",
    });
    expect(result.reason).toBe("synonym_of");
    expect(result.detail).toBe("Astur cooperii");
    expect(result.colId).toBe("CVW5J");
  });

  it("synonym_of: an IUCN-side synonym is NOT evidence about how CoL treats this name", () => {
    // Stenocranius raddei, reported from the dashboard. CoL ACCEPTS the name
    // (T6LK3); it is merely XR-only. The old covered-link route reported "CoL
    // accepts Microtus gregalis for this species", because IUCN's own synonyms
    // Arvicola raddei / Lasiopodomys raddei are filed under Microtus gregalis in
    // CoL. Opening the linked page showed no such synonym. That route produced
    // 272 of 426 synonym_of flags and is gone: without backbone evidence about
    // THIS name, the honest answer is not_in_base.
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "T6LK3", linked_name: "Stenocranius raddei", linked_in_base: false,
      covered_name: "Microtus gregalis", covered_col_id: "73K4G",
    });
    expect(result.reason).toBe("not_in_base");
    expect(result.detail).toBeUndefined();
  });

  it("not_in_base: still reported when the checklist genuinely doesn't cover the name", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "VJSZQ", linked_name: "Sorbus minima", linked_in_base: false,
    });
    expect(result.reason).toBe("not_in_base");
  });

  it("synonym_of: not claimed when the name did not change", () => {
    // CoL keeps duplicate records for some names — Metacanthus concolor has
    // three — so the name can be "a synonym of" itself. That is not a rename.
    const result = classifyNoMatch({
      ...baseRow, name: "Metacanthus concolor",
      linked_col_id: "XRONLY", linked_name: "Metacanthus concolor", linked_in_base: false,
      syn_name: "Metacanthus concolor", syn_col_id: "VFXNC",
    });
    expect(result.reason).toBe("not_in_base");
  });

  it("provisional: an unlinked name CoL holds provisionally isn't 'no CoL name at all'", () => {
    // Idaea josephinae: unmatched by build-matching (it only links accepted
    // names), but CoL does hold C7CM2 for it.
    const result = classifyNoMatch({ ...baseRow, linked_col_id: null, prov_col_id: "C7CM2" });
    expect(result.reason).toBe("provisional");
    expect(result.colId).toBe("C7CM2");
  });

  it("unmatched: still reported when CoL really has nothing under the name", () => {
    expect(classifyNoMatch({ ...baseRow, linked_col_id: null, prov_col_id: null }).reason).toBe("unmatched");
  });

  it("infraspecific: carries the parent's CoL record so that name can be linked too", () => {
    const result = classifyNoMatch({
      ...baseRow, linked_col_id: "ABC123", linked_name: null, bk_rank: "subspecies",
      parent_assessed_name: "Muntiacus muntjak", parent_assessed_id: 42, parent_col_id: "PARENT1",
    });
    expect(result.detailColId).toBe("PARENT1");
  });
});
