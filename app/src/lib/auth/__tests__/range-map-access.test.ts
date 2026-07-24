import { describe, it, expect, afterEach } from "vitest";
import { isRangeMapAuthorized } from "../range-map-access";

describe("isRangeMapAuthorized", () => {
  const originalEnv = process.env.RANGE_MAP_ALLOWED_EMAILS;

  afterEach(() => {
    process.env.RANGE_MAP_ALLOWED_EMAILS = originalEnv;
  });

  it("returns false for null/undefined/empty", () => {
    expect(isRangeMapAuthorized(null)).toBe(false);
    expect(isRangeMapAuthorized(undefined)).toBe(false);
    expect(isRangeMapAuthorized("")).toBe(false);
  });

  it("returns false for everyone when the env var is unset (fail closed)", () => {
    delete process.env.RANGE_MAP_ALLOWED_EMAILS;
    expect(isRangeMapAuthorized("anyone@example.com")).toBe(false);
  });

  it("respects a comma-separated RANGE_MAP_ALLOWED_EMAILS list, case-insensitively", () => {
    process.env.RANGE_MAP_ALLOWED_EMAILS = "a@example.com, B@Example.com";
    expect(isRangeMapAuthorized("a@example.com")).toBe(true);
    expect(isRangeMapAuthorized("b@example.com")).toBe(true);
    expect(isRangeMapAuthorized("A@EXAMPLE.COM")).toBe(true);
    expect(isRangeMapAuthorized("c@example.com")).toBe(false);
  });
});
