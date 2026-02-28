/**
 * Observation signal analysis: detects whether GBIF observation patterns
 * suggest a species' IUCN category may need reassessment.
 *
 * When taxon-level baseline data is provided, per-year species counts are
 * effort-adjusted: each year's count is scaled by the ratio of average
 * taxon-wide effort to that year's effort. This compensates for platform
 * growth (citizen science) and disruptions (e.g. Covid) without hardcoding
 * specific years — like adjusting for inflation.
 *
 * Compares **median** adjusted annual observations in the earlier vs later
 * half of a rolling window. Median is robust to remaining species-level
 * outliers (bioblitz events, data dumps).
 *
 * Trend flags:
 *   - potential_uplisting:  LC/NT/VU with declining observations
 *   - data_available:       DD species with substantial new GBIF records
 *   - potential_recovery:   CR/EN with increasing observations
 *   - monitoring_needed:    CR/EN with declining observations (worsening)
 *
 * Known limitations:
 *   - No spatial deduplication — duplicate records at the same location
 *     may inflate counts. GBIF's hasCoordinate and hasGeospatialIssue
 *     filters provide some quality control.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type TrendDirection =
  | "increasing"
  | "declining"
  | "stable"
  | "insufficient_data";

export type TrendFlag =
  | "potential_uplisting"
  | "data_available"
  | "potential_recovery"
  | "monitoring_needed";

export interface YearCount {
  year: number;
  count: number;
}

export interface TrendResult {
  direction: TrendDirection;
  /** Percentage change: negative = decline, positive = increase */
  changePercent: number;
  flag: TrendFlag | null;
  flagLabel: string | null;
  /** Raw (unadjusted) observation counts per year within the window */
  yearCounts: YearCount[];
  /** Effort-adjusted observation counts (or same as yearCounts if no baseline) */
  adjustedYearCounts: YearCount[];
  windowStart: number;
  windowEnd: number;
  /** Median adjusted annual observations in earlier half of window */
  earlierMedian: number;
  /** Median adjusted annual observations in later half of window */
  laterMedian: number;
  /** Whether effort normalization was applied */
  effortNormalized: boolean;
  /** Per-year effort scaling factors (year → factor). Factor > 1 means below-average effort that year. */
  scalingFactors: Record<number, number>;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Minimum years with ≥1 observation to compute a trend. */
const MIN_YEARS_WITH_DATA = 4;

/** Minimum total observations across the window. */
const MIN_TOTAL_OBSERVATIONS = 20;

/** Number of years to analyze. */
const WINDOW_YEARS = 10;

/**
 * Decline threshold: later-half median must be below this fraction of
 * earlier-half median to count as "declining". 0.6 = 40%+ drop.
 */
const DECLINE_THRESHOLD = 0.6;

/**
 * Increase threshold: later-half median must exceed this multiple of
 * earlier-half median to count as "increasing". 1.8 = 80%+ rise.
 */
const INCREASE_THRESHOLD = 1.8;

/** DD species need at least this many recent observations to flag. */
const DD_DATA_THRESHOLD = 50;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Compute the median of a sorted-or-unsorted numeric array. Returns 0 for empty arrays. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute per-year effort scaling factors from taxon-level year counts.
 *
 * factor[year] = meanTaxonObs / taxonObsThatYear
 *
 * A factor > 1 means recording effort was below average that year (e.g.
 * Covid), so species counts get scaled up. A factor < 1 means above-average
 * effort (citizen science growth), so species counts get scaled down.
 */
export function computeScalingFactors(
  taxonYearCounts: YearCount[],
  windowStart: number,
  windowEnd: number,
): Record<number, number> {
  const inWindow = taxonYearCounts.filter(
    (yc) => yc.year >= windowStart && yc.year <= windowEnd,
  );

  if (inWindow.length === 0) return {};

  const meanTaxonObs =
    inWindow.reduce((s, yc) => s + yc.count, 0) / inWindow.length;

  const factors: Record<number, number> = {};
  for (const yc of inWindow) {
    factors[yc.year] = yc.count > 0 ? meanTaxonObs / yc.count : 1;
  }
  return factors;
}

// ── Flag metadata for display ────────────────────────────────────────────

export const TREND_FLAG_META: Record<
  TrendFlag,
  { label: string; color: string; icon: string; description: string }
> = {
  potential_uplisting: {
    label: "Potential Uplisting",
    color: "#ef4444", // red-500
    icon: "↓",
    description:
      "Observations declining significantly. Current low-threat category may need review.",
  },
  data_available: {
    label: "Data Now Available",
    color: "#3b82f6", // blue-500
    icon: "◆",
    description:
      "Substantial GBIF data has accumulated for this Data Deficient species.",
  },
  potential_recovery: {
    label: "Possible Recovery",
    color: "#22c55e", // green-500
    icon: "↑",
    description:
      "Observations increasing significantly. High-threat category may warrant downlisting review.",
  },
  monitoring_needed: {
    label: "Decline Continuing",
    color: "#f59e0b", // amber-500
    icon: "↓",
    description:
      "Already-threatened species shows further observation decline.",
  },
};

// ── Core analysis ────────────────────────────────────────────────────────

