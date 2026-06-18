/**
 * Shared query logic for the dashboard's agent/data surface — used by BOTH the
 * /browse HTTP route and the /api/mcp tools, so they return identical results
 * (single source of truth, can't drift).
 *
 * Takes raw string params (from URL query or MCP tool args), resolves the
 * plain-English vocabulary, runs the DuckDB read layer (querySpecies for taxon
 * browse, searchSpecies for species lookup), applies the shared base predicate +
 * the SPA-local filters, and returns a structured result (total + by-category
 * breakdown + outdated stats + a capped, labelled species list).
 */
import { querySpecies, searchSpecies, type SearchResult } from "@/lib/data/species-duckdb";
import { isOutdated, getTaxaSummary } from "@/lib/data/species-store";
import { findNode, speciesMatchesNode, getCsvGroupsForNode } from "@/lib/taxonomy-utils";
import { matchesSpeciesFilter, type SpeciesFilterCriteria, type FilterableSpecies } from "@/lib/species-filter";
import type { RedListSpecies } from "@/hooks/useRedListSpeciesQuery";
import { parseAssessors } from "@/lib/parseAssessors";
import { resolveRegions } from "@/lib/regions";
import { CATEGORY_ORDER } from "@/config/taxa";
import {
  resolveTaxa, resolveThreats, resolveCategories, resolveCountries, taxonNarrowingNotes,
  taxonLabel, categoryLabel, countryLabel, threatDisplay, THREAT_LABEL,
} from "@/lib/filter-vocab";

export const RESULT_CAP = 200;

const threatLabel = (code: string) => (THREAT_LABEL[code] ? `${THREAT_LABEL[code]} (${code})` : code);

/** Dimensions the caller can ask the server to aggregate over (token-cheap counts
 *  over the FULL matched set, not just the capped species list). */
export type GroupByDimension = "category" | "threat" | "trend" | "system" | "endemism" | "country";

export interface BrowseInput {
  taxa?: string[];
  search?: string;
  categories?: string[];
  threats?: string[];
  countries?: string[];
  region?: string[];
  systems?: string[];
  trends?: string[];
  movement?: string[];
  growthForms?: string[];
  hasMap?: "yes" | "no" | null;
  outdated?: "yes" | "no" | null;
  assessors?: string[];
  reviewers?: string[];
  minObs?: number;
  maxObs?: number;
  minAssessmentYear?: number;
  maxAssessmentYear?: number;
  minDescribedYear?: number;
  maxDescribedYear?: number;
  /** Server-side aggregation dimensions (see GroupByDimension). */
  groupBy?: string[];
}

export interface BrowseSpecies {
  scientific_name: string;
  common_name: string | null;
  matched_synonym: string | null;
  category: string;
  category_label: string;
  threats: { code: string; label: string }[];
  countries: string[];
  /** Number of range countries — the token-cheap stand-in for the full `countries` array. */
  country_count: number;
  /** True when EVERY range country falls within the query's country/region filter
   *  (i.e. the species is restricted to the queried area). null when no country
   *  or region filter is active, so it can't be determined. */
  endemic_to_query: boolean | null;
  systems: string[] | null;
  population_trend: string | null;
  assessment_date: string | null;
  outdated: boolean;
  gbif_occurrence_count: number | null;
  // Canonical primary-source identifiers (URLs are built from these in the MCP
  // layer). assessment_id/sis are null for Not-Evaluated species; col_id is set
  // for NE rows and resolvable for assessed ones.
  sis_taxon_id: number | null;
  assessment_id: number | null;
  gbif_species_key: number | null;
  col_id: string | null;
}

/** One aggregated bucket: a value, optional human label, and a count. */
export interface GroupBucket { value: string; label?: string; count: number; }

/** Pre-filter assessment coverage for the queried curated taxon group(s) — how
 *  much of the CoL-described universe the IUCN Red List has actually evaluated.
 *  Surfaces the global undercount so an agent doesn't understate a crisis by
 *  trusting the assessed figure alone. */
export interface CoverageInfo {
  groups: string[];
  assessed: number;
  not_evaluated: number;
  described_universe: number;
  assessed_pct: number | null;
  note: string;
}

