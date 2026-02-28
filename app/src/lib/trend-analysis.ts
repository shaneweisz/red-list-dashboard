/**
 * Observation trend analysis: detects whether GBIF observation patterns
 * suggest a species' IUCN category may need reassessment.
 *
 * Compares mean annual observations in the earlier vs later half of a
 * 10-year window. Conservative thresholds avoid false alarms — we'd
 * rather miss borderline trends than flag species incorrectly.
 *
 * Trend flags:
 *   - potential_uplisting:  LC/NT/VU with declining observations
 *   - data_available:       DD species with substantial new GBIF records
 *   - potential_recovery:   CR/EN with increasing observations
 *   - monitoring_needed:    CR/EN with declining observations (worsening)
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
  yearCounts: YearCount[];
  windowStart: number;
  windowEnd: number;
  earlierAvg: number;
  laterAvg: number;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Minimum years with ≥1 observation to compute a trend. */
const MIN_YEARS_WITH_DATA = 4;

/** Minimum total observations across the window. */
const MIN_TOTAL_OBSERVATIONS = 20;

/** Number of years to analyze. */
const WINDOW_YEARS = 10;

/**
 * Decline threshold: later-half avg must be below this fraction of
 * earlier-half avg to count as "declining". 0.6 = 40%+ drop.
 */
const DECLINE_THRESHOLD = 0.6;

/**
 * Increase threshold: later-half avg must exceed this multiple of
 * earlier-half avg to count as "increasing". 1.8 = 80%+ rise.
 */
const INCREASE_THRESHOLD = 1.8;

/** DD species need at least this many recent observations to flag. */
const DD_DATA_THRESHOLD = 50;

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
 * Splits a 10-year window into two halves and compares mean annual
 * observations. Returns direction + magnitude but NOT the flag (which
 * depends on the species' IUCN category — see computeTrendFlag).
 */
export function analyzeTrend(
  yearCounts: YearCount[],
  currentYear: number,
): Omit<TrendResult, "flag" | "flagLabel"> {
  const windowStart = currentYear - WINDOW_YEARS + 1;
  const windowEnd = currentYear;

  // Filter to window and sort
  const inWindow = yearCounts
    .filter((yc) => yc.year >= windowStart && yc.year <= windowEnd)
    .sort((a, b) => a.year - b.year);

  const yearsWithData = inWindow.filter((yc) => yc.count > 0).length;
  const totalObs = inWindow.reduce((sum, yc) => sum + yc.count, 0);

  if (yearsWithData < MIN_YEARS_WITH_DATA || totalObs < MIN_TOTAL_OBSERVATIONS) {
    return {
      direction: "insufficient_data",
      changePercent: 0,
      yearCounts: inWindow,
      windowStart,
      windowEnd,
      earlierAvg: 0,
      laterAvg: 0,
    };
  }

  // Split at midpoint: years [start..mid-1] vs [mid..end]
  const midYear = windowStart + Math.floor(WINDOW_YEARS / 2);
  const earlierHalfYears = midYear - windowStart;
  const laterHalfYears = windowEnd - midYear + 1;

  const earlierSum = inWindow
    .filter((yc) => yc.year < midYear)
    .reduce((s, yc) => s + yc.count, 0);
  const laterSum = inWindow
    .filter((yc) => yc.year >= midYear)
    .reduce((s, yc) => s + yc.count, 0);

  const earlierAvg = earlierSum / earlierHalfYears;
  const laterAvg = laterSum / laterHalfYears;

  // Edge case: no earlier observations but later observations exist
  if (earlierAvg === 0) {
    return {
      direction: laterAvg > 0 ? "increasing" : "stable",
      changePercent: laterAvg > 0 ? 100 : 0,
      yearCounts: inWindow,
      windowStart,
      windowEnd,
      earlierAvg: 0,
      laterAvg: Math.round(laterAvg),
    };
  }

  const ratio = laterAvg / earlierAvg;
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
    windowStart,
    windowEnd,
    earlierAvg: Math.round(earlierAvg),
    laterAvg: Math.round(laterAvg),
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
