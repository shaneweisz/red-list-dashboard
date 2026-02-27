/**
 * Threat prioritization: scores species by reassessment urgency.
 *
 * Five equally-weighted dimensions, each 0–20 points, for a total of 0–100:
 *
 *   1. Staleness       – How old is the current assessment?
 *   2. New data         – How much new GBIF data exists relative to total observations?
 *   3. Population trend – Is the population declining?
 *   4. Worsening threat – Has the species' Red List category worsened over time?
 *   5. Category weight  – How severe is the current threat category?
 *
 * Equal weighting makes the score easy to explain: each dimension contributes
 * up to one-fifth of the total, so a score of 60 means three dimensions are
 * at maximum concern (or several are partially elevated).
 */

export type PriorityFlag =
  | "stale"             // Assessment is old
  | "new_data"          // Large volume of new GBIF observations relative to total
  | "declining"         // Population trend is decreasing
  | "worsening"         // Category trajectory across assessments is getting worse
  | "high_category";    // Species is in a high-severity threat category

export interface PriorityResult {
  flags: PriorityFlag[];
  score: number;          // 0–100 composite priority score
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  staleness: number;      // 0–20
  newData: number;        // 0–20
  trend: number;          // 0–20
  worsening: number;      // 0–20
  category: number;       // 0–20
}

interface PreviousAssessment {
  year: string;
  category: string;
}

interface PrioritizableSpecies {
  category: string;
  assessment_date: string | null;
  population_trend: string | null;
  previous_assessments?: PreviousAssessment[];
  gbif_occurrence_count?: number;
  gbif_observations_after_assessment_year?: number | null;
}

// Category severity (higher = more threatened). Used for worsening detection
// and the category-weight dimension.
const SEVERITY: Record<string, number> = {
  NE: 0, DD: 1, LC: 2, "LR/lc": 2, NT: 3, "LR/nt": 3, "LR/cd": 3.5,
  VU: 4, V: 4, EN: 5, E: 5, CR: 6, EW: 7, EX: 8,
};

function getSeverity(cat: string): number {
  return SEVERITY[cat] ?? 0;
}

// ── Dimension scorers (each returns 0–20) ──────────────────────────────

/** 1. Staleness: linear ramp from 0 at ≤5 years to 20 at ≥25 years. */
function scoreStaleness(assessmentDate: string | null, currentYear: number): number {
  if (!assessmentDate) return 0;
  const assessmentYear = new Date(assessmentDate).getFullYear();
  const years = currentYear - assessmentYear;
  if (years <= 5) return 0;
  // Linear from 0 at 5yr to 20 at 25yr
  return Math.min(20, Math.round((years - 5) * (20 / 20)));
}

/** 2. New data: ratio of post-assessment observations to total, scaled to 20. */
function scoreNewData(
  gbifTotal: number,
  newGbif: number,
): number {
  if (gbifTotal <= 0 || newGbif <= 0) return 0;
  const ratio = newGbif / gbifTotal;
  // ratio of 0.5+ (half the data is new) → full 20 points
  return Math.min(20, Math.round(ratio * 40));
}

/** 3. Population trend: flat score for declining populations. */
function scoreTrend(populationTrend: string | null): number {
  if (populationTrend === "Decreasing") return 20;
  if (populationTrend === "Unknown") return 5;
  return 0;
}

/** 4. Worsening: has the category worsened across assessment history? */
function scoreWorsening(
  currentCategory: string,
  previousAssessments?: PreviousAssessment[],
): number {
  if (!previousAssessments || previousAssessments.length === 0) return 0;

  const history = [...previousAssessments]
    .filter(a => a.year != null)
    .sort((a, b) => parseInt(a.year) - parseInt(b.year));

  if (history.length === 0) return 0;

  const currSev = getSeverity(currentCategory);

  // Compare against the earliest assessment to detect long-term worsening,
  // not just the most recent hop.
  const earliestSev = getSeverity(history[0].category);
  const latestPrevSev = getSeverity(history[history.length - 1].category);

  // Use the worst (largest) worsening signal from either comparison
  const longTermDelta = currSev - earliestSev;
  const recentDelta = currSev - latestPrevSev;
  const delta = Math.max(longTermDelta, recentDelta);

  if (delta <= 0) return 0;

  // 1 step = 10pts, 2+ steps = 20pts
  return delta >= 2 ? 20 : 10;
}

