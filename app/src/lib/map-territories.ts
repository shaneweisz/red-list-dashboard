/**
 * Overseas territories that the world map's country shapes fold into another
 * country's geometry.
 *
 * Natural Earth (the source behind world-atlas' `countries-50m`) draws France
 * as one MultiPolygon carrying all five inhabited overseas departments, so
 * French Guiana's landmass on the north coast of South America is literally
 * part of the shape labelled "France". Nothing downstream could tell them
 * apart: clicking French Guiana selected FR, it was coloured with France's
 * species count, its own 4,700-odd assessed species were unreachable, and
 * picking the "Europe" region filter lit it up along with Réunion, Mayotte,
 * Guadeloupe and Martinique — even though the Red List counts each of those
 * as its own country of occurrence in its own IUCN land region (French Guiana
 * is South America, Réunion and Mayotte are Sub-Saharan Africa, Guadeloupe
 * and Martinique are Caribbean Islands).
 *
 * `splitEmbeddedTerritories` cuts each territory out into a map feature of its
 * own before react-simple-maps projects the SVG paths, so colouring, hover,
 * click, search and the region highlight all treat them as the countries they
 * are. Everything keys off `properties.name`, exactly as it already does for
 * the shapes Natural Earth ships separately, so no consumer needs to know
 * this splitting happened.
 */

/** [west, south, east, north] in degrees. */
type BBox = readonly [number, number, number, number];

interface EmbeddedTerritory {
  /** ISO 3166-1 alpha-2 code, for reference — the map itself resolves via `name`. */
  code: string;
  /** Must match a NAME_TO_ALPHA2 key, since that's how the map resolves a shape. */
  name: string;
  /**
   * Boxes enclosing every ring of the territory. A parent polygon is claimed
   * only when it sits entirely inside one of them, so a box that happens to
   * span open ocean can't steal a neighbouring landmass.
   */
  boxes: readonly BBox[];
}

/**
 * Keyed by the parent shape's Natural Earth name. Boxes are drawn generously
 * around the measured extent of each island group but well clear of anything
 * else in the same parent — Norway's, for instance, start at 73.5°N so they
 * clear the mainland's northernmost islands (71.1°N) while still taking in
 * Bjørnøya (74.5°N) along with Svalbard proper.
 */
const EMBEDDED_TERRITORIES: Record<string, readonly EmbeddedTerritory[]> = {
  France: [
    { code: "GF", name: "French Guiana", boxes: [[-56, 1.5, -51, 6.5]] },
    { code: "GP", name: "Guadeloupe", boxes: [[-62.0, 15.7, -61.0, 16.7]] },
    { code: "MQ", name: "Martinique", boxes: [[-61.5, 14.2, -60.7, 15.0]] },
    { code: "RE", name: "Réunion", boxes: [[55.0, -21.6, 56.1, -20.7]] },
    { code: "YT", name: "Mayotte", boxes: [[44.8, -13.2, 45.5, -12.5]] },
  ],
  Netherlands: [
    // Bonaire, plus Saba and Sint Eustatius 800km north-east — one ISO code
    // (BQ, the Caribbean Netherlands) across two clusters of shapes.
    { code: "BQ", name: "Bonaire, Sint Eustatius and Saba", boxes: [[-68.6, 11.9, -68.0, 12.5], [-63.4, 17.3, -62.8, 17.8]] },
  ],
  Norway: [
    { code: "SJ", name: "Svalbard and Jan Mayen", boxes: [[10, 73.5, 36, 81.5], [-10, 70.5, -7, 71.5]] },
  ],
  "New Zealand": [
    { code: "TK", name: "Tokelau", boxes: [[-173, -10, -170.5, -8]] },
  ],
  // Natural Earth has no ISO code for this shape at all: it's two separate
  // Australian external territories 1,000km apart, sharing one "Indian Ocean
  // Ter." label. Splitting it is what gives either of them a code.
  "Indian Ocean Ter.": [
    { code: "CX", name: "Christmas Island", boxes: [[105, -11.0, 106.5, -10.0]] },
    { code: "CC", name: "Cocos (Keeling) Islands", boxes: [[96.5, -12.5, 97.3, -11.9]] },
  ],
};

type Ring = number[][];
type PolygonCoords = Ring[];

interface MapFeature {
  type: string;
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown };
  [key: string]: unknown;
}

function ringInside(ring: Ring, [west, south, east, north]: BBox): boolean {
  return ring.every(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north);
}

/**
 * `parseGeographies` hook for react-simple-maps' <Geographies>: runs on the
 * raw TopoJSON features before their SVG paths are projected, so the pieces we
 * split out are drawn, hit-tested and keyed like any other country.
 */
export function splitEmbeddedTerritories<T>(features: T[]): T[] {
  const out: MapFeature[] = [];

  for (const raw of features as unknown as MapFeature[]) {
    const territories = EMBEDDED_TERRITORIES[String(raw.properties?.name ?? "")];
    if (!territories || raw.geometry?.type !== "MultiPolygon") {
      out.push(raw);
      continue;
    }

    const claimed = new Map<string, PolygonCoords[]>();
    const remainder: PolygonCoords[] = [];

    for (const polygon of raw.geometry.coordinates as PolygonCoords[]) {
      const owner = territories.find((t) => t.boxes.some((b) => ringInside(polygon[0], b)));
      if (!owner) {
        remainder.push(polygon);
        continue;
      }
      const existing = claimed.get(owner.name);
      if (existing) existing.push(polygon);
      else claimed.set(owner.name, [polygon]);
    }

    // Nothing matched (an unexpected shape revision, say) — leave it untouched
    // rather than emitting a country whose overseas parts silently vanished.
    if (claimed.size === 0) {
      out.push(raw);
      continue;
    }

    if (remainder.length > 0) {
      out.push({ ...raw, geometry: { type: "MultiPolygon", coordinates: remainder } });
    }
    for (const [name, coordinates] of claimed) {
      out.push({
        ...raw,
        properties: { ...raw.properties, name },
        geometry: { type: "MultiPolygon", coordinates },
      });
    }
  }

  return out as unknown as T[];
}

/** The territories split out above, for tests and for the search/zoom lists. */
export const EMBEDDED_TERRITORY_NAMES: readonly string[] = Object.values(EMBEDDED_TERRITORIES)
  .flat()
  .map((t) => t.name);

export { EMBEDDED_TERRITORIES };
