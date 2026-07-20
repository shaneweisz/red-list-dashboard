/**
 * UN M49 sub-region mapping from ISO 3166-1 alpha-2 country codes.
 * Used to group countries into meaningful geographic regions for assessor matching.
 */

const COUNTRY_TO_REGION: Record<string, string> = {
  // Eastern Africa
  BI: "Eastern Africa", DJ: "Eastern Africa", ER: "Eastern Africa", ET: "Eastern Africa",
  KE: "Eastern Africa", KM: "Eastern Africa", MG: "Eastern Africa", MU: "Eastern Africa",
  MW: "Eastern Africa", MZ: "Eastern Africa", RE: "Eastern Africa", RW: "Eastern Africa",
  SC: "Eastern Africa", SO: "Eastern Africa", SS: "Eastern Africa", TZ: "Eastern Africa",
  UG: "Eastern Africa", YT: "Eastern Africa", ZM: "Eastern Africa", ZW: "Eastern Africa",

  // Middle Africa
  AO: "Middle Africa", CD: "Middle Africa", CF: "Middle Africa", CG: "Middle Africa",
  CM: "Middle Africa", GA: "Middle Africa", GQ: "Middle Africa", ST: "Middle Africa",
  TD: "Middle Africa",

  // Northern Africa
  DZ: "Northern Africa", EG: "Northern Africa", EH: "Northern Africa", LY: "Northern Africa",
  MA: "Northern Africa", SD: "Northern Africa", TN: "Northern Africa",

  // Southern Africa
  BW: "Southern Africa", LS: "Southern Africa", NA: "Southern Africa", SZ: "Southern Africa",
  ZA: "Southern Africa",

  // Western Africa
  BF: "Western Africa", BJ: "Western Africa", CI: "Western Africa", CV: "Western Africa",
  GH: "Western Africa", GM: "Western Africa", GN: "Western Africa", GW: "Western Africa",
  LR: "Western Africa", ML: "Western Africa", MR: "Western Africa", NE: "Western Africa",
  NG: "Western Africa", SH: "Western Africa", SL: "Western Africa", SN: "Western Africa",
  TG: "Western Africa",

  // Caribbean
  AG: "Caribbean", AI: "Caribbean", AW: "Caribbean", BB: "Caribbean",
  BL: "Caribbean", BQ: "Caribbean", BS: "Caribbean", CU: "Caribbean",
  CW: "Caribbean", DM: "Caribbean", DO: "Caribbean", GD: "Caribbean",
  GP: "Caribbean", HT: "Caribbean", JM: "Caribbean", KN: "Caribbean",
  KY: "Caribbean", LC: "Caribbean", MF: "Caribbean", MQ: "Caribbean",
  MS: "Caribbean", PR: "Caribbean", SX: "Caribbean", TC: "Caribbean",
  TT: "Caribbean", VC: "Caribbean", VG: "Caribbean", VI: "Caribbean",

  // Central America
  BZ: "Central America", CR: "Central America", GT: "Central America",
  HN: "Central America", MX: "Central America", NI: "Central America",
  PA: "Central America", SV: "Central America",

  // South America
  AR: "South America", BO: "South America", BR: "South America", CL: "South America",
  CO: "South America", EC: "South America", FK: "South America", GF: "South America",
  GY: "South America", PE: "South America", PY: "South America", SR: "South America",
  UY: "South America", VE: "South America",

  // Northern America
  BM: "Northern America", CA: "Northern America", GL: "Northern America",
  PM: "Northern America", US: "Northern America",

  // Central Asia
  KG: "Central Asia", KZ: "Central Asia", TJ: "Central Asia", TM: "Central Asia",
  UZ: "Central Asia",

  // Eastern Asia
  CN: "Eastern Asia", HK: "Eastern Asia", JP: "Eastern Asia", KP: "Eastern Asia",
  KR: "Eastern Asia", MN: "Eastern Asia", MO: "Eastern Asia", TW: "Eastern Asia",

  // South-eastern Asia
  BN: "South-eastern Asia", ID: "South-eastern Asia", KH: "South-eastern Asia",
  LA: "South-eastern Asia", MM: "South-eastern Asia", MY: "South-eastern Asia",
  PH: "South-eastern Asia", SG: "South-eastern Asia", TH: "South-eastern Asia",
  TL: "South-eastern Asia", VN: "South-eastern Asia",

  // Southern Asia
  AF: "Southern Asia", BD: "Southern Asia", BT: "Southern Asia", IN: "Southern Asia",
  IR: "Southern Asia", LK: "Southern Asia", MV: "Southern Asia", NP: "Southern Asia",
  PK: "Southern Asia",

  // Western Asia
  AE: "Western Asia", AM: "Western Asia", AZ: "Western Asia", BH: "Western Asia",
  CY: "Western Asia", GE: "Western Asia", IL: "Western Asia", IQ: "Western Asia",
  JO: "Western Asia", KW: "Western Asia", LB: "Western Asia", OM: "Western Asia",
  PS: "Western Asia", QA: "Western Asia", SA: "Western Asia", SY: "Western Asia",
  TR: "Western Asia", YE: "Western Asia",

  // Eastern Europe
  BG: "Eastern Europe", BY: "Eastern Europe", CZ: "Eastern Europe", HU: "Eastern Europe",
  MD: "Eastern Europe", PL: "Eastern Europe", RO: "Eastern Europe", RU: "Eastern Europe",
  SK: "Eastern Europe", UA: "Eastern Europe",

  // Northern Europe
  AX: "Northern Europe", DK: "Northern Europe", EE: "Northern Europe", FI: "Northern Europe",
  FO: "Northern Europe", GB: "Northern Europe", GG: "Northern Europe", IE: "Northern Europe",
  IM: "Northern Europe", IS: "Northern Europe", JE: "Northern Europe", LT: "Northern Europe",
  LV: "Northern Europe", NO: "Northern Europe", SE: "Northern Europe", SJ: "Northern Europe",

  // Southern Europe
  AD: "Southern Europe", AL: "Southern Europe", BA: "Southern Europe", ES: "Southern Europe",
  GI: "Southern Europe", GR: "Southern Europe", HR: "Southern Europe", IT: "Southern Europe",
  ME: "Southern Europe", MK: "Southern Europe", MT: "Southern Europe", PT: "Southern Europe",
  RS: "Southern Europe", SI: "Southern Europe", SM: "Southern Europe", VA: "Southern Europe",
  XK: "Southern Europe",

  // Western Europe
  AT: "Western Europe", BE: "Western Europe", CH: "Western Europe", DE: "Western Europe",
  FR: "Western Europe", LI: "Western Europe", LU: "Western Europe", MC: "Western Europe",
  NL: "Western Europe",

  // Australia and New Zealand
  AU: "Australasia", NZ: "Australasia", NF: "Australasia",

  // Melanesia
  FJ: "Melanesia", NC: "Melanesia", PG: "Melanesia", SB: "Melanesia", VU: "Melanesia",

  // Micronesia
  FM: "Micronesia", GU: "Micronesia", KI: "Micronesia", MH: "Micronesia",
  MP: "Micronesia", NR: "Micronesia", PW: "Micronesia",

  // Polynesia
  AS: "Polynesia", CK: "Polynesia", NU: "Polynesia", PF: "Polynesia",
  PN: "Polynesia", TK: "Polynesia", TO: "Polynesia", TV: "Polynesia",
  WF: "Polynesia", WS: "Polynesia",
};

