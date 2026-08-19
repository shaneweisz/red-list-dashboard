import { describe, it, expect } from "vitest";
import {
  HABITAT_LEGEND,
  HABITAT_TILE_URL,
  habitatClass,
} from "../habitat-map";

describe("habitatClass", () => {
  // Values are level1 * 100 + level2, so the hundreds are the broad habitat.
  it("names a pixel value with the scheme's own label", () => {
    expect(habitatClass(109)).toMatchObject({
      code: "1.9",
      name: "Forest - Subtropical/Tropical Moist Montane",
      group: "Forest",
    });
    expect(habitatClass(1402)).toMatchObject({
      code: "14.2",
      name: "Artificial/Terrestrial - Pastureland",
      group: "Artificial/Terrestrial",
    });
    // Two-digit sub-types: 510 is 5.10, not 5.1.
    expect(habitatClass(510)?.name).toBe(
      "Wetlands (inland) - Tundra Wetlands (incl. pools and temporary waters from snowmelt)"
    );
  });

  // 5.0 isn't a code in the scheme, but "Wetlands (inland)" is still true of it.
  it("falls back to the broad habitat rather than inventing a sub-type", () => {
    expect(habitatClass(500)).toMatchObject({ code: "5.0", name: "Wetlands (inland)" });
    expect(habitatClass(600)?.name).toBe("Rocky areas (eg. inland cliffs, mountain peaks)");
  });

  it("has nothing to say about nodata", () => {
    expect(habitatClass(0)).toBeNull();
    expect(habitatClass(NaN)).toBeNull();
    // 19xx isn't in the scheme; better to say nothing than to invent a habitat.
    expect(habitatClass(1900)).toBeNull();
  });
});

describe("HABITAT_TILE_URL", () => {
  it("keeps the bbox token MapLibre substitutes per tile", () => {
    expect(HABITAT_TILE_URL).toContain("bbox={bbox-epsg-3857}");
  });

  /**
   * Without a colormap the service renders a grey stretch across 100–1405,
   * which reads as a gradient when the values are classes.
   */
  it("paints every class the raster holds", () => {
    const rule = JSON.parse(
      decodeURIComponent(new URL(HABITAT_TILE_URL.replace("{bbox-epsg-3857}", "0,0,1,1")).searchParams.get("renderingRule")!)
    );
    expect(rule.rasterFunction).toBe("Colormap");
    const colormap: number[][] = rule.rasterFunctionArguments.Colormap;
    expect(colormap.length).toBe(63);
    expect(colormap.every((entry) => entry.length === 4)).toBe(true);
    // Forest is green and cropland is red, whichever sub-type they are.
    expect(colormap.find((e) => e[0] === 109)?.slice(1)).toEqual([22, 101, 52]);
    expect(colormap.find((e) => e[0] === 1402)?.slice(1)).toEqual([220, 38, 38]);
  });
});

describe("HABITAT_LEGEND", () => {
  it("names every level-1 group in the scheme", () => {
    expect(HABITAT_LEGEND).toHaveLength(18);
    expect(HABITAT_LEGEND[0]).toMatchObject({ code: 1, name: "Forest" });
    expect(HABITAT_LEGEND.map((e) => e.name)).toContain("Marine Deep Benthic");
  });
});
