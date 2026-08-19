import { describe, it, expect } from "vitest";
import { isAfterAssessment } from "../OccurrenceMapRow";

// ---------------------------------------------------------------------------
// isAfterAssessment — determines if an occurrence is after the assessment date
// ---------------------------------------------------------------------------
describe("isAfterAssessment", () => {
  const assessmentDate = "2023-06-15";
  const assessmentYear = 2023;

  // ---- Full eventDate comparisons ----

  it("returns true when eventDate is after the assessment date", () => {
    expect(isAfterAssessment("2023-07-01", 2023, assessmentDate, assessmentYear)).toBe(true);
  });

  it("returns false when eventDate is before the assessment date", () => {
    expect(isAfterAssessment("2023-01-01", 2023, assessmentDate, assessmentYear)).toBe(false);
  });

  it("returns false when eventDate is the same as the assessment date", () => {
    expect(isAfterAssessment("2023-06-15", 2023, assessmentDate, assessmentYear)).toBe(false);
  });

  it("returns true when eventDate is the day after assessment date", () => {
    expect(isAfterAssessment("2023-06-16", 2023, assessmentDate, assessmentYear)).toBe(true);
  });

  it("returns true when eventDate is in a later year", () => {
    expect(isAfterAssessment("2024-01-01", 2024, assessmentDate, assessmentYear)).toBe(true);
  });

  it("returns false when eventDate is in an earlier year", () => {
    expect(isAfterAssessment("2020-12-31", 2020, assessmentDate, assessmentYear)).toBe(false);
  });

  // ---- Year-only fallback (no eventDate) ----

  it("falls back to year comparison when eventDate is missing", () => {
    expect(isAfterAssessment(null, 2024, assessmentDate, assessmentYear)).toBe(true);
    expect(isAfterAssessment(undefined, 2024, assessmentDate, assessmentYear)).toBe(true);
  });

  it("returns false for same year when only year is available", () => {
    expect(isAfterAssessment(null, 2023, assessmentDate, assessmentYear)).toBe(false);
  });

  it("returns false for earlier year when only year is available", () => {
    expect(isAfterAssessment(null, 2020, assessmentDate, assessmentYear)).toBe(false);
  });

  // ---- No date info at all ----

  it("returns false when neither eventDate nor year is available", () => {
    expect(isAfterAssessment(null, null, assessmentDate, assessmentYear)).toBe(false);
    expect(isAfterAssessment(undefined, undefined, assessmentDate, assessmentYear)).toBe(false);
  });

  // ---- No assessment date ----

  it("returns true when assessmentDate is missing (no threshold)", () => {
    expect(isAfterAssessment("2020-01-01", 2020, null, null)).toBe(true);
    expect(isAfterAssessment(null, 2020, null, null)).toBe(true);
    expect(isAfterAssessment(null, null, null, null)).toBe(true);
  });

  it("returns true when assessmentDate is undefined", () => {
    expect(isAfterAssessment("2020-01-01", 2020, undefined, undefined)).toBe(true);
  });

  // ---- Edge: assessmentYear without assessmentDate ----

  it("returns true when assessmentDate is missing but assessmentYear is present", () => {
    // assessmentDate drives the logic; if it's null, everything is "new"
    expect(isAfterAssessment("2020-01-01", 2020, null, 2023)).toBe(true);
  });

  // ---- Edge: year-only fallback with missing assessmentYear ----

  it("returns false when year is present but assessmentYear is null", () => {
    expect(isAfterAssessment(null, 2024, assessmentDate, null)).toBe(false);
  });

  // ---- ISO date format with time component ----

  it("handles ISO dates with time component", () => {
    expect(isAfterAssessment("2023-06-15T12:00:00Z", 2023, "2023-06-15T00:00:00Z", assessmentYear)).toBe(true);
    expect(isAfterAssessment("2023-06-15T00:00:00Z", 2023, "2023-06-15T00:00:00Z", assessmentYear)).toBe(false);
  });
});
