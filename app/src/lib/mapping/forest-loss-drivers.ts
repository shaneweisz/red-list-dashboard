/**
 * What the loss was for — tree cover loss by dominant driver, at 1 km.
 *
 * The loss layer beside this one says where the trees went and when. It can't
 * say why, and for an assessment the why is most of the judgement: a cleared
 * block inside a species' range means one thing if it is a soy field and
 * another if it is a logging rotation that will regrow, or a wildfire, or a
 * mine. Sims et al. (2025) classify every loss pixel into one of seven drivers
 * at 1 km, which is the first global product to do it at a resolution worth
 * reading against a range map — the Curtis et al. (2018) classification it
 * replaces was 10 km, coarser than most of the ranges this dashboard draws.
 *
 * Read as the same layer Global Nature Watch draws: their tiles, their colours,
 * their canopy threshold. What it is not is a per-pixel truth — a 1 km cell is
 * given its *dominant* driver, so a village's clearing inside a logging
 * concession reads as logging. The legend says so.
 */

/**
 * Pinned, like the loss layer's version. v1.13 is the release whose tiles are
 * rendered in the seven-class palette below; the older v20241224 cache is
 * still served and still draws the Curtis colours, so the version is part of
 * what makes the legend true.
 */
const VERSION = "v1.13";

/**
 * The canopy-density threshold, which this endpoint requires rather than
 * assumes.
 *
 * 30% is Global Nature Watch's own default, and here — unlike the
 * unthresholded loss layer — there is no choice to make it match: the tile
 * service takes the parameter or refuses the request. Said in the legend, so
 * the two layers can be compared knowing they are cut differently.
 */
export const DRIVERS_CANOPY_THRESHOLD = 30;

export const FOREST_LOSS_DRIVERS_TILE_URL =
  `https://tiles.globalforestwatch.org/wri_google_tree_cover_loss_drivers/${VERSION}/dynamic/{z}/{x}/{y}.png` +
  `?implementation=default&tree_cover_density_threshold=${DRIVERS_CANOPY_THRESHOLD}`;

/**
 * The data is 1 km, so drawing it past this is magnification rather than
 * detail. MapLibre overzooms the last level it has.
 */
export const FOREST_LOSS_DRIVERS_MAX_ZOOM = 12;

export const FOREST_LOSS_DRIVERS_FIRST_YEAR = 2001;
export const FOREST_LOSS_DRIVERS_LAST_YEAR = 2024;

/** The paper, which is where the classes and their limits are defined. */
export const FOREST_LOSS_DRIVERS_PAPER_URL = "https://doi.org/10.1088/1748-9326/add606";
/** The layer on the platform it's served from. */
export const FOREST_LOSS_DRIVERS_URL = "https://globalnaturewatch.org";

export interface LossDriverClass {
  /** The class, worded as the platform words it. */
  label: string;
  /** Its colour in the tiles, sampled from them and matched to the palette. */
  color: string;
  /** What it covers, from the layer's own description. */
  description: string;
}

/**
 * The seven drivers, with the colours the tiles actually draw.
 *
 * Taken from the platform's own legend rather than invented, and checked
 * against the tiles: sampling three at zoom 4–5 returns #E39D29, #E9D700,
 * #4EA34E and #39239C among the commonest, which are these values give or take
 * the blending the renderer applies at the edges of a cell.
 */
export const FOREST_LOSS_DRIVERS: readonly LossDriverClass[] = [
  {
    label: "Permanent agriculture",
    color: "#E39D29",
    description:
      "Long-term, permanent tree cover loss for small- to large-scale agriculture.",
  },
  {
    label: "Hard commodities",
    color: "#E58074",
    description: "Loss due to the establishment or expansion of mining or energy infrastructure.",
  },
  {
    label: "Shifting cultivation",
    color: "#E9D700",
    description:
      "Small- to medium-scale clearing for temporary cultivation that is later abandoned, followed by regrowth of secondary forest or vegetation.",
  },
  {
    label: "Logging",
    color: "#51A44E",
    description:
      "Forest management and logging within managed, natural or semi-natural forests and plantations, often with evidence of regrowth or planting in later years.",
  },
  {
    label: "Wildfire",
    color: "#895128",
    description: "Loss from fire, with no evidence of subsequent land-use conversion.",
  },
  {
    label: "Settlements and infrastructure",
    color: "#A354A0",
    description:
      "Expansion and intensification of roads, settlements, urban areas or built infrastructure, where it isn't associated with another class.",
  },
  {
    label: "Other natural disturbances",
    color: "#3A209A",
    description:
      "Loss from non-fire natural disturbances — landslides, insect outbreaks, river meandering.",
  },
];

/**
 * Attribution as the licence requires it. The dataset is CC BY 4.0 and asks
 * for this credit in these words: "Tree cover loss by dominant driver".
 * WRI/Google DeepMind. Accessed from Global Nature Watch.
 */
export const FOREST_LOSS_DRIVERS_ATTRIBUTION =
  'Tree cover loss by dominant driver: WRI/Google DeepMind, ' +
  '<a href="https://doi.org/10.1088/1748-9326/add606" target="_blank" rel="noopener noreferrer">Sims et al. (2025)</a>' +
  ', via <a href="https://globalnaturewatch.org" target="_blank" rel="noopener noreferrer">Global Nature Watch</a> (CC BY 4.0)';

/**
 * What the layer does and doesn't say, in the legend rather than on hover.
 *
 * The dominance caveat is the one that matters on a Red List tool: an assessor
 * reading a single cell as "this clearing was mining" is reading more than the
 * product claims.
 */
export const FOREST_LOSS_DRIVERS_CAVEAT =
  `One driver per 1 km cell — the dominant one — so a smaller clearing of a different kind inside a cell is not shown separately. Loss is Hansen/UMD tree cover loss ${FOREST_LOSS_DRIVERS_FIRST_YEAR}–${FOREST_LOSS_DRIVERS_LAST_YEAR}, cut at ${DRIVERS_CANOPY_THRESHOLD}% canopy cover in 2000, so it shows less than the tree cover loss layer beside it, which is unthresholded.`;
