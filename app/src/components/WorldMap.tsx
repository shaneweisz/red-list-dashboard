"use client";

import React, { useState, useEffect, useRef, useMemo, memo, useCallback } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import { IUCN_REGION_ORDER, matchingRegion } from "@/lib/regions";
import CountryStatsList from "./CountryStatsList";
import type { MapViewMode, MapSortKey } from "@/hooks/useFilterParams";

// Using the recommended TopoJSON from react-simple-maps
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";

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
  "Yemen": "YE", "Zambia": "ZM", "Zimbabwe": "ZW", "Palestine": "PS",
  "Macedonia": "MK", "New Caledonia": "NC", "W. Sahara": "EH", "Fr. S. Antarctic Lands": "TF",
  "Falkland Is.": "FK",
  // Small/micro nations not in the 50m TopoJSON at all — kept spelled out since
  // there's no shape to match against; only useful for search.
  "Andorra": "AD", "Bahamas": "BS", "Bahrain": "BH", "Barbados": "BB",
  "Belize": "BZ", "Comoros": "KM", "Dominica": "DM", "Grenada": "GD",
  "Kiribati": "KI", "Liechtenstein": "LI", "Maldives": "MV", "Malta": "MT",
  "Mauritius": "MU", "Micronesia": "FM", "Monaco": "MC", "Nauru": "NR", "Palau": "PW",
  "Samoa": "WS", "San Marino": "SM", "Seychelles": "SC", "Saint Lucia": "LC",
  "Tonga": "TO", "Tuvalu": "TV",
  // These ARE present in the 50m TopoJSON, just under an abbreviated/different
  // name than the long form above — keyed here by the exact shape name so the
  // map coloring lookup (NAME_TO_ALPHA2[geo.properties.name]) actually matches.
  // (Long display names still shown elsewhere via ALPHA2_TO_NAME's own overrides below.)
  "Antigua and Barb.": "AG", "Cabo Verde": "CV", "São Tomé and Principe": "ST",
  "St. Kitts and Nevis": "KN", "St. Vin. and Gren.": "VC", "Vatican": "VA",
  "Marshall Is.": "MH",
  // Additional territories present as their own shape in the 50m TopoJSON that
  // had no entry at all before (always rendered as "No data" regardless of the
  // underlying Red List data).
  "American Samoa": "AS", "Anguilla": "AI", "Aruba": "AW", "Bermuda": "BM",
  "Br. Indian Ocean Ter.": "IO", "British Virgin Is.": "VG", "Cayman Is.": "KY",
  "Cook Is.": "CK", "Curaçao": "CW", "Faeroe Is.": "FO", "Fr. Polynesia": "PF",
  "Guam": "GU", "Guernsey": "GG", "Heard I. and McDonald Is.": "HM", "Hong Kong": "HK",
  "Isle of Man": "IM", "Jersey": "JE", "Macao": "MO", "Montserrat": "MS",
  "N. Mariana Is.": "MP", "Niue": "NU", "Norfolk Island": "NF", "Pitcairn Is.": "PN",
  "S. Geo. and the Is.": "GS", "Saint Helena": "SH", "Sint Maarten": "SX",
  "St-Barthélemy": "BL", "St-Martin": "MF", "St. Pierre and Miquelon": "PM",
  "Turks and Caicos Is.": "TC", "U.S. Virgin Is.": "VI", "Wallis and Futuna Is.": "WF",
  "Åland": "AX",
  // Somaliland, N. Cyprus, and Kosovo are drawn as their own shape in the
  // TopoJSON, but IUCN's public presentation doesn't treat any of them as a
  // distinct country — fold each into its parent rather than leaving a
  // "no data" gap that reads as a bug.
  //
  // Somaliland/N. Cyprus: IUCN's own Red List country standard (ISO 3166-1 +
  // UN country names, per redlist.org/resources/country-codes) has no
  // distinct code for either — both fold into Somalia/Cyprus, the same way
  // IUCN's own species assessments do (e.g. the Gerenuk assessment's formal
  // country field lists "Somalia", even though its range-description text
  // separately mentions "Somaliland").
  //
  // Kosovo: unlike those two, IUCN's internal SIS database *does* carry a
  // distinct location code (YUG-KO, a legacy former-Yugoslavia sub-code, not
  // a modern ISO alpha-2) — which looked at first like grounds to treat it
  // as its own country. But checking IUCN's own public page for a
  // Kosovo-tagged species (Terranigra kosovica, iucnredlist.org/species/
  // 155681/222427224) shows the official "Geographic Range" field lists only
  // "Serbia" — Kosovo appears solely in the free-text range description,
  // exactly how other legacy sub-codes (RU-EU "European Russia", FRA-FR
  // "France (mainland)") behave: real in the internal data model, but never
  // surfaced as their own entry in IUCN's own public country-of-occurrence
  // presentation. So it gets the same treatment as Somaliland/N. Cyprus, not
  // the Palestine/Taiwan/W. Sahara treatment (which do have their own
  // "Geographic Range" line).
  "Somaliland": "SO", "N. Cyprus": "CY", "Kosovo": "RS",
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
  "MF": "Saint Martin", "MH": "Marshall Islands", "MK": "North Macedonia", "MO": "Macao", "MP": "Northern Mariana Islands",
  "MQ": "Martinique", "MS": "Montserrat", "MT": "Malta", "MU": "Mauritius", "MV": "Maldives",
  "NF": "Norfolk Island", "NR": "Nauru", "NU": "Niue", "PF": "French Polynesia",
  "PM": "Saint Pierre and Miquelon", "PN": "Pitcairn", "PW": "Palau", "RE": "Réunion",
  "SC": "Seychelles", "SH": "Saint Helena", "SJ": "Svalbard", "SM": "San Marino",
  "SO": "Somalia", "CY": "Cyprus", "RS": "Serbia",
  "ST": "São Tomé and Príncipe", "SV": "El Salvador", "SX": "Sint Maarten",
  "TC": "Turks and Caicos", "TK": "Tokelau", "TO": "Tonga", "TV": "Tuvalu",
  "UM": "U.S. Minor Outlying Islands", "VA": "Vatican City", "VC": "Saint Vincent and the Grenadines",
  "VG": "British Virgin Islands", "VI": "U.S. Virgin Islands", "WF": "Wallis and Futuna",
  "WS": "Samoa", "YT": "Mayotte",
};

