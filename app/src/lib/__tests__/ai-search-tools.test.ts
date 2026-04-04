import { describe, it, expect } from "vitest";
import {
  toolSearchSpecies,
  toolSearchAssessors,
  toolGetTaxonomySubgroups,
  dispatchToolCall,
  getAllAssessorNames,
} from "../ai-search";

// =============================================================================
// Unit tests for AI search tool implementations.
// These run against real data files — no mocks, no API calls.
// First call loads the search index (~95MB) so we use a generous timeout.
// =============================================================================

const DATA_TIMEOUT = 30_000; // first call loads indexes from disk

describe("toolSearchSpecies", () => {
  it("finds species by partial name", () => {
    // Use a broad search that will hit something in any dataset
    const result = toolSearchSpecies("frog", 5);
    expect(result).not.toBe("No species found matching that query.");
  }, DATA_TIMEOUT);

  it("returns 'no species found' for gibberish", () => {
    const result = toolSearchSpecies("xyzzyplugh123", 5);
    expect(result).toBe("No species found matching that query.");
  });

  it("respects the limit parameter", () => {
    const result = toolSearchSpecies("frog", 3);
    const lines = result.split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("includes taxon and category info in output", () => {
    const result = toolSearchSpecies("frog", 1);
    expect(result).toMatch(/taxon: \w+/);
    expect(result).toMatch(/— [A-Z]{2}/);
  });

  it("caps limit at 20", () => {
    const result = toolSearchSpecies("bird", 100);
    const lines = result.split("\n");
    expect(lines.length).toBeLessThanOrEqual(20);
  });
});

describe("toolSearchAssessors", () => {
  it("finds Bachman in assessor names", () => {
    const result = toolSearchAssessors("Bachman");
    expect(result).not.toBe("No assessors found matching that query.");
    expect(result.toLowerCase()).toContain("bachman");
  }, DATA_TIMEOUT);

  it("returns names in 'Lastname, Initials' format", () => {
    const result = toolSearchAssessors("Bachman");
    expect(result).toMatch(/Bachman, \w/);
  });

  it("is case-insensitive", () => {
    const lower = toolSearchAssessors("bachman");
    const upper = toolSearchAssessors("BACHMAN");
    expect(lower).toBe(upper);
  });

  it("returns 'no assessors found' for unknown names", () => {
    const result = toolSearchAssessors("xyzzyplugh123");
    expect(result).toBe("No assessors found matching that query.");
  });

  it("truncates very broad searches to 30 results", () => {
    const result = toolSearchAssessors("Smith");
    // Smith should match many assessors
    if (result.startsWith("Found")) {
      expect(result).toMatch(/^Found \d+ matches\. Showing first 30:/);
    } else {
      // If <= 30 results, that's also fine
      expect(result.split("\n").length).toBeLessThanOrEqual(30);
    }
  });
});

describe("toolGetTaxonomySubgroups", () => {
  it("returns subgroups for 'all' (top-level taxa)", () => {
    const result = toolGetTaxonomySubgroups("all");
    expect(result).toContain("mammalia");
    expect(result).toContain("aves");
    expect(result).toContain("amphibia");
  });

  it("returns subgroups for 'mammalia'", () => {
    const result = toolGetTaxonomySubgroups("mammalia");
    expect(result).not.toMatch(/^No subgroups found/);
    expect(result.toLowerCase()).toMatch(/primates|carnivora|rodentia/);
  });

  it("returns error for nonexistent parent", () => {
    const result = toolGetTaxonomySubgroups("nonexistent_taxon");
    expect(result).toBe('No subgroups found for "nonexistent_taxon".');
  });

  it("includes assessed counts per subgroup", () => {
    const result = toolGetTaxonomySubgroups("all");
    expect(result).toMatch(/\(\d+ assessed\)/);
  });
});

describe("dispatchToolCall", () => {
  it("dispatches search_species", () => {
    const result = dispatchToolCall("search_species", { query: "frog", limit: 2 });
    expect(result).not.toBe("No species found matching that query.");
  });

  it("dispatches search_assessors", () => {
    const result = dispatchToolCall("search_assessors", { query: "Bachman" });
    expect(result.toLowerCase()).toContain("bachman");
  });

  it("dispatches get_taxonomy_subgroups", () => {
    const result = dispatchToolCall("get_taxonomy_subgroups", { parent_id: "all" });
    expect(result).toContain("mammalia");
  });

  it("returns error for unknown tool", () => {
    const result = dispatchToolCall("nonexistent_tool", {});
    expect(result).toBe("Unknown tool: nonexistent_tool");
  });
});

describe("getAllAssessorNames", () => {
  it("returns a large sorted array of names", () => {
    const names = getAllAssessorNames();
    expect(names.length).toBeGreaterThan(100);
    // Verify sorted (case-sensitive, which is how Array.sort works by default)
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  }, DATA_TIMEOUT);

  it("all names are at least 3 characters long", () => {
    const names = getAllAssessorNames();
    for (const name of names) {
      expect(name.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("contains known assessor (Bachman)", () => {
    const names = getAllAssessorNames();
    const hasBachman = names.some((n) => n.toLowerCase().includes("bachman"));
    expect(hasBachman).toBe(true);
  });
});
