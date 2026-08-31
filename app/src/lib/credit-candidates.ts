/**
 * Shared contract for the Suggested Assessors / Reviewers / Facilitators tab.
 *
 * Vocabulary and result shapes only — no data access. It exists because the
 * client needs the role and rank vocabulary as VALUES (to render the pickers),
 * and species-store.ts, which computes the rankings, reaches for `fs`: importing
 * a value from there would pull the whole file-backed data layer into the browser
 * bundle. Types alone are erased at compile time and would have been fine; the
 * moment one of these became a runtime array, it had to move here.
 */

/** Which credit line a candidate ranking is taken over. */
export const CREDIT_ROLES = ["assessors", "reviewers", "facilitators"] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];

/**
 * Granularities a candidate ranking can be taken at, broadest first.
 *
 * "group" is the target species' own IUCN Table 1a taxon group (Mammals, Corals,
 * Flowering Plants, …) — one CSV. The rest come from the TARGET SPECIES' own
 * lineage, not from whatever taxon the dashboard happens to have selected:
 * "family" means "this species' family". That's what makes the ranking answer the
 * question the tab is actually asked — who already works on things like this
 * animal — and why the scope doesn't depend on the selected node at all.
 */
export const CANDIDATE_RANKS = ["group", "class", "order", "family", "genus"] as const;
export type CandidateRank = (typeof CANDIDATE_RANKS)[number];

/** The target (Not-Evaluated) species a ranking is being built for. */
export interface TargetLineage {
  /** Table 1a taxon group — the CSV scanned, and the broadest rank offered. */
  taxonGroup: string;
  /** Genus is its first word; the Red List CSVs carry no genus column. */
  scientificName?: string | null;
  className?: string | null;
  orderName?: string | null;
  family?: string | null;
}

export interface CandidateTier {
  /** Species this person is credited on within the rank, countries ignored. */
  total: number;
  /** …of which share at least one country with the target species. */
  inRegion: number;
  /** Per-region / per-country species counts, over the `inRegion` species. */
  regionCounts: Record<string, number>;
  countryCounts: Record<string, number>;
  /**
   * Most recent assessment THIS PERSON is credited on within the rank — not the
   * species' own latest assessment date, which is what the original by-country
   * query reported: a 2009 assessor of a species reassessed by someone else in
   * 2023 was shown as having last worked on it in 2023.
   */
  latestDate: string;
}

export interface CreditCandidate {
  name: string;
  /** Only the ranks this person actually has species in. */
  tiers: Partial<Record<CandidateRank, CandidateTier>>;
}

export interface CandidateResult {
  candidates: CreditCandidate[];
  /** Ranks worth offering for this species, broadest first. */
  ranks: CandidateRank[];
  /** Deepest offered rank with enough candidates to open on. */
  defaultRank: CandidateRank;
}
