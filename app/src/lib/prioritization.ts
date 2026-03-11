/**
 * Threat prioritization: scores species by reassessment urgency.
 *
 * Three dimensions for a total of 0–100:
 *
 *   1. Staleness  (0–25) – How old is the current assessment?
 *   2. New data   (0–25) – How much new GBIF data exists relative to total observations?
 *   3. Category   (0–50) – How severe is the current threat category?
 *
 * The category weight is intentionally dominant: a CR species with a fresh
 * assessment should still rank above an LC species with a stale one.
 */

export interface PriorityResult {
  score: number;          // 0–100 composite priority score
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  staleness: number;      // 0–25
  newData: number;        // 0–25
  category: number;       // 0–50
}

interface PrioritizableSpecies {
  category: string;
  assessment_date: string | null;
  gbif_occurrence_count?: number | null;
  gbif_observations_after_assessment_year?: number | null;
}

// ── Dimension scorers ──────────────────────────────────────────────────

/** 1. Staleness: linear ramp from 0 at ≤5 years to 25 at ≥25 years. */
function scoreStaleness(assessmentDate: string | null, currentYear: number): number {
  if (!assessmentDate) return 0;
  const assessmentYear = new Date(assessmentDate).getFullYear();
  const years = currentYear - assessmentYear;
  if (years <= 5) return 0;
  // Linear from 0 at 5yr to 25 at 25yr → 1.25 pts per year
  return Math.min(25, Math.round((years - 5) * 1.25));
}

/**
 * 2. New data: dampened ratio of post-assessment observations to total, scaled to 25.
 *
 * Uses `new / (total + K)` instead of `new / total` to prevent species with
 * tiny observation counts from getting inflated scores (e.g., 2/2 = 100%).
 * K=50 means a species needs ~50+ total observations before the ratio
 * approaches its true value; below that, the score is conservatively reduced.
 */
const NEW_DATA_SMOOTHING = 50;

function scoreNewData(gbifTotal: number, newGbif: number): number {
  if (gbifTotal <= 0 || newGbif <= 0) return 0;
  const ratio = newGbif / (gbifTotal + NEW_DATA_SMOOTHING);
  // ratio of 0.5+ → full 25 points
  return Math.min(25, Math.round(ratio * 50));
}

/**
 * 3. Category weight: DD 50, CR 40, EN 30, VU 20, NT 10, LC/NE 0.
 *
 * DD is highest because resolving data-deficiency is the most urgent
 * use of reassessment resources — you can't protect what you can't assess.
 */
function scoreCategory(category: string): number {
  const scores: Record<string, number> = {
    DD: 50, CR: 40, EN: 30, VU: 20, NT: 10,
    LC: 0, "LR/lc": 0, NE: 0,
    "LR/nt": 10, "LR/cd": 15,
  };
  return scores[category] ?? 0;
}

// ── Breakdown labels for tooltip display ───────────────────────────────

export const BREAKDOWN_LABELS: Record<keyof ScoreBreakdown, string> = {
  staleness: "Staleness",
  newData: "New data",
  category: "Category",
};

// ── Main entry point ───────────────────────────────────────────────────

/**
 * Compute priority score and breakdown for a single species.
 */
export function computePriority(species: PrioritizableSpecies, currentYear: number): PriorityResult {
  const { category, assessment_date } = species;
  const gbifTotal = species.gbif_occurrence_count ?? 0;
  const newGbif = species.gbif_observations_after_assessment_year ?? 0;

  // Extinct species don't need reassessment
  if (category === "EX" || category === "EW") {
    return { score: 0, breakdown: { staleness: 0, newData: 0, category: 0 } };
  }

  const breakdown: ScoreBreakdown = {
    staleness: scoreStaleness(assessment_date, currentYear),
    newData: scoreNewData(gbifTotal, newGbif),
    category: scoreCategory(category),
  };

  const score = Math.min(100,
    breakdown.staleness + breakdown.newData + breakdown.category
  );

  return { score, breakdown };
}
