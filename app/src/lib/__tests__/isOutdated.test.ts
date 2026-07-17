import { describe, it, expect } from "vitest";
import { isOutdated, outdatedCutoffDate } from "../outdated";

describe("isOutdated", () => {
  // Fixed reference point so tests don't depend on wall-clock time.
  const now = new Date("2026-07-16T00:00:00Z");

  it("returns true when assessment_date is null", () => {
    expect(isOutdated(null, now)).toBe(true);
  });

  it("returns true when assessment_date is empty string", () => {
    expect(isOutdated("", now)).toBe(true);
  });

  it("returns true when assessment_date is not parseable", () => {
    expect(isOutdated("unknown", now)).toBe(true);
  });

  it("returns true when assessment is >10 years old", () => {
    expect(isOutdated("2015-06-15", now)).toBe(true);
    expect(isOutdated("2010-01-01", now)).toBe(true);
    expect(isOutdated("2000-12-31", now)).toBe(true);
  });

  it("returns false when assessment is exactly 10 years old", () => {
    expect(isOutdated("2016-07-16", now)).toBe(false);
  });

  it("returns true just after the 10-year mark", () => {
    expect(isOutdated("2016-07-15", now)).toBe(true);
  });

  it("returns false when assessment is <10 years old", () => {
    expect(isOutdated("2017-01-01", now)).toBe(false);
    expect(isOutdated("2025-12-31", now)).toBe(false);
    expect(isOutdated("2026-01-01", now)).toBe(false);
  });

  it("returns false for recent assessment", () => {
    expect(isOutdated("2024-08-20", now)).toBe(false);
  });

  it("handles year-only strings", () => {
    expect(isOutdated("2015", now)).toBe(true);
    expect(isOutdated("2020", now)).toBe(false);
  });

  it("is precise to the day, not just the calendar year", () => {
    // Old calendar-year math treated every 2016 date alike (2026 - 2016 = 10,
    // not outdated). Precise elapsed time correctly flags an early-2016 date
    // as outdated (already >10 years by `now`), while a mid-2016 date right
    // at the actual 10-year mark is not.
    expect(isOutdated("2016-01-01", now)).toBe(true);
    expect(isOutdated("2016-07-16", now)).toBe(false);
  });
});

describe("outdatedCutoffDate", () => {
  it("returns the date 10 * 365.25 days before now", () => {
    const now = new Date("2026-07-16T00:00:00Z");
    const cutoff = outdatedCutoffDate(now);
    // 3652.5 days before 2026-07-16 — half a day short of the calendar
    // "10 years ago" date, since 365.25 is an average, not this window's
    // actual leap-day count.
    expect(cutoff.toISOString()).toBe("2016-07-15T12:00:00.000Z");
  });

  it("agrees with isOutdated at the boundary", () => {
    const now = new Date("2026-07-16T00:00:00Z");
    const cutoff = outdatedCutoffDate(now);
    expect(isOutdated(cutoff.toISOString(), now)).toBe(false);
    const dayBefore = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000);
    expect(isOutdated(dayBefore.toISOString(), now)).toBe(true);
  });
});