/**
 * 5. Category weight: higher-severity categories score higher because
 *    reassessing a CR species is more urgent than reassessing an LC one.
 *    DD also scores highly — it needs assessment to resolve uncertainty.
 *
 *    CR → 20, EN → 16, VU → 12, DD → 14, NT → 8, LC → 0, NE → 0
 */
function scoreCategory(category: string): number {
  const scores: Record<string, number> = {
    CR: 20, EN: 16, VU: 12, NT: 8,
    DD: 14,
    LC: 0, "LR/lc": 0, NE: 0,
    "LR/nt": 8, "LR/cd": 10,
  };
  return scores[category] ?? 0;
}

// ── Flag thresholds ────────────────────────────────────────────────────

const FLAG_THRESHOLDS: Record<Exclude<PriorityFlag, "high_category">, number> = {
  stale: 10,         // flag when staleness ≥ 10 (roughly 15+ years old)
  new_data: 10,      // flag when new-data score ≥ 10
  declining: 10,     // flag when trend score ≥ 10 (i.e. "Decreasing")
  worsening: 10,     // flag when worsening score ≥ 10
};

const HIGH_CATEGORY_SET = new Set(["CR", "EN", "VU", "DD"]);

// ── Main entry point ───────────────────────────────────────────────────

/**
 * Compute priority score and flags for a single species.
 */
export function computePriority(species: PrioritizableSpecies, currentYear: number): PriorityResult {
  const { category, assessment_date, population_trend, previous_assessments } = species;
  const gbifTotal = species.gbif_occurrence_count ?? 0;
  const newGbif = species.gbif_observations_after_assessment_year ?? 0;

  // Extinct species don't need reassessment
  if (category === "EX" || category === "EW") {
    return { flags: [], score: 0, breakdown: { staleness: 0, newData: 0, trend: 0, worsening: 0, category: 0 } };
  }

  const breakdown: ScoreBreakdown = {
    staleness: scoreStaleness(assessment_date, currentYear),
    newData: scoreNewData(gbifTotal, newGbif),
    trend: scoreTrend(population_trend),
    worsening: scoreWorsening(category, previous_assessments),
    category: scoreCategory(category),
  };

  const score = Math.min(100,
    breakdown.staleness + breakdown.newData + breakdown.trend + breakdown.worsening + breakdown.category
  );

  // Derive flags from score thresholds
  const flags: PriorityFlag[] = [];
  if (breakdown.staleness >= FLAG_THRESHOLDS.stale) flags.push("stale");
  if (breakdown.newData >= FLAG_THRESHOLDS.new_data) flags.push("new_data");
  if (breakdown.trend >= FLAG_THRESHOLDS.declining) flags.push("declining");
  if (breakdown.worsening >= FLAG_THRESHOLDS.worsening) flags.push("worsening");
  if (HIGH_CATEGORY_SET.has(category)) flags.push("high_category");

  return { flags, score, breakdown };
}

/** Human-readable labels for each flag */
export const FLAG_LABELS: Record<PriorityFlag, string> = {
  stale: "Stale assessment (15+ years)",
  new_data: "Significant new GBIF data",
  declining: "Population declining",
  worsening: "Threat category worsening",
  high_category: "High-severity category",
};

/** Short labels for compact display */
export const FLAG_SHORT_LABELS: Record<PriorityFlag, string> = {
  stale: "Stale",
  new_data: "New data",
  declining: "Declining",
  worsening: "Worsening",
  high_category: "High threat",
};

/** Colors for priority flag badges */
export const FLAG_COLORS: Record<PriorityFlag, string> = {
  stale: "#f59e0b",          // amber
  new_data: "#3b82f6",       // blue
  declining: "#ef4444",       // red
  worsening: "#dc2626",       // red-600
  high_category: "#f97316",   // orange
};
