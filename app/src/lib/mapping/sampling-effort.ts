/**
 * GBIF sampling effort: which taxa it can be shown for, and how to read it.
 *
 * The layer answers the question a record map can't answer about itself —
 * whether a blank area is empty because the species isn't there, or because
 * nobody has looked. It is the visible form of the caveat behind a
 * record-based AOO, that the AOO is a lower bound.
 *
 * The published dataset is taxon-stratified, and using the matching taxon
 * matters: all-groups effort is dominated by birds and casual observation, so a
 * cell can be heavily worked for vertebrates and never botanised. Judging a
 * plant's range gap against bird effort would be worse than showing nothing.
 *
 * Pixels carry counts rather than colour — see PIXEL ENCODING below — so the
 * palette, the normalisation and "how many records in this cell" are all
 * decided here rather than baked into the files.
 *
 * Data: El-Gabbas, A. (2026) "A global, taxon-stratified, high-resolution
 * sampling-effort dataset from GBIF for bias-aware ecological modelling",
 * Diversity and Distributions. https://doi.org/10.1111/ddi.70205
 */

/** The nine published groups, plus the all-groups surface. */
export const EFFORT_GROUPS = [
  "all",
  "tracheophyta",
  "aves",
  "insecta",
  "mammalia",
  "reptilia",
  "amphibia",
  "arachnida",
  "mollusca",
  "fungi",
] as const;

export type EffortGroup = (typeof EFFORT_GROUPS)[number];

export const EFFORT_GROUP_LABELS: Record<EffortGroup, string> = {
  all: "All taxa",
  tracheophyta: "Vascular plants",
  aves: "Birds",
  insecta: "Insects",
  mammalia: "Mammals",
  reptilia: "Reptiles",
  amphibia: "Amphibians",
  arachnida: "Arachnids",
  mollusca: "Molluscs",
  fungi: "Fungi",
};

/**
 * The dashboard's taxon groups mapped onto the dataset's.
 *
 * Deliberately incomplete. A group is only listed where the dataset genuinely
 * covers it, because a near-miss here is worse than no layer: showing insect
 * effort under a crustacean, or vascular-plant effort under a moss, invites
 * exactly the wrong conclusion about an empty map. Anything absent from this
 * table gets no sampling-effort layer at all.
 *
 * The notable gaps, all deliberate:
 *   - fishes — the dataset has no fish group
 *   - crustaceans, corals, velvet worms, horseshoe crabs, other invertebrates —
 *     none fall inside Insecta, Arachnida or Mollusca
 *   - mosses and the algae — not vascular plants, so Tracheophyta doesn't cover
 *     them
 */
export const TAXON_GROUP_TO_EFFORT: Record<string, EffortGroup> = {
  flowering_plants: "tracheophyta",
  gymnosperms: "tracheophyta",
  ferns_and_allies: "tracheophyta",
  birds: "aves",
  mammals: "mammalia",
  reptiles: "reptilia",
  amphibians: "amphibia",
  mushrooms: "fungi",
  arachnids: "arachnida",
  molluscs: "mollusca",
  butterflies_and_moths: "insecta",
  beetles: "insecta",
  bees_wasps_and_ants: "insecta",
  flies_and_mosquitoes: "insecta",
  true_bugs: "insecta",
  other_insects: "insecta",
  grasshoppers_crickets_locusts: "insecta",
  dragonflies_and_damselflies: "insecta",
};

/**
 * The effort surface matching a species' taxon group, or null where the
 * dataset doesn't cover it.
 *
 * Null means the layer is withheld entirely, All taxa included: an all-groups
 * surface under a fish record still reads as "this sea is well surveyed" when
 * what was surveyed was seabirds.
 */
export function effortGroupFor(taxonGroup: string | undefined): EffortGroup | null {
  if (!taxonGroup) return null;
  return TAXON_GROUP_TO_EFFORT[taxonGroup] ?? null;
}

/** The published asset for a group. */
export const effortAsset = (group: EffortGroup) =>
  `sampling-effort-${group}-n_obs-10km-v4.png`;

// ---------------------------------------------------------------------------
// PIXEL ENCODING
// ---------------------------------------------------------------------------

