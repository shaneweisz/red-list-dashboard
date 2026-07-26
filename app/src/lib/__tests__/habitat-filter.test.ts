import { describe, it, expect } from "vitest";
import { parseHabitatEntries, matchesHabitatFilter, type HabitatFilterCriteria } from "../habitat-filter";

const noFilter: HabitatFilterCriteria = {
  selectedHabitat: new Set(),
  specialistsOnly: false,
  excludeMinor: false,
  seasons: new Set(),
};

describe("parseHabitatEntries", () => {
  it("returns [] for null/undefined/empty input", () => {
    expect(parseHabitatEntries(null)).toEqual([]);
    expect(parseHabitatEntries(undefined)).toEqual([]);
    expect(parseHabitatEntries([])).toEqual([]);
  });

  it("decodes a full tuple", () => {
    expect(parseHabitatEntries(["1.1:R:S:1"])).toEqual([
      { code: "1.1", season: "Resident", suitability: "Suitable", importance: "Major" },
    ]);
  });

  it("decodes every season/suitability/importance code, including '-' as Unknown", () => {
    expect(parseHabitatEntries(["1:B:M:0"])[0]).toMatchObject({ season: "Breeding Season", suitability: "Marginal", importance: "Not major" });
    expect(parseHabitatEntries(["1:N:U:-"])[0]).toMatchObject({ season: "Non-Breeding Season", suitability: "Unknown", importance: "Unknown" });
    expect(parseHabitatEntries(["1:P:S:1"])[0]).toMatchObject({ season: "Passage" });
    expect(parseHabitatEntries(["1:U:S:1"])[0]).toMatchObject({ season: "Seasonal Occurrence Unknown" });
    expect(parseHabitatEntries(["1:-:S:1"])[0]).toMatchObject({ season: "Unknown" });
  });
});

describe("matchesHabitatFilter — no filters active", () => {
  it("matches everything, including species with no habitat data", () => {
    expect(matchesHabitatFilter(null, noFilter)).toBe(true);
    expect(matchesHabitatFilter([], noFilter)).toBe(true);
    expect(matchesHabitatFilter(["1.1:R:S:1"], noFilter)).toBe(true);
  });
});

describe("matchesHabitatFilter — selectedHabitat", () => {
  it("matches an exact code", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1"], { ...noFilter, selectedHabitat: new Set(["1.1"]) })).toBe(true);
  });

  it("matches a more specific code under a selected coarser code (prefix match)", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1"], { ...noFilter, selectedHabitat: new Set(["1"]) })).toBe(true);
  });

  it("does not match a sibling code, or treat prefix matching as substring matching", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1"], { ...noFilter, selectedHabitat: new Set(["1.2"]) })).toBe(false);
    // "1" should not match "18" (Unknown) via naive string prefix — startsWith("1.") guards this
    expect(matchesHabitatFilter(["18:R:S:1"], { ...noFilter, selectedHabitat: new Set(["1"]) })).toBe(false);
  });
});

describe("matchesHabitatFilter — specialistsOnly", () => {
  const specialistFilter = { ...noFilter, specialistsOnly: true };

  it("is a specialist with exactly one coarse category, even via one exact code", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1"], specialistFilter)).toBe(true);
  });

  it("is still a specialist across multiple subtypes of the SAME coarse category", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1", "1.5:R:S:0"], specialistFilter)).toBe(true);
  });

  it("is not a specialist across two different coarse categories", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1", "4.1:R:S:1"], specialistFilter)).toBe(false);
  });

  it("is not a specialist when the only habitat data is Unknown (category 18)", () => {
    expect(matchesHabitatFilter(["18:-:U:-"], specialistFilter)).toBe(false);
  });

  it("is not a specialist with no habitat data at all", () => {
    expect(matchesHabitatFilter([], specialistFilter)).toBe(false);
    expect(matchesHabitatFilter(null, specialistFilter)).toBe(false);
  });

  it("ignores Unknown entries mixed in with one known coarse category — still a specialist", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1", "18:-:U:-"], specialistFilter)).toBe(true);
  });

  it("is not a specialist with one known category plus a second known category alongside Unknown", () => {
    expect(matchesHabitatFilter(["1.1:R:S:1", "4.1:R:S:1", "18:-:U:-"], specialistFilter)).toBe(false);
  });
});