export interface BrowseResult {
  interpreted: string[];
  unresolved: string[];
  /** Notes when a colloquial taxon silently narrowed (e.g. plants → flowering plants). */
  narrowingNotes: string[];
  /** A requested group is too large to enumerate (drill into a sub-group). */
  tooLarge: boolean;
  /** True when neither a taxon nor a search term resolved (caller decides how to surface). */
  noSelector: boolean;
  total: number;
  shown: number;
  capped: boolean;
  breakdown: Record<string, number>;
  stats: { assessed: number; outdated: number; outdated_pct: number | null };
  /** Requested server-side aggregations (over the full matched set). Empty when none asked. */
  groups: Record<string, GroupBucket[]>;
  /** Assessment coverage for the queried taxon group(s); undefined when not derivable. */
  coverage?: CoverageInfo;
  species: BrowseSpecies[];
}

type Row = FilterableSpecies & {
  id?: number;
  sis_taxon_id?: number | null;
  assessment_id?: number | null;
  gbif_species_key?: number | null;
  col_id?: string | null;
  taxon_group?: string;
  class_name?: string | null;
  order_name?: string | null;
  family?: string | null;
  latest_assessors?: string | null;
  latest_reviewers?: string | null;
  described_year?: number | null;
  matched_synonym?: string | null;
};

// resolveRegions now lives in @/lib/regions (shared with the dashboard-URL
// translator); re-exported here for existing importers.
export { resolveRegions } from "@/lib/regions";

function searchHitToRow(h: SearchResult): Row {
  return {
    category: h.category, countries: h.countries ?? [], systems: null,
    population_trend: null, movement_pattern: null, threat_codes: null, has_map: false,
    growth_forms: null, scientific_name: h.scientific_name, common_name: h.common_name,
    gbif_occurrence_count: null, assessment_date: h.assessment_date, taxon_group: h.taxon_group,
    latest_assessors: null, latest_reviewers: null, described_year: null,
    matched_synonym: h.matched_synonym ?? null,
    // Carry the canonical ids so a species lookup can cite its primary sources too.
    // A positive id is the IUCN SIS id; a synthetic negative id is a CoL-only hit.
    id: h.id, sis_taxon_id: h.id > 0 ? h.id : null, assessment_id: h.assessment_id,
    gbif_species_key: h.gbif_species_key, col_id: null,
  };
}

const arr = (a?: string[]) => (a ?? []).map((s) => s.trim()).filter(Boolean);
const setOrUndef = (a: string[]) => (a.length ? new Set(a) : undefined);

