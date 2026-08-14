/**
 * Tree cover loss, 2001–2025 — the Global Forest Watch layer.
 *
 * Same dataset GFW's own map draws: Hansen/UMD Global Forest Change, produced
 * by the University of Maryland with Google, USGS and NASA, and published
 * through what is now Global Nature Watch (globalforestwatch.org redirects
 * there since the 2026 rebrand). We read Google's pre-rendered tiles rather
 * than GFW's encoded ones — see below — but it is the same data behind the
 * same numbers, so the layer is named and linked as what it is.
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

/** Where the layer lives on the web, for anyone who wants the full tool. */
export const FOREST_LOSS_URL = "https://globalnaturewatch.org";
/** The dataset's own page, with the methods and the download. */
export const FOREST_LOSS_DATASET_URL = "https://glad.earthengine.app/view/global-forest-change";

/**
 * Attribution as the licence requires it: CC BY 4.0 obliges the source credit
 * "Hansen/UMD/Google/USGS/NASA", and Global Nature Watch asks to be named as
 * the platform it was accessed through.
 */
export const FOREST_LOSS_ATTRIBUTION =
  '<a href="https://globalnaturewatch.org" target="_blank" rel="noopener noreferrer">Global Forest Watch</a>' +
  ' tree cover loss: <a href="https://glad.earthengine.app/view/global-forest-change" target="_blank" rel="noopener noreferrer">Hansen/UMD/Google/USGS/NASA</a>';

/** Shown wherever the layer is named, so the rebrand isn't a puzzle. */
export const FOREST_LOSS_SOURCE_NOTE =
  "Global Forest Watch — now Global Nature Watch — tree cover loss, from Hansen/UMD Global Forest Change.";

/**
 * The tiles ship a yellow-to-red ramp, which is the wrong family for this map:
 * orange and red are what terrain, bare ground and dry vegetation already look
 * like, so loss competes with the ground it sits on. A hue rotation turns the
 * whole ramp pink-to-violet — colours nothing natural takes — without touching
 * the year encoding underneath, since it moves every hue by the same amount.
 */
export const FOREST_LOSS_HUE_ROTATE = 270;

/** The rotated ramp's ends, for the legend: oldest loss pink, newest violet. */
export const FOREST_LOSS_RAMP = ["#ff0080", "#7f00ff"] as const;

/**
 * What the layer does and doesn't mean.
 *
 * Worth saying out loud on a Red List tool: "loss" is stand-replacement
 * disturbance, which includes logging rotation, fire, storm and disease, so it
 * is not the same thing as habitat loss. The dataset's own caution.
 */
export const FOREST_LOSS_CAVEAT =
  "Stand-replacement disturbance — includes logging rotation, fire and storm damage, not only permanent clearance. The 2001–2010 and 2011–2025 series were produced differently, so trends across that boundary aren't supported.";