describe("matchesHabitatFilter — excludeMinor", () => {
  it("with no habitat selected, keeps species with at least one non-minor (major or unknown-importance) entry", () => {
    const f = { ...noFilter, excludeMinor: true };
    expect(matchesHabitatFilter(["1.1:R:S:1"], f)).toBe(true); // major
    expect(matchesHabitatFilter(["1.1:R:S:-"], f)).toBe(true); // unrecorded, kept
    expect(matchesHabitatFilter(["1.1:R:S:0"], f)).toBe(false); // confirmed minor only
    expect(matchesHabitatFilter(["1.1:R:S:0", "4.1:R:S:1"], f)).toBe(true); // one major elsewhere
  });

  it("scopes to the selected habitat's own entries, not just any habitat", () => {
    const f = { ...noFilter, selectedHabitat: new Set(["1"]), excludeMinor: true };
    // Forest (1.1) is confirmed minor; a different, unselected habitat (4.1) is major —
    // should NOT rescue the Forest match.
    expect(matchesHabitatFilter(["1.1:R:S:0", "4.1:R:S:1"], f)).toBe(false);
    // Forest itself is major — passes.
    expect(matchesHabitatFilter(["1.1:R:S:1", "4.1:R:S:0"], f)).toBe(true);
    // Forest importance unrecorded — kept, not treated as minor.
    expect(matchesHabitatFilter(["1.1:R:S:-"], f)).toBe(true);
  });
});

describe("matchesHabitatFilter — seasons", () => {
  it("matches any one of multiple selected seasons (OR)", () => {
    const f = { ...noFilter, seasons: new Set(["Breeding Season", "Passage"]) };
    expect(matchesHabitatFilter(["1.1:B:S:1"], f)).toBe(true);
    expect(matchesHabitatFilter(["1.1:P:S:1"], f)).toBe(true);
    expect(matchesHabitatFilter(["1.1:R:S:1"], f)).toBe(false);
  });

  it("scopes to the selected habitat's own entries", () => {
    const f = { ...noFilter, selectedHabitat: new Set(["1"]), seasons: new Set(["Breeding Season"]) };
    // Forest is Resident-only; a different habitat is Breeding — shouldn't count.
    expect(matchesHabitatFilter(["1.1:R:S:1", "4.1:B:S:1"], f)).toBe(false);
    expect(matchesHabitatFilter(["1.1:B:S:1", "4.1:R:S:1"], f)).toBe(true);
  });
});

describe("matchesHabitatFilter — combined filters", () => {
  it("ANDs selectedHabitat, specialistsOnly, excludeMinor, and seasons together", () => {
    const f: HabitatFilterCriteria = {
      selectedHabitat: new Set(["1"]),
      specialistsOnly: true,
      excludeMinor: true,
      seasons: new Set(["Resident"]),
    };
    // Passes all four: only Forest, matches selection, major, Resident.
    expect(matchesHabitatFilter(["1.1:R:S:1"], f)).toBe(true);
    // Fails specialistsOnly (two coarse categories).
    expect(matchesHabitatFilter(["1.1:R:S:1", "4.1:R:S:1"], f)).toBe(false);
    // Fails excludeMinor (Forest entry confirmed minor).
    expect(matchesHabitatFilter(["1.1:R:S:0"], f)).toBe(false);
    // Fails seasons (Forest entry is Breeding, not Resident).
    expect(matchesHabitatFilter(["1.1:B:S:1"], f)).toBe(false);
  });
});
