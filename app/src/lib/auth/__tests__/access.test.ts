import { describe, it, expect, afterEach } from "vitest";
import { isRangeMapAuthorized } from "../access";

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

  it("allows the default owner email when no env override is set", () => {
    delete process.env.RANGE_MAP_ALLOWED_EMAILS;
    expect(isRangeMapAuthorized("shaneweisz@gmail.com")).toBe(true);
    expect(isRangeMapAuthorized("SHANEWEISZ@GMAIL.COM")).toBe(true);
    expect(isRangeMapAuthorized("someone.else@gmail.com")).toBe(false);
  });

  it("respects a comma-separated RANGE_MAP_ALLOWED_EMAILS override", () => {
    process.env.RANGE_MAP_ALLOWED_EMAILS = "a@example.com, b@example.com";
    expect(isRangeMapAuthorized("a@example.com")).toBe(true);
    expect(isRangeMapAuthorized("b@example.com")).toBe(true);
    expect(isRangeMapAuthorized("shaneweisz@gmail.com")).toBe(false);
  });
});