/**
 * Map a country code to its UN M49 sub-region.
 * Returns "Other" for unrecognised codes.
 */
export function countryToRegion(code: string): string {
  return COUNTRY_TO_REGION[code.toUpperCase()] ?? "Other";
}

/** Canonical geographic order: Africa → Americas → Asia → Europe → Oceania */
const REGION_ORDER: string[] = [
  "Eastern Africa", "Middle Africa", "Northern Africa", "Southern Africa", "Western Africa",
  "Caribbean", "Central America", "Northern America", "South America",
  "Central Asia", "Eastern Asia", "South-eastern Asia", "Southern Asia", "Western Asia",
  "Eastern Europe", "Northern Europe", "Southern Europe", "Western Europe",
  "Australasia", "Melanesia", "Micronesia", "Polynesia",
  "Other",
];

const REGION_INDEX = new Map(REGION_ORDER.map((r, i) => [r, i]));

/**
 * Given an array of country codes, return the unique set of regions they belong to,
 * sorted in canonical geographic order so chart segments flow smoothly.
 */
export function countriesToRegions(codes: string[]): string[] {
  const regions = new Set<string>();
  for (const c of codes) {
    regions.add(countryToRegion(c));
  }
  return [...regions].sort((a, b) => (REGION_INDEX.get(a) ?? 99) - (REGION_INDEX.get(b) ?? 99));
}

