/**
 * Tree cover loss, 2001–2025 (Hansen/UMD/Google/USGS/NASA).
 *
 * The question it answers for an assessor is the one a range map can't: the
 * species was assessed in 2014 and its habitat has been cut since. Colour codes
 * the year, so recent loss inside a range reads differently from loss that
 * predates the assessment.
 *
 * These are the pre-rendered alpha tiles rather than GFW's own encoded ones:
 * the alpha channel already carries sub-pixel loss density, so they composite
 * onto a basemap with no shader work. The trade-off is that the year can't be
 * filtered client-side — a MapLibre raster layer has only global paint
 * transforms, and the year lives in a hue no `raster-*` property can isolate.
 * A legend, not a slider.
 */

/**
 * Pinned deliberately. The dataset is reissued annually and the colour ramp is
 * rescaled every time — the same 2013 pixel is a different green in v1.12 and
 * v1.13 — so the legend below is only true of the version it was written for.
 */
const VERSION = "v1.13";

export const FOREST_LOSS_FIRST_YEAR = 2001;
export const FOREST_LOSS_LAST_YEAR = 2025;

export const FOREST_LOSS_TILE_URL =
  `https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_${VERSION}/loss_year_alpha/{z}/{x}/{y}.png`;

/** Past this the tiles 404; MapLibre overzooms the last level it has. */
export const FOREST_LOSS_MAX_ZOOM = 12;

export const FOREST_LOSS_ATTRIBUTION =
  '<a href="https://glad.earthengine.app/view/global-forest-change" target="_blank" rel="noopener noreferrer">Tree cover loss</a>: Hansen/UMD/Google/USGS/NASA';

/** The ramp's ends, for the legend: oldest loss is yellow, newest is red. */
export const FOREST_LOSS_RAMP = ["#ffff00", "#ff0000"] as const;

/**
 * What the layer does and doesn't mean.
 *
 * Worth saying out loud on a Red List tool: "loss" is stand-replacement
 * disturbance, which includes logging rotation, fire, storm and disease, so it
 * is not the same thing as habitat loss. The dataset's own caution.
 */
export const FOREST_LOSS_CAVEAT =
  "Stand-replacement disturbance — includes logging rotation, fire and storm damage, not only permanent clearance. The 2001–2010 and 2011–2025 series were produced differently, so trends across that boundary aren't supported.";