/**
 * Records in a cell, from one pixel of the published PNG.
 *
 * The build writes the count as a plain 24-bit integer across RGB, with alpha
 * marking presence. The largest cell in the global raster holds 5,725,330
 * records against a ceiling of 16,777,215, so every value survives exactly.
 *
 * The same technique lib/mapping/elevation.ts reads terrain with: browsers
 * decode PNG natively, so there is no decoder to ship, and shipping numbers
 * rather than colours is what lets the map name a figure instead of only
 * showing a shade.
 */
export function decodeEffort(r: number, g: number, b: number, a: number): number | null {
  if (a === 0) return null;
  return (r << 16) | (g << 8) | b;
}

/**
 * The ramp the paper itself plots with — colorRamps::matlab.like2, blue through
 * cyan and green to yellow and red — so this layer and El-Gabbas's published
 * figures read alike rather than asking anyone to translate between two
 * schemes.
 *
 * Recorded rather than argued, since it cuts the other way: a jet ramp is not
 * perceptually uniform. Its cyan-to-green step reads as an edge the data
 * doesn't contain, and it separates poorly under the commoner colour-vision
 * deficiencies. Matching the source publication was judged the more useful
 * property here.
 */
const RAMP: [number, number, number][] = [
  [0, 0, 191],
  [0, 48, 255],
  [0, 144, 255],
  [0, 224, 224],
  [64, 224, 0],
  [192, 240, 0],
  [255, 208, 0],
  [255, 96, 0],
  [191, 0, 0],
];

