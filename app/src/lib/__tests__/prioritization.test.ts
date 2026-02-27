import { describe, it, expect } from "vitest";
import { computePriority, PriorityFlag } from "../prioritization";

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
  it("returns no flags for a recently-assessed stable LC species", () => {
    const result = computePriority(makeSpecies(), CURRENT_YEAR);
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("flags stale assessments (>10 years old)", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: "2012-01-01" }),
      CURRENT_YEAR
    );
    expect(result.flags).toContain("stale");
    expect(result.score).toBeGreaterThan(0);
  });

  it("does not flag assessments <=10 years old as stale", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: "2016-06-01" }),
      CURRENT_YEAR
    );
    expect(result.flags).not.toContain("stale");
  });

  it("flags declining population trend", () => {
    const result = computePriority(
      makeSpecies({ population_trend: "Decreasing" }),
      CURRENT_YEAR
    );
    expect(result.flags).toContain("declining");
  });

  it("flags worsening category trajectory", () => {
    const result = computePriority(
      makeSpecies({
        category: "EN",
        previous_assessments: [{ year: "2010", category: "VU" }],
      }),
      CURRENT_YEAR
    );
    expect(result.flags).toContain("worsening");
  });

  it("does not flag improving category trajectory", () => {
    const result = computePriority(
      makeSpecies({
        category: "LC",
        previous_assessments: [{ year: "2010", category: "VU" }],
      }),
      CURRENT_YEAR
    );
    expect(result.flags).not.toContain("worsening");
  });

  it("flags NT species with declining population as at risk", () => {
    const result = computePriority(
      makeSpecies({ category: "NT", population_trend: "Decreasing" }),
      CURRENT_YEAR
    );
    expect(result.flags).toContain("nt_at_risk");
    expect(result.flags).toContain("declining");
  });

  it("flags DD species with significant GBIF data", () => {
    const result = computePriority(
      makeSpecies({ category: "DD", gbif_occurrence_count: 500 }),
      CURRENT_YEAR
    );
    expect(result.flags).toContain("dd_data_available");
  });

  it("does not flag DD species with few GBIF observations", () => {
    const result = computePriority(
      makeSpecies({ category: "DD", gbif_occurrence_count: 5 }),
      CURRENT_YEAR
    );
    expect(result.flags).not.toContain("dd_data_available");
  });

  it("flags species with significant new GBIF data", () => {
    const result = computePriority(
      makeSpecies({ gbif_observations_after_assessment_year: 500 }),
      CURRENT_YEAR
    );
    expect(result.flags).toContain("new_data");
  });

  it("skips extinct species", () => {
    const result = computePriority(
      makeSpecies({ category: "EX", population_trend: "Decreasing" }),
      CURRENT_YEAR
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("skips extinct in the wild species", () => {
    const result = computePriority(
      makeSpecies({ category: "EW" }),
      CURRENT_YEAR
    );
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
  });

  it("accumulates score from multiple flags", () => {
    const result = computePriority(
      makeSpecies({
        category: "NT",
        assessment_date: "2005-01-01",
        population_trend: "Decreasing",
        gbif_observations_after_assessment_year: 1000,
      }),
      CURRENT_YEAR
    );
    expect(result.flags.length).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeGreaterThan(30);
  });

  it("caps score at 100", () => {
    const result = computePriority(
      makeSpecies({
        category: "NT",
        assessment_date: "1990-01-01",
        population_trend: "Decreasing",
        previous_assessments: [{ year: "1985", category: "LC" }],
        gbif_observations_after_assessment_year: 10000,
      }),
      CURRENT_YEAR
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("handles missing assessment date gracefully", () => {
    const result = computePriority(
      makeSpecies({ assessment_date: null }),
      CURRENT_YEAR
    );
    expect(result.flags).not.toContain("stale");
  });

  it("handles legacy Red List categories in previous assessments", () => {
    const result = computePriority(
      makeSpecies({
        category: "VU",
        previous_assessments: [{ year: "1996", category: "LR/lc" }],
      }),
      CURRENT_YEAR
    );
    expect(result.flags).toContain("worsening");
  });
});
