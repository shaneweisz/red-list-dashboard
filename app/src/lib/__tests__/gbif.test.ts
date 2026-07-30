import { describe, it, expect } from "vitest";
import { gbifTaxonKeysForGroup, GBIF_CHECKLIST_KEY, COL_XR_CHECKLIST_KEY, gbifOccurrenceParams } from "../gbif";
import { TAXA } from "@/config/taxa";
import DERIVED_TAXON_KEYS from "@/config/gbif-taxon-keys.json";

describe("gbifTaxonKeysForGroup", () => {
  // The failure this guards against produced no error at all: src/config/taxa.ts
  // kept its own list of GBIF Backbone integer keys, the pipeline moved to
  // Catalogue of Life, and country statistics went on sending integers while
  // naming the CoL checklist. GBIF answers that with an empty result set, so the
  // world map's occurrence layer went blank and every request still returned 200.
  it("returns keys for every dashboard group that has occurrence data", () => {
    const groups = TAXA.map((t) => t.id).filter((id) => id !== "all");
    for (const id of groups) {
      expect(gbifTaxonKeysForGroup(id), `no GBIF keys for "${id}"`).not.toHaveLength(0);
    }
  });

  it("draws every key from the generated config, never a second list", () => {
    // The keys cannot be checked by shape — Catalogue of Life ids are alphanumeric
    // but plenty are all digits (Testudines is "477"), so "looks like an integer"
    // says nothing. What matters is provenance: a key that is not in the generated
    // config came from somewhere else, and somewhere else is what went stale.
    const derived = new Set(
      Object.values(DERIVED_TAXON_KEYS as Record<string, Array<{ taxonKey: string | null }>>)
        .flat()
        .map((e) => e.taxonKey)
        .filter((k): k is string => Boolean(k))
    );
    for (const id of TAXA.map((t) => t.id)) {
      for (const key of gbifTaxonKeysForGroup(id)) {
        expect(derived.has(key), `"${key}" in "${id}" is not in gbif-taxon-keys.json`).toBe(true);
      }
    }
  });

  it("rolls the fine-grained Table 1a groups up into dashboard groups", () => {
    // Invertebrates spans beetles through corals, so it must carry more keys than
    // any single constituent group.
    expect(gbifTaxonKeysForGroup("invertebrates").length).toBeGreaterThan(5);
    expect(gbifTaxonKeysForGroup("mammals")).toEqual(["6224G"]);
  });

  it("is unknown-group safe", () => {
    expect(gbifTaxonKeysForGroup("not-a-group")).toEqual([]);
  });
});

describe("gbifOccurrenceParams", () => {
  it("names the checklist on every query", () => {
    // Leaving it unset means the result depends on which default GBIF happens to
    // be serving, and the two taxonomies answer each other with silence.
    expect(gbifOccurrenceParams().get("checklistKey")).toBe(GBIF_CHECKLIST_KEY);
    expect(GBIF_CHECKLIST_KEY).toBe(COL_XR_CHECKLIST_KEY);
  });
});
