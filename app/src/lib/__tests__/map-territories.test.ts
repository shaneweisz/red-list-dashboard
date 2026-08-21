/**
 * splitEmbeddedTerritories — cutting overseas territories out of the parent
 * shape the world map's TopoJSON folds them into (French Guiana out of France,
 * and so on). Getting a box wrong is silent and easy: too tight and the
 * territory stays inside its parent, too loose and it swallows a neighbouring
 * island, and either way the map just quietly attributes land to the wrong
 * country.
 *
 * The fixture is every polygon of the affected shapes (plus Spain, Portugal
 * and the UK as controls — European countries with distant islands that must
 * NOT be split) reduced to its bounding-box ring, taken from
 * https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json — the exact
 * file the map loads. The splitter's only input is how far each ring extends,
 * so bounding-box rings exercise it identically to the full outlines at a
 * fraction of the size. Regenerate by re-running that reduction against a
 * newer world-atlas release if the shapes ever change.
 */
import { describe, it, expect } from "vitest";
import { splitEmbeddedTerritories, EMBEDDED_TERRITORIES } from "../map-territories";
import fixture from "./fixtures/embedded-territory-extents.json";

type Feature = {
  type: string;
  properties: { name: string };
  geometry: { type: string; coordinates: number[][][][] };
};

const WORLD = fixture.features as Feature[];
const byName = (features: Feature[], name: string) =>
  features.filter((f) => f.properties.name === name);
const polygonCount = (features: Feature[], name: string) =>
  byName(features, name).reduce((n, f) => n + f.geometry.coordinates.length, 0);

const split = splitEmbeddedTerritories(WORLD);

describe("splitEmbeddedTerritories", () => {
  it("gives each embedded territory a shape of its own", () => {
    for (const territory of Object.values(EMBEDDED_TERRITORIES).flat()) {
      const own = byName(split, territory.name);
      expect(own, `${territory.name} (${territory.code}) was not split out`).toHaveLength(1);
      expect(own[0].geometry.coordinates.length).toBeGreaterThan(0);
    }
  });

  it("keeps French Guiana's shape over South America, not Europe", () => {
    const [guiana] = byName(split, "French Guiana");
    const lngs = guiana.geometry.coordinates.flat(2).map(([lng]) => lng);
    const lats = guiana.geometry.coordinates.flat(2).map(([, lat]) => lat);
    expect(Math.min(...lngs)).toBeGreaterThan(-56);
    expect(Math.max(...lngs)).toBeLessThan(-51);
    expect(Math.min(...lats)).toBeGreaterThan(0);
    expect(Math.max(...lats)).toBeLessThan(7);
  });

  it("loses no land and duplicates none — every parent polygon lands in exactly one shape", () => {
    for (const [parent, territories] of Object.entries(EMBEDDED_TERRITORIES)) {
      const before = polygonCount(WORLD, parent);
      const after =
        polygonCount(split, parent) +
        territories.reduce((n, t) => n + polygonCount(split, t.name), 0);
      expect(after, `${parent} changed polygon count`).toBe(before);
    }
  });

  it("leaves the parent's own islands alone", () => {
    // Corsica stays French; the Frisian islands stay Dutch; mainland Norway's
    // northern islands (up to 71.1°N) stay Norwegian rather than joining
    // Svalbard; the Chathams and the subantarctic islands stay New Zealand's.
    expect(polygonCount(split, "France")).toBe(polygonCount(WORLD, "France") - 7);
    expect(polygonCount(split, "Netherlands")).toBe(polygonCount(WORLD, "Netherlands") - 3);
    expect(polygonCount(split, "New Zealand")).toBe(polygonCount(WORLD, "New Zealand") - 2);
    // Svalbard proper (8 islands) + Bjørnøya + Jan Mayen, all one ISO code.
    expect(polygonCount(split, "Svalbard")).toBe(10);
    expect(polygonCount(split, "Norway")).toBe(polygonCount(WORLD, "Norway") - 10);
  });

  it("drops a parent that is nothing but territories", () => {
    // "Indian Ocean Ter." is Natural Earth's own label for two separate
    // Australian territories with no shared ISO code — split, nothing is left.
    expect(byName(split, "Indian Ocean Ter.")).toHaveLength(0);
    expect(polygonCount(split, "Christmas Island")).toBe(1);
    expect(polygonCount(split, "Cocos Islands")).toBe(2);
  });

  it("passes every other country straight through, untouched", () => {
    const parents = new Set(Object.keys(EMBEDDED_TERRITORIES));
    for (const feature of WORLD) {
      if (parents.has(feature.properties.name)) continue;
      expect(split, `${feature.properties.name} was rewritten`).toContain(feature);
    }
  });

  it("leaves a shape alone if it stops matching (a future TopoJSON revision)", () => {
    const renamed = [{ ...WORLD[0], properties: { name: "Nowhere" } }] as Feature[];
    expect(splitEmbeddedTerritories(renamed)).toEqual(renamed);

    const moved = [
      { ...byName(WORLD, "France")[0], geometry: { type: "MultiPolygon", coordinates: [] } },
    ] as Feature[];
    expect(splitEmbeddedTerritories(moved)).toEqual(moved);
  });
});
