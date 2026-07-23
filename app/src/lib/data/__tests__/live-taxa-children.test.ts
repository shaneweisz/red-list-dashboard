import { describe, it, expect } from "vitest";
import { isEmptyLiveBucket } from "../live-taxa-children";

// The rule deciding whether a live-enumerated bucket (e.g. an "Unclassified
// Order" row) is real enough to show, or should be silently dropped instead
// of rendering an empty "0 described, 0 assessed" row with nothing to click
// into. Previously inline and untested — easy to get backwards (hiding a
// real bucket some assessed species actually belong to, or showing a truly
// empty one) without anyone noticing, since it only ever affects an edge case
// (a value with zero real content on both the assessed and CoL sides).
describe("isEmptyLiveBucket", () => {
  it("is empty when neither side has anything", () => {
    expect(isEmptyLiveBucket(0, 0)).toBe(true);
    expect(isEmptyLiveBucket(0, undefined)).toBe(true);
  });

  it("is NOT empty when there are assessed species, even with zero CoL-described", () => {
    expect(isEmptyLiveBucket(5, 0)).toBe(false);
    expect(isEmptyLiveBucket(5, undefined)).toBe(false);
  });

  it("is NOT empty when CoL has described species, even with zero assessed", () => {
    expect(isEmptyLiveBucket(0, 12)).toBe(false);
  });

  it("is NOT empty when both sides have content", () => {
    expect(isEmptyLiveBucket(5, 12)).toBe(false);
  });
});
