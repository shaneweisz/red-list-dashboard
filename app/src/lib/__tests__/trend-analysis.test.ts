import { describe, it, expect } from "vitest";
import { analyzeTrend, computeTrendFlag, EXCLUDED_YEARS, type YearCount } from "../trend-analysis";

const CURRENT_YEAR = 2026;

/** Helper: create year counts with a constant value. */
function flatCounts(value: number, startYear = 2017, years = 10): YearCount[] {
  return Array.from({ length: years }, (_, i) => ({
    year: startYear + i,
    count: value,
  }));
}

/** Helper: create declining year counts (earlier=high, later=low). */
function decliningCounts(
  earlierVal: number,
  laterVal: number,
  startYear = 2017,
): YearCount[] {
  // 5 years at earlierVal, 5 years at laterVal
  return [
    ...Array.from({ length: 5 }, (_, i) => ({ year: startYear + i, count: earlierVal })),
    ...Array.from({ length: 5 }, (_, i) => ({ year: startYear + 5 + i, count: laterVal })),
  ];
}

/** Helper: create increasing year counts (earlier=low, later=high). */
function increasingCounts(
  earlierVal: number,
  laterVal: number,
  startYear = 2017,
): YearCount[] {
  return [
    ...Array.from({ length: 5 }, (_, i) => ({ year: startYear + i, count: earlierVal })),
    ...Array.from({ length: 5 }, (_, i) => ({ year: startYear + 5 + i, count: laterVal })),
  ];
}

/** Helper: create counts excluding the given years (to simulate gaps). */
function countsExcluding(value: number, excludeYears: number[], startYear = 2017, years = 10): YearCount[] {
  return Array.from({ length: years }, (_, i) => ({
    year: startYear + i,
    count: value,
  })).filter((yc) => !excludeYears.includes(yc.year));
}

