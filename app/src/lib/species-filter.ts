/**
 * Shared species filter predicate.
 *
 * Extracted from RedListView.tsx so the same base-filter logic runs both
 * client-side (the dashboard) and server-side (the /browse LLM endpoint).
 *
 * Semantics (must match the dashboard exactly):
 *  - Within one filter, multiple selected values are OR (species matches ANY).
 *  - Across different filters it is AND (species must satisfy EVERY active filter).
 *  - Threats match by prefix: "11" matches "11", "11.1", "11.4", ...
 *  - Categories match exactly.
 *
 * Note: time-relative filters (years/obs/assessment-year), assessor/reviewer,
 * and the "starred" filter are intentionally NOT included here — they depend on
 * the current date, GBIF counts, or local UI state and stay inline in RedListView.
 */

/** Minimal structural shape this predicate needs. Both `SpeciesRow`
 *  (server data store) and `RedListSpecies` (client hook) satisfy it. */
export interface FilterableSpecies {
  category: string;
  countries: string[];
  systems?: string[] | null;
  population_trend: string | null;
  movement_pattern: string | null;
  threat_codes?: string[] | null;
  has_map: boolean;
  growth_forms?: string[] | null;
  scientific_name: string;
  common_name: string | null;
}

export interface SpeciesFilterCriteria {
  categories?: Set<string>;
  threats?: Set<string>;
  countries?: Set<string>;
  systems?: Set<string>;
  populationTrends?: Set<string>;
  movementPatterns?: Set<string>;
  growthForms?: Set<string>;
  hasMap?: "yes" | "no" | null;
  /** Already lowercased by the caller. */
  search?: string;
}

const empty = (s?: Set<string>) => !s || s.size === 0;

export function matchesSpeciesFilter(s: FilterableSpecies, f: SpeciesFilterCriteria): boolean {
  const matchesCategory = empty(f.categories) || f.categories!.has(s.category);

  const matchesCountry = empty(f.countries) || s.countries.some((c) => f.countries!.has(c));

  const matchesSystem = empty(f.systems) || (s.systems?.some((sys) => f.systems!.has(sys)) ?? false);

  const matchesTrend =
    empty(f.populationTrends) ||
    (s.population_trend != null && f.populationTrends!.has(s.population_trend));

  const matchesMovement =
    empty(f.movementPatterns) ||
    (s.movement_pattern != null && f.movementPatterns!.has(s.movement_pattern));

  const matchesThreat =
    empty(f.threats) ||
    (s.threat_codes?.some((tc) =>
      Array.from(f.threats!).some((sel) => tc === sel || tc.startsWith(sel + "."))
    ) ?? false);

  const matchesMap = !f.hasMap || (f.hasMap === "yes" ? s.has_map : !s.has_map);

  const matchesGrowth =
    empty(f.growthForms) || (s.growth_forms?.some((gf) => f.growthForms!.has(gf)) ?? false);

  const q = f.search;
  const matchesSearch =
    !q ||
    s.scientific_name.toLowerCase().includes(q) ||
    (s.common_name?.toLowerCase().includes(q) ?? false);

  return (
    matchesCategory &&
    matchesCountry &&
    matchesSystem &&
    matchesTrend &&
    matchesMovement &&
    matchesThreat &&
    matchesMap &&
    matchesGrowth &&
    matchesSearch
  );
}
