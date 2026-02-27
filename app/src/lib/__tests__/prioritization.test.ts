import { describe, it, expect } from "vitest";
import { computePriority } from "../prioritization";

const CURRENT_YEAR = 2026;

function makeSpecies(overrides: Record<string, unknown> = {}) {
  return {
    category: "LC",
    assessment_date: "2024-01-01",
    population_trend: "Stable",
    previous_assessments: [],
    gbif_occurrence_count: 50,
    gbif_observations_after_assessment_year: 0,
    ...overrides,
  };
}

describe("computePriority", () => {
  // ── Basic behaviour ──────────────────────────────────────────────────

  it("returns zero score for a recently-assessed stable LC species", () => {
    const result = computePriority(makeSpecies(), CURRENT_YEAR);
    expect(result.score).toBe(0);
  });

  it("skips extinct species", () => {
    const result = computePriority(
      makeSpecies({ category: "EX", assessment_date: "1990-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.score).toBe(0);
  });

  it("skips extinct in the wild species", () => {
    const result = computePriority(makeSpecies({ category: "EW" }), CURRENT_YEAR);
    expect(result.score).toBe(0);
  });

  it("caps score at 100", () => {
    const result = computePriority(
      makeSpecies({
        category: "DD",
        assessment_date: "1990-01-01",
        gbif_occurrence_count: 100,
        gbif_observations_after_assessment_year: 100,
      }),
      CURRENT_YEAR,
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns a breakdown with three dimensions", () => {
    const result = computePriority(makeSpecies(), CURRENT_YEAR);
    expect(result.breakdown).toHaveProperty("staleness");
    expect(result.breakdown).toHaveProperty("newData");
    expect(result.breakdown).toHaveProperty("category");
  });

  // ── Staleness (0–25) ────────────────────────────────────────────────

  it("scores 0 staleness for assessments ≤5 years old", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: "2022-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(0);
  });

  it("scores staleness linearly between 5 and 25 years", () => {
    // 15 years old → (15-5) * 1.25 = 12.5 → 13
    const result = computePriority(
      makeSpecies({ assessment_date: "2011-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(13);
  });

  it("caps staleness at 25 for very old assessments", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: "1990-01-01" }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(25);
  });

  it("handles missing assessment date gracefully", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: null }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.staleness).toBe(0);
  });

  // ── New data (0–25) ─────────────────────────────────────────────────

  it("scores new data based on ratio of new to total observations", () => {
    // 50% new → ratio 0.5 → min(25, round(0.5*50)) = 25
    const result = computePriority(
      makeSpecies({
        gbif_occurrence_count: 1000,
        gbif_observations_after_assessment_year: 500,
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.newData).toBe(25);
  });

  it("scores 0 new data when there are no new observations", () => {
    const result = computePriority(
      makeSpecies({ gbif_observations_after_assessment_year: 0 }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.newData).toBe(0);
  });

  it("gives proportional new-data score for small ratios", () => {
    // 100 new out of 1000 total → ratio 0.1 → min(25, round(0.1*50)) = 5
    const result = computePriority(
      makeSpecies({
        gbif_occurrence_count: 1000,
        gbif_observations_after_assessment_year: 100,
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.newData).toBe(5);
  });

  it("handles zero total GBIF observations", () => {
    const result = computePriority(
      makeSpecies({
        gbif_occurrence_count: 0,
        gbif_observations_after_assessment_year: 0,
      }),
      CURRENT_YEAR,
    );
    expect(result.breakdown.newData).toBe(0);
  });

  // ── Category weight (0–50) ──────────────────────────────────────────

  it("scores DD highest at 50", () => {
    const result = computePriority(makeSpecies({ category: "DD" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(50);
  });

  it("scores CR at 40", () => {
    const result = computePriority(makeSpecies({ category: "CR" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(40);
  });

  it("scores EN at 30", () => {
    const result = computePriority(makeSpecies({ category: "EN" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(30);
  });

  it("scores VU at 20", () => {
    const result = computePriority(makeSpecies({ category: "VU" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(20);
  });

  it("scores NT at 10", () => {
    const result = computePriority(makeSpecies({ category: "NT" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(10);
  });

  it("scores LC at 0", () => {
    const result = computePriority(makeSpecies({ category: "LC" }), CURRENT_YEAR);
    expect(result.breakdown.category).toBe(0);
  });

  // ── Composite scoring ───────────────────────────────────────────────

  it("accumulates score from all dimensions", () => {
    const result = computePriority(
      makeSpecies({
        category: "DD",
        assessment_date: "1990-01-01",
        gbif_occurrence_count: 200,
        gbif_observations_after_assessment_year: 200,
      }),
      CURRENT_YEAR,
    );
    // staleness: 25 + newData: 25 (100% new) + category: 50 = 100
    expect(result.score).toBe(100);
  });

  it("returns correct breakdown for a mid-range species", () => {
    // EN species, 16yr old assessment, 20% new data
    const result = computePriority(
      makeSpecies({
        category: "EN",
        assessment_date: "2010-01-01",
        gbif_occurrence_count: 500,
        gbif_observations_after_assessment_year: 100,
      }),
      CURRENT_YEAR,
    );
    // staleness: (16-5)*1.25 = 13.75 → 14
    expect(result.breakdown.staleness).toBe(14);
    // newData: 0.2*50 = 10
    expect(result.breakdown.newData).toBe(10);
    // category: EN = 30
    expect(result.breakdown.category).toBe(30);
    expect(result.score).toBe(54);
  });
});