export function effortColour(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** The legend's stops, straight off the ramp so the two can't drift apart. */
export const EFFORT_LEGEND = [0, 0.25, 0.4, 0.55, 0.75, 1].map((t) => {
  const [r, g, b] = effortColour(t);
  return `rgb(${r},${g},${b})`;
});

/**
 * Where the ramp tops out, as a count.
 *
 * The 99th percentile of occupied cells, not the maximum: the raster runs from
 * a median of about 5 records per occupied cell to millions in one, so scaling
 * to the maximum puts most of the world in the bottom of the ramp and the map
 * reads as speckle. Computed from the layer actually loaded, so each taxon is
 * scaled to its own distribution rather than to all-groups totals.
 */
export function rampTop(counts: Uint32Array): number {
  // A log-spaced histogram rather than a sort: this runs over ~17 million
  // pixels, and sorting them to find one percentile would cost far more than
  // the answer is worth.
  const BUCKETS = 512;
  const histogram = new Uint32Array(BUCKETS);
  let occupied = 0;
  for (const value of counts) {
    if (value <= 0) continue;
    occupied++;
    const bucket = Math.min(BUCKETS - 1, Math.floor((Math.log1p(value) / Math.log1p(20_000_000)) * BUCKETS));
    histogram[bucket]++;
  }
  if (occupied === 0) return 1;
  const target = occupied * 0.99;
  let seen = 0;
  for (let i = 0; i < BUCKETS; i++) {
    seen += histogram[i];
    if (seen >= target) {
      return Math.max(1, Math.round(Math.expm1(((i + 1) / BUCKETS) * Math.log1p(20_000_000))));
    }
  }
  return 1;
}

/**
 * How a cell's count reads next to the elevation and ecoregion.
 *
 * The width is given rather than assumed. The surface is Web Mercator, so a
 * pixel is a fixed span in projected space and a shrinking one on the ground —
 * 9.8 km at the equator, about 6.9 km at 45°, 4.9 km at 60°. Calling every one
 * of them "10 km", as this did, is only true on the equator.
 */
export function formatEffort(count: number, cellKm: number): string {
  const width = cellKm >= 10 ? Math.round(cellKm) : Math.round(cellKm * 10) / 10;
  return `${count.toLocaleString()} record${count === 1 ? "" : "s"} in this ${width} km cell`;
}

/**
 * GBIF's taxon keys for the groups this layer offers, so a cell can be opened
 * as an occurrence search.
 *
 * Every one verified by querying it and checking what comes back, because a
 * wrong key here doesn't fail — it quietly widens the search. Two caught that
 * way: a name lookup for Reptilia returns Chordata by HIGHERRANK, which would
 * have opened every vertebrate; and Amphibia has no match at all through
 * species/match though the backbone holds it as class 131.
 *
 * Reptilia has no usable node of its own since the CoL migration — it is
 * paraphyletic — so it is assembled from its orders. Rhynchocephalia is left
 * out: one living species, and its absence is invisible at this scale.
 */
export const GBIF_TAXON_KEYS: Record<Exclude<EffortGroup, "all">, number[]> = {
  tracheophyta: [7707728],
  aves: [212],
  mammalia: [359],
  reptilia: [11592253, 11418114, 11493978], // Squamata, Testudines, Crocodylia
  amphibia: [131],
  insecta: [216],
  arachnida: [367],
  mollusca: [52],
  fungi: [5],
};

/**
 * Catalogue of Life keys for the groups this layer offers.
 *
 * The website and the v1 API do not share a keyspace. gbif.org went CoL-first
 * in June 2026 and its occurrence search takes CoL ids — the same alphanumeric
 * keys this dashboard already routes on, so 6CX6F is Dioscorea biplicata in
 * both. The v1 API still takes the old numeric backbone keys, which is why
 * GBIF_TAXON_KEYS above and this table both exist and disagree.
 *
 * Resolved through ChecklistBank against the release gbif.org serves, and
 * spot-checked against a URL the site itself produced: clicking Vertebrata
 * there gives taxonKey=8V4V3, which ChecklistBank confirms is Vertebrata.
 *
 * Reptilia needs no workaround here. CoL holds it as an accepted class (RP),
 * where the v1 backbone has no usable node for it at all.
 */
export const COL_TAXON_KEYS: Record<Exclude<EffortGroup, "all">, string> = {
  tracheophyta: "TP",
  aves: "V2",
  mammalia: "6224G",
  reptilia: "RP",
  amphibia: "PH",
  insecta: "H6",
  arachnida: "CCQKT",
  mollusca: "M2L",
  fungi: "F",
};

/**
 * The GBIF occurrence search for one cell, filtered to the taxon shown.
 *
 * Both parameters are camelCase, which is what the site emits for itself. Two
 * earlier attempts failed for a reason worth recording: the names were right
 * the first time and the key was wrong — a numeric v1 key the CoL-first site
 * couldn't resolve, so it fell through into the scientific-name filter and
 * returned nothing. The lesson wasn't "guess again", it was that a link whose
 * result nobody here can see needs a number beside it, which is what the live
 * count is for.
 */
export function gbifSearchUrl(
  bounds: [number, number, number, number],
  group: EffortGroup
): string {
  const [w, s, e, n] = bounds.map((v) => Number(v.toFixed(5)));
  const polygon = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  const params = new URLSearchParams({ geometry: polygon, hasCoordinate: "true" });
  if (group !== "all") params.set("taxonKey", COL_TAXON_KEYS[group]);
  return `https://www.gbif.org/occurrence/search?${params}`;
}

/**
 * What GBIF holds in a cell now, for the taxon shown — the API, not the site.
 *
 * The API's parameter names are documented and were checked against real
 * responses, so the taxon filter here is known to bite: the same call returns
 * 1,442 vascular-plant records for a cell east of Bogot\u00e1 and 609 million
 * worldwide for the phylum.
 */
export function gbifCountUrl(
  bounds: [number, number, number, number],
  group: EffortGroup
): string {
  const [w, s, e, n] = bounds.map((v) => Number(v.toFixed(5)));
  const polygon = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  // Faceted, so the same request that gives the total also breaks it down —
  // "24 records" and "24 human observations, no specimens" are different
  // evidence about whether anyone has actually collected here.
  const params = new URLSearchParams({
    geometry: polygon,
    hasCoordinate: "true",
    limit: "0",
    facet: "basisOfRecord",
    facetLimit: "12",
  });
  if (group !== "all") {
    for (const key of GBIF_TAXON_KEYS[group]) params.append("taxonKey", String(key));
  }
  return `https://api.gbif.org/v1/occurrence/search?${params}`;
}
