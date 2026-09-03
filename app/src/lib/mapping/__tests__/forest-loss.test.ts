import { describe, it, expect } from "vitest";
import {
  FOREST_LOSS_ATTRIBUTION,
  FOREST_LOSS_CANOPY_THRESHOLD,
  FOREST_LOSS_CAVEAT,
  FOREST_LOSS_COLOR,
  FOREST_LOSS_FIRST_YEAR,
  FOREST_LOSS_LAST_YEAR,
  FOREST_LOSS_THRESHOLD_NOTE,
  forestLossTileUrl,
} from "../forest-loss";

const url = (a: number, b: number) =>
  new URL(forestLossTileUrl(a, b).replace("{z}/{x}/{y}", "4/5/8"));

describe("the tree cover loss layer", () => {
  it("asks the platform's renderer, which is the only thing that can cut at a threshold", () => {
    // Hansen's own pre-rendered tiles carry no threshold variant at all, so
    // this endpoint is what makes 30% possible.
    expect(forestLossTileUrl(2001, 2025)).toContain("/umd_tree_cover_loss/v1.13/dynamic/");
  });

  it("cuts at the threshold Global Forest Watch's own figures use", () => {
    expect(FOREST_LOSS_CANOPY_THRESHOLD).toBe(30);
    expect(url(2001, 2025).searchParams.get("tree_cover_density_threshold")).toBe("30");
  });

  it("asks for rendered tiles, not encoded ones", () => {
    // The encoded tiles carry the year in the blue channel and would need a
    // custom WebGL layer to decode — and they ignore the year range, which is
    // the half that matters more.
    expect(url(2001, 2025).searchParams.get("render_type")).toBe("true_color");
  });

  it("carries the year range, which is what replaced the colour ramp", () => {
    const u = url(2014, 2025);
    expect(u.searchParams.get("start_year")).toBe("2014");
    expect(u.searchParams.get("end_year")).toBe("2025");
  });

  it("keeps the {z}/{x}/{y} placeholders MapLibre fills in", () => {
    expect(forestLossTileUrl(2001, 2025)).toContain("/{z}/{x}/{y}.png");
  });

  it("gives a different URL per range, so the tiles are refetched", () => {
    expect(forestLossTileUrl(2001, 2025)).not.toBe(forestLossTileUrl(2014, 2025));
  });

  it("draws loss in one colour, since the tiles no longer encode the year", () => {
    expect(FOREST_LOSS_COLOR).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("covers the series the dataset publishes", () => {
    expect(FOREST_LOSS_FIRST_YEAR).toBe(2001);
    expect(FOREST_LOSS_LAST_YEAR).toBe(2025);
  });

  it("says what the threshold costs, and where", () => {
    // The cost falls on dry systems, which is exactly where a lot of
    // threatened plants live — so it is stated rather than left to be found.
    expect(FOREST_LOSS_THRESHOLD_NOTE).toContain("30%");
    expect(FOREST_LOSS_THRESHOLD_NOTE).toMatch(/cerrado/i);
  });

  it("still says loss is disturbance rather than deforestation", () => {
    expect(FOREST_LOSS_CAVEAT).toMatch(/disturbance/i);
  });

  it("credits the licence's required parties", () => {
    expect(FOREST_LOSS_ATTRIBUTION).toContain("Hansen/UMD/Google/USGS/NASA");
  });
});