/** Olympic-inspired continent colours with sub-region shade variants */
const REGION_COLORS: Record<string, string> = {
  // Africa — yellows/golds
  "Eastern Africa": "#eab308",
  "Middle Africa": "#ca8a04",
  "Northern Africa": "#facc15",
  "Southern Africa": "#a16207",
  "Western Africa": "#fde047",
  // Americas — reds
  "Caribbean": "#f87171",
  "Central America": "#ef4444",
  "Northern America": "#fca5a5",
  "South America": "#dc2626",
  // Asia — greens
  "Central Asia": "#22c55e",
  "Eastern Asia": "#16a34a",
  "South-eastern Asia": "#4ade80",
  "Southern Asia": "#15803d",
  "Western Asia": "#86efac",
  // Europe — blues
  "Eastern Europe": "#3b82f6",
  "Northern Europe": "#2563eb",
  "Southern Europe": "#60a5fa",
  "Western Europe": "#1d4ed8",
  // Oceania — teals
  "Australasia": "#14b8a6",
  "Melanesia": "#0d9488",
  "Micronesia": "#2dd4bf",
  "Polynesia": "#0f766e",
  "Other": "#a1a1aa",
};

export function regionColor(region: string): string {
  return REGION_COLORS[region] ?? "#a1a1aa";
}

// ── IUCN Land Regions ──────────────────────────────────────────────
// Maps ISO 3166-1 alpha-2 country codes to IUCN land regions.

