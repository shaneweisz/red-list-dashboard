import { FOREST_LOSS_DRIVERS, type LossDriverClass } from "./forest-loss-drivers";
import { FOREST_LOSS_CANOPY_THRESHOLD } from "./forest-loss";

/**
 * Asking the map what happened at one spot.
 *
 * The drivers layer is a raster, so nothing about it is clickable in the way a
 * polygon is — MapLibre has no features to hand back, only pixels. Reading the
 * colour under the cursor and matching it to the legend would work and would be
 * wrong: the renderer blends at cell edges, so a click near a boundary would
 * confidently report a class that isn't there.
 *
 * The platform serves the underlying rasters as COGs with a point endpoint, so
 * the honest version is to ask it. What comes back is the stored class, not an
 * inference from a picture of it.
 *
 * Three datasets rather than one, because the useful answer is three-part: what
 * the loss was for, when it happened, and how wooded the place was before any
 * of it. On a Red List tool the third is what stops the first two being
 * over-read — a driver on ground that was 12% canopy in 2000 is a different
 * claim from the same driver on closed forest.
 */

const TILES = "https://tiles.globalforestwatch.org/cog/basic/point";

/** Pinned to the versions the layers themselves are pinned to. */
const DRIVERS_VERSION = "v1.13";
const LOSS_VERSION = "v1.13";
/** The only version of the density raster the point endpoint will serve. */
const DENSITY_VERSION = "v1.8";

export interface ForestPoint {
  lat: number;
  lon: number;
  /** The dominant driver for this 1 km cell, where the cell has one. */
  driver?: LossDriverClass;
  /** The year the loss was detected, where this pixel has loss. */
  lossYear?: number;
  /** Canopy cover in 2000, as a percentage. */
  canopyPercent?: number;
  /**
   * True where there is a driver but the canopy is under the threshold the
   * layers are drawn at — the point endpoint takes no threshold, so it answers
   * for pixels the tiles leave blank. Saying so is better than either hiding
   * the answer or letting it contradict the map.
   */
  belowThreshold?: boolean;
}

async function value(
  dataset: string,
  version: string,
  lon: number,
  lat: number,
  signal?: AbortSignal
): Promise<number | undefined> {
  const url = `${TILES}/${lon},${lat}?dataset=${dataset}&version=${version}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { values?: (number | null)[] };
  const v = body.values?.[0];
  return typeof v === "number" ? v : undefined;
}

/**
 * What the rasters say at one coordinate.
 *
 * The three requests go together and a failure in one doesn't sink the others:
 * a click that can only answer "loss in 2014" is still worth answering.
 */
export async function queryForestPoint(
  lon: number,
  lat: number,
  signal?: AbortSignal
): Promise<ForestPoint> {
  const [driverCode, loss, density] = await Promise.all([
    value("wri_google_tree_cover_loss_drivers", DRIVERS_VERSION, lon, lat, signal).catch(
      () => undefined
    ),
    value("umd_tree_cover_loss", LOSS_VERSION, lon, lat, signal).catch(() => undefined),
    value("umd_tree_cover_density_2000", DENSITY_VERSION, lon, lat, signal).catch(() => undefined),
  ]);

  const driver = FOREST_LOSS_DRIVERS.find((d) => d.code === driverCode);
  return {
    lat,
    lon,
    driver,
    // The raster stores years since 2000: 20 is 2020. Zero is "no loss here",
    // not the year 2000 — the series starts in 2001.
    lossYear: loss != null && loss > 0 ? 2000 + loss : undefined,
    canopyPercent: density,
    belowThreshold:
      driver != null && density != null && density < FOREST_LOSS_CANOPY_THRESHOLD ? true : undefined,
  };
}

/** Whether there is anything worth showing for a click. */
export function hasForestAnswer(point: ForestPoint): boolean {
  return point.driver != null || point.lossYear != null || point.canopyPercent != null;
}
