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