describe("analyzeTrend", () => {
  // ── Insufficient data ─────────────────────────────────────────────────

  it("returns insufficient_data when fewer than 4 years have observations", () => {
    const counts: YearCount[] = [
      { year: 2024, count: 100 },
      { year: 2025, count: 80 },
      { year: 2026, count: 60 },
    ];
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("insufficient_data");
  });

  it("returns insufficient_data when total observations are below threshold", () => {
    // 10 years but only 1 obs/year = 10 total < 20 threshold (after excluding 2020-2021 = 8 years * 1 = 8)
    const counts = flatCounts(1);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("insufficient_data");
  });

  it("returns insufficient_data for empty input", () => {
    const result = analyzeTrend([], CURRENT_YEAR);
    expect(result.direction).toBe("insufficient_data");
  });

  // ── Stable trend ──────────────────────────────────────────────────────

  it("detects stable trend when observations are consistent", () => {
    const counts = flatCounts(50);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("stable");
    expect(Math.abs(result.changePercent)).toBeLessThanOrEqual(5);
  });

  it("detects stable for small changes within thresholds", () => {
    // 20% decline: ratio = 0.8, above 0.6 threshold → stable
    const counts = decliningCounts(100, 80);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("stable");
  });

  it("detects stable for moderate increases within thresholds", () => {
    // 50% increase: ratio = 1.5, below 1.8 threshold → stable
    const counts = increasingCounts(100, 150);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("stable");
  });

  // ── Declining trend ───────────────────────────────────────────────────

  it("detects declining trend when later observations drop significantly", () => {
    // 60% decline: ratio = 0.4, below 0.6 threshold
    const counts = decliningCounts(100, 40);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("declining");
    expect(result.changePercent).toBeLessThan(-30);
  });

  it("detects declining for near-total observation collapse", () => {
    const counts = decliningCounts(200, 5);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("declining");
    expect(result.changePercent).toBeLessThan(-90);
  });

  // ── Increasing trend ──────────────────────────────────────────────────

  it("detects increasing trend when later observations rise significantly", () => {
    // 200% increase: ratio = 3.0, above 1.8 threshold
    const counts = increasingCounts(50, 150);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("increasing");
    expect(result.changePercent).toBeGreaterThan(100);
  });

  it("detects increasing when earlier half has zero observations", () => {
    const counts: YearCount[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ year: 2017 + i, count: 0 })),
      ...Array.from({ length: 5 }, (_, i) => ({ year: 2022 + i, count: 20 })),
    ];
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("increasing");
  });

  // ── Window and filtering ──────────────────────────────────────────────

  it("only considers observations within the 10-year window", () => {
    // Old data outside window shouldn't affect the result
    const counts: YearCount[] = [
      { year: 2000, count: 10000 }, // Way outside window
      ...flatCounts(50),
    ];
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.direction).toBe("stable");
  });

  it("returns windowed year counts sorted by year", () => {
    const counts = flatCounts(30);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    for (let i = 1; i < result.yearCounts.length; i++) {
      expect(result.yearCounts[i].year).toBeGreaterThan(result.yearCounts[i - 1].year);
    }
  });

  it("reports correct window boundaries", () => {
    const result = analyzeTrend(flatCounts(30), CURRENT_YEAR);
    expect(result.windowStart).toBe(2017);
    expect(result.windowEnd).toBe(2026);
  });

  it("reports earlier and later medians", () => {
    const counts = decliningCounts(100, 50);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.earlierMedian).toBe(100);
    expect(result.laterMedian).toBe(50);
  });

  // ── Covid year exclusion ──────────────────────────────────────────────

  it("excludes Covid years (2020-2021) from analysis", () => {
    // Without exclusion: earlier half has a mix of 100 (2017-2019) and 0 (2020-2021)
    // which would drag down the earlier avg. With exclusion, only 2017-2019 counts matter.
    const counts: YearCount[] = [
      { year: 2017, count: 100 },
      { year: 2018, count: 100 },
      { year: 2019, count: 100 },
      { year: 2020, count: 5 },   // Covid dip — should be excluded
      { year: 2021, count: 5 },   // Covid dip — should be excluded
      { year: 2022, count: 100 },
      { year: 2023, count: 100 },
      { year: 2024, count: 100 },
      { year: 2025, count: 100 },
      { year: 2026, count: 100 },
    ];
    const result = analyzeTrend(counts, CURRENT_YEAR);
    // With exclusion: earlier median = 100, later median = 100 → stable
    // Without exclusion: earlier avg = (100*3+5*2)/5 = 62, later avg = 100 → would look increasing
    expect(result.direction).toBe("stable");
    expect(result.excludedYears).toContain(2020);
    expect(result.excludedYears).toContain(2021);
  });

  it("reports which years were excluded", () => {
    const result = analyzeTrend(flatCounts(30), CURRENT_YEAR);
    expect(result.excludedYears).toEqual(
      EXCLUDED_YEARS.filter((y) => y >= 2017 && y <= 2026),
    );
  });

  it("still includes excluded years in yearCounts for display", () => {
    const counts = flatCounts(30);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    // yearCounts should contain all 10 years including excluded ones
    const years = result.yearCounts.map((yc) => yc.year);
    for (const excluded of EXCLUDED_YEARS) {
      if (excluded >= 2017 && excluded <= 2026) {
        expect(years).toContain(excluded);
      }
    }
  });

  // ── Median robustness ─────────────────────────────────────────────────

  it("uses median so a single high year does not skew the result", () => {
    // 3 normal earlier years (2017-2019) + 5 normal later years (2022-2026)
    // One outlier year in the later half shouldn't shift the median much
    const counts: YearCount[] = [
      { year: 2017, count: 50 },
      { year: 2018, count: 50 },
      { year: 2019, count: 50 },
      { year: 2020, count: 50 },  // excluded
      { year: 2021, count: 50 },  // excluded
      { year: 2022, count: 50 },
      { year: 2023, count: 50 },
      { year: 2024, count: 50 },
      { year: 2025, count: 50 },
      { year: 2026, count: 5000 }, // huge outlier
    ];
    const result = analyzeTrend(counts, CURRENT_YEAR);
    // Median of later half [50,50,50,50,5000] = 50, so stable
    // Mean would be 1040, which would falsely show increasing
    expect(result.direction).toBe("stable");
  });

  it("uses median so a single low year does not skew the result", () => {
    const counts: YearCount[] = [
      { year: 2017, count: 200 },
      { year: 2018, count: 200 },
      { year: 2019, count: 200 },
      { year: 2020, count: 200 },  // excluded
      { year: 2021, count: 200 },  // excluded
      { year: 2022, count: 1 },    // one bad year
      { year: 2023, count: 200 },
      { year: 2024, count: 200 },
      { year: 2025, count: 200 },
      { year: 2026, count: 200 },
    ];
    const result = analyzeTrend(counts, CURRENT_YEAR);
    // Median of later half [1,200,200,200,200] = 200, so stable
    expect(result.direction).toBe("stable");
  });
});