export async function runBrowseQuery(input: BrowseInput): Promise<BrowseResult> {
  const taxa = resolveTaxa(arr(input.taxa));
  const threats = resolveThreats(arr(input.threats));
  const categories = resolveCategories(arr(input.categories));
  const countries = resolveCountries(arr(input.countries));
  const regionRaw = arr(input.region);
  const regions = resolveRegions(regionRaw);
  const assessors = arr(input.assessors);
  const reviewers = arr(input.reviewers);
  const systems = arr(input.systems);
  const trends = arr(input.trends);
  const movement = arr(input.movement);
  const growthForms = arr(input.growthForms);
  const search = (input.search ?? "").trim();
  const { hasMap = null, outdated = null, minObs, maxObs, minAssessmentYear, maxAssessmentYear, minDescribedYear, maxDescribedYear } = input;

  const unresolved = [
    ...taxa.unresolved.map((v) => `taxa=${v}`),
    ...threats.unresolved.map((v) => `threats=${v}`),
    ...categories.unresolved.map((v) => `categories=${v}`),
    ...countries.unresolved.map((v) => `countries=${v}`),
    ...regions.unresolved.map((v) => `region=${v}`),
  ];

  if (taxa.ids.length === 0 && !search) {
    return { interpreted: [], unresolved, narrowingNotes: taxonNarrowingNotes(arr(input.taxa)), tooLarge: false, noSelector: true, total: 0, shown: 0, capped: false, breakdown: {}, stats: { assessed: 0, outdated: 0, outdated_pct: null }, groups: {}, species: [] };
  }

  const criteria: SpeciesFilterCriteria = {
    categories: setOrUndef(categories.codes),
    threats: setOrUndef(threats.codes),
    countries: setOrUndef([...countries.codes, ...regions.codes]),
    systems: setOrUndef(systems),
    populationTrends: setOrUndef(trends),
    movementPatterns: setOrUndef(movement),
    growthForms: setOrUndef(growthForms),
    hasMap,
    search: search ? search.toLowerCase() : undefined,
    minObs, maxObs, minAssessmentYear, maxAssessmentYear,
  };

  let matched: Row[] = [];
  let tooLarge = false;

  if (taxa.ids.length) {
    const includeNE = categories.codes.includes("NE");
    const results = await Promise.all(taxa.ids.map((id) => querySpecies({ taxon: id, includeNE })));
    const seen = new Set<number>();
    results.forEach((res, i) => {
      if (res.tooLarge) tooLarge = true;
      const id = taxa.ids[i];
      const isNode = !!findNode(id);
      for (const r of res.species as unknown as RedListSpecies[]) {
        if (isNode && !speciesMatchesNode(r, id)) continue;
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (matchesSpeciesFilter(r, criteria)) matched.push(r);
      }
    });
    if (outdated) matched = matched.filter((r) => isOutdated(r.assessment_date ?? null) === (outdated === "yes"));
    if (assessors.length) {
      const q = assessors.map((a) => a.toLowerCase());
      matched = matched.filter((r) => parseAssessors(r.latest_assessors).some((a) => q.some((x) => a.toLowerCase().includes(x))));
    }
    if (reviewers.length) {
      const q = reviewers.map((a) => a.toLowerCase());
      matched = matched.filter((r) => parseAssessors(r.latest_reviewers).some((a) => q.some((x) => a.toLowerCase().includes(x))));
    }
    if (minDescribedYear != null || maxDescribedYear != null) {
      matched = matched.filter((r) => r.described_year != null
        && (minDescribedYear == null || r.described_year >= minDescribedYear)
        && (maxDescribedYear == null || r.described_year <= maxDescribedYear));
    }
  } else {
    const hits = await searchSpecies(search, RESULT_CAP);
    matched = hits.map(searchHitToRow);
  }

  matched.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 99;
    const cb = CATEGORY_ORDER[b.category] ?? 99;
    return ca !== cb ? ca - cb : a.scientific_name.localeCompare(b.scientific_name);
  });

  const total = matched.length;
  const shown = matched.slice(0, RESULT_CAP);
  const breakdown: Record<string, number> = {};
  for (const r of matched) breakdown[r.category] = (breakdown[r.category] ?? 0) + 1;
  const assessed = matched.filter((r) => r.category !== "NE");
  const outdatedCount = assessed.filter((r) => isOutdated(r.assessment_date ?? null)).length;
  const outdated_pct = assessed.length ? Math.round((outdatedCount / assessed.length) * 100) : null;

  // Endemism is computed relative to the query's country/region set: a species is
  // "endemic to the query" when EVERY one of its range countries falls inside that
  // set. Null (undeterminable) when no country/region filter is active.
  const querySet = new Set<string>([...countries.codes, ...regions.codes]);
  const hasGeoFilter = querySet.size > 0;
  const endemicOf = (r: Row): boolean | null =>
    !hasGeoFilter ? null : r.countries.length > 0 && r.countries.every((c) => querySet.has(c));

  const groups = aggregate(matched, arr(input.groupBy), endemicOf);
  const coverage = computeCoverage(taxa.ids);
  const narrowingNotes = taxonNarrowingNotes(arr(input.taxa));

  const interpreted = describeFilters({ taxa, threats, categories, countries, regionRaw, regions, systems, trends, movement, growthForms, hasMap, search, assessors, reviewers, minObs, maxObs, minAssessmentYear, maxAssessmentYear, minDescribedYear, maxDescribedYear, outdated });

  return {
    interpreted, unresolved, narrowingNotes, tooLarge, noSelector: false,
    total, shown: shown.length, capped: total > RESULT_CAP, breakdown,
    stats: { assessed: assessed.length, outdated: outdatedCount, outdated_pct },
    groups, coverage,
    species: shown.map((s) => ({
      scientific_name: s.scientific_name,
      common_name: s.common_name,
      matched_synonym: s.matched_synonym ?? null,
      category: s.category,
      category_label: categoryLabel(s.category),
      threats: (s.threat_codes ?? []).map((c) => ({ code: c, label: threatDisplay(c) })),
      countries: s.countries,
      country_count: s.countries.length,
      endemic_to_query: endemicOf(s),
      systems: s.systems ?? null,
      population_trend: s.population_trend,
      assessment_date: s.assessment_date ?? null,
      outdated: isOutdated(s.assessment_date ?? null),
      gbif_occurrence_count: s.gbif_occurrence_count ?? null,
      sis_taxon_id: s.sis_taxon_id ?? null,
      assessment_id: s.assessment_id ?? null,
      gbif_species_key: s.gbif_species_key ?? null,
      col_id: s.col_id ?? null,
    })),
  };
}