// Sorted list of country names for search
const COUNTRY_NAMES_SORTED = Object.keys(NAME_TO_ALPHA2).sort();

export interface CountryStats {
  [countryCode: string]: {
    occurrences: number;
    species: number;
    outdated?: number;
  };
}

// Linear gradient for % outdated: green (0%) -> amber (50%) -> red (100%).
// Unlike the species/occurrence heatmap, % is already bounded and roughly
// uniformly distributed, so a plain linear scale (no log) keeps countries
// distinguishable across the full range instead of clumping most into one bucket.
function getOutdatedColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  const green: [number, number, number] = [34, 197, 94]; // #22c55e
  const amber: [number, number, number] = [234, 179, 8]; // #eab308
  const red: [number, number, number] = [239, 68, 68]; // #ef4444
  const [from, to, t] = p <= 50 ? [green, amber, p / 50] : [amber, red, (p - 50) / 50];
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
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

type ColorMode = "species" | "occurrences" | "outdated";

const ALL_TAXA_IDS = ["mammals", "birds", "reptiles", "amphibians", "fishes", "invertebrates", "plantae", "fungi"];

interface WorldMapProps {
  selectedCountries: Set<string>;
  onCountrySelect: (countryCode: string, countryName: string, event: React.MouseEvent) => void;
  selectedTaxon?: string | null;
  // Optional pre-computed stats (for Red List species counts - avoids API call)
  precomputedStats?: CountryStats;
  // Same shape as precomputedStats, but with no filters applied beyond taxon/
  // subgroup selection — the "true total" shown in the tooltip alongside the
  // (possibly filtered) precomputedStats count, so e.g. "100% outdated" while
  // the Outdated filter is on doesn't read as a fact about the country.
  precomputedStatsTotal?: CountryStats;
  // Which taxa are selected (determines which GBIF occurrence stats to fetch)
  selectedTaxa?: Set<string>;
  // Label for the species count in tooltips (default: "# Assessed")
  speciesLabel?: string;
  // Callback when a region is selected from the dropdown (sets country filter)
  onRegionFilter?: (region: string) => void;
  // Whether the "endemics only" filter is active (single-country species)
  endemicsOnly?: boolean;
  // Callback to toggle the endemics-only filter
  onEndemicsToggle?: () => void;
  // Optional footer content rendered inside the panel below the map
  footer?: React.ReactNode;
  // Whether to show the Species/GBIF color mode toggle (only accurate for top-level taxa)
  showGbifToggle?: boolean;
  // Whether the "% Outdated" color mode is meaningful (false for unassessed/NE species views,
  // where every species has no assessment date rather than an outdated one)
  showOutdatedMode?: boolean;
  // Whether to show the color-mode <select> at all (species/outdated/GBIF) — false
  // for new-assessments/NE views, where it's not just missing its "% Outdated"
  // option but pointless outright: color-coding a map of species that are all,
  // definitionally, unassessed conveys nothing. Independent of showGbifToggle/
  // showOutdatedMode (which only control which OPTIONS appear once shown).
  showColorModeDropdown?: boolean;
  // Map/List toggle + list-view sort, URL-synced (see useFilterParams.ts's
  // mapViewMode/mapSortKey/mapSortDirection) so a sorted list view is a
  // shareable link. Falls back to local state when omitted (e.g. tests).
  mapViewMode?: MapViewMode;
  onMapViewModeChange?: (mode: MapViewMode) => void;
  mapSortKey?: MapSortKey;
  mapSortDirection?: "asc" | "desc";
  onMapSortChange?: (key: MapSortKey, direction: "asc" | "desc") => void;
  // When true, hovering a country calls onCountryHover (in addition to the
  // tooltip), so e.g. the country-view landing page's table can preview a
  // country as you scan the map rather than requiring a click. Deliberately
  // separate from onCountrySelect/onClick — hover previews, it doesn't
  // select, so the caller can keep its real (locked-in) selection state
  // untouched by mouse movement. Default false — the other WorldMap usages
  // (Charts row 2's country filter, the CITES map) still expect click-to-
  // select only.
  selectOnHover?: boolean;
  // Called with the hovered country's code on mouseenter, and null on
  // mouseleave, only while selectOnHover is true.
  onCountryHover?: (countryCode: string | null) => void;
}