/**
 * Analyze observation trend from year-faceted GBIF data.
 *
 * When `taxonYearCounts` is provided, species counts are effort-adjusted
 * by scaling each year relative to the taxon-wide average effort.
 * Then compares **median** adjusted annual observations in the earlier
 * vs later half of the window.
 *
 * Returns direction + magnitude but NOT the flag (which depends on the
 * species' IUCN category — see computeTrendFlag).
 */
export function analyzeTrend(
  yearCounts: YearCount[],
  currentYear: number,
  taxonYearCounts?: YearCount[],
): Omit<TrendResult, "flag" | "flagLabel"> {
  const windowStart = currentYear - WINDOW_YEARS + 1;
  const windowEnd = currentYear;

  // Filter to window and sort (keep all years for display)
  const inWindow = yearCounts
    .filter((yc) => yc.year >= windowStart && yc.year <= windowEnd)
    .sort((a, b) => a.year - b.year);

  // Compute effort scaling factors if taxon baseline is available
  const effortNormalized = !!taxonYearCounts && taxonYearCounts.length > 0;
  const scalingFactors = effortNormalized
    ? computeScalingFactors(taxonYearCounts!, windowStart, windowEnd)
    : {};

  // Apply effort adjustment to get adjusted year counts
  const adjustedInWindow: YearCount[] = inWindow.map((yc) => ({
    year: yc.year,
    count: effortNormalized
      ? Math.round(yc.count * (scalingFactors[yc.year] ?? 1))
      : yc.count,
  }));

  const yearsWithData = adjustedInWindow.filter((yc) => yc.count > 0).length;
  const totalObs = adjustedInWindow.reduce((sum, yc) => sum + yc.count, 0);

  const insufficientResult: Omit<TrendResult, "flag" | "flagLabel"> = {
    direction: "insufficient_data",
    changePercent: 0,
    yearCounts: inWindow,
    adjustedYearCounts: adjustedInWindow,
    windowStart,
    windowEnd,
    earlierMedian: 0,
    laterMedian: 0,
    effortNormalized,
    scalingFactors,
  };

  if (yearsWithData < MIN_YEARS_WITH_DATA || totalObs < MIN_TOTAL_OBSERVATIONS) {
    return insufficientResult;
  }

  // Split at midpoint: years [start..mid-1] vs [mid..end]
  const midYear = windowStart + Math.floor(WINDOW_YEARS / 2);

  // Build complete count arrays for each half, including 0 for years
  // with no data in the adjusted counts
  const earlierCounts: number[] = [];
  const laterCounts: number[] = [];

  for (let y = windowStart; y <= windowEnd; y++) {
    const yc = adjustedInWindow.find((d) => d.year === y);
    const count = yc?.count ?? 0;
    if (y < midYear) {
      earlierCounts.push(count);
    } else {
      laterCounts.push(count);
    }
  }

  const earlierMed = median(earlierCounts);
  const laterMed = median(laterCounts);

  // Edge case: no earlier observations but later observations exist
  if (earlierMed === 0) {
    return {
      direction: laterMed > 0 ? "increasing" : "stable",
      changePercent: laterMed > 0 ? 100 : 0,
      yearCounts: inWindow,
      adjustedYearCounts: adjustedInWindow,
      windowStart,
      windowEnd,
      earlierMedian: 0,
      laterMedian: Math.round(laterMed),
      effortNormalized,
      scalingFactors,
    };
  }

  const ratio = laterMed / earlierMed;
  const changePercent = Math.round((ratio - 1) * 100);

  let direction: TrendDirection;
  if (ratio < DECLINE_THRESHOLD) {
    direction = "declining";
  } else if (ratio > INCREASE_THRESHOLD) {
    direction = "increasing";
  } else {
    direction = "stable";
  }

  return {
    direction,
    changePercent,
    yearCounts: inWindow,
    adjustedYearCounts: adjustedInWindow,
    windowStart,
    windowEnd,
    earlierMedian: Math.round(earlierMed),
    laterMedian: Math.round(laterMed),
    effortNormalized,
    scalingFactors,
  };
}

// ── Flag assignment ──────────────────────────────────────────────────────

/**
 * Combine observation trend with IUCN category to produce a
 * conservation-relevant flag (or null if nothing noteworthy).
 */
export function computeTrendFlag(
  direction: TrendDirection,
  category: string,
  totalRecentObs: number,
): { flag: TrendFlag | null; flagLabel: string | null } {
  if (direction === "insufficient_data") {
    return { flag: null, flagLabel: null };
  }

  // DD species with enough new data should be flagged regardless of trend
  if (category === "DD" && totalRecentObs >= DD_DATA_THRESHOLD) {
    return { flag: "data_available", flagLabel: "Data Now Available" };
  }

  if (direction === "declining") {
    if (["LC", "NT", "VU", "LR/lc", "LR/nt", "LR/cd"].includes(category)) {
      return { flag: "potential_uplisting", flagLabel: "Potential Uplisting" };
    }
    if (["CR", "EN"].includes(category)) {
      return { flag: "monitoring_needed", flagLabel: "Decline Continuing" };
    }
  }

  if (direction === "increasing") {
    if (["CR", "EN"].includes(category)) {
      return { flag: "potential_recovery", flagLabel: "Possible Recovery" };
    }
  }

  return { flag: null, flagLabel: null };
}
