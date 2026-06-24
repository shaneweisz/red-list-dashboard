/**
 * Registry of the *shared* species filters — the single source of truth for the
 * filters that exist identically on all four surfaces:
 *
 *   1. the dashboard URL          (useFilterParams: buildQs / parseParams)
 *   2. the MCP / /browse input    (route.ts FILTERS schema + BrowseInput)
 *   3. the server-side predicate  (species-filter: matchesSpeciesFilter)
 *   4. the dashboard link an agent hands back (dashboard-url + the `interpreted` text)
 *
 * Each filter is declared ONCE here (its MCP schema, its dashboard URL param, how
 * it resolves into the filter criteria, how it matches a species, and how it
 * reads in plain English). Adding a categorical filter is one entry and it is
 * wired everywhere; a drift-guard test (shared-filters.test.ts) fails if the
 * dashboard URL layer can't round-trip any registry filter.
 *
 * Scope: this covers the *categorical* filters (sets of values, plus the hasMap
 * enum and the endemic flag). The genuinely-bespoke filters stay outside the
 * registry because they don't share one shape across surfaces:
 *   - taxa           — expands to display-root + sub-group tokens
 *   - countries/region — region expands INTO the country set (one param)
 *   - assessors/reviewers — substring match on a parsed name list (not a species attr)
 *   - search, the exact numeric/outdated params — already 1:1 and bucket-free
 */
import { z } from "zod";
import {
  resolveCategories, resolveThreats, categoryLabel, THREAT_LABEL,
} from "@/lib/filter-vocab";
import type { FilterableSpecies, SpeciesFilterCriteria } from "@/lib/species-filter";

// ─── MCP / browse input schema (the source of the BrowseInput shared fields) ──

/**
 * Zod shape for the shared categorical filters, spread into the MCP tool input.
 * Declared as a literal so `SharedFilterInput` infers precise field types.
 */
export const SHARED_FILTER_SCHEMA = {
  categories: z.array(z.string()).optional().describe("IUCN status codes or names: CR, EN, VU, NT, LC, DD, NE, EX, EW — or 'threatened' (=CR,EN,VU). NE = not yet evaluated."),
  threats: z.array(z.string()).optional().describe("IUCN threat codes (prefix match, e.g. '11' = climate change) or aliases like climate-change, pollution, overfishing."),
  systems: z.array(z.string()).optional().describe("Realm/system: Terrestrial, Freshwater, Marine."),
  trends: z.array(z.string()).optional().describe("Population trend: Increasing, Decreasing, Stable, Unknown."),
  movement: z.array(z.string()).optional().describe("Movement pattern, e.g. Migratory, Nomadic, Not a Migrant."),
  growthForms: z.array(z.string()).optional().describe("Plant/fungus growth form, e.g. Tree, Shrub, Herb."),
  hasMap: z.enum(["yes", "no"]).optional().describe("Whether the species has an IUCN range map."),
  endemic: z.enum(["yes"]).optional().describe("Only species endemic to a single country (occurring in exactly one country)."),
} as const;

/** Precise TS type of the shared-filter fields on a BrowseInput / MCP args object. */
export type SharedFilterInput = z.infer<z.ZodObject<typeof SHARED_FILTER_SCHEMA>>;

// ─── Per-filter descriptors ───────────────────────────────────────────────

/** Outcome of resolving one filter's raw input: any unresolved tokens + a
 *  human-readable description (null when the filter resolved to nothing). */
interface ApplyResult {
  unresolved: string[];
  describe: string | null;
}

interface SharedFilterDef {
  /** Field name on the MCP / BrowseInput object (and the key in SHARED_FILTER_SCHEMA). */
  mcpKey: keyof SharedFilterInput;
  /** Dashboard URL param key (usually === mcpKey; differs only for `endemic`→`endemics`). */
  urlKey: string;
  /** Sample raw value (MCP-input shape) used by the drift-guard test. */
  sample: unknown;
  /** Resolve the raw input value and write the result onto `c`. Null when absent. */
  apply(raw: unknown, c: SpeciesFilterCriteria): ApplyResult | null;
  /** Emit the dashboard URL param from a resolved criteria object. */
  toParam(c: SpeciesFilterCriteria, p: URLSearchParams): void;
  /** Predicate clause: does the species pass this filter, given the criteria? */
  match(s: FilterableSpecies, c: SpeciesFilterCriteria): boolean;
}

const toArray = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map((v) => String(v).trim()).filter(Boolean) : [];

/**
 * Factory for a "set of values" filter (OR within the set). Handles vocab
 * resolution, criteria population, URL serialization, and the `interpreted`
 * line; callers supply only the species-matching predicate.
 */
