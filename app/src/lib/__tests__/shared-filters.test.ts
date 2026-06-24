/**
 * Drift guard for the shared-filter registry.
 *
 * The whole point of the registry (@/lib/shared-filters) is that a filter
 * declared once is wired into every surface — the MCP input schema, the
 * server predicate, the dashboard-link builder, AND the dashboard URL state.
 * These tests fail if any registry filter falls out of sync with one of them,
 * so a new filter can't be merged half-wired (the bug that left `endemics`,
 * `movement`, and `growthForms` missing from the MCP tools).
 */
import { describe, it, expect } from "vitest";
import {
  SHARED_FILTERS, SHARED_FILTER_SCHEMA,
  applySharedFilters, emitSharedParams, matchSharedFilters,
} from "@/lib/shared-filters";
import { browseInputToDashboardQuery } from "@/lib/dashboard-url";
import { parseParams, buildQs } from "@/hooks/useFilterParams";
import { matchesSpeciesFilter, type SpeciesFilterCriteria } from "@/lib/species-filter";

describe("shared-filter registry integrity", () => {
  it("every descriptor has a matching MCP schema entry (and vice versa)", () => {
    const descriptorKeys = SHARED_FILTERS.map((f) => f.mcpKey).sort();
    const schemaKeys = Object.keys(SHARED_FILTER_SCHEMA).sort();
    expect(descriptorKeys).toEqual(schemaKeys);
  });

  it("uses unique MCP keys and dashboard URL keys", () => {
    const mcp = SHARED_FILTERS.map((f) => f.mcpKey);
    const url = SHARED_FILTERS.map((f) => f.urlKey);
    expect(new Set(mcp).size).toBe(mcp.length);
    expect(new Set(url).size).toBe(url.length);
  });
});

// The guarantee: for every registry filter, an MCP input value flows all the way
// to the dashboard URL AND the dashboard parses it back (round-trips through
// buildQs). If a filter is added to the registry but its URL param isn't taught
// to parseParams/buildQs, one of these assertions fails.
describe("every shared filter round-trips MCP input → dashboard URL → parseParams", () => {
  for (const f of SHARED_FILTERS) {
    it(`${f.mcpKey} reaches the dashboard URL and survives a parse/rebuild`, () => {
      const qs = browseInputToDashboardQuery({ taxa: ["mammals"], [f.mcpKey]: f.sample });

      // 1. The MCP→dashboard-URL builder emits this filter's param.
      const emitted = new URLSearchParams(qs).get(f.urlKey);
      expect(emitted).not.toBeNull();

      // 2. The dashboard parses it and re-emits it with the SAME value (no silent
      //    drop OR mis-decode in buildQs/parseParams).
      const rebuilt = new URLSearchParams(buildQs(parseParams(qs)));
      expect(rebuilt.get(f.urlKey)).toBe(emitted);
    });
  }
});

describe("registry predicate clauses", () => {
  const base = {
    category: "VU", countries: ["BR", "AR"], systems: ["Marine"],
    population_trend: "Decreasing", movement_pattern: "Migratory",
    threat_codes: ["11.4"], has_map: true, growth_forms: ["Tree"],
    scientific_name: "X", common_name: null,
  };

  it("matchSharedFilters covers every categorical clause", () => {
    // A criteria that selects the base species on every registry dimension.
    const c: SpeciesFilterCriteria = {
      categories: new Set(["VU"]), threats: new Set(["11"]),
      systems: new Set(["Marine"]), populationTrends: new Set(["Decreasing"]),
      movementPatterns: new Set(["Migratory"]), growthForms: new Set(["Tree"]),
      hasMap: "yes",
    };
    expect(matchSharedFilters(base, c)).toBe(true);
    // Flip each and confirm it now fails — proves the clause is wired.
    expect(matchSharedFilters({ ...base, category: "EN" }, c)).toBe(false);
    expect(matchSharedFilters({ ...base, threat_codes: ["5.4"] }, c)).toBe(false);
    expect(matchSharedFilters({ ...base, systems: ["Freshwater"] }, c)).toBe(false);
    expect(matchSharedFilters({ ...base, population_trend: "Stable" }, c)).toBe(false);
    expect(matchSharedFilters({ ...base, movement_pattern: "Nomadic" }, c)).toBe(false);
    expect(matchSharedFilters({ ...base, growth_forms: ["Shrub"] }, c)).toBe(false);
    expect(matchSharedFilters({ ...base, has_map: false }, c)).toBe(false);
  });

  it("endemic filter keeps single-country species only", () => {
    const c: SpeciesFilterCriteria = { endemicsOnly: true };
    expect(matchesSpeciesFilter({ ...base, countries: ["BR"] }, c)).toBe(true);
    expect(matchesSpeciesFilter({ ...base, countries: ["BR", "AR"] }, c)).toBe(false);
  });
});

describe("applySharedFilters / emitSharedParams", () => {
  it("resolves vocabulary aliases and reports unresolved tokens", () => {
    const c: SpeciesFilterCriteria = {};
    const { unresolved, describe } = applySharedFilters(
      { categories: ["threatened", "not-a-category"], endemic: "yes" },
      c,
    );
    expect(c.categories).toEqual(new Set(["CR", "EN", "VU"]));
    expect(c.endemicsOnly).toBe(true);
    expect(unresolved).toContain("categories=not-a-category");
    expect(describe.some((d) => d.startsWith("Categories:"))).toBe(true);
  });

  it("emits dashboard params from resolved criteria", () => {
    const c: SpeciesFilterCriteria = {};
    applySharedFilters({ trends: ["Decreasing"], hasMap: "no", endemic: "yes" }, c);
    const p = new URLSearchParams();
    emitSharedParams(c, p);
    expect(p.get("trends")).toBe("Decreasing");
    expect(p.get("hasMap")).toBe("no");
    expect(p.get("endemics")).toBe("1");
  });
});
