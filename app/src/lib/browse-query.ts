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
import { isOutdated } from "@/lib/data/species-store";
import { findNode, speciesMatchesNode } from "@/lib/taxonomy-utils";
import { matchesSpeciesFilter, type SpeciesFilterCriteria, type FilterableSpecies } from "@/lib/species-filter";
import type { RedListSpecies } from "@/hooks/useRedListSpeciesQuery";
import { parseAssessors } from "@/lib/parseAssessors";
import { IUCN_REGION_ORDER, iucnRegionCountries } from "@/lib/regions";
import { CATEGORY_ORDER } from "@/config/taxa";
import {
  resolveTaxa, resolveThreats, resolveCategories, resolveCountries,
  taxonLabel, categoryLabel, countryLabel, threatDisplay, THREAT_LABEL,
} from "@/lib/filter-vocab";

export const RESULT_CAP = 200;

const threatLabel = (code: string) => (THREAT_LABEL[code] ? `${THREAT_LABEL[code]} (${code})` : code);

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
}

export interface BrowseSpecies {
  scientific_name: string;
  common_name: string | null;
  matched_synonym: string | null;
  category: string;
  category_label: string;
  threats: { code: string; label: string }[];
  countries: string[];
  systems: string[] | null;
  population_trend: string | null;
  assessment_date: string | null;
  outdated: boolean;
  gbif_occurrence_count: number | null;
}

export interface BrowseResult {
  interpreted: string[];
  unresolved: string[];
  /** A requested group is too large to enumerate (drill into a sub-group). */
  tooLarge: boolean;
  /** True when neither a taxon nor a search term resolved (caller decides how to surface). */
  noSelector: boolean;
  total: number;
  shown: number;
  capped: boolean;
  breakdown: Record<string, number>;
  stats: { assessed: number; outdated: number; outdated_pct: number | null };
  species: BrowseSpecies[];
}

type Row = FilterableSpecies & {
  taxon_group?: string;
  class_name?: string | null;
  order_name?: string | null;
  family?: string | null;
  latest_assessors?: string | null;
  latest_reviewers?: string | null;
  described_year?: number | null;
  matched_synonym?: string | null;
};

// Resolve IUCN region names (case-insensitive, hyphen/space tolerant) to their
// country codes — the dashboard's region dropdown expands to countries the same way.
export function resolveRegions(values: string[]): { codes: string[]; unresolved: string[] } {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  for (const v of values) {
    const hit = IUCN_REGION_ORDER.find((r) => norm(r) === norm(v));
    if (hit) iucnRegionCountries(hit).forEach((c) => codes.add(c));
    else unresolved.push(v);
  }
  return { codes: [...codes], unresolved };
}

function searchHitToRow(h: SearchResult): Row {
  return {
    category: h.category, countries: h.countries ?? [], systems: null,
    population_trend: null, movement_pattern: null, threat_codes: null, has_map: false,
    growth_forms: null, scientific_name: h.scientific_name, common_name: h.common_name,
    gbif_occurrence_count: null, assessment_date: h.assessment_date, taxon_group: h.taxon_group,
    latest_assessors: null, latest_reviewers: null, described_year: null,
    matched_synonym: h.matched_synonym ?? null,
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
    return { interpreted: [], unresolved, tooLarge: false, noSelector: true, total: 0, shown: 0, capped: false, breakdown: {}, stats: { assessed: 0, outdated: 0, outdated_pct: null }, species: [] };
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

  const interpreted = describeFilters({ taxa, threats, categories, countries, regionRaw, regions, systems, trends, movement, growthForms, hasMap, search, assessors, reviewers, minObs, maxObs, minAssessmentYear, maxAssessmentYear, minDescribedYear, maxDescribedYear, outdated });

  return {
    interpreted, unresolved, tooLarge, noSelector: false,
    total, shown: shown.length, capped: total > RESULT_CAP, breakdown,
    stats: { assessed: assessed.length, outdated: outdatedCount, outdated_pct },
    species: shown.map((s) => ({
      scientific_name: s.scientific_name,
      common_name: s.common_name,
      matched_synonym: s.matched_synonym ?? null,
      category: s.category,
      category_label: categoryLabel(s.category),
      threats: (s.threat_codes ?? []).map((c) => ({ code: c, label: threatDisplay(c) })),
      countries: s.countries,
      systems: s.systems ?? null,
      population_trend: s.population_trend,
      assessment_date: s.assessment_date ?? null,
      outdated: isOutdated(s.assessment_date ?? null),
      gbif_occurrence_count: s.gbif_occurrence_count ?? null,
    })),
  };
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
