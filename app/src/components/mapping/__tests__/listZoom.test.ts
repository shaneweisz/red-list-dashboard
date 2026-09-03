import { describe, it, expect } from "vitest";
import {
  clampZoom,
  LIST_ZOOM_DEFAULT,
  LIST_ZOOM_MAX,
  LIST_ZOOM_MIN,
} from "../ListZoomControl";

describe("the table's size control", () => {
  it("opens the table at its own size", () => {
    expect(LIST_ZOOM_DEFAULT).toBe(1);
  });

  it("takes any percentage that was typed", () => {
    expect(clampZoom(100)).toBe(1);
    expect(clampZoom(125)).toBe(1.25);
    expect(clampZoom(43)).toBe(0.43);
  });

  it("holds a mistyped number inside the bounds", () => {
    // Far enough out that the control to undo it would be unreadable.
    expect(clampZoom(100000)).toBe(LIST_ZOOM_MAX);
    expect(clampZoom(1)).toBe(LIST_ZOOM_MIN);
  });

  it("rounds to whole percents, which is the unit it's typed in", () => {
    expect(clampZoom(66.6)).toBe(0.67);
  });

  it("spans a range worth having — a projector and a 4K monitor", () => {
    expect(LIST_ZOOM_MIN).toBeLessThan(0.5);
    expect(LIST_ZOOM_MAX).toBeGreaterThan(2);
  });
});