function setFilter(opts: {
  mcpKey: keyof SharedFilterInput;
  urlKey?: string;
  /** SpeciesFilterCriteria field this writes/reads (defaults to mcpKey). */
  criteriaKey: keyof SpeciesFilterCriteria;
  label: string;
  sample: string[];
  /** Optional plain-English → code resolver (categories, threats). */
  resolve?: (vals: string[]) => { codes: string[]; unresolved: string[] };
  /** Render a resolved value for the `interpreted` text (defaults to identity). */
  render?: (code: string) => string;
  match: (s: FilterableSpecies, values: Set<string>) => boolean;
}): SharedFilterDef {
  const { mcpKey, criteriaKey, label, sample, resolve, render, match } = opts;
  const urlKey = opts.urlKey ?? mcpKey;
  const get = (c: SpeciesFilterCriteria) => c[criteriaKey] as Set<string> | undefined;
  return {
    mcpKey,
    urlKey,
    sample,
    apply(raw, c) {
      const vals = toArray(raw);
      if (!vals.length) return null;
      const { codes, unresolved } = resolve ? resolve(vals) : { codes: vals, unresolved: [] };
      if (codes.length) (c as Record<string, unknown>)[criteriaKey] = new Set(codes);
      return {
        unresolved,
        describe: codes.length ? `${label}: ${codes.map((c2) => (render ? render(c2) : c2)).join(", ")}` : null,
      };
    },
    toParam(c, p) {
      const set = get(c);
      if (set && set.size) p.set(urlKey, [...set].join(","));
    },
    match(s, c) {
      const set = get(c);
      return !set || set.size === 0 || match(s, set);
    },
  };
}

const threatRender = (code: string) => (THREAT_LABEL[code] ? `${THREAT_LABEL[code]} (${code})` : code);

export const SHARED_FILTERS: SharedFilterDef[] = [
  setFilter({
    mcpKey: "categories", criteriaKey: "categories", label: "Categories",
    sample: ["threatened"], resolve: resolveCategories, render: categoryLabel,
    match: (s, set) => set.has(s.category),
  }),
  setFilter({
    mcpKey: "threats", criteriaKey: "threats", label: "Threats",
    sample: ["climate-change"], resolve: resolveThreats, render: threatRender,
    match: (s, set) =>
      s.threat_codes?.some((tc) => [...set].some((sel) => tc === sel || tc.startsWith(sel + "."))) ?? false,
  }),
  setFilter({
    mcpKey: "systems", criteriaKey: "systems", label: "Systems",
    sample: ["Marine"],
    match: (s, set) => s.systems?.some((sys) => set.has(sys)) ?? false,
  }),
  setFilter({
    mcpKey: "trends", criteriaKey: "populationTrends", label: "Population trend",
    sample: ["Decreasing"],
    match: (s, set) => s.population_trend != null && set.has(s.population_trend),
  }),
  setFilter({
    mcpKey: "movement", criteriaKey: "movementPatterns", label: "Movement",
    sample: ["Migratory"],
    match: (s, set) => s.movement_pattern != null && set.has(s.movement_pattern),
  }),
  setFilter({
    mcpKey: "growthForms", criteriaKey: "growthForms", label: "Growth forms",
    sample: ["Tree"],
    match: (s, set) => s.growth_forms?.some((gf) => set.has(gf)) ?? false,
  }),
  // hasMap — enum yes/no
  {
    mcpKey: "hasMap", urlKey: "hasMap", sample: "yes",
    apply(raw, c) {
      if (raw !== "yes" && raw !== "no") return null;
      c.hasMap = raw;
      return { unresolved: [], describe: `Has range map: ${raw}` };
    },
    toParam(c, p) { if (c.hasMap) p.set("hasMap", c.hasMap); },
    match(s, c) { return !c.hasMap || (c.hasMap === "yes" ? s.has_map : !s.has_map); },
  },
  // endemic — flag (single-country species). URL param is `endemics=1`.
  {
    mcpKey: "endemic", urlKey: "endemics", sample: "yes",
    apply(raw, c) {
      if (raw !== "yes") return null;
      c.endemicsOnly = true;
      return { unresolved: [], describe: "Endemic to a single country" };
    },
    toParam(c, p) { if (c.endemicsOnly) p.set("endemics", "1"); },
    match(s, c) { return !c.endemicsOnly || s.countries.length === 1; },
  },
];

// ─── Surface drivers (used by browse-query, dashboard-url, species-filter) ────

/**
 * Resolve every shared filter from a raw input object onto `criteria`,
 * collecting unresolved tokens (prefixed `key=value`) and `interpreted` lines.
 */
export function applySharedFilters(
  input: SharedFilterInput,
  criteria: SpeciesFilterCriteria,
): { unresolved: string[]; describe: string[] } {
  const unresolved: string[] = [];
  const describe: string[] = [];
  for (const f of SHARED_FILTERS) {
    const res = f.apply(input[f.mcpKey], criteria);
    if (!res) continue;
    for (const u of res.unresolved) unresolved.push(`${f.mcpKey}=${u}`);
    if (res.describe) describe.push(res.describe);
  }
  return { unresolved, describe };
}

/** Emit the dashboard URL params for the shared filters present on `criteria`. */
export function emitSharedParams(criteria: SpeciesFilterCriteria, p: URLSearchParams): void {
  for (const f of SHARED_FILTERS) f.toParam(criteria, p);
}

/** AND of every shared-filter clause (each is a no-op when its filter is absent). */
export function matchSharedFilters(s: FilterableSpecies, criteria: SpeciesFilterCriteria): boolean {
  return SHARED_FILTERS.every((f) => f.match(s, criteria));
}
