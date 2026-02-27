/**
 * Threat prioritization: flags species likely needing reassessment or new assessment.
 *
 * Each flag represents a signal that the species' conservation status may have changed
 * or that enough data now exists to assess a previously data-deficient species.
 */

export type PriorityFlag =
  | "stale"           // Assessment is old (>10 years)
  | "declining"       // Population trend is decreasing
  | "worsening"       // Category trajectory across assessments is getting worse
  | "nt_at_risk"      // Near Threatened with declining population — uplisting candidate
  | "dd_data_available" // Data Deficient but significant GBIF observations exist
  | "new_data";       // Large volume of new GBIF observations since assessment

export interface PriorityResult {
  flags: PriorityFlag[];
  score: number; // 0–100 composite priority score
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

// Category severity (higher = more threatened). Used to detect worsening trajectories.
const SEVERITY: Record<string, number> = {
  NE: 0, DD: 0, LC: 1, "LR/lc": 1, NT: 2, "LR/nt": 2, "LR/cd": 2.5,
  VU: 3, V: 3, EN: 4, E: 4, CR: 5, EW: 6, EX: 7,
};

function getSeverity(cat: string): number {
  return SEVERITY[cat] ?? 0;
}

/**
 * Compute priority flags and score for a single species.
 */
export function computePriority(species: PrioritizableSpecies, currentYear: number): PriorityResult {
  const flags: PriorityFlag[] = [];
  let score = 0;

  const { category, assessment_date, population_trend, previous_assessments } = species;
  const gbifTotal = species.gbif_occurrence_count ?? 0;
  const newGbif = species.gbif_observations_after_assessment_year ?? 0;

  // Skip extinct species — they don't need reassessment
  if (category === "EX" || category === "EW") {
    return { flags, score: 0 };
  }

  // 1. Stale assessment (>10 years old)
  if (assessment_date) {
    const assessmentYear = new Date(assessment_date).getFullYear();
    const yearsSince = currentYear - assessmentYear;
    if (yearsSince > 10) {
      flags.push("stale");
      // Scale: 15pts at 11yr, up to 25pts at 20+yr
      score += Math.min(25, 15 + (yearsSince - 10));
    }
  }

  // 2. Population declining
  if (population_trend === "Decreasing") {
    flags.push("declining");
    score += 15;
  }

  // 3. Worsening category trajectory across assessments
  if (previous_assessments && previous_assessments.length > 0) {
    const history = [...previous_assessments]
      .sort((a, b) => parseInt(a.year) - parseInt(b.year));
    const prevCategory = history[history.length - 1]?.category;
    if (prevCategory) {
      const prevSev = getSeverity(prevCategory);
      const currSev = getSeverity(category);
      if (currSev > prevSev && currSev >= 2) {
        flags.push("worsening");
        score += 20;
      }
    }
  }

  // 4. Near Threatened with declining population — uplisting candidate
  if (category === "NT" && population_trend === "Decreasing") {
    flags.push("nt_at_risk");
    score += 15;
  }

  // 5. Data Deficient but significant GBIF data exists
  if (category === "DD" && gbifTotal >= 20) {
    flags.push("dd_data_available");
    score += 20;
  }

  // 6. Significant new GBIF observations since assessment
  if (newGbif >= 100) {
    flags.push("new_data");
    // Scale: 10pts at 100 obs, up to 20pts at 1000+
    score += Math.min(20, 10 + Math.floor(Math.log10(newGbif) * 3));
  }

  // Clamp to 0–100
  score = Math.min(100, Math.max(0, score));

  return { flags, score };
}

/** Human-readable labels for each flag */
export const FLAG_LABELS: Record<PriorityFlag, string> = {
  stale: "Stale assessment",
  declining: "Population declining",
  worsening: "Category worsening",
  nt_at_risk: "NT at risk of uplisting",
  dd_data_available: "DD with available data",
  new_data: "Significant new GBIF data",
};

/** Short labels for compact display */
export const FLAG_SHORT_LABELS: Record<PriorityFlag, string> = {
  stale: "Stale",
  declining: "Declining",
  worsening: "Worsening",
  nt_at_risk: "NT at risk",
  dd_data_available: "DD assessable",
  new_data: "New data",
};

/** Colors for priority flag badges */
export const FLAG_COLORS: Record<PriorityFlag, string> = {
  stale: "#f59e0b",        // amber
  declining: "#ef4444",     // red
  worsening: "#dc2626",     // red-600
  nt_at_risk: "#f97316",    // orange
  dd_data_available: "#8b5cf6", // violet
  new_data: "#3b82f6",      // blue
};