const COUNTRY_TO_IUCN_REGION: Record<string, string> = {
  // Antarctic
  AQ: "Antarctic", BV: "Antarctic", GS: "Antarctic", HM: "Antarctic", TF: "Antarctic",

  // Caribbean Islands
  AG: "Caribbean Islands", AI: "Caribbean Islands", AW: "Caribbean Islands",
  BB: "Caribbean Islands", BL: "Caribbean Islands", BQ: "Caribbean Islands",
  BS: "Caribbean Islands", CU: "Caribbean Islands", CW: "Caribbean Islands",
  DM: "Caribbean Islands", DO: "Caribbean Islands", GD: "Caribbean Islands",
  GP: "Caribbean Islands", HT: "Caribbean Islands", JM: "Caribbean Islands",
  KN: "Caribbean Islands", KY: "Caribbean Islands", LC: "Caribbean Islands",
  MF: "Caribbean Islands", MQ: "Caribbean Islands", MS: "Caribbean Islands",
  PR: "Caribbean Islands", SX: "Caribbean Islands", TC: "Caribbean Islands",
  TT: "Caribbean Islands", VC: "Caribbean Islands", VG: "Caribbean Islands",
  VI: "Caribbean Islands",

  // East Asia
  CN: "East Asia", HK: "East Asia", JP: "East Asia", KP: "East Asia",
  KR: "East Asia", MN: "East Asia", MO: "East Asia", TW: "East Asia",

  // Europe
  AD: "Europe", AL: "Europe", AT: "Europe", AX: "Europe", BA: "Europe",
  BE: "Europe", BG: "Europe", BY: "Europe", CH: "Europe", CZ: "Europe",
  DE: "Europe", DK: "Europe", EE: "Europe", ES: "Europe", FI: "Europe",
  FO: "Europe", FR: "Europe", GB: "Europe", GG: "Europe", GI: "Europe",
  GR: "Europe", HR: "Europe", HU: "Europe", IE: "Europe", IM: "Europe",
  IS: "Europe", IT: "Europe", JE: "Europe", LI: "Europe", LT: "Europe",
  LU: "Europe", LV: "Europe", MC: "Europe", MD: "Europe", ME: "Europe",
  MK: "Europe", MT: "Europe", NL: "Europe", NO: "Europe", PL: "Europe",
  PT: "Europe", RO: "Europe", RS: "Europe", SE: "Europe", SI: "Europe",
  SJ: "Europe", SK: "Europe", SM: "Europe", UA: "Europe", VA: "Europe",
  XK: "Europe",

  // Mesoamerica
  BZ: "Mesoamerica", CR: "Mesoamerica", GT: "Mesoamerica", HN: "Mesoamerica",
  MX: "Mesoamerica", NI: "Mesoamerica", PA: "Mesoamerica", SV: "Mesoamerica",

  // North Africa
  DZ: "North Africa", EG: "North Africa", EH: "North Africa", LY: "North Africa",
  MA: "North Africa", SD: "North Africa", TN: "North Africa",

  // North America
  BM: "North America", CA: "North America", GL: "North America",
  PM: "North America", US: "North America",

  // North Asia
  RU: "North Asia",

  // Oceania
  AS: "Oceania", AU: "Oceania", CK: "Oceania", FJ: "Oceania", FM: "Oceania",
  GU: "Oceania", KI: "Oceania", MH: "Oceania", MP: "Oceania", NC: "Oceania",
  NF: "Oceania", NR: "Oceania", NU: "Oceania", NZ: "Oceania", PF: "Oceania",
  PG: "Oceania", PN: "Oceania", PW: "Oceania", SB: "Oceania", TK: "Oceania",
  TO: "Oceania", TV: "Oceania", VU: "Oceania", WF: "Oceania", WS: "Oceania",

  // South America
  AR: "South America", BO: "South America", BR: "South America", CL: "South America",
  CO: "South America", EC: "South America", FK: "South America", GF: "South America",
  GY: "South America", PE: "South America", PY: "South America", SR: "South America",
  UY: "South America", VE: "South America",

  // South and Southeast Asia
  AF: "South and Southeast Asia", BD: "South and Southeast Asia",
  BN: "South and Southeast Asia", BT: "South and Southeast Asia",
  ID: "South and Southeast Asia", IN: "South and Southeast Asia",
  KH: "South and Southeast Asia", LA: "South and Southeast Asia",
  LK: "South and Southeast Asia", MM: "South and Southeast Asia",
  MV: "South and Southeast Asia", MY: "South and Southeast Asia",
  NP: "South and Southeast Asia", PH: "South and Southeast Asia",
  PK: "South and Southeast Asia", SG: "South and Southeast Asia",
  TH: "South and Southeast Asia", TL: "South and Southeast Asia",
  VN: "South and Southeast Asia",

  // Sub-Saharan Africa
  AO: "Sub-Saharan Africa", BF: "Sub-Saharan Africa", BI: "Sub-Saharan Africa",
  BJ: "Sub-Saharan Africa", BW: "Sub-Saharan Africa", CD: "Sub-Saharan Africa",
  CF: "Sub-Saharan Africa", CG: "Sub-Saharan Africa", CI: "Sub-Saharan Africa",
  CM: "Sub-Saharan Africa", CV: "Sub-Saharan Africa", DJ: "Sub-Saharan Africa",
  ER: "Sub-Saharan Africa", ET: "Sub-Saharan Africa", GA: "Sub-Saharan Africa",
  GH: "Sub-Saharan Africa", GM: "Sub-Saharan Africa", GN: "Sub-Saharan Africa",
  GQ: "Sub-Saharan Africa", GW: "Sub-Saharan Africa", KE: "Sub-Saharan Africa",
  KM: "Sub-Saharan Africa", LR: "Sub-Saharan Africa", LS: "Sub-Saharan Africa",
  MG: "Sub-Saharan Africa", ML: "Sub-Saharan Africa", MR: "Sub-Saharan Africa",
  MU: "Sub-Saharan Africa", MW: "Sub-Saharan Africa", MZ: "Sub-Saharan Africa",
  NA: "Sub-Saharan Africa", NE: "Sub-Saharan Africa", NG: "Sub-Saharan Africa",
  RE: "Sub-Saharan Africa", RW: "Sub-Saharan Africa", SC: "Sub-Saharan Africa",
  SH: "Sub-Saharan Africa", SL: "Sub-Saharan Africa", SN: "Sub-Saharan Africa",
  SO: "Sub-Saharan Africa", SS: "Sub-Saharan Africa", ST: "Sub-Saharan Africa",
  SZ: "Sub-Saharan Africa", TD: "Sub-Saharan Africa", TG: "Sub-Saharan Africa",
  TZ: "Sub-Saharan Africa", UG: "Sub-Saharan Africa", YT: "Sub-Saharan Africa",
  ZA: "Sub-Saharan Africa", ZM: "Sub-Saharan Africa", ZW: "Sub-Saharan Africa",

  // West and Central Asia
  AE: "West and Central Asia", AM: "West and Central Asia", AZ: "West and Central Asia",
  BH: "West and Central Asia", CY: "West and Central Asia", GE: "West and Central Asia",
  IL: "West and Central Asia", IQ: "West and Central Asia", IR: "West and Central Asia",
  JO: "West and Central Asia", KG: "West and Central Asia", KW: "West and Central Asia",
  KZ: "West and Central Asia", LB: "West and Central Asia", OM: "West and Central Asia",
  PS: "West and Central Asia", QA: "West and Central Asia", SA: "West and Central Asia",
  SY: "West and Central Asia", TJ: "West and Central Asia", TM: "West and Central Asia",
  TR: "West and Central Asia", UZ: "West and Central Asia", YE: "West and Central Asia",
};

