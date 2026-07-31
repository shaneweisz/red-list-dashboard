/**
 * The lump branch of matchGbifSpecies, driven through a stubbed GBIF.
 *
 * This path had no test, and two defects lived in it: a guard that compared
 * authorship to itself (`a === a`, always true), and the exact-epithet rule that
 * replaced it, which threw away 21 species' own records because GBIF reports a
 * respelled name as VARIANT rather than EXACT.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { matchGbifSpecies, setAssessedNames } from "../match-redlist-species-to-gbif";

/** A CoL lump: `usage` is what the searched name resolved to, `acceptedUsage` is what CoL folds it into. */
function gbifLump(usageName: string, acceptedName: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      usage: { key: "OWNKEY", canonicalName: usageName, authorship: "(Gould, 1852)", status: "synonym", rank: "SPECIES" },
      acceptedUsage: { key: "OTHERKEY", canonicalName: acceptedName, authorship: "(Someone, 1900)" },
      diagnostics: { matchType: "VARIANT" },
    }),
  };
}

describe("keeping a lumped species' own usage", () => {
  beforeEach(() => setAssessedNames([]));
  afterEach(() => { vi.unstubAllGlobals(); setAssessedNames([]); });

  it("keeps the own key when GBIF respells the name it was asked for", async () => {
    // Searched its own name; GBIF answers with a VARIANT spelling. That is GBIF
    // confirming the name, not a different species.
    vi.stubGlobal("fetch", vi.fn(async () => gbifLump("Sminthopsis fuliginosus", "Sminthopsis crassicaudata")));
    const r = await matchGbifSpecies("Sminthopsis fuliginosa", {}, "Sminthopsis fuliginosa");
    expect(r.matchType).toBe("LUMPED");
    expect(r.key).toBe("OWNKEY");
  });

  it("refuses the key when the usage was reached through a synonym", async () => {
    // Catapodium borgesii: searching a listed synonym landed on a widespread
    // European grass's usage, carrying 19,901 records that are not its own.
    vi.stubGlobal("fetch", vi.fn(async () => gbifLump("Catapodium marinum", "Catapodium marinum")));
    const r = await matchGbifSpecies("Desmazeria marina", {}, "Catapodium borgesii");
    expect(r.matchType).toBe("LUMPED");
    expect(r.key).toBeNull();
  });

  it("refuses when the usage is a species the Red List assesses separately", async () => {
    setAssessedNames(["Actinodaphne latifolia", "Actinodaphne nitida"]);
    vi.stubGlobal("fetch", vi.fn(async () => gbifLump("Actinodaphne nitida", "Actinodaphne nitida")));
    const r = await matchGbifSpecies("Actinodaphne latifolia", {}, "Actinodaphne latifolia");
    expect(r.key).toBeNull();
  });
});