describe("computeTrendFlag", () => {
  // ── Potential uplisting ───────────────────────────────────────────────

  it("flags LC + declining as potential_uplisting", () => {
    const { flag } = computeTrendFlag("declining", "LC", 500);
    expect(flag).toBe("potential_uplisting");
  });

  it("flags NT + declining as potential_uplisting", () => {
    const { flag } = computeTrendFlag("declining", "NT", 500);
    expect(flag).toBe("potential_uplisting");
  });

  it("flags VU + declining as potential_uplisting", () => {
    const { flag } = computeTrendFlag("declining", "VU", 500);
    expect(flag).toBe("potential_uplisting");
  });

  // ── Data available ────────────────────────────────────────────────────

  it("flags DD species with sufficient observations as data_available", () => {
    const { flag } = computeTrendFlag("stable", "DD", 100);
    expect(flag).toBe("data_available");
  });

  it("flags DD species even with declining trend if enough data", () => {
    const { flag } = computeTrendFlag("declining", "DD", 60);
    expect(flag).toBe("data_available");
  });

  it("does not flag DD species with insufficient observations", () => {
    const { flag } = computeTrendFlag("stable", "DD", 30);
    expect(flag).toBeNull();
  });

  // ── Potential recovery ────────────────────────────────────────────────

  it("flags CR + increasing as potential_recovery", () => {
    const { flag } = computeTrendFlag("increasing", "CR", 500);
    expect(flag).toBe("potential_recovery");
  });

  it("flags EN + increasing as potential_recovery", () => {
    const { flag } = computeTrendFlag("increasing", "EN", 500);
    expect(flag).toBe("potential_recovery");
  });

  // ── Monitoring needed ─────────────────────────────────────────────────

  it("flags CR + declining as monitoring_needed", () => {
    const { flag } = computeTrendFlag("declining", "CR", 500);
    expect(flag).toBe("monitoring_needed");
  });

  it("flags EN + declining as monitoring_needed", () => {
    const { flag } = computeTrendFlag("declining", "EN", 500);
    expect(flag).toBe("monitoring_needed");
  });

  // ── No flag scenarios ─────────────────────────────────────────────────

  it("returns null for stable LC species", () => {
    const { flag } = computeTrendFlag("stable", "LC", 500);
    expect(flag).toBeNull();
  });

  it("returns null for insufficient data", () => {
    const { flag } = computeTrendFlag("insufficient_data", "CR", 500);
    expect(flag).toBeNull();
  });

  it("returns null for LC + increasing (no downlisting flag)", () => {
    const { flag } = computeTrendFlag("increasing", "LC", 500);
    expect(flag).toBeNull();
  });

  // ── Flag labels ───────────────────────────────────────────────────────

  it("returns a human-readable label with each flag", () => {
    const { flag, flagLabel } = computeTrendFlag("declining", "LC", 500);
    expect(flag).toBe("potential_uplisting");
    expect(flagLabel).toBe("Potential Uplisting");
  });

  it("returns null label when no flag", () => {
    const { flagLabel } = computeTrendFlag("stable", "LC", 500);
    expect(flagLabel).toBeNull();
  });
});
