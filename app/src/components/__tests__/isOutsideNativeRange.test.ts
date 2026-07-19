import { describe, it, expect } from "vitest";
import { isOutsideNativeRange } from "../OccurrenceMapRow";

// ---------------------------------------------------------------------------
// isOutsideNativeRange — flags an occurrence whose reported country isn't in
// the species' native range (its Red List assessment's country list). Used to
// drive the "Native range only" filter (issue #82), e.g. hiding a cultivated
// botanical-garden specimen recorded far from where the species actually grows.
// ---------------------------------------------------------------------------
describe("isOutsideNativeRange", () => {
  const nativeCountries = ["BD", "CN", "IN", "JP"];

  it("returns false for a country inside the native range", () => {
    expect(isOutsideNativeRange("CN", nativeCountries)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isOutsideNativeRange("cn", nativeCountries)).toBe(false);
  });

  it("returns true for a country outside the native range", () => {
    expect(isOutsideNativeRange("GB", nativeCountries)).toBe(true);
  });

  it("returns false when the occurrence has no reported country", () => {
    expect(isOutsideNativeRange(undefined, nativeCountries)).toBe(false);
    expect(isOutsideNativeRange(null, nativeCountries)).toBe(false);
    expect(isOutsideNativeRange("", nativeCountries)).toBe(false);
  });

  it("returns false when the species has no native-range data at all", () => {
    expect(isOutsideNativeRange("GB", undefined)).toBe(false);
    expect(isOutsideNativeRange("GB", [])).toBe(false);
  });
});
