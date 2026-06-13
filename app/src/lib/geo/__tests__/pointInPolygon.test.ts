import { describe, it, expect } from "vitest";
import { pointInGeometry, pointInAnyFeature, type Position } from "../pointInPolygon";

// A unit square from (0,0) to (10,10)
const square = {
  type: "Polygon" as const,
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as Position[],
  ],
};

// Same square with a hole from (4,4) to (6,6)
const squareWithHole = {
  type: "Polygon" as const,
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as Position[],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]] as Position[],
  ],
};

const multi = {
  type: "MultiPolygon" as const,
  coordinates: [
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]] as Position[]],
    [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]] as Position[]],
  ],
};

describe("pointInGeometry", () => {
  it("detects a point inside a simple polygon", () => {
    expect(pointInGeometry([5, 5], square)).toBe(true);
  });

  it("detects a point outside a simple polygon", () => {
    expect(pointInGeometry([15, 5], square)).toBe(false);
    expect(pointInGeometry([-1, -1], square)).toBe(false);
  });

  it("treats points inside a hole as outside", () => {
    expect(pointInGeometry([5, 5], squareWithHole)).toBe(false);
    expect(pointInGeometry([1, 1], squareWithHole)).toBe(true); // in ring, not in hole
  });

  it("handles MultiPolygon — inside either part counts", () => {
    expect(pointInGeometry([1, 1], multi)).toBe(true);
    expect(pointInGeometry([21, 21], multi)).toBe(true);
    expect(pointInGeometry([10, 10], multi)).toBe(false);
  });
});

describe("pointInAnyFeature", () => {
  it("returns true if the point is in any polygonal feature", () => {
    const features = [{ geometry: square }, { geometry: multi }];
    expect(pointInAnyFeature([21, 21], features)).toBe(true);
    expect(pointInAnyFeature([100, 100], features)).toBe(false);
  });

  it("skips non-polygonal features without throwing", () => {
    const features = [
      { geometry: { type: "Point", coordinates: [5, 5] } },
      { geometry: square },
    ];
    expect(pointInAnyFeature([5, 5], features)).toBe(true);
    expect(pointInAnyFeature([50, 50], features)).toBe(false);
  });
});
