/**
 * Jung et al. (2020), "A global map of terrestrial habitat types" — the 100 m
 * global raster of IUCN habitat classes that Area of Habitat refinements are
 * built from.
 *
 * This is complementary to the per-species AOH layer this dashboard already
 * has: AOH is one species' modelled habitat inside its range, this is what
 * habitat is present everywhere, which is what you want when asking whether a
 * record's locality is even plausible for the species.
 *
 * Served from UNEP-WCMC's ArcGIS ImageServer — the same host as the protected
 * areas overlay, no key, CORS open. The Zenodo original is a 2.45 GB zipped,
 * strip-organised GeoTIFF (161 GB uncompressed, no overviews, not a COG), so
 * reading it directly in a browser isn't an option and hosting it ourselves
 * would mean building a tile pyramid first.
 */

import { habitatCodeLabel } from "@/lib/habitat-classification";

const IMAGE_SERVER =
  "https://data-gis.unep-wcmc.org/server/rest/services/NatureMap/NatureMap_HabitatTypes/ImageServer";

/**
 * Pixel values are `level1 * 100 + level2`, so 109 is habitat class 1.9. The
 * names come from the same IUCN scheme table the dashboard's habitat filter
 * uses; only the colours are ours, and they're keyed to level 1 because 63
 * distinct sub-type colours would be a legend nobody could read.
 */
const LEVEL_1_COLORS: Record<number, string> = {
  1: "#166534",
  2: "#ca8a04",
  3: "#b45309",
  4: "#a3e635",
  5: "#0ea5e9",
  6: "#78716c",
  7: "#57534e",
  8: "#fbbf24",
  9: "#2563eb",
  10: "#1e3a8a",
  11: "#172554",
  12: "#38bdf8",
  13: "#7dd3fc",
  14: "#dc2626",
  15: "#f87171",
  16: "#c026d3",
  17: "#9ca3af",
  18: "#d4d4d8",
};

/**
 * Every value the raster actually holds, read from the service's own attribute
 * table. Listed rather than generated because the colormap has to name each
 * one: anything absent from it renders transparent, which is exactly what we
 * want for nodata, and would silently hide a real class if this drifted.
 */
const HABITAT_VALUES = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
  201, 202,
  300, 301, 302, 303, 304, 305, 306, 307, 308,
  400, 401, 402, 403, 404, 405, 406, 407,
  500, 501, 502, 503, 505, 506, 507, 508, 510, 511, 513, 514, 515,
  600,
  801, 802, 803,
  900, 908, 909,
  1101, 1102, 1103, 1104, 1105, 1106,
  1200, 1206, 1207,
  1401, 1402, 1403, 1404, 1405,
];

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * The service renders a grey stretch by default, which says nothing — the
 * values are classes, not a gradient. This paints each class by its level-1
 * group: 63 sub-types would need a legend nobody can read, and the exact
 * sub-type is a click away.
 */
const RENDERING_RULE = JSON.stringify({
  rasterFunction: "Colormap",
  rasterFunctionArguments: {
    Colormap: HABITAT_VALUES.map((value) => [
      value,
      ...rgb(LEVEL_1_COLORS[Math.floor(value / 100)] ?? "#9ca3af"),
    ]),
    Raster: "$$",
  },
});

export const HABITAT_TILE_URL =
  `${IMAGE_SERVER}/exportImage` +
  "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image" +
  `&renderingRule=${encodeURIComponent(RENDERING_RULE)}`;

export const HABITAT_ATTRIBUTION =
  '<a href="https://zenodo.org/records/4058819" target="_blank" rel="noopener noreferrer">Habitat types</a>: Jung et al. 2020 (CC BY 4.0)';

/** The published classification the codes belong to. */
export const HABITAT_SCHEME_URL =
  "https://www.iucnredlist.org/resources/habitat-classification-scheme";

/** The level-1 groups, for a legend. */
export const HABITAT_LEGEND = Object.entries(LEVEL_1_COLORS).map(([code, color]) => ({
  code: Number(code),
  name: habitatCodeLabel(code) ?? code,
  color,
}));

export interface HabitatClass {
  /** The raw pixel value, e.g. 109. */
  value: number;
  /** Its dotted form in the IUCN scheme, e.g. "1.9". */
  code: string;
  /** The scheme's name for it, e.g. "Forest - Subtropical/Tropical Moist Montane". */
  name: string;
  /** The level-1 group it belongs to, which is what the colour encodes. */
  group: string;
  color: string;
}

export function habitatClass(value: number): HabitatClass | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const level1 = Math.floor(value / 100);
  const color = LEVEL_1_COLORS[level1];
  const group = habitatCodeLabel(String(level1));
  if (!color || !group) return null;
  const code = `${level1}.${value % 100}`;
  return {
    value,
    code,
    // A value whose sub-type isn't in the scheme still has a true level-1
    // name; habitatCodeLabel falls back to it rather than guessing.
    name: habitatCodeLabel(code) ?? group,
    group,
    color,
  };
}

/** The habitat class at a point, or null where the map has no data. */
export async function identifyHabitat(
  lng: number,
  lat: number,
  signal?: AbortSignal
): Promise<HabitatClass | null> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    returnGeometry: "false",
    f: "json",
  });
  const response = await fetch(`${IMAGE_SERVER}/identify?${params}`, { signal });
  if (!response.ok) throw new Error(`Habitat identify failed: ${response.status}`);
  const json = (await response.json()) as { value?: string };
  // The service answers "NoData" as a string for pixels outside the raster.
  const value = Number(json?.value);
  return Number.isFinite(value) ? habitatClass(value) : null;
}