// ─── Server-side aggregation (groupBy) ───────────────────────────────────────
//
// Counts over the FULL matched set (not the capped species list), so an agent can
// ask "by threat / by trend / by endemism" and get a token-cheap, reliable answer
// instead of eyeballing dozens of raw rows. Country is capped to the top buckets.

const COUNTRY_BUCKET_CAP = 30;

function aggregate(rows: Row[], dimsRaw: string[], endemicOf: (r: Row) => boolean | null): Record<string, GroupBucket[]> {
  const out: Record<string, GroupBucket[]> = {};
  const dims = new Set(dimsRaw.map((d) => d.trim().toLowerCase()).filter(Boolean));
  for (const dim of dims) {
    if (dim === "category") {
      const c = tally(rows, (r) => [r.category]);
      out.category = sortByCategory([...c].map(([value, count]) => ({ value, label: categoryLabel(value), count })));
    } else if (dim === "threat") {
      // Count each species once per DISTINCT top-level threat code it carries.
      const c = tally(rows, (r) => [...new Set((r.threat_codes ?? []).map((t) => t.split(".")[0]))]);
      out.threat = sortByCount([...c].map(([value, count]) => ({ value, label: THREAT_LABEL[value] ?? value, count })));
    } else if (dim === "trend") {
      const c = tally(rows, (r) => [r.population_trend ?? "Unspecified"]);
      out.trend = sortByCount([...c].map(([value, count]) => ({ value, count })));
    } else if (dim === "system") {
      const c = tally(rows, (r) => (r.systems?.length ? r.systems : ["Unspecified"]));
      out.system = sortByCount([...c].map(([value, count]) => ({ value, count })));
    } else if (dim === "endemism") {
      const c = tally(rows, (r) => {
        const e = endemicOf(r);
        return [e == null ? "unknown" : e ? "endemic_to_query" : "not_endemic_to_query"];
      });
      out.endemism = [...c].map(([value, count]) => ({ value, count }));
    } else if (dim === "country") {
      const c = tally(rows, (r) => r.countries);
      const sorted = sortByCount([...c].map(([value, count]) => ({ value, label: countryLabel(value), count })));
      out.country = sorted.slice(0, COUNTRY_BUCKET_CAP);
    }
  }
  return out;
}

function tally(rows: Row[], keysOf: (r: Row) => string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) for (const k of keysOf(r)) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}
const sortByCount = (b: GroupBucket[]) => b.sort((x, y) => y.count - x.count || x.value.localeCompare(y.value));
const sortByCategory = (b: GroupBucket[]) =>
  b.sort((x, y) => (CATEGORY_ORDER[x.value] ?? 99) - (CATEGORY_ORDER[y.value] ?? 99));

// ─── Assessment-coverage signal (#completeness) ──────────────────────────────
//
// For the queried CURATED taxon group(s), report how much of the CoL-described
// universe IUCN has actually evaluated — from the precomputed taxa-summary, so
// it's free. Group-level and PRE-filter (an upper bound for any sub-group/filter),
// labelled as such, so an agent treats it as an undercount signal, not a result.

