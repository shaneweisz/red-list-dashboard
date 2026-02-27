import { describe, it, expect } from "vitest";
import { computePriority, type PriorityFlag } from "../prioritization";

const CURRENT_YEAR = 2026;

function makeSpecies(overrides: Record<string, unknown> = {}) {
  return {
    category: "LC",
    assessment_date: "2020-01-01",
    population_trend: "Stable",
    previous_assessments: [],
    gbif_occurrence_count: 50,
    gbif_observations_after_assessment_year: 10,
    ...overrides,
  };
}

describe("computePriority", () => {
  // ── Basic behaviour ──────────────────────────────────────────────────

  it("returns zero score and no flags for a recently-assessed stable LC species with no new data", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: "2024-01-01", gbif_observations_after_assessment_year: 0 }),
      CURRENT_YEAR,
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("skips extinct species", () => {
    const result = computePriority(
      makeSpecies({ category: "EX", population_trend: "Decreasing" }),
      CURRENT_YEAR,
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("skips extinct in the wild species", () => {
    const result = computePriority(makeSpecies({ category: "EW" }), CURRENT_YEAR);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("caps score at 100", () => {
    const result = computePriority(
      makeSpecies({
        category: "CR",
        assessment_date: "1990-01-01",
        population_trend: "Decreasing",
        previous_assessments: [{ year: "1985", category: "LC" }],
        gbif_occurrence_count: 100,
        gbif_observations_after_assessment_year: 90,
      }),
      CURRENT_YEAR,
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns a breakdown with five dimensions", () => {
    const result = computePriority(makeSpecies(), CURRENT_YEAR);
    expect(result.breakdown).toHaveProperty("staleness");
    expect(result.breakdown).toHaveProperty("newData");
    expect(result.breakdown).toHaveProperty("trend");
    expect(result.breakdown).toHaveProperty("worsening");
    expect(result.breakdown).toHaveProperty("category");
  });

  // ── Staleness (dimension 1) ──────────────────────────────────────────

  it("scores 0 staleness for assessments ≤5 years old", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: "2022-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(0);
    expect(result.flags).not.toContain("stale");
  });

  it("scores staleness linearly between 5 and 25 years", () => {
    // 15 years old → (15-5) * 1 = 10 points
    const result = computePriority(
      makeSpecies({ assessment_date: "2011-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(10);
    expect(result.flags).toContain("stale");
  });

  it("caps staleness at 20 for very old assessments", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: "1990-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(20);
  });

  it("handles missing assessment date gracefully", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: null }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(0);
    expect(result.flags).not.toContain("stale");
  });

  // ── New data (dimension 2) ───────────────────────────────────────────

  it("scores new data based on ratio of new to total observations", () => {
    // 50% new → ratio 0.5 → min(20, round(0.5*40)) = 20
    const result = computePriority(
      makeSpecies({
        gbif_occurrence_count: 1000,
        gbif_observations_after_assessment_year: 500,
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.newData).toBe(20);
    expect(result.flags).toContain("new_data");
  });

  it("scores 0 new data when there are no new observations", () => {
    const result = computePriority(
      makeSpecies({ gbif_observations_after_assessment_year: 0 }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.newData).toBe(0);
    expect(result.flags).not.toContain("new_data");
  });

  it("gives proportional new-data score for small ratios", () => {
    // 100 new out of 1000 total → ratio 0.1 → min(20, round(0.1*40)) = 4
    const result = computePriority(
      makeSpecies({
        gbif_occurrence_count: 1000,
        gbif_observations_after_assessment_year: 100,
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.newData).toBe(4);
    expect(result.flags).not.toContain("new_data"); // below threshold of 10
  });

  // ── Population trend (dimension 3) ───────────────────────────────────

  it("scores 20 for declining population trend", () => {
    const result = computePriority(
      makeSpecies({ population_trend: "Decreasing" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.trend).toBe(20);
    expect(result.flags).toContain("declining");
  });

  it("scores 5 for unknown population trend", () => {
    const result = computePriority(
      makeSpecies({ population_trend: "Unknown" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.trend).toBe(5);
  });

  it("scores 0 for stable population trend", () => {
    const result = computePriority(
      makeSpecies({ population_trend: "Stable" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.trend).toBe(0);
  });

  // ── Worsening (dimension 4) ──────────────────────────────────────────

  it("scores worsening based on long-term trajectory (earliest assessment)", () => {
    // LC → NT → EN: earliest is LC, current is EN → delta 3 → 20pts
    const result = computePriority(
      makeSpecies({
        category: "EN",
        previous_assessments: [
          { year: "2000", category: "LC" },
          { year: "2010", category: "NT" },
        ],
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.worsening).toBe(20);
    expect(result.flags).toContain("worsening");
  });

  it("scores 10 for a single-step worsening", () => {
    const result = computePriority(
      makeSpecies({
        category: "EN",
        previous_assessments: [{ year: "2010", category: "VU" }],
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.worsening).toBe(10);
  });

  it("scores 0 for improving category trajectory", () => {
    const result = computePriority(
      makeSpecies({
        category: "LC",
        previous_assessments: [{ year: "2010", category: "VU" }],
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.worsening).toBe(0);
    expect(result.flags).not.toContain("worsening");
  });

  it("scores 0 when no previous assessments exist", () => {
    const result = computePriority(
      makeSpecies({ previous_assessments: [] }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.worsening).toBe(0);
  });

  it("handles legacy Red List categories in previous assessments", () => {
    // LR/lc (severity 2) → VU (severity 4) = delta 2 → 20pts
    const result = computePriority(
      makeSpecies({
        category: "VU",
        previous_assessments: [{ year: "1996", category: "LR/lc" }],
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.worsening).toBe(20);
    expect(result.flags).toContain("worsening");
  });

  // ── Category weight (dimension 5) ────────────────────────────────────

  it("scores CR highest at 20", () => {
    const result = computePriority(makeSpecies({ category: "CR" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(20);
    expect(result.flags).toContain("high_category");
  });

  it("scores EN at 16", () => {
    const result = computePriority(makeSpecies({ category: "EN" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(16);
  });

  it("scores VU at 12", () => {
    const result = computePriority(makeSpecies({ category: "VU" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(12);
  });

  it("scores DD at 14 (high because it needs assessment)", () => {
    const result = computePriority(makeSpecies({ category: "DD" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(14);
    expect(result.flags).toContain("high_category");
  });

  it("scores NT at 8", () => {
    const result = computePriority(makeSpecies({ category: "NT" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(8);
  });

  it("scores LC at 0", () => {
    const result = computePriority(makeSpecies({ category: "LC" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(0);
  });

  // ── Multi-flag accumulation ──────────────────────────────────────────

  it("accumulates score from multiple dimensions", () => {
    const result = computePriority(
      makeSpecies({
        category: "CR",
        assessment_date: "2005-01-01",
        population_trend: "Decreasing",
        previous_assessments: [{ year: "2000", category: "LC" }],
        gbif_occurrence_count: 200,
        gbif_observations_after_assessment_year: 150,
      }),
      CURRENT_YEAR,
    );
    expect(result.flags.length).toBeGreaterThanOrEqual(3);
    // staleness (20yr → 15pts) + newData (75% → 20pts) + trend (20pts) + worsening (20pts) + category (20pts)
    expect(result.score).toBeGreaterThan(50);
  });

  // ── Flag thresholds ──────────────────────────────────────────────────

  it("does not flag stale for assessments between 5-15 years old (below threshold)", () => {
    // 12 years → staleness = 7, below flag threshold of 10
    const result = computePriority(
      makeSpecies({ assessment_date: "2014-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(7);
    expect(result.flags).not.toContain("stale");
  });

  it("flags high_category for CR, EN, VU, DD but not for NT or LC", () => {
    for (const cat of ["CR", "EN", "VU", "DD"]) {
      const result = computePriority(makeSpecies({ category: cat }), CURRENT_YEAR);
      expect(result.flags).toContain("high_category");
    }
    for (const cat of ["NT", "LC"]) {
      const result = computePriority(makeSpecies({ category: cat }), CURRENT_YEAR);
      expect(result.flags).not.toContain("high_category");
    }
  });
});
