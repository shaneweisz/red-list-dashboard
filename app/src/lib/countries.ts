// ISO 3166-1 alpha-2 country code mappings.
// Extracted from WorldMap.tsx so server-side code (e.g. /browse) can import
// these maps without pulling in the client-only map rendering deps.

// Country name (from TopoJSON) to ISO 3166-1 alpha-2 mapping for GBIF
export const NAME_TO_ALPHA2: Record<string, string> = {
  "Afghanistan": "AF", "Albania": "AL", "Algeria": "DZ", "Angola": "AO", "Argentina": "AR",
  "Armenia": "AM", "Australia": "AU", "Austria": "AT", "Azerbaijan": "AZ", "Bangladesh": "BD",
  "Belarus": "BY", "Belgium": "BE", "Benin": "BJ", "Bhutan": "BT", "Bolivia": "BO",
  "Bosnia and Herz.": "BA", "Botswana": "BW", "Brazil": "BR", "Brunei": "BN", "Bulgaria": "BG",
  "Burkina Faso": "BF", "Burundi": "BI", "Cambodia": "KH", "Cameroon": "CM", "Canada": "CA",
  "Central African Rep.": "CF", "Chad": "TD", "Chile": "CL", "China": "CN", "Colombia": "CO",
  "Congo": "CG", "Dem. Rep. Congo": "CD", "Costa Rica": "CR", "Côte d'Ivoire": "CI",
  "Croatia": "HR", "Cuba": "CU", "Cyprus": "CY", "Czechia": "CZ", "Denmark": "DK",
  "Djibouti": "DJ", "Dominican Rep.": "DO", "Ecuador": "EC", "Egypt": "EG", "El Salvador": "SV",
  "Eq. Guinea": "GQ", "Eritrea": "ER", "Estonia": "EE", "eSwatini": "SZ", "Ethiopia": "ET",
  "Fiji": "FJ", "Finland": "FI", "France": "FR", "Gabon": "GA", "Gambia": "GM", "Georgia": "GE",
  "Germany": "DE", "Ghana": "GH", "Greece": "GR", "Greenland": "GL", "Guatemala": "GT",
  "Guinea": "GN", "Guinea-Bissau": "GW", "Guyana": "GY", "Haiti": "HT", "Honduras": "HN",
  "Hungary": "HU", "Iceland": "IS", "India": "IN", "Indonesia": "ID", "Iran": "IR", "Iraq": "IQ",
  "Ireland": "IE", "Israel": "IL", "Italy": "IT", "Jamaica": "JM", "Japan": "JP", "Jordan": "JO",
  "Kazakhstan": "KZ", "Kenya": "KE", "North Korea": "KP", "South Korea": "KR", "Kuwait": "KW",
  "Kyrgyzstan": "KG", "Laos": "LA", "Latvia": "LV", "Lebanon": "LB", "Lesotho": "LS",
  "Liberia": "LR", "Libya": "LY", "Lithuania": "LT", "Luxembourg": "LU", "Madagascar": "MG",
  "Malawi": "MW", "Malaysia": "MY", "Mali": "ML", "Mauritania": "MR", "Mexico": "MX",
  "Moldova": "MD", "Mongolia": "MN", "Montenegro": "ME", "Morocco": "MA", "Mozambique": "MZ",
  "Myanmar": "MM", "Namibia": "NA", "Nepal": "NP", "Netherlands": "NL", "New Zealand": "NZ",
  "Nicaragua": "NI", "Niger": "NE", "Nigeria": "NG", "Norway": "NO", "Oman": "OM",
  "Pakistan": "PK", "Panama": "PA", "Papua New Guinea": "PG", "Paraguay": "PY", "Peru": "PE",
  "Philippines": "PH", "Poland": "PL", "Portugal": "PT", "Puerto Rico": "PR", "Qatar": "QA",
  "Romania": "RO", "Russia": "RU", "Rwanda": "RW", "Saudi Arabia": "SA", "Senegal": "SN",
  "Serbia": "RS", "Sierra Leone": "SL", "Singapore": "SG", "Slovakia": "SK", "Slovenia": "SI",
  "Solomon Is.": "SB", "Somalia": "SO", "South Africa": "ZA", "S. Sudan": "SS", "Spain": "ES",
  "Sri Lanka": "LK", "Sudan": "SD", "Suriname": "SR", "Sweden": "SE", "Switzerland": "CH",
  "Syria": "SY", "Taiwan": "TW", "Tajikistan": "TJ", "Tanzania": "TZ", "Thailand": "TH",
  "Timor-Leste": "TL", "Togo": "TG", "Trinidad and Tobago": "TT", "Tunisia": "TN",
  "Turkey": "TR", "Turkmenistan": "TM", "Uganda": "UG", "Ukraine": "UA",
  "United Arab Emirates": "AE", "United Kingdom": "GB", "United States of America": "US",
  "Uruguay": "UY", "Uzbekistan": "UZ", "Vanuatu": "VU", "Venezuela": "VE", "Vietnam": "VN",
  "Yemen": "YE", "Zambia": "ZM", "Zimbabwe": "ZW", "Palestine": "PS", "Kosovo": "XK",
  "North Macedonia": "MK", "New Caledonia": "NC", "W. Sahara": "EH", "Fr. S. Antarctic Lands": "TF",
  "Falkland Is.": "FK",
  // Small/micro nations not in 110m TopoJSON but useful for search
  "Andorra": "AD", "Antigua and Barbuda": "AG", "Bahamas": "BS", "Bahrain": "BH", "Barbados": "BB",
  "Belize": "BZ", "Cape Verde": "CV", "Comoros": "KM", "Dominica": "DM", "Grenada": "GD",
  "Kiribati": "KI", "Liechtenstein": "LI", "Maldives": "MV", "Malta": "MT", "Marshall Islands": "MH",
  "Mauritius": "MU", "Micronesia": "FM", "Monaco": "MC", "Nauru": "NR", "Palau": "PW",
  "Samoa": "WS", "San Marino": "SM", "São Tomé and Príncipe": "ST", "Seychelles": "SC",
  "Saint Kitts and Nevis": "KN", "Saint Lucia": "LC", "Saint Vincent and the Grenadines": "VC",
  "Tonga": "TO", "Tuvalu": "TV", "Vatican City": "VA",
};