function computeCoverage(taxonIds: string[]): CoverageInfo | undefined {
  try {
    const groups = new Set<string>();
    for (const id of taxonIds) if (findNode(id)) for (const g of getCsvGroupsForNode(id)) groups.add(g);
    if (groups.size === 0) return undefined;
    let assessed = 0, ne = 0, described = 0, haveNe = false;
    for (const row of getTaxaSummary()) {
      if (!groups.has(row.table1a_taxon_group)) continue;
      assessed += row.total_assessed ?? 0;
      if (row.col_ne != null) { ne += row.col_ne; haveNe = true; }
      if (row.col_described != null) described += row.col_described;
    }
    if (!haveNe) return undefined;
    const universe = described || assessed + ne;
    const assessed_pct = universe > 0 ? Math.round((assessed / universe) * 100) : null;
    return {
      groups: [...groups], assessed, not_evaluated: ne, described_universe: universe, assessed_pct,
      note: `Of ~${universe.toLocaleString()} described species CoL knows in this taxon group, IUCN has assessed ${assessed.toLocaleString()} (${assessed_pct ?? "?"}%); ~${ne.toLocaleString()} are Not Evaluated globally. These are GROUP-level, PRE-filter figures. The global Red List can also undercount where a national/regional assessment (e.g. SANBI for South African plants) lists more threatened taxa — caveat group totals accordingly.`,
    };
  } catch {
    return undefined; // taxa-summary not bundled in this function — skip, don't fail.
  }
}

// Human-readable description of the active filters (drives the HTML/JSON "interpreted").
function describeFilters(r: {
  taxa: ReturnType<typeof resolveTaxa>; threats: ReturnType<typeof resolveThreats>;
  categories: ReturnType<typeof resolveCategories>; countries: ReturnType<typeof resolveCountries>;
  regionRaw: string[]; regions: { codes: string[]; unresolved: string[] };
  systems: string[]; trends: string[]; movement: string[]; growthForms: string[];
  hasMap: "yes" | "no" | null; search: string; assessors: string[]; reviewers: string[];
  minObs?: number; maxObs?: number; minAssessmentYear?: number; maxAssessmentYear?: number;
  minDescribedYear?: number; maxDescribedYear?: number; outdated: "yes" | "no" | null;
}): string[] {
  const parts: string[] = [];
  if (r.taxa.ids.length) parts.push(`Taxa: ${r.taxa.ids.map(taxonLabel).join(", ")}`);
  if (r.threats.codes.length) parts.push(`Threats: ${r.threats.codes.map(threatLabel).join(", ")}`);
  if (r.categories.codes.length) parts.push(`Categories: ${r.categories.codes.map(categoryLabel).join(", ")}`);
  if (r.countries.codes.length) parts.push(`Countries: ${r.countries.codes.map(countryLabel).join(", ")}`);
  if (r.regions.codes.length) parts.push(`Region: ${r.regionRaw.filter((v) => !r.regions.unresolved.includes(v)).join(", ")}`);
  if (r.systems.length) parts.push(`Systems: ${r.systems.join(", ")}`);
  if (r.trends.length) parts.push(`Population trend: ${r.trends.join(", ")}`);
  if (r.movement.length) parts.push(`Movement: ${r.movement.join(", ")}`);
  if (r.growthForms.length) parts.push(`Growth forms: ${r.growthForms.join(", ")}`);
  if (r.hasMap) parts.push(`Has range map: ${r.hasMap}`);
  if (r.search) parts.push(`Name search: "${r.search}"`);
  if (r.assessors.length) parts.push(`Assessor: ${r.assessors.join(", ")}`);
  if (r.reviewers.length) parts.push(`Reviewer: ${r.reviewers.join(", ")}`);
  if (r.minObs != null) parts.push(`GBIF observations ≥ ${r.minObs.toLocaleString()}`);
  if (r.maxObs != null) parts.push(`GBIF observations ≤ ${r.maxObs.toLocaleString()}`);
  if (r.minAssessmentYear != null) parts.push(`Assessed in or after ${r.minAssessmentYear}`);
  if (r.maxAssessmentYear != null) parts.push(`Assessed in or before ${r.maxAssessmentYear}`);
  if (r.minDescribedYear != null) parts.push(`Described in or after ${r.minDescribedYear}`);
  if (r.maxDescribedYear != null) parts.push(`Described in or before ${r.maxDescribedYear}`);
  if (r.outdated) parts.push(r.outdated === "yes" ? "Outdated assessments (>10 yrs old)" : "Current assessments (≤10 yrs old)");
  return parts;
}
