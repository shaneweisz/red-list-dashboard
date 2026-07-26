/**
 * Habitat filter predicate — extracted from RedListView.tsx so the
 * specialists/exclude-minor/season logic (and its edge cases) can be unit
 * tested directly instead of only through the component.
 *
 * habitat_codes tuples are "code:season:suitability:importance", written by
 * fetch-redlist-species.ts — see that file's SEASON_CODES/SUITABILITY_CODES/
 * MAJOR_IMPORTANCE_CODES for the single-letter encoding this decodes.
 */

export interface HabitatEntry {
  code: string;
  season: string;
  suitability: string;
  /** "Major" | "Not major" | "Unknown" (importance not recorded in the IUCN DB) */
  importance: string;
}

const HABITAT_SEASON_LABELS: Record<string, string> = {
  R: "Resident", B: "Breeding Season", N: "Non-Breeding Season", P: "Passage", U: "Seasonal Occurrence Unknown", "-": "Unknown",
};
const HABITAT_SUITABILITY_LABELS: Record<string, string> = {
  S: "Suitable", M: "Marginal", U: "Unknown", "-": "Unknown",
};
const HABITAT_IMPORTANCE_LABELS: Record<string, string> = {
  "1": "Major", "0": "Not major", "-": "Unknown",
};

/** The IUCN "Unknown" top-level habitat category — has no subtypes, so a
 *  species recorded only here has no *known* habitat and can't be a
 *  specialist in anything. */
const UNKNOWN_HABITAT_CATEGORY = "18";

export function parseHabitatEntries(habitatCodes: string[] | null | undefined): HabitatEntry[] {
  if (!habitatCodes) return [];
  return habitatCodes.map(tuple => {
    const [code, season, suitability, importance] = tuple.split(":");
    return {
      code: code ?? tuple,
      season: HABITAT_SEASON_LABELS[season] ?? "Unknown",
      suitability: HABITAT_SUITABILITY_LABELS[suitability] ?? "Unknown",
      importance: HABITAT_IMPORTANCE_LABELS[importance] ?? "Unknown",
    };
  });
}

export interface HabitatFilterCriteria {
  selectedHabitat: Set<string>;
  specialistsOnly: boolean;
  excludeMinor: boolean;
  seasons: Set<string>;
}

export function matchesHabitatFilter(
  habitatCodes: string[] | null | undefined,
  criteria: HabitatFilterCriteria
): boolean {
  const { selectedHabitat, specialistsOnly, excludeMinor, seasons } = criteria;
  if (selectedHabitat.size === 0 && !specialistsOnly && !excludeMinor && seasons.size === 0) return true;

  const entries = parseHabitatEntries(habitatCodes);
  const codes = Array.from(new Set(entries.map(e => e.code)));

  if (selectedHabitat.size > 0 && !codes.some(code => Array.from(selectedHabitat).some(sel => code === sel || code.startsWith(sel + ".")))) {
    return false;
  }

  if (specialistsOnly) {
    // "Specialist" is about the coarse (top-level) category, not the exact
    // code — a species recorded in two Forest subtypes (1.1 and 1.5) is
    // still a Forest specialist, not a 2-habitat generalist. Unknown entries
    // are excluded entirely: a species with no known habitat isn't a
    // specialist in anything.
    const coarseKnownCategories = new Set(
      codes.map(code => code.split(".")[0]).filter(top => top !== UNKNOWN_HABITAT_CATEGORY)
    );
    if (coarseKnownCategories.size !== 1) return false;
  }

  // Exclude-minor and season scope to the entries matching the current
  // habitat selection (so they refine "this specific habitat match"),
  // falling back to all entries when no habitat is selected.
  const relevant = selectedHabitat.size > 0
    ? entries.filter(e => Array.from(selectedHabitat).some(sel => e.code === sel || e.code.startsWith(sel + ".")))
    : entries;

  if (excludeMinor && !relevant.some(e => e.importance !== "Not major")) return false;
  if (seasons.size > 0 && !relevant.some(e => seasons.has(e.season))) return false;

  return true;
}
