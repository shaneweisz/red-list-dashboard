import { describe, it, expect } from "vitest";
import { isOutdated } from "../data/species-store";

describe("isOutdated", () => {
  const currentYear = 2026;

  it("returns true when assessment_date is null", () => {
    expect(isOutdated(null, currentYear)).toBe(true);
  });

  it("returns true when assessment_date is empty string", () => {
    expect(isOutdated("", currentYear)).toBe(true);
  });

  it("returns true when assessment_date is not parseable", () => {
    expect(isOutdated("unknown", currentYear)).toBe(true);
  });

  it("returns true when assessment is >10 years old", () => {
    expect(isOutdated("2015-06-15", currentYear)).toBe(true);
    expect(isOutdated("2010-01-01", currentYear)).toBe(true);
    expect(isOutdated("2000-12-31", currentYear)).toBe(true);
  });

  it("returns false when assessment is exactly 10 years old", () => {
    // 2026 - 2016 = 10, which is NOT > 10
    expect(isOutdated("2016-03-01", currentYear)).toBe(false);
  });

  it("returns false when assessment is <10 years old", () => {
    expect(isOutdated("2017-01-01", currentYear)).toBe(false);
    expect(isOutdated("2025-12-31", currentYear)).toBe(false);
    expect(isOutdated("2026-01-01", currentYear)).toBe(false);
  });

  it("returns false for recent assessment", () => {
    expect(isOutdated("2024-08-20", currentYear)).toBe(false);
  });

  it("handles year-only strings", () => {
    // slice(0,4) extracts "2015" from "2015"
    expect(isOutdated("2015", currentYear)).toBe(true);
    expect(isOutdated("2020", currentYear)).toBe(false);
  });

  it("matches build-taxa-summary.ts boundary behavior", () => {
    // The build script uses: CURRENT_YEAR - year > OUTDATED_THRESHOLD_YEARS
    // So at boundary (exactly 10 years): 2026 - 2016 = 10, 10 > 10 is false
    // At 11 years: 2026 - 2015 = 11, 11 > 10 is true
    expect(isOutdated("2016-01-01", 2026)).toBe(false);
    expect(isOutdated("2015-12-31", 2026)).toBe(true);
  });
});
