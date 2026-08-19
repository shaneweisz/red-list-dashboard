/**
 * The two context layers on the occurrence map that come from a file rather
 * than a live service.
 *
 * Both are large, static and openly licensed, so they are built once by the
 * scripts named below, uploaded to the maps bucket, and served through
 * /api/overlays/<asset>. Nothing is fetched from the origin at runtime: these
 * files never change, and depending on somebody else's uptime for them buys
 * nothing — a lesson the protected-areas layer taught the hard way.
 *
 * The names here are the contract between the upload script, the route and the
 * map. The route serves only what this list names, so a request can't be
 * pointed at anything else in the bucket.
 */

// v2 adds the One Earth page slugs. The bucket refuses overwrites, so a change
// to the contents is a change to the name — which is the point: the route
// caches these forever, and a silently-swapped file would be served stale.
export const ECOREGIONS_ASSET = "ecoregions-2017-v2.json.gz";
export const SAMPLING_EFFORT_ASSET = "sampling-effort-n_obs-10km.png";

/** Everything /api/overlays will serve. Built by scripts/build-*-layer.ts. */
export const OVERLAY_ASSETS = [ECOREGIONS_ASSET, SAMPLING_EFFORT_ASSET] as const;

export type OverlayAsset = (typeof OVERLAY_ASSETS)[number];

export function isOverlayAsset(name: string): name is OverlayAsset {
  return (OVERLAY_ASSETS as readonly string[]).includes(name);
}

export const overlayUrl = (asset: OverlayAsset) => `/api/overlays/${asset}`;

/**
 * Attribution for both layers.
 *
 * Ecoregions is CC-BY, so the citation is the licence condition rather than a
 * courtesy. The sampling-effort README likewise grants use of "the code,
 * pre-computed raster products, or derived outputs" on condition of citation.
 */
export const ECOREGIONS_ATTRIBUTION =
  'Ecoregions: <a href="https://doi.org/10.1093/biosci/bix014" target="_blank" rel="noopener noreferrer">Dinerstein et al. (2017)</a>, RESOLVE Ecoregions 2017 (CC BY 4.0)';

// The sampling-effort citation lives in its map legend rather than here: an
// image source takes no attribution in the MapLibre style spec, so the only
// place it can be shown is the legend, and one copy is better than two.

/** One ecoregion, as the overlay carries it. */
export interface EcoregionProperties {
  name: string;
  biome: string;
  realm: string;
  /** Nature Needs Half status, e.g. "Nature Could Reach Half Protected". */
  nnh: string;
  color: string;
  /** The dataset's own colour for the biome — what the overlay draws with. */
  biomeColor: string;
  /**
   * One Earth's page for this ecoregion, where one exists.
   *
   * Only the 760 of 847 whose page was confirmed at build time carry this —
   * One Earth names some ecoregions differently and a few ("Rock and Ice")
   * aren't really ecoregions at all. Absent means don't offer a link.
   */
  oneEarth?: string;
}

/** One Earth's write-up of an ecoregion — the Navigator's content, as a page. */
export const oneEarthEcoregionUrl = (slug: string) =>
  `https://www.oneearth.org/ecoregions/${slug}/`;

/**
 * The 14 biomes, in the dataset's own order, with its own colours.
 *
 * Held here rather than derived from the loaded file so the legend can be
 * drawn before the 2 MB of geometry arrives, and so its order is stable rather
 * than being whatever order the features happen to come in.
 */
export const BIOMES: { name: string; color: string }[] = [
  { name: "Tropical & Subtropical Moist Broadleaf Forests", color: "#38A700" },
  { name: "Tropical & Subtropical Dry Broadleaf Forests", color: "#CCCD65" },
  { name: "Tropical & Subtropical Coniferous Forests", color: "#88CE66" },
  { name: "Temperate Broadleaf & Mixed Forests", color: "#00734C" },
  { name: "Temperate Conifer Forests", color: "#458970" },
  { name: "Boreal Forests/Taiga", color: "#00A884" },
  { name: "Tropical & Subtropical Grasslands, Savannas & Shrublands", color: "#FEAA01" },
  { name: "Temperate Grasslands, Savannas & Shrublands", color: "#FEFF73" },
  { name: "Flooded Grasslands & Savannas", color: "#00C5FF" },
  { name: "Montane Grasslands & Shrublands", color: "#D3FFBF" },
  { name: "Tundra", color: "#9ED7C2" },
  { name: "Mediterranean Forests, Woodlands & Scrub", color: "#CA7AF5" },
  { name: "Deserts & Xeric Shrublands", color: "#FEC0C0" },
  { name: "Mangroves", color: "#FE01C4" },
];

/**
 * What a sampling-effort colour means, for the legend.
 *
 * The raster is GBIF records per 10 km cell on a log scale, so the legend is
 * deliberately qualitative: the number under any one pixel matters much less
 * than whether a blank area on the record map is genuinely empty or merely
 * unvisited.
 */
export const SAMPLING_EFFORT_LEGEND = [
  { label: "Barely surveyed", color: "#440154" },
  { label: "", color: "#3B528B" },
  { label: "", color: "#21918C" },
  { label: "", color: "#5EC962" },
  { label: "Heavily surveyed", color: "#FDE725" },
];
