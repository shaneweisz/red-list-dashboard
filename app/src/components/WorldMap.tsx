"use client";

import React, { useState, useEffect, useRef, useMemo, memo, useCallback } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";

// Using the recommended TopoJSON from react-simple-maps
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Country name (from TopoJSON) to ISO 3166-1 alpha-2 mapping for GBIF
const NAME_TO_ALPHA2: Record<string, string> = {
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

// Approximate country centroids [longitude, latitude] for zoom-to-country
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  "Afghanistan": [67, 33], "Albania": [20, 41], "Algeria": [3, 28], "Angola": [17.5, -12.5], "Argentina": [-64, -34],
  "Armenia": [45, 40], "Australia": [134, -25], "Austria": [14, 47.5], "Azerbaijan": [48, 40.5], "Bangladesh": [90, 24],
  "Belarus": [28, 53], "Belgium": [4.5, 50.5], "Benin": [2.3, 9.5], "Bhutan": [90.5, 27.5], "Bolivia": [-65, -17],
  "Bosnia and Herz.": [18, 44], "Botswana": [24, -22], "Brazil": [-53, -10], "Brunei": [115, 4.5], "Bulgaria": [25, 43],
  "Burkina Faso": [-1.5, 12], "Burundi": [30, -3.5], "Cambodia": [105, 13], "Cameroon": [12.5, 6], "Canada": [-96, 62],
  "Central African Rep.": [21, 7], "Chad": [19, 15], "Chile": [-71, -30], "China": [105, 35], "Colombia": [-72, 4],
  "Congo": [15, -1], "Dem. Rep. Congo": [24, -3], "Costa Rica": [-84, 10], "Côte d'Ivoire": [-5.5, 7.5],
  "Croatia": [16.5, 45], "Cuba": [-79, 22], "Cyprus": [33, 35], "Czechia": [15.5, 49.8], "Denmark": [10, 56],
  "Djibouti": [43, 11.5], "Dominican Rep.": [-70, 19], "Ecuador": [-78.5, -1.5], "Egypt": [30, 27], "El Salvador": [-89, 13.8],
  "Eq. Guinea": [10, 1.5], "Eritrea": [39, 15], "Estonia": [25, 59], "eSwatini": [31.5, -26.5], "Ethiopia": [40, 8],
  "Fiji": [178, -18], "Finland": [26, 64], "France": [2, 46], "Gabon": [11.5, -0.5], "Gambia": [-15.5, 13.5],
  "Georgia": [43.5, 42], "Germany": [10, 51], "Ghana": [-1.2, 8], "Greece": [22, 39], "Greenland": [-42, 72],
  "Guatemala": [-90.5, 15.5], "Guinea": [-12, 11], "Guinea-Bissau": [-15, 12], "Guyana": [-59, 5],
  "Haiti": [-72, 19], "Honduras": [-87, 15], "Hungary": [19.5, 47], "Iceland": [-19, 65], "India": [79, 22],
  "Indonesia": [120, -5], "Iran": [53, 32], "Iraq": [44, 33], "Ireland": [-8, 53], "Israel": [35, 31.5],
  "Italy": [12.5, 42.5], "Jamaica": [-77.5, 18.2], "Japan": [138, 36], "Jordan": [36, 31],
  "Kazakhstan": [67, 48], "Kenya": [38, 1], "North Korea": [127, 40], "South Korea": [128, 36], "Kuwait": [48, 29.5],
  "Kyrgyzstan": [75, 41], "Laos": [102, 18], "Latvia": [25, 57], "Lebanon": [35.8, 34], "Lesotho": [28.5, -29.5],
  "Liberia": [-9.5, 6.5], "Libya": [17, 27], "Lithuania": [24, 55.5], "Luxembourg": [6.1, 49.8], "Madagascar": [47, -20],
  "Malawi": [34, -13.5], "Malaysia": [110, 4], "Mali": [-2, 17], "Mauritania": [-10.5, 20], "Mexico": [-102, 23],
  "Moldova": [29, 47], "Mongolia": [104, 47], "Montenegro": [19.3, 42.5], "Morocco": [-6, 32], "Mozambique": [35, -18],
  "Myanmar": [96, 19], "Namibia": [17, -22], "Nepal": [84, 28], "Netherlands": [5.5, 52.5], "New Zealand": [174, -41],
  "Nicaragua": [-85, 13], "Niger": [8, 16], "Nigeria": [8, 10], "Norway": [9, 62], "Oman": [56, 21],
  "Pakistan": [70, 30], "Panama": [-80, 9], "Papua New Guinea": [147, -6], "Paraguay": [-58, -23], "Peru": [-76, -10],
  "Philippines": [122, 13], "Poland": [20, 52], "Portugal": [-8, 39.5], "Puerto Rico": [-66.5, 18.2], "Qatar": [51.2, 25.3],
  "Romania": [25, 46], "Russia": [100, 60], "Rwanda": [30, -2], "Saudi Arabia": [45, 24], "Senegal": [-14.5, 14.5],
  "Serbia": [21, 44], "Sierra Leone": [-11.8, 8.5], "Singapore": [104, 1.3], "Slovakia": [19.5, 48.7], "Slovenia": [15, 46],
  "Solomon Is.": [160, -9], "Somalia": [46, 6], "South Africa": [25, -29], "S. Sudan": [30, 7], "Spain": [-4, 40],
  "Sri Lanka": [81, 8], "Sudan": [30, 15], "Suriname": [-56, 4], "Sweden": [15, 62], "Switzerland": [8, 47],
  "Syria": [38, 35], "Taiwan": [121, 24], "Tajikistan": [69, 39], "Tanzania": [35, -6], "Thailand": [101, 15],
  "Timor-Leste": [126, -8.5], "Togo": [1.2, 8], "Trinidad and Tobago": [-61, 10.5], "Tunisia": [9, 34],
  "Turkey": [35, 39], "Turkmenistan": [60, 39], "Uganda": [32, 1.5], "Ukraine": [32, 49],
  "United Arab Emirates": [54, 24], "United Kingdom": [-2, 54], "United States of America": [-97, 38],
  "Uruguay": [-56, -33], "Uzbekistan": [65, 41], "Vanuatu": [167, -16], "Venezuela": [-66, 8], "Vietnam": [106, 16],
  "Yemen": [48, 15.5], "Zambia": [28, -15], "Zimbabwe": [30, -20], "Palestine": [35.3, 31.9], "Kosovo": [21, 42.6],
  "North Macedonia": [21.7, 41.5], "New Caledonia": [165.5, -21.5], "W. Sahara": [-13, 24.5],
  "Fr. S. Antarctic Lands": [69, -49], "Falkland Is.": [-59, -52],
  // Small/micro nations
  "Andorra": [1.6, 42.5], "Antigua and Barbuda": [-61.8, 17.1], "Bahamas": [-77.4, 25], "Bahrain": [50.6, 26],
  "Barbados": [-59.5, 13.2], "Belize": [-88.5, 17.2], "Cape Verde": [-24, 16], "Comoros": [44.3, -12.2],
  "Dominica": [-61.4, 15.4], "Grenada": [-61.7, 12.1], "Kiribati": [173, 1.5], "Liechtenstein": [9.6, 47.2],
  "Maldives": [73.5, 3.2], "Malta": [14.4, 35.9], "Marshall Islands": [171.4, 7.1],
  "Mauritius": [57.6, -20.3], "Micronesia": [158.2, 6.9], "Monaco": [7.4, 43.7], "Nauru": [166.9, -0.5],
  "Palau": [134.6, 7.5], "Samoa": [-172.1, -13.8], "San Marino": [12.5, 43.9],
  "São Tomé and Príncipe": [6.6, 0.2], "Seychelles": [55.5, -4.7],
  "Saint Kitts and Nevis": [-62.7, 17.3], "Saint Lucia": [-61, 13.9],
  "Saint Vincent and the Grenadines": [-61.2, 13.2], "Tonga": [-175.2, -21.2],
  "Tuvalu": [179.2, -8.5], "Vatican City": [12.5, 41.9],
};

