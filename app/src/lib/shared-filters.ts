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
 * Scope: this covers the *categorical* filters (sets of values, plus the
 * endemic flag). The genuinely-bespoke filters stay outside the
 * registry because they don't share one shape across surfaces:
 *   - taxa           — expands to display-root + sub-group tokens
 *   - countries/region — region expands INTO the country set (one param)
 *   - assessors/reviewers — substring match on a parsed name list (not a species attr)
 *   - search, the exact numeric/outdated params — already 1:1 and bucket-free
 */
import { z } from "zod";
import {
  resolveCategories, resolveThreats, categoryLabel, THREAT_LABEL,
  ALL_CATEGORIES, THREAT_CATEGORIES, SYSTEMS, POPULATION_TRENDS,
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

/** Help/vocabulary for one shared filter, surfaced by the /browse index help and
 *  the get_vocabulary MCP tool — both derive from this, so they can't drift. */
export interface FilterVocab {
  /** MCP/BrowseInput key. */
  key: string;
  /** Dashboard URL param key (what a /browse or shared URL actually uses). */
  urlKey: string;
  /** Short human label. */
  label: string;
  /** Enumerable values — plain strings, or {code,label} for coded vocab; [] = free-text. */
  values: readonly (string | { code: string; label: string })[];
  /** Free-text note (aliases, "common values", endemic meaning, …). */
  note?: string;
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
  /** Read this filter's value from URL params into MCP-input shape (inverse of toParam). */
  readParam(sp: URLSearchParams): unknown;
  /** Emit the dashboard URL param from a resolved criteria object. */
  toParam(c: SpeciesFilterCriteria, p: URLSearchParams): void;
  /** Predicate clause: does the species pass this filter, given the criteria? */
  match(s: FilterableSpecies, c: SpeciesFilterCriteria): boolean;
  /** Help/vocabulary entry for the discovery surfaces. */
  vocab: FilterVocab;
}

const toArray = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map((v) => String(v).trim()).filter(Boolean) : [];

/** Read a comma/multi-valued list param (matches the /browse + dashboard parsing). */
const readList = (sp: URLSearchParams, key: string): string[] =>
  sp.getAll(key).join(",").split(",").map((s) => s.trim()).filter(Boolean);

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
  /** Discovery-surface vocabulary (label/values/note). */
  vocab: Omit<FilterVocab, "key" | "urlKey">;
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
    readParam(sp) {
      const vals = readList(sp, urlKey);
      return vals.length ? vals : undefined;
    },
    toParam(c, p) {
      const set = get(c);
      if (set && set.size) p.set(urlKey, [...set].join(","));
    },
    match(s, c) {
      const set = get(c);
      return !set || set.size === 0 || match(s, set);
    },
    vocab: { key: mcpKey, urlKey, ...opts.vocab },
  };
}

const threatRender = (code: string) => (THREAT_LABEL[code] ? `${THREAT_LABEL[code]} (${code})` : code);

export const SHARED_FILTERS: SharedFilterDef[] = [
  setFilter({
    mcpKey: "categories", criteriaKey: "categories", label: "Categories",
    sample: ["threatened"], resolve: resolveCategories, render: categoryLabel,
    match: (s, set) => set.has(s.category),
    vocab: {
      label: "IUCN status category",
      values: ALL_CATEGORIES.map((c) => ({ code: c, label: categoryLabel(c) })),
      note: "codes or names; aliases: threatened = CR, EN, VU; extinct = EX, EW. NE = not yet evaluated.",
    },
  }),
  setFilter({
    mcpKey: "threats", criteriaKey: "threats", label: "Threats",
    sample: ["climate-change"], resolve: resolveThreats, render: threatRender,
    match: (s, set) =>
      s.threat_codes?.some((tc) => [...set].some((sel) => tc === sel || tc.startsWith(sel + "."))) ?? false,
    vocab: {
      label: "IUCN threat",
      values: THREAT_CATEGORIES.map((t) => ({ code: t.code, label: t.label })),
      note: "prefix/sub-code match (11 covers 11.1, 11.4, …); aliases: climate-change, pollution, invasive-species, overfishing, logging, hunting, dams.",
    },
  }),
  setFilter({
    mcpKey: "systems", criteriaKey: "systems", label: "Systems",
    sample: ["Marine"],
    match: (s, set) => s.systems?.some((sys) => set.has(sys)) ?? false,
    vocab: { label: "Realm / system", values: SYSTEMS },
  }),
  setFilter({
    mcpKey: "trends", criteriaKey: "populationTrends", label: "Population trend",
    sample: ["Decreasing"],
    match: (s, set) => s.population_trend != null && set.has(s.population_trend),
    vocab: { label: "Population trend", values: POPULATION_TRENDS },
  }),
  setFilter({
    mcpKey: "movement", criteriaKey: "movementPatterns", label: "Movement",
    sample: ["Migratory"],
    match: (s, set) => s.movement_pattern != null && set.has(s.movement_pattern),
    vocab: {
      label: "Movement pattern",
      values: ["Full Migrant", "Altitudinal Migrant", "Nomadic", "Not a Migrant", "Unknown"],
      note: "free text; common values shown.",
    },
  }),
  setFilter({
    mcpKey: "growthForms", criteriaKey: "growthForms", label: "Growth forms",
    sample: ["Tree"],
    match: (s, set) => s.growth_forms?.some((gf) => set.has(gf)) ?? false,
    vocab: {
      label: "Plant / fungus growth form",
      values: ["Tree", "Shrub", "Herb", "Forb", "Graminoid", "Geophyte", "Lithophyte", "Epiphyte"],
      note: "free text; common values shown.",
    },
  }),
  // endemic — flag (single-country species). URL param is `endemics=1`.
  {
    mcpKey: "endemic", urlKey: "endemics", sample: "yes",
    apply(raw, c) {
      if (raw !== "yes") return null;
      c.endemicsOnly = true;
      return { unresolved: [], describe: "Endemic to a single country" };
    },
    readParam(sp) {
      const v = sp.get("endemics");
      // Canonical dashboard form is `endemics=1`; also accept `endemics=yes`.
      return v === "1" || v === "yes" ? "yes" : undefined;
    },
    toParam(c, p) { if (c.endemicsOnly) p.set("endemics", "1"); },
    match(s, c) { return !c.endemicsOnly || s.countries.length === 1; },
    vocab: { key: "endemic", urlKey: "endemics", label: "Endemic to a single country", values: ["yes"], note: "URL param is endemics=1." },
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

/**
 * Read the shared-filter portion of a BrowseInput straight from URL params
 * (the inverse of emitSharedParams at the input layer). The /browse route uses
 * this so every registry filter is parsed from a pasted/shared URL — adding a
 * filter to the registry wires /browse automatically, no per-param edit.
 */
export function readSharedInput(sp: URLSearchParams): Partial<SharedFilterInput> {
  const out: Record<string, unknown> = {};
  for (const f of SHARED_FILTERS) {
    const v = f.readParam(sp);
    if (v !== undefined) out[f.mcpKey] = v;
  }
  return out as Partial<SharedFilterInput>;
}

/** Vocabulary for every shared filter, for the /browse index + get_vocabulary. */
export const SHARED_FILTER_VOCAB: FilterVocab[] = SHARED_FILTERS.map((f) => f.vocab);

/** AND of every shared-filter clause (each is a no-op when its filter is absent). */
export function matchSharedFilters(s: FilterableSpecies, criteria: SpeciesFilterCriteria): boolean {
  return SHARED_FILTERS.every((f) => f.match(s, criteria));
}