const DEFAULT_CENTER: [number, number] = [10, 10];
const DEFAULT_ZOOM = 1.0;
const MIN_ZOOM = 1.0;
const MAX_ZOOM = 8.0;

function WorldMap({ selectedCountries, onCountrySelect, selectedTaxon, precomputedStats, precomputedStatsTotal, selectedTaxa, speciesLabel = "# Assessed", onRegionFilter, endemicsOnly = false, onEndemicsToggle, footer, showGbifToggle = true, showOutdatedMode = true, showColorModeDropdown = true, mapViewMode, onMapViewModeChange, mapSortKey, mapSortDirection, onMapSortChange, selectOnHover = false, onCountryHover }: WorldMapProps) {
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [hoveredCountryCode, setHoveredCountryCode] = useState<string | null>(null);
  const [speciesStats, setSpeciesStats] = useState<CountryStats>(precomputedStats || {});
  const [occurrenceStats, setOccurrenceStats] = useState<CountryStats | null>(null);
  const [loading, setLoading] = useState(!precomputedStats);
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("species");
  // Falls back to local state when uncontrolled (mapViewMode/onMapViewModeChange
  // omitted) — see the same pattern for sort just below.
  const [localViewMode, setLocalViewMode] = useState<MapViewMode>("map");
  const viewMode = mapViewMode ?? localViewMode;
  const setViewMode = onMapViewModeChange ?? setLocalViewMode;
  const [localSortKey, setLocalSortKey] = useState<MapSortKey>("species");
  const [localSortDir, setLocalSortDir] = useState<"asc" | "desc">("desc");
  const sortKey = mapSortKey ?? localSortKey;
  const sortDir = mapSortDirection ?? localSortDir;
  const setSort = useCallback(
    (key: MapSortKey, dir: "asc" | "desc") => {
      if (onMapSortChange) onMapSortChange(key, dir);
      else { setLocalSortKey(key); setLocalSortDir(dir); }
    },
    [onMapSortChange]
  );

  // Reset to species mode if GBIF is hidden while it's the active mode
  // (Species and % Outdated stay available regardless of showGbifToggle,
  // since unlike GBIF occurrence counts they already reflect active filters.)
  useEffect(() => {
    setColorMode(mode => {
      if (mode === "occurrences" && !showGbifToggle) return "species";
      if (mode === "outdated" && !showOutdatedMode) return "species";
      return mode;
    });
  }, [showGbifToggle, showOutdatedMode]);

  // Zoom & pan state
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Country search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return COUNTRY_NAMES_SORTED.filter(name => name.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery]);

  const handleZoomToCountry = useCallback((countryName: string) => {
    const coords = centroidsRef.current[countryName];
    if (coords) {
      setCenter(coords);
      // Zoom level depends on country size - small countries zoom more
      const smallCountries = new Set(["Singapore", "Luxembourg", "Cyprus", "Jamaica", "Trinidad and Tobago", "Brunei", "Qatar", "Kuwait", "Lebanon", "Djibouti", "eSwatini", "Lesotho", "Gambia", "Guinea-Bissau", "Slovenia", "Montenegro", "Kosovo", "Macedonia", "Andorra", "Antigua and Barb.", "Bahrain", "Barbados", "Belize", "Cabo Verde", "Comoros", "Dominica", "Grenada", "Kiribati", "Liechtenstein", "Maldives", "Malta", "Marshall Is.", "Mauritius", "Micronesia", "Monaco", "Nauru", "Palau", "Samoa", "San Marino", "São Tomé and Principe", "Seychelles", "St. Kitts and Nevis", "Saint Lucia", "St. Vin. and Gren.", "Tonga", "Tuvalu", "Vatican", "American Samoa", "Anguilla", "Aruba", "Bermuda", "British Virgin Is.", "Cayman Is.", "Curaçao", "Faeroe Is.", "Guernsey", "Hong Kong", "Isle of Man", "Jersey", "Macao", "Montserrat", "N. Mariana Is.", "Niue", "Norfolk Island", "Pitcairn Is.", "Saint Helena", "Sint Maarten", "St-Barthélemy", "St-Martin", "St. Pierre and Miquelon", "Turks and Caicos Is.", "U.S. Virgin Is.", "Wallis and Futuna Is.", "Åland", "N. Cyprus"]);
      const largeCountries = new Set(["Russia", "Canada", "United States of America", "China", "Brazil", "Australia", "India", "Argentina"]);
      // Small-country zoom capped lower than it used to be (was 6) — at 6 a
      // small island could fill the whole visible frame, right where the
      // bottom-left Map/List toggle and bottom-right zoom controls overlay it.
      const zoomLevel = smallCountries.has(countryName) ? 4.5 : largeCountries.has(countryName) ? 2.5 : 4;
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

  // Prevent trackpad zoom/scroll from zooming the whole page when over the map
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
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

  // Centroids computed from TopoJSON geometries (computed once on first render)
  const centroidsRef = useRef<Record<string, [number, number]>>({});

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

  // Active stats for coloring based on mode ("outdated" reuses the species stats,
  // since outdated counts are computed alongside species counts, not fetched separately)
  const activeStats = colorMode === "occurrences" ? (occurrenceStats || {}) : speciesStats;

  // Which region (if any) is currently selected as a whole — shared by the
  // region <select>'s own value (below) and the list view (which narrows its
  // rows to this region, same as the map already implicitly does via the blue
  // highlight over the whole region's shapes). See matchingRegion's own doc
  // comment for exactly what "as a whole" means.
  const activeRegion = useMemo(() => matchingRegion(selectedCountries) ?? "", [selectedCountries]);

  // Calculate max value for heatmap scaling (unused in "outdated" mode, which uses a fixed 0-100% gradient)
  const maxValue = Object.values(activeStats).reduce(
    (max, stat) => Math.max(max, colorMode === "species" ? stat.species : stat.occurrences),
    0
  );

  const getCountryColor = (alpha2: string | undefined, isSelected: boolean): string => {
    if (isSelected) return "#3b82f6"; // blue-500 for selected
    if (!alpha2) return "#f4f4f5";

    const stats = activeStats[alpha2];
    if (!stats) return "#f4f4f5";

    if (colorMode === "outdated") {
      if (!stats.species) return "#f4f4f5";
      return getOutdatedColor(((stats.outdated || 0) / stats.species) * 100);
    }

    const value = colorMode === "species" ? stats.species : stats.occurrences;
    return getHeatmapColor(value, maxValue);
  };

  const hoveredSpeciesStats = hoveredCountryCode ? speciesStats[hoveredCountryCode] : null;
  const hoveredTotalStats = hoveredCountryCode ? precomputedStatsTotal?.[hoveredCountryCode] : null;
  const hoveredOccurrenceStats = hoveredCountryCode && occurrenceStats ? occurrenceStats[hoveredCountryCode] : null;

  return (
    <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-3 h-full flex flex-col">
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0">
          Country
        </h2>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
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
          {/* Color mode: Species and % Outdated are always accurate; GBIF only when
              no extra filters are active (its counts aren't filterable per-country).
              Only meaningful for the choropleth itself — hidden in List view, which
              shows every column directly rather than color-coding by just one. */}
          {viewMode === "map" && showColorModeDropdown && (
            <select
              value={colorMode}
              onChange={(e) => setColorMode(e.target.value as ColorMode)}
              className="text-[10px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="species">{speciesLabel}</option>
              {showOutdatedMode && <option value="outdated">% Outdated</option>}
              {showGbifToggle && <option value="occurrences"># GBIF Obs</option>}
            </select>
          )}
          {onEndemicsToggle && (
            <button
              onClick={onEndemicsToggle}
              title="Show only species endemic to a single country"
              aria-pressed={endemicsOnly}
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors border ${
                endemicsOnly
                  ? "bg-teal-500 text-white border-teal-500 shadow-sm"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              Endemics
            </button>
          )}
          {onRegionFilter && (
            <select
              value={activeRegion}
              onChange={(e) => onRegionFilter(e.target.value)}
              className="text-[10px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[96px] truncate"
            >
              <option value="">All Regions</option>
              {IUCN_REGION_ORDER.map(region => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Hover tooltip (map view only) */}
      {viewMode === "map" && hoveredCountry && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 bg-white dark:bg-zinc-800 px-3 py-2 rounded-lg shadow-lg text-sm text-zinc-700 dark:text-zinc-300 pointer-events-none border border-zinc-200 dark:border-zinc-700 min-w-[140px]">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">{hoveredCountry}</div>
          {hoveredSpeciesStats || hoveredOccurrenceStats ? (
            <div className="mt-1 space-y-0.5">
              {hoveredSpeciesStats && (
                <div className="flex justify-between gap-4 text-xs">
                  <span className="text-zinc-500">{speciesLabel}</span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">
                    {formatNumber(hoveredSpeciesStats.species)}
                    {/* Filters (e.g. Outdated, a category) can narrow this below the country's
                        true total — show that total too so the count doesn't read as absolute. */}
                    {hoveredTotalStats && hoveredTotalStats.species !== hoveredSpeciesStats.species && (
                      <span className="text-zinc-400 font-normal"> (of {formatNumber(hoveredTotalStats.species)})</span>
                    )}
                  </span>
                </div>
              )}
              {showOutdatedMode && hoveredSpeciesStats && hoveredSpeciesStats.species > 0 && (
                <>
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-zinc-500"># Outdated</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">
                      {formatNumber(hoveredSpeciesStats.outdated || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-zinc-500">% Outdated</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">
                      {(((hoveredSpeciesStats.outdated || 0) / hoveredSpeciesStats.species) * 100).toFixed(1)}%
                    </span>
                  </div>
                </>
              )}
              {showGbifToggle && (
              <div className="flex justify-between gap-4 text-xs">
                <span className="text-zinc-500"># GBIF Obs</span>
                {occurrenceLoading ? (
                  <span className="text-zinc-400 tabular-nums">...</span>
                ) : hoveredOccurrenceStats ? (
                  <span className="font-medium text-zinc-700 dark:text-zinc-300 tabular-nums">{formatNumber(hoveredOccurrenceStats.occurrences)}</span>
                ) : (
                  <span className="text-zinc-400 tabular-nums">{colorMode === "occurrences" ? "..." : "—"}</span>
                )}
              </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-zinc-400 mt-1">No data available</div>
          )}
        </div>
      )}

      {/* List view: sortable table alternative, same stats/selection/click-through.
          Narrowed to activeRegion's countries when a whole region is selected —
          same scope the map already implies via its blue region highlight.
          Shares this relative wrapper with the map below (rather than each
          having its own) so the Map/List toggle can overlay bottom-left of
          whichever one is actually showing. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      {viewMode === "list" && (
        <CountryStatsList
          stats={activeStats}
          selectedCountries={selectedCountries}
          onCountrySelect={onCountrySelect}
          speciesLabel={speciesLabel}
          showOutdatedMode={showOutdatedMode}
          regionFilter={activeRegion || null}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={setSort}
        />
      )}

      {/* Map */}
      <div className={viewMode === "list" ? "hidden" : "flex-1 rounded-lg overflow-hidden relative"} ref={mapContainerRef} style={{ minHeight: "200px", touchAction: "none" }}>
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
            scale: 140,
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
              {({ geographies }) => {
                // Compute centroids from geometry on first load
                /* eslint-disable react-hooks/immutability -- one-time cache populated from render callback data */
                if (Object.keys(centroidsRef.current).length === 0) {
                  for (const geo of geographies) {
                    const name = geo.properties.name;
                    if (name && name !== "Antarctica") {
                      const [lng, lat] = geoCentroid(geo);
                      centroidsRef.current[name] = [lng, lat];
                    }
                  }
                }
                /* eslint-enable react-hooks/immutability */
                return geographies
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
                        if (selectOnHover && alpha2) {
                          onCountryHover?.(alpha2);
                        }
                      }}
                      onMouseLeave={() => {
                        setHoveredCountry(null);
                        setHoveredCountryCode(null);
                        // Unconditional (not gated on selectOnHover, unlike
                        // onMouseEnter above) — self-heals a stale preview
                        // left over from before a country got locked in, so
                        // it can't resurface later if the lock is cleared.
                        onCountryHover?.(null);
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
                });
              }}
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
        {/* Zoom controls */}
        <div className="absolute bottom-2 right-2 flex flex-col gap-1 z-10">
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
        </div>
      </div>
      {/* Map/List toggle — a sortable table alternative to the choropleth for
          users who'd rather scan/sort a list than read a map. Bottom-left,
          overlaying whichever of the two is currently showing (see the shared
          relative wrapper above), mirroring the zoom controls' bottom-right spot. */}
      <div className="absolute bottom-2 left-2 z-10 flex items-center bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md p-0.5 text-[10px] shadow-sm">
        {(["map", "list"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            aria-pressed={viewMode === mode}
            className={`px-1.5 py-0.5 rounded capitalize transition-colors ${
              viewMode === mode
                ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
      </div>
      {footer}
    </div>
  );
}

export default memo(WorldMap);