// Sorted list of country names for search
const COUNTRY_NAMES_SORTED = Object.keys(NAME_TO_ALPHA2).sort();

interface CountryStats {
  [countryCode: string]: {
    occurrences: number;
    species: number;
  };
}

// Color scale for heatmap: pale green -> medium green -> dark green
function getHeatmapColor(value: number, maxValue: number): string {
  if (value === 0 || maxValue === 0) return "#f5f5f4"; // stone-100

  // Use log scale with high power to push most countries to pale end
  // Higher power = more countries appear pale, only highest values get dark
  const logValue = Math.log10(value + 1);
  const logMax = Math.log10(maxValue + 1);
  const ratio = Math.pow(logValue / logMax, 2.0);

  // Color scale: #dcfce7 (green-100) -> #86efac (green-300) -> #22c55e (green-500) -> #166534 (green-800)
  if (ratio < 0.33) {
    // Pale green to light green
    const t = ratio * 3;
    const r = Math.round(220 + (134 - 220) * t);
    const g = Math.round(252 + (239 - 252) * t);
    const b = Math.round(231 + (172 - 231) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (ratio < 0.66) {
    // Light green to medium green
    const t = (ratio - 0.33) * 3;
    const r = Math.round(134 + (34 - 134) * t);
    const g = Math.round(239 + (197 - 239) * t);
    const b = Math.round(172 + (94 - 172) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Medium green to dark green
    const t = (ratio - 0.66) * 3;
    const r = Math.round(34 + (22 - 34) * t);
    const g = Math.round(197 + (101 - 197) * t);
    const b = Math.round(94 + (52 - 94) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

type ColorMode = "species" | "occurrences";

const ALL_TAXA_IDS = ["mammalia", "aves", "reptilia", "amphibia", "fishes", "invertebrates", "plantae", "fungi"];

interface WorldMapProps {
  selectedCountries: Set<string>;
  onCountrySelect: (countryCode: string, countryName: string, event: React.MouseEvent) => void;
  onClearSelection: () => void;
  selectedTaxon?: string | null;
  // Optional pre-computed stats (for Red List species counts - avoids API call)
  precomputedStats?: CountryStats;
  // Which taxa are selected (determines which GBIF occurrence stats to fetch)
  selectedTaxa?: Set<string>;
}

const DEFAULT_CENTER: [number, number] = [10, 10];
const DEFAULT_ZOOM = 1.0;
const MIN_ZOOM = 1.0;
const MAX_ZOOM = 8.0;

function WorldMap({ selectedCountries, onCountrySelect, onClearSelection, selectedTaxon, precomputedStats, selectedTaxa }: WorldMapProps) {
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [hoveredCountryCode, setHoveredCountryCode] = useState<string | null>(null);
  const [speciesStats, setSpeciesStats] = useState<CountryStats>(precomputedStats || {});
  const [occurrenceStats, setOccurrenceStats] = useState<CountryStats | null>(null);
  const [loading, setLoading] = useState(!precomputedStats);
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("species");

  // Zoom & pan state
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Country search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return COUNTRY_NAMES_SORTED.filter(name => name.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery]);

  const handleZoomToCountry = useCallback((countryName: string) => {
    const coords = COUNTRY_CENTROIDS[countryName];
    if (coords) {
      setCenter(coords);
      // Zoom level depends on country size - small countries zoom more
      const smallCountries = new Set(["Singapore", "Luxembourg", "Cyprus", "Jamaica", "Trinidad and Tobago", "Brunei", "Qatar", "Kuwait", "Lebanon", "Djibouti", "eSwatini", "Lesotho", "Gambia", "Guinea-Bissau", "Slovenia", "Montenegro", "Kosovo", "North Macedonia", "Andorra", "Antigua and Barbuda", "Bahrain", "Barbados", "Belize", "Cape Verde", "Comoros", "Dominica", "Grenada", "Kiribati", "Liechtenstein", "Maldives", "Malta", "Marshall Islands", "Mauritius", "Micronesia", "Monaco", "Nauru", "Palau", "Samoa", "San Marino", "São Tomé and Príncipe", "Seychelles", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Tonga", "Tuvalu", "Vatican City"]);
      const largeCountries = new Set(["Russia", "Canada", "United States of America", "China", "Brazil", "Australia", "India", "Argentina"]);
      const zoomLevel = smallCountries.has(countryName) ? 6 : largeCountries.has(countryName) ? 2.5 : 4;
      setZoom(zoomLevel);
    }
    setSearchQuery("");
    setSearchOpen(false);
    // Also select the country
    const alpha2 = NAME_TO_ALPHA2[countryName];
    if (alpha2) {
      onCountrySelect(alpha2, countryName, { ctrlKey: true, metaKey: false } as unknown as React.MouseEvent);
    }
  }, [onCountrySelect]);

  const handleResetZoom = useCallback(() => {
    setCenter(DEFAULT_CENTER);
    setZoom(DEFAULT_ZOOM);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z: number) => Math.min(z * 1.5, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z: number) => Math.max(z / 1.5, MIN_ZOOM));
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Cache occurrence results by taxa key to avoid refetching on toggle
  const occurrenceCacheRef = useRef<Record<string, CountryStats>>({});

  // Use precomputed stats for species counts, otherwise fetch from API
  useEffect(() => {
    if (precomputedStats) {
      setSpeciesStats(precomputedStats);
      setLoading(false);
      return;
    }

    if (!selectedTaxon) {
      setSpeciesStats({});
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/country/stats?taxon=${encodeURIComponent(selectedTaxon)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.stats) {
          setSpeciesStats(data.stats);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedTaxon, precomputedStats]);

  // Stable key for the current taxa selection
  const taxaKey = useMemo(() => {
    if (!selectedTaxa || selectedTaxa.size === 0) return "all";
    return Array.from(selectedTaxa).sort().join(",");
  }, [selectedTaxa]);

  // Fetch real per-country occurrence counts from GBIF API in the background
  // All taxa fire in parallel; map updates once when all resolve
  useEffect(() => {
    // Use cached result if available
    if (occurrenceCacheRef.current[taxaKey]) {
      setOccurrenceStats(occurrenceCacheRef.current[taxaKey]);
      return;
    }

    const taxaToFetch = taxaKey === "all" ? ALL_TAXA_IDS : taxaKey.split(",");

    setOccurrenceLoading(true);
    const controller = new AbortController();

    Promise.all(
      taxaToFetch.map(taxon =>
        fetch(`/api/country/stats?taxon=${encodeURIComponent(taxon)}`, { signal: controller.signal })
          .then(res => res.json())
          .then(data => (data.stats || {}) as CountryStats)
          .catch(() => ({} as CountryStats))
      )
    ).then(results => {
      if (controller.signal.aborted) return;
      const combined: CountryStats = {};
      for (const stats of results) {
        for (const [code, stat] of Object.entries(stats)) {
          if (!combined[code]) combined[code] = { occurrences: 0, species: 0 };
          combined[code].occurrences += stat.occurrences;
        }
      }
      occurrenceCacheRef.current[taxaKey] = combined;
      setOccurrenceStats(combined);
    }).finally(() => {
      if (!controller.signal.aborted) setOccurrenceLoading(false);
    });

    return () => controller.abort();
  }, [taxaKey]);

  // Invalidate occurrence cache when taxa change
  useEffect(() => {
    setOccurrenceStats(occurrenceCacheRef.current[taxaKey] || null);
  }, [taxaKey]);

  // Active stats for coloring based on mode
  const activeStats = colorMode === "species" ? speciesStats : (occurrenceStats || {});

  // Calculate max value for heatmap scaling
  const maxValue = Object.values(activeStats).reduce(
    (max, stat) => Math.max(max, colorMode === "species" ? stat.species : stat.occurrences),
    0
  );

  const getCountryColor = (alpha2: string | undefined, isSelected: boolean): string => {
    if (isSelected) return "#3b82f6"; // blue-500 for selected
    if (!alpha2) return "#f4f4f5";

    const stats = activeStats[alpha2];
    if (!stats) return "#f4f4f5";

    const value = colorMode === "species" ? stats.species : stats.occurrences;
    return getHeatmapColor(value, maxValue);
  };

  const hoveredSpeciesStats = hoveredCountryCode ? speciesStats[hoveredCountryCode] : null;
  const hoveredOccurrenceStats = hoveredCountryCode && occurrenceStats ? occurrenceStats[hoveredCountryCode] : null;
  const selectedCount = selectedCountries.size;

  return (
    <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-3 h-full flex flex-col">
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0">
          Country
        </h2>
        <div className="flex items-center gap-2">
          {/* Country search */}
          <div ref={searchContainerRef} className="relative">
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md">
              <svg className="w-3 h-3 ml-1.5 text-zinc-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search country..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                  setHighlightedIndex(0);
                }}
                onFocus={() => { if (searchQuery) setSearchOpen(true); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightedIndex(i => Math.min(i + 1, filteredCountries.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedIndex(i => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && filteredCountries[highlightedIndex]) {
                    e.preventDefault();
                    handleZoomToCountry(filteredCountries[highlightedIndex]);
                  } else if (e.key === "Escape") {
                    setSearchOpen(false);
                    setSearchQuery("");
                    searchInputRef.current?.blur();
                  }
                }}
                className="bg-transparent text-[11px] text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 px-1.5 py-1 w-28 focus:w-36 transition-all outline-none"
              />
            </div>
            {/* Search dropdown */}
            {searchOpen && filteredCountries.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-30 overflow-hidden">
                {filteredCountries.map((name, i) => (
                  <button
                    key={name}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${i === highlightedIndex ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"}`}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => handleZoomToCountry(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Color mode toggle */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5 text-[10px]">
            <button
              onClick={() => setColorMode("species")}
              className={`px-1.5 py-0.5 rounded transition-colors ${colorMode === "species" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              Species
            </button>
            <button
              onClick={() => setColorMode("occurrences")}
              className={`px-1.5 py-0.5 rounded transition-colors ${colorMode === "occurrences" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              GBIF
            </button>
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredCountry && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 bg-white dark:bg-zinc-800 px-3 py-2 rounded-lg shadow-lg text-sm text-zinc-700 dark:text-zinc-300 pointer-events-none border border-zinc-200 dark:border-zinc-700 min-w-[140px]">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">{hoveredCountry}</div>
          {hoveredSpeciesStats || hoveredOccurrenceStats ? (
            <div className="mt-1 space-y-0.5">
              {hoveredSpeciesStats && (
                <div className="flex justify-between gap-4 text-xs">
                  <span className="text-zinc-500"># Assessed</span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{formatNumber(hoveredSpeciesStats.species)}</span>
                </div>
              )}
              <div className="flex justify-between gap-4 text-xs">
                <span className="text-zinc-500">GBIF Obs</span>
                {occurrenceLoading ? (
                  <span className="text-zinc-400 tabular-nums">...</span>
                ) : hoveredOccurrenceStats ? (
                  <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{formatNumber(hoveredOccurrenceStats.occurrences)}</span>
                ) : (
                  <span className="text-zinc-400 tabular-nums">{colorMode === "occurrences" ? "..." : "—"}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-400 mt-1">No data available</div>
          )}
        </div>
      )}

      {/* Map */}
      <div className="flex-1 rounded-lg overflow-hidden relative" style={{ minHeight: "200px" }}>
        {(loading || (colorMode === "occurrences" && !occurrenceStats)) && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-zinc-900/50 z-10">
            <svg className="animate-spin h-5 w-5 text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}
        <ComposableMap
          projection="geoNaturalEarth1"
          projectionConfig={{
            scale: 210,
            center: [0, 0],
          }}
          style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
        >
          <ZoomableGroup
            center={center}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onMoveEnd={({ coordinates, zoom: z }) => {
              setCenter(coordinates as [number, number]);
              setZoom(z);
            }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies
                  .filter((geo) => geo.properties.name !== "Antarctica")
                  .map((geo) => {
                  const countryName = geo.properties.name;
                  const alpha2 = NAME_TO_ALPHA2[countryName];
                  const isSelected = alpha2 ? selectedCountries.has(alpha2) : false;
                  const fillColor = getCountryColor(alpha2, isSelected);

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseEnter={() => {
                        setHoveredCountry(countryName);
                        setHoveredCountryCode(alpha2);
                      }}
                      onMouseLeave={() => {
                        setHoveredCountry(null);
                        setHoveredCountryCode(null);
                      }}
                      onClick={(event) => {
                        if (alpha2) {
                          onCountrySelect(alpha2, countryName, event);
                        }
                      }}
                      style={{
                        default: {
                          fill: fillColor,
                          stroke: "#a1a1aa",
                          strokeWidth: 0.5,
                          outline: "none",
                          cursor: alpha2 ? "pointer" : "default",
                        },
                        hover: {
                          fill: isSelected ? "#2563eb" : alpha2 ? "#a3e635" : "#f4f4f5",
                          stroke: "#71717a",
                          strokeWidth: 0.75,
                          outline: "none",
                          cursor: alpha2 ? "pointer" : "default",
                        },
                        pressed: {
                          fill: "#1d4ed8",
                          stroke: "#52525b",
                          strokeWidth: 1,
                          outline: "none",
                        },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
        {/* Zoom controls */}
        <div className="absolute bottom-2 right-2 flex flex-col gap-1 z-10">
          <button
            onClick={handleZoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="w-7 h-7 flex items-center justify-center rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={handleZoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="w-7 h-7 flex items-center justify-center rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            title="Zoom out"
          >
            &minus;
          </button>
          {zoom > MIN_ZOOM && (
            <button
              onClick={handleResetZoom}
              className="w-7 h-7 flex items-center justify-center rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 text-[10px] font-medium transition-colors"
              title="Reset zoom"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(WorldMap);
