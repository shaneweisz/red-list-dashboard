/**
 * Dependency-free point-in-polygon tests for GeoJSON geometries.
 *
 * Used to flag which GBIF occurrence points fall inside a protected-area
 * polygon (WDPA). Kept self-contained (no turf dependency) since we only need
 * a ray-casting test over Polygon / MultiPolygon geometries with holes.
 *
 * Coordinates are GeoJSON order: [longitude, latitude].
 */

export type Position = [number, number];
type LinearRing = Position[];
type PolygonCoords = LinearRing[]; // [outerRing, ...holes]
type MultiPolygonCoords = PolygonCoords[];

/**
 * Standard ray-casting test for whether a point lies inside a single linear
 * ring. Points exactly on an edge are treated inconsistently (as is typical for
 * ray casting) — acceptable here, where occurrence coordinates landing exactly
 * on a boundary are vanishingly rare and either answer is defensible.
 */
function pointInRing(point: Position, ring: LinearRing): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
function pointInPolygonCoords(point: Position, polygon: PolygonCoords): boolean {
  if (polygon.length === 0 || !pointInRing(point, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (pointInRing(point, polygon[h])) return false; // inside a hole
  }
  return true;
}

/** Test a point against a GeoJSON Polygon or MultiPolygon geometry. */
export function pointInGeometry(
  point: Position,
  geometry: { type: "Polygon"; coordinates: PolygonCoords } | { type: "MultiPolygon"; coordinates: MultiPolygonCoords },
): boolean {
  if (geometry.type === "Polygon") {
    return pointInPolygonCoords(point, geometry.coordinates);
  }
  for (const polygon of geometry.coordinates) {
    if (pointInPolygonCoords(point, polygon)) return true;
  }
  return false;
}

// Permissive geometry shape: accepts any GeoJSON geometry (incl. ones without
// `coordinates`, like GeometryCollection), so callers can pass GeoJSON.Feature[]
// straight through. Only Polygon / MultiPolygon are actually tested.
type GeometryLike = { type: string; coordinates?: unknown } | null;

/**
 * Whether a point falls inside any polygonal feature of a collection.
 * Non-polygonal features (e.g. PA point records with no boundary) are skipped.
 */
export function pointInAnyFeature(
  point: Position,
  features: ReadonlyArray<{ geometry: GeometryLike }>,
): boolean {
  for (const f of features) {
    const g = f.geometry;
    if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) {
      if (pointInGeometry(point, g as Parameters<typeof pointInGeometry>[1])) return true;
    }
  }
  return false;
}