// Complete ISO 3166-1 alpha-2 to country name mapping (for display)
// Includes all countries, territories, and small island nations
export const ALPHA2_TO_NAME: Record<string, string> = {
  // From TopoJSON (use these names for map consistency)
  ...Object.fromEntries(Object.entries(NAME_TO_ALPHA2).map(([name, code]) => [code, name])),
  // Additional countries and territories not in TopoJSON
  "AD": "Andorra", "AG": "Antigua and Barbuda", "AI": "Anguilla", "AQ": "Antarctica",
  "AS": "American Samoa", "AW": "Aruba", "AX": "Åland Islands", "BB": "Barbados",
  "BH": "Bahrain", "BL": "Saint Barthélemy", "BM": "Bermuda", "BQ": "Bonaire",
  "BS": "Bahamas", "BV": "Bouvet Island", "BZ": "Belize", "CC": "Cocos Islands",
  "CK": "Cook Islands", "CV": "Cape Verde", "CW": "Curaçao", "CX": "Christmas Island",
  "DM": "Dominica", "FK": "Falkland Islands", "FM": "Micronesia", "FO": "Faroe Islands",
  "GD": "Grenada", "GF": "French Guiana", "GG": "Guernsey", "GI": "Gibraltar",
  "GP": "Guadeloupe", "GS": "South Georgia", "GU": "Guam", "HK": "Hong Kong",
  "HM": "Heard Island", "IM": "Isle of Man", "IO": "British Indian Ocean Territory",
  "JE": "Jersey", "KI": "Kiribati", "KM": "Comoros", "KN": "Saint Kitts and Nevis",
  "KY": "Cayman Islands", "LC": "Saint Lucia", "LI": "Liechtenstein", "MC": "Monaco",
  "MF": "Saint Martin", "MH": "Marshall Islands", "MO": "Macao", "MP": "Northern Mariana Islands",
  "MQ": "Martinique", "MS": "Montserrat", "MT": "Malta", "MU": "Mauritius", "MV": "Maldives",
  "NF": "Norfolk Island", "NR": "Nauru", "NU": "Niue", "PF": "French Polynesia",
  "PM": "Saint Pierre and Miquelon", "PN": "Pitcairn", "PW": "Palau", "RE": "Réunion",
  "SC": "Seychelles", "SH": "Saint Helena", "SJ": "Svalbard", "SM": "San Marino",
  "ST": "São Tomé and Príncipe", "SV": "El Salvador", "SX": "Sint Maarten",
  "TC": "Turks and Caicos", "TK": "Tokelau", "TO": "Tonga", "TV": "Tuvalu",
  "UM": "U.S. Minor Outlying Islands", "VA": "Vatican City", "VC": "Saint Vincent and the Grenadines",
  "VG": "British Virgin Islands", "VI": "U.S. Virgin Islands", "WF": "Wallis and Futuna",
  "WS": "Samoa", "YT": "Mayotte",
};

// --- Resolution helpers -------------------------------------------------

// Informal / common aliases not present as canonical names above.
const ALIAS_TO_ALPHA2: Record<string, string> = {
  "usa": "US", "u.s.a.": "US", "us": "US", "united states": "US", "america": "US",
  "uk": "GB", "u.k.": "GB", "britain": "GB", "great britain": "GB", "england": "GB",
  "drc": "CD", "dr congo": "CD", "democratic republic of the congo": "CD",
  "czech republic": "CZ", "swaziland": "SZ", "ivory coast": "CI",
};

const NAME_LOOKUP: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [name, code] of Object.entries(NAME_TO_ALPHA2)) m[name.toLowerCase()] = code;
  for (const [code, name] of Object.entries(ALPHA2_TO_NAME)) m[name.toLowerCase()] = code;
  for (const [k, v] of Object.entries(ALIAS_TO_ALPHA2)) m[k] = v;
  return m;
})();

/** Resolve a country code or human-readable name to an ISO alpha-2 code, or null. */
export function resolveCountryToAlpha2(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && ALPHA2_TO_NAME[upper]) return upper;
  return NAME_LOOKUP[v.toLowerCase()] ?? null;
}