/** IUCN land regions in canonical display order */
export const IUCN_REGION_ORDER: string[] = [
  "Antarctic",
  "Caribbean Islands",
  "East Asia",
  "Europe",
  "Mesoamerica",
  "North Africa",
  "North America",
  "North Asia",
  "Oceania",
  "South America",
  "South and Southeast Asia",
  "Sub-Saharan Africa",
  "West and Central Asia",
];

/** Map a country code to its IUCN land region. Returns "Other" for unrecognised codes. */
export function countryToIucnRegion(code: string): string {
  return COUNTRY_TO_IUCN_REGION[code.toUpperCase()] ?? "Other";
}

/** Get all country codes belonging to a given IUCN region */
export function iucnRegionCountries(region: string): string[] {
  return Object.entries(COUNTRY_TO_IUCN_REGION)
    .filter(([, r]) => r === region)
    .map(([code]) => code);
}

/**
 * Which region (if any) a set of country codes matches *exactly* — not just
 * "some/one country within it", every code in the region and no others. Used
 * to show a region's name (e.g. "Sub-Saharan Africa") instead of a generic
 * "N countries" label wherever a whole region was selected as a unit, whether
 * via the region dropdown or by happening to cmd-click every one of its
 * countries individually. Returns null for an empty set, an arbitrary
 * multi-select that doesn't line up with any one region, or a set spanning
 * more than one region.
 */
export function matchingRegion(codes: Set<string> | string[]): string | null {
  const codeSet = codes instanceof Set ? codes : new Set(codes);
  if (codeSet.size === 0) return null;
  const regions = new Set<string>();
  codeSet.forEach((c) => regions.add(countryToIucnRegion(c)));
  if (regions.size !== 1) return null;
  const region = [...regions][0];
  if (region === "Other") return null;
  const regionCodes = iucnRegionCountries(region);
  return regionCodes.length === codeSet.size && regionCodes.every((c) => codeSet.has(c)) ? region : null;
}

/**
 * Resolve IUCN region names (case-insensitive, hyphen/space tolerant) to their
 * country codes — the dashboard's region dropdown expands to countries the same
 * way, so a region filter and its expanded country set select identically.
 */
export function resolveRegions(values: string[]): { codes: string[]; unresolved: string[] } {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  for (const v of values) {
    const hit = IUCN_REGION_ORDER.find((r) => norm(r) === norm(v));
    if (hit) iucnRegionCountries(hit).forEach((c) => codes.add(c));
    else unresolved.push(v);
  }
  return { codes: [...codes], unresolved };
}
