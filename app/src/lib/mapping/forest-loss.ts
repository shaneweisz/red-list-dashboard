/**
 * Tree cover loss, 2001–2025 — the Global Forest Watch layer.
 *
 * Same dataset GFW's own map draws: Hansen/UMD Global Forest Change, produced
 * by the University of Maryland with Google, USGS and NASA, and published
 * through what is now Global Nature Watch (globalforestwatch.org redirects
 * there since the 2026 rebrand).
 *
 * The question it answers for an assessor is the one a range map can't: the
 * species was assessed in 2014 and its habitat has been cut since. That
 * question is answered here by *filtering* to a range of years rather than by
 * reading a year off a colour ramp — see below.
 */

/**
 * Pinned deliberately, and to the same release the drivers layer uses, so the
 * two are cut from the same tree cover loss.
 */
const VERSION = "v1.13";

export const FOREST_LOSS_FIRST_YEAR = 2001;
export const FOREST_LOSS_LAST_YEAR = 2025;

/**
 * The canopy-density threshold: 30%, which is what Global Forest Watch's own
 * map and statistics use.
 *
 * This layer was previously drawn unthresholded, from Hansen's pre-rendered
 * `loss_year_alpha` tiles, on the argument that a 25%-canopy woodland which has
 * been cleared is still habitat gone. The counter-argument won: 30% is the cut
 * the published science, the platform's own figures and the papers an assessor
 * will cite are all built on, and a dashboard that quietly disagrees with them
 * makes its numbers hard to reconcile with everything else on the desk.
 *
 * It is not a free choice. The cost falls almost entirely on dry systems —
 * measured against the same tiles at a 0% threshold, moving to 30% drops about
 * 12% of the loss area in a cerrado tile and 4% in the Chaco, against under 1%
 * in the Amazon and Borneo. Said in the legend, because that is exactly the
 * country a lot of threatened plants live in.
 */
export const FOREST_LOSS_CANOPY_THRESHOLD = 30;

/**
 * The tiles, from the platform's own dynamic renderer.
 *
 * Hansen's pre-rendered tiles carry no threshold variant — the 30% cut is
 * something the platform applies on top — so reading them at 30% is not
 * possible and this endpoint is what makes the threshold available at all. It
 * also takes the year range, which those tiles could not.
 *
 * `true_color` rather than `encoded`: the rendered tiles composite straight
 * onto the basemap and keep sub-pixel loss density in the alpha channel, where
 * the encoded ones carry the year in the blue channel and would need a custom
 * WebGL layer to decode. The encoded tiles also ignore the year parameters
 * entirely, which is the half of this that matters more.
 */
export function forestLossTileUrl(startYear: number, endYear: number): string {
  const params = new URLSearchParams({
    tree_cover_density_threshold: String(FOREST_LOSS_CANOPY_THRESHOLD),
    render_type: "true_color",
    start_year: String(startYear),
    end_year: String(endYear),
  });
  return `https://tiles.globalforestwatch.org/umd_tree_cover_loss/${VERSION}/dynamic/{z}/{x}/{y}.png?${params}`;
}

/** Past this the tiles stop gaining detail; MapLibre overzooms the last level. */
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
 * One colour for loss, whatever year it happened in.
 *
 * The rendered tiles are a single pink — sampled across single-year renders
 * from 2001 to 2025, every one of them comes back #E44792 — so the year is no
 * longer something the colours can be read for. The year range below is what
 * replaced it, and it answers the question more exactly than a ramp did: an
 * assessor eyeballing where a colour sits between two ends of a gradient was
 * always estimating, where a filter is the actual answer.
 *
 * The colour also happens to be the family the old ramp was hue-rotated into,
 * for the same reason it was chosen then: orange and red are what terrain, bare
 * ground and dry vegetation already look like, and pink is not.
 */
export const FOREST_LOSS_COLOR = "#E44792";

/**
 * What the layer does and doesn't mean.
 *
 * Worth saying out loud on a Red List tool: "loss" is stand-replacement
 * disturbance, which includes logging rotation, fire, storm and disease, so it
 * is not the same thing as habitat loss. The dataset's own caution.
 */
export const FOREST_LOSS_CAVEAT =
  "Stand-replacement disturbance — includes logging rotation, fire and storm damage, not only permanent clearance. The 2001–2010 and 2011–2025 series were produced differently, so trends across that boundary aren't supported.";

export const FOREST_LOSS_THRESHOLD_NOTE =
  `Pixels with at least ${FOREST_LOSS_CANOPY_THRESHOLD}% canopy cover in 2000, which is what Global Forest Watch's own map and published figures use. It shows less loss than an unthresholded view in sparsely wooded country — around 12% less in cerrado and 4% in the Chaco, against under 1% in dense forest.`;
