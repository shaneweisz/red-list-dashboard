import { describe, it, expect } from "vitest";
import {
  DRIVERS_CANOPY_THRESHOLD,
  FOREST_LOSS_DRIVERS,
  FOREST_LOSS_DRIVERS_ATTRIBUTION,
  FOREST_LOSS_DRIVERS_CAVEAT,
  FOREST_LOSS_DRIVERS_TILE_URL,
} from "../forest-loss-drivers";
import { FOREST_LOSS_CANOPY_THRESHOLD } from "../forest-loss";

describe("the dominant-driver layer", () => {
  it("asks for the version whose tiles carry the seven-class palette", () => {
    expect(FOREST_LOSS_DRIVERS_TILE_URL).toContain("/wri_google_tree_cover_loss_drivers/v1.13/");
  });

  it("sends the canopy threshold the tile service requires", () => {
    // Without it the endpoint answers 422, naming the missing field.
    const url = new URL(FOREST_LOSS_DRIVERS_TILE_URL.replace("{z}/{x}/{y}", "4/5/8"));
    expect(url.searchParams.get("tree_cover_density_threshold")).toBe(String(DRIVERS_CANOPY_THRESHOLD));
    expect(url.searchParams.get("implementation")).toBe("default");
  });

  it("keeps the {z}/{x}/{y} placeholders MapLibre fills in", () => {
    expect(FOREST_LOSS_DRIVERS_TILE_URL).toContain("/{z}/{x}/{y}.png");
  });

  it("has the seven drivers, each with a colour and what it covers", () => {
    expect(FOREST_LOSS_DRIVERS).toHaveLength(7);
    for (const driver of FOREST_LOSS_DRIVERS) {
      expect(driver.label).not.toBe("");
      expect(driver.color).toMatch(/^#[0-9A-F]{6}$/);
      expect(driver.description.length).toBeGreaterThan(20);
    }
  });

  it("carries the raster class code the point query answers with", () => {
    // 1-7 in the order the platform lists them, derived by pairing tile
    // colours with the point endpoint rather than read off a values table —
    // the dataset publishes none.
    expect(FOREST_LOSS_DRIVERS.map((d) => d.code)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("gives every driver its own code", () => {
    expect(new Set(FOREST_LOSS_DRIVERS.map((d) => d.code)).size).toBe(FOREST_LOSS_DRIVERS.length);
  });

  it("is cut the same way as the tree cover loss layer beside it", () => {
    // The two used to disagree — this one thresholded, that one not — which
    // made them impossible to read against each other.
    expect(DRIVERS_CANOPY_THRESHOLD).toBe(FOREST_LOSS_CANOPY_THRESHOLD);
    expect(FOREST_LOSS_DRIVERS_CAVEAT).toContain("the same cut");
  });

  it("gives every driver its own colour", () => {
    expect(new Set(FOREST_LOSS_DRIVERS.map((d) => d.color)).size).toBe(FOREST_LOSS_DRIVERS.length);
  });

  it("credits the licence's required parties", () => {
    expect(FOREST_LOSS_DRIVERS_ATTRIBUTION).toContain("WRI/Google DeepMind");
    expect(FOREST_LOSS_DRIVERS_ATTRIBUTION).toContain("Global Nature Watch");
    expect(FOREST_LOSS_DRIVERS_ATTRIBUTION).toContain("CC BY 4.0");
    expect(FOREST_LOSS_DRIVERS_ATTRIBUTION).toContain("10.1088/1748-9326/add606");
  });

  it("says a cell carries only its dominant driver, and how it's cut", () => {
    expect(FOREST_LOSS_DRIVERS_CAVEAT).toMatch(/dominant/i);
    expect(FOREST_LOSS_DRIVERS_CAVEAT).toContain("30% canopy cover");
  });
});
