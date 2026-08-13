/**
 * Ground elevation at a point, read from public terrain tiles in the browser.
 *
 * An assessor georeferencing a herbarium label has one strong constraint the
 * locality text can't give them: the label says "1900 m", and the point they're
 * about to place either sits at that height or doesn't. This answers that
 * without leaving the map.
 *
 * It reads the AWS Terrain Tiles ("terrarium" encoding, SRTM/GMTED/NED
 * mosaicked with GEBCO bathymetry) and decodes the pixel itself. Two
 * alternatives were rejected:
 *
 *   - MapLibre's `map.queryTerrainElevation()` returns null unless 3D terrain
 *     is actually enabled, and enabling it switches the whole style to the
 *     render-to-texture path. Setting `exaggeration: 0` to hide it doesn't
 *     help either — the elevation is multiplied by the exaggeration, so every
 *     query comes back 0.
 *   - The point-query APIs each cost a round trip per point, and Open-Elevation
 *     in particular answers a confident 0.0 outside SRTM's 60°N–56°S coverage,
 *     which is indistinguishable from genuine sea level. A silent wrong number
 *     is worse here than no number.
 *
 * The tiles are served with `Access-Control-Allow-Origin: *`, so the canvas
 * they're drawn to stays untainted and the pixels are readable.
 */

const TILE_SIZE = 256;
/** Terrarium's deepest zoom; z16 is a 404. */
const MAX_ZOOM = 15;

export const ELEVATION_ATTRIBUTION =
  "Elevation: AWS Terrain Tiles (SRTM, GMTED, NED; GEBCO bathymetry)";

function tileUrl(z: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}

/** Terrarium packs metres into RGB, offset so the sea floor stays positive. */
export function decodeElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface TilePosition {
  z: number;
  x: number;
  y: number;
  /** Pixel within the tile, fractional — the sub-pixel part drives the blend. */
  px: number;
  py: number;
}

/** Web-Mercator tile and pixel for a coordinate. */
export function tilePosition(lng: number, lat: number, z: number = MAX_ZOOM): TilePosition {
  const zoom = Math.min(MAX_ZOOM, Math.max(0, Math.round(z)));
  const n = 2 ** zoom;
  const latRad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const xWorld = ((lng + 180) / 360) * n;
  const yWorld = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.max(0, Math.floor(xWorld)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(yWorld)));
  return {
    z: zoom,
    x,
    y,
    px: (xWorld - x) * TILE_SIZE,
    py: (yWorld - y) * TILE_SIZE,
  };
}

/**
 * Bilinear rather than nearest-neighbour: on an Andean slope, where most of
 * this work happens, neighbouring 30 m pixels can differ by tens of metres, and
 * a nearest-pixel answer wobbles as you move the point around.
 */
export function sampleElevation(pixels: Uint8ClampedArray, px: number, py: number): number {
  const clamp = (v: number) => Math.min(TILE_SIZE - 1, Math.max(0, v));
  // The sample sits at the centre of its pixel, hence the half-pixel shift.
  const fx = clamp(px - 0.5);
  const fy = clamp(py - 0.5);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = clamp(x0 + 1);
  const y1 = clamp(y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => {
    const i = (y * TILE_SIZE + x) * 4;
    return decodeElevation(pixels[i], pixels[i + 1], pixels[i + 2]);
  };
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

// One fetch+decode per tile, kept for the session: panning around one locality
// hits the same handful of tiles, and after the first ~half-second each further
// point is answered without touching the network.
const tileCache = new Map<string, Promise<Uint8ClampedArray | null>>();

function loadTile(z: number, x: number, y: number): Promise<Uint8ClampedArray | null> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const pending = new Promise<Uint8ClampedArray | null>((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const image = new Image();
    // Required for getImageData below; the tiles send `ACAO: *`, so this holds.
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE);
        resolve(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = tileUrl(z, x, y);
  });
  tileCache.set(key, pending);
  return pending;
}

/** Metres above sea level at a point, or null if the tile can't be read. */
export async function elevationAt(lng: number, lat: number): Promise<number | null> {
  const { z, x, y, px, py } = tilePosition(lng, lat);
  const pixels = await loadTile(z, x, y);
  if (!pixels) return null;
  return sampleElevation(pixels, px, py);
}

/**
 * How an elevation reads to someone checking it against a specimen label.
 *
 * Terrarium carries bathymetry, so a point in the sea comes back as a large
 * negative number rather than zero — worth saying in words, since "-3820 m" on
 * its own looks like a bug.
 */
export function formatElevation(metres: number): string {
  const rounded = Math.round(metres);
  if (rounded < -10) return `${Math.abs(rounded).toLocaleString()} m below sea level`;
  return `${rounded.toLocaleString()} m`;
}
