import { describe, it, expect } from "vitest";
import { analyzeTrend, computeTrendFlag, computeScalingFactors, type YearCount } from "../trend-analysis";

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

  // ── Median robustness ─────────────────────────────────────────────────

  it("uses median so a single high year does not skew the result", () => {
    const counts: YearCount[] = [
      { year: 2017, count: 50 },
      { year: 2018, count: 50 },
      { year: 2019, count: 50 },
      { year: 2020, count: 50 },
      { year: 2021, count: 50 },
      { year: 2022, count: 50 },
      { year: 2023, count: 50 },
      { year: 2024, count: 50 },
      { year: 2025, count: 50 },
      { year: 2026, count: 5000 }, // huge outlier
    ];
    const result = analyzeTrend(counts, CURRENT_YEAR);
    // Median of later half [50,50,50,50,5000] = 50, so stable
    expect(result.direction).toBe("stable");
  });

  it("uses median so a single low year does not skew the result", () => {
    const counts: YearCount[] = [
      { year: 2017, count: 200 },
      { year: 2018, count: 200 },
      { year: 2019, count: 200 },
      { year: 2020, count: 200 },
      { year: 2021, count: 200 },
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

  // ── Without normalization ─────────────────────────────────────────────

  it("marks effortNormalized=false when no taxon baseline provided", () => {
    const result = analyzeTrend(flatCounts(50), CURRENT_YEAR);
    expect(result.effortNormalized).toBe(false);
    expect(result.scalingFactors).toEqual({});
  });

  it("returns adjustedYearCounts identical to yearCounts when not normalized", () => {
    const counts = flatCounts(50);
    const result = analyzeTrend(counts, CURRENT_YEAR);
    expect(result.adjustedYearCounts).toEqual(result.yearCounts);
  });

  // ── With effort normalization ─────────────────────────────────────────

  it("marks effortNormalized=true when taxon baseline provided", () => {
    const species = flatCounts(50);
    const taxon = flatCounts(10000);
    const result = analyzeTrend(species, CURRENT_YEAR, taxon);
    expect(result.effortNormalized).toBe(true);
  });

  it("returns scaling factors for each year in the window", () => {
    const species = flatCounts(50);
    const taxon = flatCounts(10000);
    const result = analyzeTrend(species, CURRENT_YEAR, taxon);
    // With flat taxon counts, all factors should be ~1
    for (let y = 2017; y <= 2026; y++) {
      expect(result.scalingFactors[y]).toBeCloseTo(1, 5);
    }
  });

  it("compensates for Covid-like dip via effort normalization", () => {
    // Species tracks the taxon baseline closely (proportional observer effect)
    // In 2020-2021, both species and taxon observations drop (Covid lockdowns)
    const species: YearCount[] = [
      { year: 2017, count: 100 },
      { year: 2018, count: 100 },
      { year: 2019, count: 100 },
      { year: 2020, count: 30 },   // Covid dip
      { year: 2021, count: 30 },   // Covid dip
      { year: 2022, count: 100 },
      { year: 2023, count: 100 },
      { year: 2024, count: 100 },
      { year: 2025, count: 100 },
      { year: 2026, count: 100 },
    ];
    const taxon: YearCount[] = [
      { year: 2017, count: 1000000 },
      { year: 2018, count: 1000000 },
      { year: 2019, count: 1000000 },
      { year: 2020, count: 300000 },  // Covid dip (same proportion)
      { year: 2021, count: 300000 },  // Covid dip (same proportion)
      { year: 2022, count: 1000000 },
      { year: 2023, count: 1000000 },
      { year: 2024, count: 1000000 },
      { year: 2025, count: 1000000 },
      { year: 2026, count: 1000000 },
    ];

    // Without normalization: earlier median would be dragged down by 2020-2021
    const rawResult = analyzeTrend(species, CURRENT_YEAR);

    // With normalization: Covid years get scaled up, revealing stable pattern
    const normResult = analyzeTrend(species, CURRENT_YEAR, taxon);
    expect(normResult.direction).toBe("stable");
    expect(normResult.effortNormalized).toBe(true);

    // Verify the Covid years were scaled up in adjusted counts
    const adj2020 = normResult.adjustedYearCounts.find((yc) => yc.year === 2020);
    const raw2020 = normResult.yearCounts.find((yc) => yc.year === 2020);
    expect(adj2020!.count).toBeGreaterThan(raw2020!.count);
  });

  it("compensates for citizen science growth via effort normalization", () => {
    // Species count is actually stable, but raw counts look increasing
    // because total citizen science observations are growing exponentially
    const species: YearCount[] = [
      { year: 2017, count: 50 },
      { year: 2018, count: 60 },
      { year: 2019, count: 70 },
      { year: 2020, count: 80 },
      { year: 2021, count: 90 },
      { year: 2022, count: 100 },
      { year: 2023, count: 120 },
      { year: 2024, count: 140 },
      { year: 2025, count: 160 },
      { year: 2026, count: 180 },
    ];
    // Taxon grows at the same rate — species' relative abundance is constant
    const taxon: YearCount[] = [
      { year: 2017, count: 500000 },
      { year: 2018, count: 600000 },
      { year: 2019, count: 700000 },
      { year: 2020, count: 800000 },
      { year: 2021, count: 900000 },
      { year: 2022, count: 1000000 },
      { year: 2023, count: 1200000 },
      { year: 2024, count: 1400000 },
      { year: 2025, count: 1600000 },
      { year: 2026, count: 1800000 },
    ];

    // Without normalization: raw median later >> earlier → might look increasing
    // With normalization: adjusted counts are flat → stable
    const normResult = analyzeTrend(species, CURRENT_YEAR, taxon);
    expect(normResult.direction).toBe("stable");
  });

  it("detects genuine decline even with growing baseline", () => {
    // Species is genuinely declining while overall taxon is growing
    const species: YearCount[] = [
      { year: 2017, count: 200 },
      { year: 2018, count: 200 },
      { year: 2019, count: 200 },
      { year: 2020, count: 180 },
      { year: 2021, count: 160 },
      { year: 2022, count: 30 },
      { year: 2023, count: 25 },
      { year: 2024, count: 20 },
      { year: 2025, count: 15 },
      { year: 2026, count: 10 },
    ];
    const taxon: YearCount[] = flatCounts(1000000);

    const result = analyzeTrend(species, CURRENT_YEAR, taxon);
    expect(result.direction).toBe("declining");
  });

  it("preserves raw yearCounts alongside adjusted when normalized", () => {
    const species = flatCounts(50);
    // Growing taxon → scaling factors < 1 for later years
    const taxon: YearCount[] = [
      { year: 2017, count: 500000 },
      { year: 2018, count: 600000 },
      { year: 2019, count: 700000 },
      { year: 2020, count: 800000 },
      { year: 2021, count: 900000 },
      { year: 2022, count: 1000000 },
      { year: 2023, count: 1200000 },
      { year: 2024, count: 1400000 },
      { year: 2025, count: 1600000 },
      { year: 2026, count: 1800000 },
    ];

    const result = analyzeTrend(species, CURRENT_YEAR, taxon);
    // Raw counts should all be 50
    for (const yc of result.yearCounts) {
      expect(yc.count).toBe(50);
    }
    // Adjusted counts should differ from raw
    const rawSum = result.yearCounts.reduce((s, yc) => s + yc.count, 0);
    const adjSum = result.adjustedYearCounts.reduce((s, yc) => s + yc.count, 0);
    expect(adjSum).not.toBe(rawSum);
  });
});

describe("computeScalingFactors", () => {
  it("returns factor 1 for flat taxon counts", () => {
    const taxon = flatCounts(10000);
    const factors = computeScalingFactors(taxon, 2017, 2026);
    for (let y = 2017; y <= 2026; y++) {
      expect(factors[y]).toBeCloseTo(1, 5);
    }
  });

  it("returns factors > 1 for years with below-average effort", () => {
    const taxon: YearCount[] = [
      { year: 2017, count: 1000000 },
      { year: 2018, count: 1000000 },
      { year: 2019, count: 1000000 },
      { year: 2020, count: 300000 },  // Covid dip
      { year: 2021, count: 300000 },  // Covid dip
      { year: 2022, count: 1000000 },
      { year: 2023, count: 1000000 },
      { year: 2024, count: 1000000 },
      { year: 2025, count: 1000000 },
      { year: 2026, count: 1000000 },
    ];
    const factors = computeScalingFactors(taxon, 2017, 2026);
    // 2020 had 300k vs mean ~860k, so factor should be ~2.87
    expect(factors[2020]).toBeGreaterThan(2);
    expect(factors[2021]).toBeGreaterThan(2);
    // Normal years should be close to 1
    expect(factors[2017]).toBeLessThan(1.2);
  });

  it("returns factors < 1 for years with above-average effort", () => {
    const taxon: YearCount[] = [
      { year: 2017, count: 500000 },
      { year: 2018, count: 600000 },
      { year: 2019, count: 700000 },
      { year: 2020, count: 800000 },
      { year: 2021, count: 900000 },
      { year: 2022, count: 1000000 },
      { year: 2023, count: 1200000 },
      { year: 2024, count: 1400000 },
      { year: 2025, count: 1600000 },
      { year: 2026, count: 1800000 },
    ];
    const factors = computeScalingFactors(taxon, 2017, 2026);
    // Earlier years (below mean) should have factor > 1
    expect(factors[2017]).toBeGreaterThan(1);
    // Later years (above mean) should have factor < 1
    expect(factors[2026]).toBeLessThan(1);
  });

  it("returns empty object for empty input", () => {
    const factors = computeScalingFactors([], 2017, 2026);
    expect(factors).toEqual({});
  });

  it("handles zero-count years with factor 1", () => {
    const taxon: YearCount[] = [
      { year: 2017, count: 1000 },
      { year: 2018, count: 0 },
    ];
    const factors = computeScalingFactors(taxon, 2017, 2018);
    expect(factors[2018]).toBe(1);
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
