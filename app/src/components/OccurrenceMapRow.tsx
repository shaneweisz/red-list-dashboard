"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import type { MapRef, ViewStateChangeEvent, MapLayerMouseEvent } from "react-map-gl/maplibre";
import type maplibregl from "maplibre-gl";
import { mapTaxonId } from "@/lib/data/taxonomy-constants";
import { InatObservation, getThumbUrl, InatPhotoWithPreview } from "./InatPhotoCard";
import { QualityFlag, QUALITY_FLAG_LABELS, QUALITY_FLAG_DESCRIPTIONS, QUALITY_FLAG_SOURCES } from "@/lib/coordinate-cleaning";
import { FaInfoCircle } from "react-icons/fa";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, Polygon, MultiPolygon } from "geojson";

// Fixed page size for iNat photo grid (2 columns x 5 rows)
const INAT_PAGE_SIZE = 10;

// Dynamically import MapLibre GL components
const MapGL = dynamic(
  () => import("react-map-gl/maplibre").then((mod) => mod.Map),
  { ssr: false }
);
const Source = dynamic(
  () => import("react-map-gl/maplibre").then((mod) => mod.Source),
  { ssr: false }
);
const Layer = dynamic(
  () => import("react-map-gl/maplibre").then((mod) => mod.Layer),
  { ssr: false }
);
const MapLibreMarker = dynamic(
  () => import("react-map-gl/maplibre").then((mod) => mod.Marker),
  { ssr: false }
);
const ScaleControl = dynamic(
  () => import("react-map-gl/maplibre").then((mod) => mod.ScaleControl),
  { ssr: false }
);
const MapImageTooltip = dynamic(
  () => import("./MapImageTooltip"),
  { ssr: false }
);
const MapOccurrenceTooltip = dynamic(
  () => import("./MapOccurrenceTooltip"),
  { ssr: false }
);
const RangeMapLayer = dynamic(
  () => import("./RangeMapLayer"),
  { ssr: false }
);
const AohMapLayer = dynamic(
  () => import("./AohMapLayer"),
  { ssr: false }
);

// Shape of coordinate-cleaning-refdata/countries.json (Natural Earth admin-0
// country polygons, keyed by ISO 3166-1 alpha-2), dynamically imported for the
// POWO/IUCN native-range overlays.
interface CountryPolygon {
  iso_a2: string;
  polygon: GeoJSON.Polygon;
}

interface OccurrenceFeature {
  type: "Feature";
  properties: {
    gbifID: number;
    species: string;
    eventDate?: string;
    country?: string;
    countryCode?: string;
    basisOfRecord?: string;
    datasetKey?: string;
    datasetName?: string;
    publishingOrgKey?: string;
    coordinateUncertaintyInMeters?: number | null;
    year?: number | null;
    month?: number | null;
    institutionCode?: string;
    qualityFlags?: string[];
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

// Uncertainty filter options (meters)
const UNCERTAINTY_OPTIONS = [
  { label: "Any", value: null },
  { label: "\u2264 10m", value: 10 },
  { label: "\u2264 100m", value: 100 },
  { label: "\u2264 1km", value: 1000 },
  { label: "\u2264 10km", value: 10000 },
  { label: "\u2264 50km", value: 50000 },
] as const;

// Format a meters value for display, e.g. in the custom-uncertainty badge
function formatUncertainty(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)}km`;
  }
  return `${meters}m`;
}

// Basemap style options for MapLibre GL
function makeRasterStyle(tileUrl: string, attribution: string): maplibregl.StyleSpecification {
  return {
    version: 8 as const,
    sources: {
      basemap: {
        type: "raster" as const,
        tiles: [tileUrl],
        tileSize: 256,
        attribution,
      },
    },
    layers: [
      {
        id: "basemap-layer",
        type: "raster" as const,
        source: "basemap",
      },
    ],
  };
}
// Lazy import for maplibre-gl types
type MaplibreStyle = ReturnType<typeof makeRasterStyle>;
const BASEMAP_STYLES: Record<string, { label: string; style: MaplibreStyle }> = {
  streets: {
    label: "Streets",
    style: makeRasterStyle(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    ),
  },
  satellite: {
    label: "Satellite",
    style: makeRasterStyle(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      '&copy; <a href="https://www.esri.com">Esri</a> World Imagery'
    ),
  },
  terrain: {
    label: "Terrain",
    style: makeRasterStyle(
      "https://tile.opentopomap.org/{z}/{x}/{y}.png",
      '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    ),
  },
};
type BasemapKey = keyof typeof BASEMAP_STYLES;

// Protected areas overlay — the World Database on Protected Areas (WDPA),
// UNEP-WCMC & IUCN (the dataset behind protectedplanet.net, refreshed monthly).
// Served straight from UNEP-WCMC's ArcGIS MapServer `export` endpoint as a
// transparent PNG, which MapLibre fetches per-tile via the {bbox-epsg-3857}
// token. Drawn semi-transparently beneath the occurrence points so you can see
// at a glance which occurrences fall inside a protected area. No API key needed.
const PROTECTED_AREAS_TILE_URL =
  "https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer/export" +
  "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&format=png32&transparent=true&f=image";
const PROTECTED_AREAS_ATTRIBUTION =
  '<a href="https://www.protectedplanet.net" target="_blank" rel="noopener noreferrer">WDPA</a> &copy; UNEP-WCMC &amp; IUCN';

/**
 * Determine whether an occurrence record is "new" (recorded after the assessment date).
 * Uses full date comparison when eventDate is available, falls back to year comparison.
 */
export function isAfterAssessment(
  eventDate: string | undefined | null,
  year: number | undefined | null,
  assessmentDate: string | undefined | null,
  assessmentYear: number | undefined | null,
): boolean {
  if (!assessmentDate) return true;
  if (eventDate) {
    return new Date(eventDate) > new Date(assessmentDate);
  }
  if (year != null && assessmentYear != null) {
    return year > assessmentYear;
  }
  return false;
}

// Convert an eventDate string (or year-only) to a numeric value for interpolation
function dateToNumeric(eventDate?: string | null, year?: number | null): number | null {
  if (eventDate) {
    const ts = new Date(eventDate).getTime();
    if (!isNaN(ts)) return ts;
  }
  if (year != null) return new Date(year, 0, 1).getTime();
  return null;
}

// Fixed absolute color scale so the same year always maps to the same color
// across all species. Simple continuous hue gradient: orange-red(20) → green(130).
// Anchored so that the last ~20 years span the full visible range.
const COLOR_SCALE_MIN_YEAR = new Date().getFullYear() - 20;
const COLOR_SCALE_MAX_YEAR = new Date().getFullYear();
const COLOR_SCALE_MIN_TS = new Date(COLOR_SCALE_MIN_YEAR, 0, 1).getTime();
const COLOR_SCALE_MAX_TS = new Date(COLOR_SCALE_MAX_YEAR, 0, 1).getTime();

// Date-based color interpolation — continuous hue gradient
function dateToColor(dateNum: number): { stroke: string; fill: string } {
  // Clamp to range; anything older than 20 years gets the orange-red color
  const t = Math.max(0, Math.min(1, (dateNum - COLOR_SCALE_MIN_TS) / (COLOR_SCALE_MAX_TS - COLOR_SCALE_MIN_TS)));
  // Hue: 20 (orange-red) → 130 (green)
  const hue = Math.round(20 + t * 110);
  return {
    stroke: `hsl(${hue}, 75%, 30%)`,
    fill: `hsl(${hue}, 75%, 50%)`,
  };
}

// Classify an occurrence into one of the basis-of-record checkbox categories.
function classifyOccurrence(o: OccurrenceFeature): string {
  const basis = o.properties.basisOfRecord;
  if (basis === "HUMAN_OBSERVATION") return "humanObservation";
  if (basis === "MACHINE_OBSERVATION") return "machineObservation";
  if (basis === "OBSERVATION") return "observation";
  if (basis === "PRESERVED_SPECIMEN") return "preservedSpecimen";
  if (basis === "FOSSIL_SPECIMEN") return "fossilSpecimen";
  if (basis === "LIVING_SPECIMEN") return "livingSpecimen";
  if (basis === "MATERIAL_SAMPLE") return "materialSample";
  if (basis === "MATERIAL_CITATION") return "materialCitation";
  if (basis === "OCCURRENCE") return "occurrence";
  return "observation"; // fallback
}

// Inverse of classifyOccurrence — the GBIF basisOfRecord value to filter
// /api/occurrences by when loading more of just this category.
const GBIF_BASIS_OF_RECORD: Record<string, string> = {
  humanObservation: "HUMAN_OBSERVATION",
  machineObservation: "MACHINE_OBSERVATION",
  observation: "OBSERVATION",
  preservedSpecimen: "PRESERVED_SPECIMEN",
  fossilSpecimen: "FOSSIL_SPECIMEN",
  livingSpecimen: "LIVING_SPECIMEN",
  materialSample: "MATERIAL_SAMPLE",
  materialCitation: "MATERIAL_CITATION",
  occurrence: "OCCURRENCE",
};

// How many additional records to fetch per "Load more" click on a Basis of Record row.
const BASIS_OF_RECORD_LOAD_MORE_BATCH = 200;

interface RecordTypeBreakdown {
  humanObservation: number;
  machineObservation: number;
  observation: number;
  preservedSpecimen: number;
  fossilSpecimen: number;
  livingSpecimen: number;
  materialSample: number;
  materialCitation: number;
  occurrence: number;
  iNaturalist: number;
  recentInatObservations?: InatObservation[];
  inatTotalCount?: number;
  total?: number;
}

interface OccurrenceMapRowProps {
  speciesKey: number;
  countryCode?: string | null;
  mounted: boolean;
  assessmentYear?: number | null;
  assessmentDate?: string | null;
  assessmentId?: number | null;
  sisTaxonId?: number | null;
  /** CSV taxon group (e.g. "flowering_plants", "mushrooms") — used to default
   * preserved specimens ON for plants & fungi, where herbarium/fungarium
   * records are a core data source. */
  taxonGroup?: string;
  /** This species' scientific name — used to look up its POWO/WCVP native range. */
  scientificName?: string;
  /** This species' native-range countries (ISO 3166-1 alpha-2), per its IUCN Red
   * List assessment's locations (already filtered to origin="Native" upstream in
   * scripts/fetch-redlist-species.ts) — the "Red List" native-range source. */
  nativeCountriesRedList?: string[];
  /** Called once the occurrence data has loaded and there are no records to show,
   * letting the parent fall back to another tab (e.g. Catalogue of Life). */
  onEmpty?: () => void;
}

/**
 * Plants & fungi rely heavily on herbarium/fungarium specimens in GBIF, so
 * preserved specimens should be ON by default for those kingdoms.
 */
export function isPlantOrFungiTaxonGroup(taxonGroup: string | undefined): boolean {
  if (!taxonGroup) return false;
  const kingdom = mapTaxonId(taxonGroup);
  return kingdom === "plantae" || kingdom === "fungi";
}

/**
 * Vascular plants only — the taxonomic scope WCVP/POWO actually covers (not
 * mosses, algae, or fungi), used to gate the "POWO" native-range source fetch.
 */
export function isVascularPlantTaxonGroup(taxonGroup: string | undefined): boolean {
  return taxonGroup === "flowering_plants" || taxonGroup === "gymnosperms" || taxonGroup === "ferns_and_allies";
}

/**
 * True if this occurrence's reported country falls outside the species' native
 * range (its IUCN Red List assessment's country list, already Native-only).
 * Records with no reported country, or species with no native-range data at
 * all, can't be checked and are never flagged — same "nothing to contradict"
 * logic as isOutsideReportedCountry in coordinate-cleaning.ts.
 */
export function isOutsideNativeRange(
  countryCode: string | null | undefined,
  nativeCountries: readonly string[] | undefined,
): boolean {
  if (!countryCode || !nativeCountries || nativeCountries.length === 0) return false;
  const upper = countryCode.toUpperCase();
  return !nativeCountries.some((c) => c.toUpperCase() === upper);
}

export default function OccurrenceMapRow({
  speciesKey,
  countryCode,
  mounted,
  assessmentYear,
  assessmentDate,
  assessmentId,
  sisTaxonId,
  taxonGroup,
  scientificName,
  nativeCountriesRedList,
  onEmpty,
}: OccurrenceMapRowProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceFeature[]>([]);
  const [breakdown, setBreakdown] = useState<RecordTypeBreakdown | null>(null);
  const [loadingOccurrences, setLoadingOccurrences] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);

  // Checkbox state for each observation type category (default: all checked except specimens, citations & occurrence)
  const [checkedTypes, setCheckedTypes] = useState({
    humanObservation: true,
    machineObservation: true,
    observation: false,
    preservedSpecimen: isPlantOrFungiTaxonGroup(taxonGroup),
    fossilSpecimen: false,
    livingSpecimen: false,
    materialSample: true,
    materialCitation: false,
    occurrence: false,
  });

  // Advanced filter state
  const [maxUncertainty, setMaxUncertainty] = useState<number | null>(null);
  // Custom max-uncertainty entry, shown instead of the preset <select> when active
  const [customUncertaintyMode, setCustomUncertaintyMode] = useState(false);
  const [customUncertaintyInput, setCustomUncertaintyInput] = useState("");
  // Coordinate-cleaning checks (zero/equal coords, GBIF HQ, duplicates — see
  // src/lib/coordinate-cleaning.ts), individually toggleable. Default all off —
  // opt-in, since these are plausibility heuristics with real false-positive risk
  // (documented per-check), not the same as GBIF's own hasGeospatialIssue=false
  // parsing-error filter, which stays on unconditionally upstream of this. Zero/
  // null-island coordinates are the one exception — there's no plausible reading
  // of (0,0) or an axis-zero point as a real location, so it's on by default.
  const [appliedChecks, setAppliedChecks] = useState<Record<QualityFlag, boolean>>({
    ZERO_COORDINATE: true,
    EQUAL_COORDINATES: false,
    GBIF_HEADQUARTERS: false,
    DUPLICATE: false,
    NEAR_CAPITAL: false,
    NEAR_CENTROID: false,
    NEAR_INSTITUTION: false,
    OCEAN: false,
    URBAN_AREA: false,
    ARTIFICIAL_HOTSPOT: false,
    OUTSIDE_REPORTED_COUNTRY: false,
  });
  // Native range only — hide occurrences reported in a country outside this
  // species' native range. Off by default (folded into the Coordinate cleaning
  // dropdown below as an opt-in check, same as every other check there).
  const [nativeRangeOnly, setNativeRangeOnly] = useState(false);
  // Which native-range source backs the filter above. Defaults to "wcvp" (POWO)
  // — the source issue #82 originally asked for by name — falling back to the
  // Red List assessment's own locations when this species has no WCVP match.
  // The two sources can genuinely disagree (e.g. Acorus calamus: WCVP treats it
  // as native only to Kazakhstan, everywhere else — including the Red List
  // assessment's own 26-country list — as introduced), which is why both are
  // offered rather than picking one as canonical.
  const [nativeRangeSource, setNativeRangeSource] = useState<"redlist" | "wcvp">("wcvp");
  const [nativeCountriesWcvp, setNativeCountriesWcvp] = useState<string[] | null>(null);
  // This species' accepted-taxon POWO/IPNI id (from the WCVP fetch), for linking
  // out to its real POWO page — see the "POWO native range" overlay's info icon.
  const [wcvpPowoId, setWcvpPowoId] = useState<string | null>(null);
  const [loadingWcvpRange, setLoadingWcvpRange] = useState(false);
  const [colorByDate, setColorByDate] = useState(true);
  const [basemap, setBasemap] = useState<BasemapKey>("streets");
  // Overlays — informational map layers, independent of the "Native range only"
  // occurrence filter above: shading which countries a source considers native,
  // regardless of whether occurrences are being filtered by it.
  const [showProtectedAreas, setShowProtectedAreas] = useState(false);
  const [showPowoRangeOverlay, setShowPowoRangeOverlay] = useState(false);
  const [showIucnRangeOverlay, setShowIucnRangeOverlay] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [splitDate, setSplitDate] = useState<string>(assessmentDate?.split("T")[0] || "");
  const [sharedViewState, setSharedViewState] = useState({ longitude: 0, latitude: 20, zoom: 1.5 });
  const mapRef = useRef<MapRef>(null);
  // Initial fetch size — no longer user-adjustable; loading more of a specific
  // basis-of-record category is handled by loadMoreForCategory below instead.
  const sampleSize = 300;

  // GBIF points toggle (on by default)
  const [showGbif, setShowGbif] = useState(true);

  // Range map layer state
  const [showRange, setShowRange] = useState(false);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeNotFound, setRangeNotFound] = useState(false);
  const [rangeCategories, setRangeCategories] = useState<import("./RangeMapLayer").RangeCategory[]>([]);
  const [visibleCategories, setVisibleCategories] = useState<Set<string> | undefined>(undefined);
  const [rangeCategoriesExpanded, setRangeCategoriesExpanded] = useState(false);
  const [rangeSimplification, setRangeSimplification] = useState<import("./RangeMapLayer").SimplificationInfo | null>(null);
  // Currently-visible range polygons (post category-filtering), reported up from
  // RangeMapLayer — paired with filteredOccurrences below to compute the
  // in-range/out-of-range breakdown shown in the corner stats table.
  const [rangePolygons, setRangePolygons] = useState<Feature[] | null>(null);

  // AOH layer state
  const isAohAvailable = !!(sisTaxonId && taxonGroup &&
    ["mammalia", "aves", "reptilia", "amphibia"].includes(taxonGroup.toLowerCase()));
  const [showAoh, setShowAoh] = useState(false);
  const [aohLoading, setAohLoading] = useState(false);

  // Filters dropdown state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  // Coordinate-cleaning checks dropdown state
  const [cleaningFilterOpen, setCleaningFilterOpen] = useState(false);
  const cleaningFilterRef = useRef<HTMLDivElement>(null);

  // Overlays dropdown state (Protected areas / POWO native range / IUCN native range)
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const overlaysRef = useRef<HTMLDivElement>(null);

  // Fixed page size for filmstrip
  const pageSize = INAT_PAGE_SIZE;

  // iNat photos pagination
  const [inatPage, setInatPage] = useState(0);
  const [inatPhotos, setInatPhotos] = useState<InatObservation[]>([]);
  const [inatTotalCount, setInatTotalCount] = useState(0);
  const [loadingInatPhotos, setLoadingInatPhotos] = useState(false);

  // Close filters popover on outside click
  useEffect(() => {
    if (!filtersOpen) return;
    const handler = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filtersOpen]);

  // Close coordinate-cleaning popover on outside click
  useEffect(() => {
    if (!cleaningFilterOpen) return;
    const handler = (e: MouseEvent) => {
      if (cleaningFilterRef.current && !cleaningFilterRef.current.contains(e.target as Node)) {
        setCleaningFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [cleaningFilterOpen]);

  // Close overlays popover on outside click
  useEffect(() => {
    if (!overlaysOpen) return;
    const handler = (e: MouseEvent) => {
      if (overlaysRef.current && !overlaysRef.current.contains(e.target as Node)) {
        setOverlaysOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overlaysOpen]);

  // Hovered iNat observation (for map highlight)
  const [hoveredObs, setHoveredObs] = useState<InatObservation | null>(null);

  // Hovered occurrence on map (for hover tooltip)
  const [hoveredFeature, setHoveredFeature] = useState<OccurrenceFeature | null>(null);
  const [hoveredPanel, setHoveredPanel] = useState<string | null>(null);

  // Touch-only device detection (no hover tooltips on touch-only devices)
  // Check for coarse pointer (phone/tablet) rather than maxTouchPoints which is true on Mac trackpads
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    setIsTouchDevice(window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches);
  }, []);

  // Lookup: gbifID → InatObservation (for showing photos in map popups)
  const inatPhotosByGbifId = useMemo(() => {
    const m = new Map<number, InatObservation>();
    for (const obs of inatPhotos) {
      if (obs.gbifID) m.set(obs.gbifID, obs);
    }
    return m;
  }, [inatPhotos]);

  // Total occurrences count (from API metadata)
  const [totalOccurrences, setTotalOccurrences] = useState<number | null>(null);
  // Bounding box from API: [minLon, minLat, maxLon, maxLat]
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);

  // Fetch occurrences (re-fetches when sample size changes)
  useEffect(() => {
    setLoadingOccurrences(true);
    const params = new URLSearchParams({
      speciesKey: speciesKey.toString(),
      limit: sampleSize.toString(),
    });
    if (countryCode) {
      params.set("country", countryCode);
    }
    fetch(`/api/occurrences?${params}`)
      .then((res) => res.json())
      .then((data) => {
        const features = data.features || [];
        setOccurrences(features);
        setTotalOccurrences(data.metadata?.total ?? null);
        setBbox(data.metadata?.bbox ?? null);
      })
      .catch(console.error)
      .finally(() => setLoadingOccurrences(false));
  }, [speciesKey, countryCode, sampleSize]);

  // Basis-of-record category currently fetching more records, if any (drives the
  // per-row "Load more" spinner/disabled state in the dropdown).
  const [loadingMoreCategory, setLoadingMoreCategory] = useState<string | null>(null);

  // Load another batch of just one basis-of-record category (e.g. "load 200 more
  // Preserved specimen records"), independent of the overall sample-size selector —
  // that reloads everything and is dominated by whichever category is most numerous.
  // Offsets by how many of this category are already loaded, and de-dupes the merge
  // by gbifID since the untargeted main fetch and this filtered one aren't guaranteed
  // to line up by offset alone.
  const loadMoreForCategory = useCallback((key: string) => {
    const gbifBasis = GBIF_BASIS_OF_RECORD[key];
    if (!gbifBasis) return;
    setLoadingMoreCategory(key);
    const alreadyLoaded = occurrences.filter((o) => classifyOccurrence(o) === key).length;
    const params = new URLSearchParams({
      speciesKey: speciesKey.toString(),
      basisOfRecord: gbifBasis,
      limit: BASIS_OF_RECORD_LOAD_MORE_BATCH.toString(),
      offset: alreadyLoaded.toString(),
    });
    if (countryCode) {
      params.set("country", countryCode);
    }
    fetch(`/api/occurrences?${params}`)
      .then((res) => res.json())
      .then((data) => {
        const newFeatures: OccurrenceFeature[] = data.features || [];
        setOccurrences((prev) => {
          const seen = new Set(prev.map((o) => o.properties.gbifID));
          const toAdd = newFeatures.filter((f) => !seen.has(f.properties.gbifID));
          return [...prev, ...toAdd];
        });
      })
      .catch(console.error)
      .finally(() => setLoadingMoreCategory(null));
  }, [occurrences, speciesKey, countryCode]);

  // Fetch breakdown data
  useEffect(() => {
    setLoadingBreakdown(true);
    const params = new URLSearchParams();
    if (countryCode) {
      params.set("country", countryCode);
    }
    fetch(`/api/species/${speciesKey}/breakdown?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setBreakdown(data);
        setInatTotalCount(data.inatTotalCount || data.iNaturalist || 0);
      })
      .catch(console.error)
      .finally(() => setLoadingBreakdown(false));
  }, [speciesKey, countryCode]);

  // Fetch this species' POWO/WCVP native range (only meaningful for vascular
  // plants — WCVP doesn't cover mosses/algae/fungi/animals).
  useEffect(() => {
    if (!isVascularPlantTaxonGroup(taxonGroup) || !scientificName) {
      setNativeCountriesWcvp(null);
      setWcvpPowoId(null);
      return;
    }
    setLoadingWcvpRange(true);
    fetch(`/api/wcvp-native-range?name=${encodeURIComponent(scientificName)}`)
      .then((res) => res.json())
      .then((data) => {
        setNativeCountriesWcvp(data.countries ?? null);
        setWcvpPowoId(data.powoId ?? null);
      })
      .catch(console.error)
      .finally(() => setLoadingWcvpRange(false));
  }, [taxonGroup, scientificName]);

  // Once occurrences have loaded, tell the parent if GBIF (which includes iNat
  // records) returned nothing — so an unevaluated species with no occurrence data
  // can fall back to another tab (e.g. Catalogue of Life).
  useEffect(() => {
    if (!loadingOccurrences && totalOccurrences === 0) {
      onEmpty?.();
    }
  }, [loadingOccurrences, totalOccurrences, onEmpty]);

  // Fetch iNat photos for a given page
  const fetchInatPhotos = useCallback((page: number, limit: number) => {
    setLoadingInatPhotos(true);
    const params = new URLSearchParams({
      offset: (page * limit).toString(),
      limit: limit.toString(),
    });
    if (countryCode) {
      params.set("country", countryCode);
    }
    fetch(`/api/species/${speciesKey}/inat-photos?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.observations) {
          setInatPhotos(data.observations);
          if (data.totalCount) setInatTotalCount(data.totalCount);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingInatPhotos(false));
  }, [speciesKey, countryCode]);

  // Re-fetch when screen size changes (page size changes)
  useEffect(() => {
    // Reset to page 0 and re-fetch with new page size
    setInatPage(0);
    fetchInatPhotos(0, pageSize);
  }, [pageSize, fetchInatPhotos]);

  // Which native-country list actually backs the filter right now, per the
  // selected source. Only "wcvp" when this species has a real WCVP match —
  // there's nothing to fall back to silently, since the source picker itself
  // (below) is only ever shown once nativeCountriesWcvp is known to be non-empty.
  const effectiveNativeCountries = nativeRangeSource === "wcvp" ? (nativeCountriesWcvp ?? undefined) : nativeCountriesRedList;
  const hasNativeRangeData = (nativeCountriesRedList?.length ?? 0) > 0 || (nativeCountriesWcvp?.length ?? 0) > 0;
  const hasBothNativeRangeSources = (nativeCountriesRedList?.length ?? 0) > 0 && (nativeCountriesWcvp?.length ?? 0) > 0;

  // Country border polygons for the POWO/IUCN native-range overlays — loaded
  // lazily (dynamic import) only once one of those overlays is actually turned
  // on, so the ~1.7MB Natural Earth dataset never weighs down the initial
  // bundle for the (majority of) sessions that never open this dropdown.
  const [countryPolygons, setCountryPolygons] = useState<CountryPolygon[] | null>(null);
  useEffect(() => {
    if (!(showPowoRangeOverlay || showIucnRangeOverlay) || countryPolygons) return;
    import("@/lib/coordinate-cleaning-refdata/countries.json").then((mod) => {
      setCountryPolygons(mod.default as unknown as CountryPolygon[]);
    });
  }, [showPowoRangeOverlay, showIucnRangeOverlay, countryPolygons]);

  const buildRangeGeoJson = useCallback((countries: string[] | null | undefined): GeoJSON.FeatureCollection | null => {
    if (!countryPolygons || !countries || countries.length === 0) return null;
    const codes = new Set(countries.map((c) => c.toUpperCase()));
    const features = countryPolygons
      .filter((p) => codes.has(p.iso_a2))
      .map((p) => ({ type: "Feature" as const, properties: {}, geometry: p.polygon }));
    return { type: "FeatureCollection", features };
  }, [countryPolygons]);

  const powoRangeGeoJson = useMemo(() => buildRangeGeoJson(nativeCountriesWcvp), [buildRangeGeoJson, nativeCountriesWcvp]);
  const iucnRangeGeoJson = useMemo(() => buildRangeGeoJson(nativeCountriesRedList), [buildRangeGeoJson, nativeCountriesRedList]);

  // Multi-stage filtering pipeline
  const filteredOccurrences = useMemo(() => {
    let result = occurrences;
    // 1. Basis of record checkboxes
    result = result.filter((o) => checkedTypes[classifyOccurrence(o) as keyof typeof checkedTypes]);
    // 2. GPS uncertainty filter
    if (maxUncertainty != null) {
      result = result.filter((o) => {
        const u = o.properties.coordinateUncertaintyInMeters;
        return u != null && u <= maxUncertainty;
      });
    }
    // 3. Coordinate-cleaning checks (zero/equal coords, GBIF HQ, duplicates)
    result = result.filter((o) => !o.properties.qualityFlags?.some((f) => appliedChecks[f as QualityFlag]));
    // 4. Native range only — hide occurrences reported outside this species' native countries
    if (nativeRangeOnly) {
      result = result.filter((o) => !isOutsideNativeRange(o.properties.countryCode, effectiveNativeCountries));
    }
    return result;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks, nativeRangeOnly, effectiveNativeCountries]);

  // Of the loaded occurrences that pass every other active filter, how many are
  // outside the species' native range — i.e. how many the "Native range only"
  // checkbox would additionally hide if switched on right now.
  const nativeRangeHiddenCount = useMemo(() => {
    if (!effectiveNativeCountries || effectiveNativeCountries.length === 0) return 0;
    let count = 0;
    for (const o of occurrences) {
      if (!checkedTypes[classifyOccurrence(o) as keyof typeof checkedTypes]) continue;
      if (maxUncertainty != null) {
        const u = o.properties.coordinateUncertaintyInMeters;
        if (u == null || u > maxUncertainty) continue;
      }
      if (o.properties.qualityFlags?.some((f) => appliedChecks[f as QualityFlag])) continue;
      if (isOutsideNativeRange(o.properties.countryCode, effectiveNativeCountries)) count++;
    }
    return count;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks, effectiveNativeCountries]);

  // Per-check counts among the currently loaded occurrences (independent of whether
  // that check is applied), for the coordinate-cleaning dropdown
  const flagCounts = useMemo(() => {
    const counts: Partial<Record<QualityFlag, number>> = {};
    for (const o of occurrences) {
      for (const f of o.properties.qualityFlags ?? []) {
        const key = f as QualityFlag;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [occurrences]);

  // For each check: of the loaded records it flags, how many would actually appear on
  // the map if just this one check were switched off (i.e. they still pass every other
  // active filter — basis of record, uncertainty, year range, native range, and every
  // other applied coordinate-cleaning check). Mirrors basisLoadedShownCounts's "shown
  // of loaded" semantics so both dropdowns read the same way.
  const flagShownCounts = useMemo(() => {
    const counts: Partial<Record<QualityFlag, number>> = {};
    for (const o of occurrences) {
      if (!checkedTypes[classifyOccurrence(o) as keyof typeof checkedTypes]) continue;
      if (maxUncertainty != null) {
        const u = o.properties.coordinateUncertaintyInMeters;
        if (u == null || u > maxUncertainty) continue;
      }
      if (nativeRangeOnly && isOutsideNativeRange(o.properties.countryCode, effectiveNativeCountries)) continue;
      const flags = o.properties.qualityFlags ?? [];
      for (const f of flags) {
        const key = f as QualityFlag;
        const blockedByOtherCheck = flags.some((f2) => f2 !== key && appliedChecks[f2 as QualityFlag]);
        if (!blockedByOtherCheck) counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks, nativeRangeOnly, effectiveNativeCountries]);

  const flagDefs = useMemo(
    () =>
      (Object.keys(QUALITY_FLAG_LABELS) as QualityFlag[]).map((key) => ({
        key,
        label: QUALITY_FLAG_LABELS[key],
        description: QUALITY_FLAG_DESCRIPTIONS[key],
        source: QUALITY_FLAG_SOURCES[key],
        count: flagCounts[key] ?? 0,
        shown: flagShownCounts[key] ?? 0,
      })),
    [flagCounts, flagShownCounts]
  );

  const toggleCheck = (key: QualityFlag) => {
    setAppliedChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Date range for the split view slider
  const { sliderMinDate, sliderMaxDate } = useMemo(() => {
    const dates = filteredOccurrences
      .map((o) => o.properties.eventDate)
      .filter((d): d is string => d != null && d.length >= 10)
      .map((d) => d.slice(0, 10));
    if (dates.length === 0) return { sliderMinDate: splitDate, sliderMaxDate: splitDate };
    dates.sort();
    return { sliderMinDate: dates[0], sliderMaxDate: dates[dates.length - 1] };
  }, [filteredOccurrences, splitDate]);

  // Split view: partition occurrences by exact assessment date
  const { preAssessmentOccs, postAssessmentOccs } = useMemo(() => {
    if (!splitView || !splitDate) {
      return { preAssessmentOccs: [], postAssessmentOccs: [] };
    }
    const pre: OccurrenceFeature[] = [];
    const post: OccurrenceFeature[] = [];
    for (const o of filteredOccurrences) {
      const d = o.properties.eventDate ?? (o.properties.year != null ? String(o.properties.year) : null);
      if (d && d > splitDate) {
        post.push(o);
      } else {
        pre.push(o);
      }
    }
    return {
      preAssessmentOccs: pre,
      postAssessmentOccs: post,
    };
  }, [splitView, splitDate, filteredOccurrences]);

  // % of currently-filtered GBIF occurrences that fall inside the currently-visible
  // IUCN range polygons — recomputed whenever the range layer's polygons or the
  // filtered occurrence set change, so it tracks both the coordinate-cleaning /
  // basis-of-record filters and the range category toggles automatically.
  const rangeCoverageStats = useMemo(() => {
    if (!rangePolygons || rangePolygons.length === 0) return null;
    const polygons = rangePolygons as Feature<Polygon | MultiPolygon>[];
    const computeFor = (occs: OccurrenceFeature[]) => {
      let inRange = 0;
      for (const o of occs) {
        const point: Feature<GeoJSON.Point> = { type: "Feature", properties: {}, geometry: o.geometry };
        const isInside = polygons.some((poly) => {
          try {
            return booleanPointInPolygon(point, poly);
          } catch {
            return false;
          }
        });
        if (isInside) inRange++;
      }
      return { inRange, outRange: occs.length - inRange, total: occs.length };
    };
    return {
      main: computeFor(filteredOccurrences),
      before: splitView ? computeFor(preAssessmentOccs) : null,
      after: splitView ? computeFor(postAssessmentOccs) : null,
    };
  }, [rangePolygons, filteredOccurrences, splitView, preAssessmentOccs, postAssessmentOccs]);

  // Date range for color gradient (uses full eventDate for finer granularity)
  const { minDateNum, maxDateNum, minDateLabel, maxDateLabel } = useMemo(() => {
    const nums = filteredOccurrences
      .map((o) => dateToNumeric(o.properties.eventDate, o.properties.year))
      .filter((n): n is number => n != null);
    if (nums.length === 0) return { minDateNum: 0, maxDateNum: 0, minDateLabel: "", maxDateLabel: "" };
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const fmt = (ts: number) => {
      const d = new Date(ts);
      // Show just year if the range spans multiple years, otherwise show month/year
      const rangeYears = new Date(max).getFullYear() - new Date(min).getFullYear();
      if (rangeYears > 2) return String(d.getFullYear());
      return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };
    return { minDateNum: min, maxDateNum: max, minDateLabel: fmt(min), maxDateLabel: fmt(max) };
  }, [filteredOccurrences]);

  // Filter definitions — plain GBIF basis-of-record terminology (iNaturalist is just
  // part of "Human observation" here; it gets its own dedicated panel below anyway)
  const pillDefs = useMemo(() => {
    if (!breakdown) return [];
    return [
      { key: "humanObservation" as const, label: "Human observation (e.g. iNaturalist, eBird)", count: breakdown.humanObservation },
      { key: "machineObservation" as const, label: "Machine observation (e.g. camera traps)", count: breakdown.machineObservation },
      { key: "observation" as const, label: "Observation", count: breakdown.observation },
      { key: "preservedSpecimen" as const, label: "Preserved specimen (e.g. herbaria, museums)", count: breakdown.preservedSpecimen },
      { key: "fossilSpecimen" as const, label: "Fossil specimen", count: breakdown.fossilSpecimen },
      { key: "livingSpecimen" as const, label: "Living specimen (e.g. zoos, botanical gardens)", count: breakdown.livingSpecimen },
      { key: "materialSample" as const, label: "Material sample (e.g. eDNA)", count: breakdown.materialSample },
      { key: "materialCitation" as const, label: "Material citation (literature records)", count: breakdown.materialCitation },
      { key: "occurrence" as const, label: "Occurrence", count: breakdown.occurrence },
    ];
  }, [breakdown]);


  const toggleType = (key: keyof typeof checkedTypes) => {
    setCheckedTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Per-category counts among the currently loaded occurrences: how many are in this
  // basis-of-record category at all ("loaded"), and of those, how many also survive
  // every other active filter — uncertainty, year range, coordinate cleaning, native
  // range — but not the basis-of-record checkboxes themselves ("shown"). Distinct from
  // pillDefs' counts, which are true GBIF-wide totals from a separate server aggregation.
  const basisLoadedShownCounts = useMemo(() => {
    const counts: Record<string, { loaded: number; shown: number }> = {};
    for (const o of occurrences) {
      const cat = classifyOccurrence(o);
      const entry = counts[cat] ?? (counts[cat] = { loaded: 0, shown: 0 });
      entry.loaded++;
      if (maxUncertainty != null) {
        const u = o.properties.coordinateUncertaintyInMeters;
        if (u == null || u > maxUncertainty) continue;
      }
      if (o.properties.qualityFlags?.some((f) => appliedChecks[f as QualityFlag])) continue;
      if (nativeRangeOnly && isOutsideNativeRange(o.properties.countryCode, effectiveNativeCountries)) continue;
      entry.shown++;
    }
    return counts;
  }, [occurrences, maxUncertainty, appliedChecks, nativeRangeOnly, effectiveNativeCountries]);

  // Build GeoJSON FeatureCollection with computed styling properties for the circle layer
  const buildStyledFeatureCollection = useCallback((
    panelOccurrences: OccurrenceFeature[],
  ): GeoJSON.FeatureCollection => {
    const features = panelOccurrences.map((feature) => {
      const isFeatureHovered = hoveredFeature?.properties.gbifID === feature.properties.gbifID;

      let strokeColor: string;
      let fillColor: string;
      if (colorByDate) {
        const dNum = dateToNumeric(feature.properties.eventDate, feature.properties.year);
        if (dNum != null) {
          const colors = dateToColor(dNum);
          strokeColor = colors.stroke;
          fillColor = colors.fill;
        } else {
          strokeColor = "#6b7280";
          fillColor = "#9ca3af";
        }
      } else {
        // Color by before/after assessment date
        const isNew = isAfterAssessment(feature.properties.eventDate, feature.properties.year, assessmentDate, assessmentYear);
        strokeColor = isNew ? "#16a34a" : "#6b7280";
        fillColor = isNew ? "#4ade80" : "#9ca3af";
      }

      const radius = isFeatureHovered ? 6 : 5;
      const strokeWidth = isFeatureHovered ? 3 : 2;

      return {
        type: "Feature" as const,
        properties: {
          ...feature.properties,
          _fillColor: fillColor,
          _strokeColor: strokeColor,
          _radius: radius,
          _strokeWidth: strokeWidth,
          _opacity: 1,
        },
        geometry: feature.geometry,
      };
    });
    return { type: "FeatureCollection", features };
  }, [hoveredFeature, colorByDate, assessmentDate, assessmentYear]);

  // FitBounds helper using map ref
  const fitMapToBbox = useCallback((bbox: [number, number, number, number]) => {
    const map = mapRef.current;
    if (!map) return false;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (minLon === maxLon && minLat === maxLat) {
      map.flyTo({ center: [minLon, minLat], zoom: 10, duration: 500 });
    } else {
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, maxZoom: 14, duration: 500 });
    }
    return true;
  }, []);

  // Track whether we've fitted bounds for the current bbox
  const fittedBboxRef = useRef<string | null>(null);
  const pendingBboxRef = useRef<[number, number, number, number] | null>(null);

  // Reset fitted state when split view toggles (new map instances are mounted)
  const prevSplitViewRef = useRef(splitView);
  useEffect(() => {
    if (prevSplitViewRef.current !== splitView) {
      prevSplitViewRef.current = splitView;
      fittedBboxRef.current = null;
      if (bbox) {
        pendingBboxRef.current = bbox;
      }
    }
  }, [splitView, bbox]);

  // Fit bounds when the (unfiltered) bbox changes (may need to wait for map to
  // be ready) — deliberately keyed on `bbox` (the server-computed extent of
  // every loaded record), not a filtered subset: re-fitting to whatever's left
  // after toggling a filter checkbox felt jarring, since the view would jump
  // every time. The map now only re-fits on genuinely new data (a new species,
  // or loading a larger sample), not on filter changes.
  useEffect(() => {
    if (!bbox) return;
    const key = bbox.join(",");
    if (fittedBboxRef.current === key) return;
    if (fitMapToBbox(bbox)) {
      fittedBboxRef.current = key;
      pendingBboxRef.current = null;
    } else {
      // Map not ready yet — store as pending for onLoad
      pendingBboxRef.current = bbox;
    }
  }, [bbox, fitMapToBbox]);

  // Called when the MapGL component finishes loading
  const handleMapLoad = useCallback(() => {
    if (pendingBboxRef.current) {
      const bbox = pendingBboxRef.current;
      if (fitMapToBbox(bbox)) {
        fittedBboxRef.current = bbox.join(",");
        pendingBboxRef.current = null;
      }
    }
  }, [fitMapToBbox]);

  // Map event handlers
  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const features = e.features;
    if (features && features.length > 0) {
      const gbifID = features[0].properties?.gbifID;
      if (gbifID) {
        window.open(`https://www.gbif.org/occurrence/${gbifID}`, "_blank");
      }
    }
  }, []);

  const handleMapMouseMove = useCallback((e: MapLayerMouseEvent, panelId: string) => {
    if (isTouchDevice) return;
    const features = e.features;
    if (features && features.length > 0) {
      const props = features[0].properties;
      if (props) {
        // Reconstruct the OccurrenceFeature from the queried feature
        const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
        setHoveredFeature({
          type: "Feature",
          properties: {
            gbifID: props.gbifID,
            species: props.species,
            eventDate: props.eventDate,
            country: props.country,
            countryCode: props.countryCode,
            basisOfRecord: props.basisOfRecord,
            datasetKey: props.datasetKey,
            datasetName: props.datasetName,
            publishingOrgKey: props.publishingOrgKey,
            coordinateUncertaintyInMeters: props.coordinateUncertaintyInMeters,
            year: props.year,
            month: props.month,
            institutionCode: props.institutionCode,
            qualityFlags: typeof props.qualityFlags === "string" ? JSON.parse(props.qualityFlags) : props.qualityFlags,
          },
          geometry: { type: "Point", coordinates: coords },
        });
        setHoveredPanel(panelId);
      }
    } else {
      setHoveredFeature(null);
      setHoveredPanel(null);
    }
  }, [isTouchDevice]);

  const handleMapMouseLeave = useCallback(() => {
    setHoveredFeature(null);
    setHoveredPanel(null);
  }, []);

  // Handle view state change for split view sync
  const handleMoveForSync = useCallback((e: ViewStateChangeEvent) => {
    setSharedViewState({
      longitude: e.viewState.longitude,
      latitude: e.viewState.latitude,
      zoom: e.viewState.zoom,
    });
  }, []);

  // Reusable map panel renderer (used once in normal mode, twice in split view)
  const renderMapPanel = (
    panelOccurrences: OccurrenceFeature[],
    panelBbox: [number, number, number, number] | null,
    label: string | null,
    panelId: string = "main",
  ) => {
    const styledGeoJson = buildStyledFeatureCollection(panelOccurrences);
    const rangeStatsForPanel =
      panelId === "before" ? rangeCoverageStats?.before
      : panelId === "after" ? rangeCoverageStats?.after
      : rangeCoverageStats?.main;

    // Circle layer paint properties (data-driven from feature properties)
    const circleLayerStyle = {
      id: `occ-circles-${panelId}`,
      type: "circle" as const,
      paint: {
        "circle-radius": ["get", "_radius"] as unknown as number,
        "circle-color": ["get", "_fillColor"] as unknown as string,
        "circle-opacity": ["get", "_opacity"] as unknown as number,
        "circle-stroke-color": ["get", "_strokeColor"] as unknown as string,
        "circle-stroke-width": ["get", "_strokeWidth"] as unknown as number,
        "circle-stroke-opacity": ["get", "_opacity"] as unknown as number,
      },
    };

    const mapProps = splitView
      ? {
          longitude: sharedViewState.longitude,
          latitude: sharedViewState.latitude,
          zoom: sharedViewState.zoom,
          onMove: handleMoveForSync,
        }
      : {
          initialViewState: { longitude: 0, latitude: 20, zoom: 1.5 },
        };

    return (
      <div className="flex-1 flex flex-col rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 relative isolate z-0">
        <div className={`${splitView ? "h-[250px] sm:h-auto sm:min-h-[400px]" : "h-[300px] sm:h-auto sm:min-h-[450px]"} sm:flex-1 relative`}>
          {loadingOccurrences ? (
            <div className="flex items-center justify-center h-full bg-zinc-100 dark:bg-zinc-800">
              <div className="flex items-center gap-2 text-zinc-400 text-sm">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading occurrences...
              </div>
            </div>
          ) : mounted ? (
            <MapGL
              ref={panelId === "main" || panelId === "before" || !splitView ? mapRef : undefined}
              {...mapProps}
              style={{ width: "100%", height: "100%" }}
              mapStyle={BASEMAP_STYLES[basemap].style}
              interactiveLayerIds={[`occ-circles-${panelId}`]}
              onClick={handleMapClick}
              onMouseMove={(e: MapLayerMouseEvent) => handleMapMouseMove(e, panelId)}
              onMouseLeave={handleMapMouseLeave}
              onLoad={panelId === "main" || panelId === "before" || !splitView ? handleMapLoad : undefined}
              cursor={hoveredFeature && hoveredPanel === panelId ? "pointer" : "grab"}
            >
              <ScaleControl position="bottom-right" />
              {/* Protected areas overlay (WDPA) — rendered before the occurrence
                  circles so the points draw on top of the shaded PA polygons */}
              {showProtectedAreas && (
                <Source
                  id={`wdpa-${panelId}`}
                  type="raster"
                  tiles={[PROTECTED_AREAS_TILE_URL]}
                  tileSize={256}
                  attribution={PROTECTED_AREAS_ATTRIBUTION}
                >
                  <Layer id={`wdpa-layer-${panelId}`} type="raster" paint={{ "raster-opacity": 0.5 }} />
                </Source>
              )}
              {/* POWO / IUCN native-range overlays — shade the countries each
                  source considers native, purely informational (independent of
                  the "Native range only" occurrence filter). Distinct colors
                  since both can be shown at once to compare them directly. */}
              {showPowoRangeOverlay && powoRangeGeoJson && (
                <Source id={`powo-range-${panelId}`} type="geojson" data={powoRangeGeoJson}>
                  <Layer id={`powo-range-fill-${panelId}`} type="fill" paint={{ "fill-color": "#3b82f6", "fill-opacity": 0.25 }} />
                  <Layer id={`powo-range-line-${panelId}`} type="line" paint={{ "line-color": "#2563eb", "line-width": 1 }} />
                </Source>
              )}
              {showIucnRangeOverlay && iucnRangeGeoJson && (
                <Source id={`iucn-range-${panelId}`} type="geojson" data={iucnRangeGeoJson}>
                  <Layer id={`iucn-range-fill-${panelId}`} type="fill" paint={{ "fill-color": "#f59e0b", "fill-opacity": 0.25 }} />
                  <Layer id={`iucn-range-line-${panelId}`} type="line" paint={{ "line-color": "#d97706", "line-width": 1 }} />
                </Source>
              )}
              {/* Occurrence circles (GeoJSON source + circle layer) */}
              {showGbif && (
                <Source id={`occurrences-${panelId}`} type="geojson" data={styledGeoJson}>
                  <Layer {...circleLayerStyle} />
                </Source>
              )}
              {/* Highlighted dot when hovering an iNat thumbnail (only in the correct split panel) */}
              {hoveredObs && hoveredObs.decimalLatitude != null && hoveredObs.decimalLongitude != null && (
                !splitView || (
                  panelId === "main" ||
                  (panelId === "before" && (!hoveredObs.date || hoveredObs.date <= splitDate)) ||
                  (panelId === "after" && hoveredObs.date && hoveredObs.date > splitDate)
                )
              ) && (
                <>
                  <MapLibreMarker
                    longitude={hoveredObs.decimalLongitude}
                    latitude={hoveredObs.decimalLatitude}
                    anchor="center"
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: "rgba(59, 130, 246, 0.5)",
                      border: "2.5px solid #1d4ed8",
                    }} />
                  </MapLibreMarker>
                  {hoveredObs.imageUrl && (
                    <MapImageTooltip
                      lat={hoveredObs.decimalLatitude!}
                      lng={hoveredObs.decimalLongitude!}
                      imageUrl={getThumbUrl(hoveredObs.imageUrl)}
                    />
                  )}
                </>
              )}
              {/* Hover tooltip for map markers */}
              {hoveredFeature && !hoveredObs && hoveredPanel === panelId && (() => {
                const [hLon, hLat] = hoveredFeature.geometry.coordinates;
                const hInat = inatPhotosByGbifId.get(hoveredFeature.properties.gbifID);
                return (
                  <MapOccurrenceTooltip
                    lat={hLat}
                    lng={hLon}
                    species={hoveredFeature.properties.species}
                    basisOfRecord={hoveredFeature.properties.basisOfRecord}
                    datasetName={hoveredFeature.properties.datasetName}
                    eventDate={hoveredFeature.properties.eventDate}
                    coordinateUncertaintyInMeters={hoveredFeature.properties.coordinateUncertaintyInMeters}
                    imageUrl={hInat?.imageUrl ?? null}
                    observer={hInat?.observer ?? null}
                    qualityFlags={hoveredFeature.properties.qualityFlags}
                    outsideNativeRange={isOutsideNativeRange(hoveredFeature.properties.countryCode, effectiveNativeCountries)}
                    country={hoveredFeature.properties.country}
                  />
                );
              })()}
              {/* IUCN Range Map layer */}
              {showRange && assessmentId && (
                <RangeMapLayer
                  assessmentId={assessmentId}
                  visible={showRange}
                  panelId={panelId}
                  onLoadingChange={setRangeLoading}
                  onCategoriesChange={(cats) => {
                    setRangeCategories(cats);
                    // Default to showing only Extant (Native) if it exists
                    if (cats.some((c) => c.key === "1-1")) {
                      setVisibleCategories(new Set(["1-1"]));
                    }
                  }}
                  onNotFound={setRangeNotFound}
                  onSimplificationChange={setRangeSimplification}
                  onPolygonsChange={setRangePolygons}
                  visibleCategories={visibleCategories}
                />
              )}
              {/* AOH layer */}
              {showAoh && sisTaxonId && taxonGroup && (
                <AohMapLayer
                  sisTaxonId={sisTaxonId}
                  taxonGroup={taxonGroup}
                  visible={showAoh}
                  panelId={panelId}
                  mapRef={mapRef}
                  onLoadingChange={setAohLoading}
                />
              )}
            </MapGL>
          ) : null}
          {/* Legend */}
          {!loadingOccurrences && (
            <div className="absolute bottom-2 left-2 z-[1000] bg-white dark:bg-zinc-800 px-2 py-1.5 rounded text-xs text-zinc-600 dark:text-zinc-300 shadow flex flex-wrap items-center gap-x-3 gap-y-1 max-w-[90%]">
              {label ? (
                <span>{label}</span>
              ) : colorByDate ? (
                <>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: dateToColor(minDateNum).fill, border: `2px solid ${dateToColor(minDateNum).stroke}` }} />
                    <span>{minDateLabel}</span>
                  </div>
                  <span>→</span>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: dateToColor(maxDateNum).fill, border: `2px solid ${dateToColor(maxDateNum).stroke}` }} />
                    <span>{maxDateLabel}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-gray-500" />
                    <span>≤{assessmentDate?.split("T")[0] ?? assessmentYear}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-green-400 border-2 border-green-600" />
                    <span>After {assessmentDate?.split("T")[0] ?? assessmentYear}</span>
                  </div>
                </>
              )}
              {/* Toggle color mode / split view (only when assessment year is available) */}
              {!label && assessmentYear && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">|</span>
                  <button
                    onClick={() => setColorByDate(!colorByDate)}
                    className="px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 text-[10px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    title={colorByDate ? "Color by before/after assessment" : "Color by date"}
                  >
                    {colorByDate ? "Color by before/after assess. date" : "Color by date"}
                  </button>
                  {!splitView && (
                    <button
                      onClick={() => {
                        if (!splitDate && assessmentDate) setSplitDate(assessmentDate.split("T")[0]);
                        setSplitView(true);
                      }}
                      className="px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 text-[10px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors flex items-center gap-1"
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <rect x="1" y="2" width="14" height="12" rx="1.5" />
                        <line x1="8" y1="2" x2="8" y2="14" />
                      </svg>
                      Split view
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {/* Label badge for split view */}
          {label && (
            <div className="absolute top-2 left-2 z-[1000] bg-zinc-900/80 text-white text-[11px] font-medium px-2.5 py-1 rounded-full shadow-md">
              {label}
            </div>
          )}
          {/* Basemap toggle */}
          {!loadingOccurrences && mounted && (
            <div className="absolute top-12 right-2 z-[1000] flex flex-col gap-0.5 bg-white dark:bg-zinc-800 rounded-lg shadow-md border border-zinc-200 dark:border-zinc-700 p-1">
              {(Object.entries(BASEMAP_STYLES) as [BasemapKey, (typeof BASEMAP_STYLES)[BasemapKey]][]).map(([key, opt]) => (
                <button
                  key={key}
                  onClick={() => setBasemap(key)}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                    basemap === key
                      ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {/* Layer toggles (GBIF Points, Range Map, AOH) */}
          {!loadingOccurrences && mounted && (
            <div className="absolute top-12 right-[72px] z-[1000] flex flex-col gap-0.5 bg-white dark:bg-zinc-800 rounded-lg shadow-md border border-zinc-200 dark:border-zinc-700 p-1">
              <button
                onClick={() => setShowGbif(!showGbif)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors text-left ${
                  showGbif
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
                    : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                }`}
              >
                GBIF Points
              </button>
              {assessmentId && (
                <div className="flex flex-col">
                  <button
                    onClick={() => setShowRange(!showRange)}
                    className={`px-2 py-0.5 rounded text-[10px] transition-colors flex items-center gap-1 ${
                      showRange
                        ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-medium"
                        : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    }`}
                    title="Toggle IUCN range map overlay. Range maps are indicative only and may not reflect current distributions."
                  >
                    {rangeLoading ? (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : null}
                    IUCN Range Map
                    {showRange && rangeCategories.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setRangeCategoriesExpanded(!rangeCategoriesExpanded); }}
                        className="ml-0.5 text-zinc-400 hover:text-zinc-600"
                      >
                        {rangeCategoriesExpanded ? "▴" : "▾"}
                      </button>
                    )}
                  </button>
                  {showRange && rangeNotFound && (
                    <span className="px-2 py-0.5 text-[9px] text-zinc-400 italic">Not yet available</span>
                  )}
                  {showRange && !rangeNotFound && rangeSimplification && (
                    <span
                      className="px-2 py-0.5 text-[9px] text-amber-600 dark:text-amber-400 flex items-center gap-1 cursor-help"
                      title={`This range map has been simplified at ${rangeSimplification.tolerance}° (~${Math.round(rangeSimplification.tolerance * 111)}km) to reduce file size. Fine-scale boundary details may be lost.`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4M12 8h.01" />
                      </svg>
                      Simplified to {rangeSimplification.tolerance}°
                    </span>
                  )}
                  {showRange && rangeCategoriesExpanded && rangeCategories.length > 0 && (
                    <div className="flex flex-col gap-0.5 mt-0.5 pl-1 border-l-2 border-zinc-200 dark:border-zinc-600 ml-1">
                      {rangeCategories.map((cat) => {
                        const isVisible = !visibleCategories || visibleCategories.has(cat.key);
                        return (
                          <button
                            key={cat.key}
                            onClick={() => {
                              setVisibleCategories((prev) => {
                                const next = new Set(prev ?? rangeCategories.map((c) => c.key));
                                if (next.has(cat.key)) next.delete(cat.key);
                                else next.add(cat.key);
                                return next;
                              });
                            }}
                            className={`flex items-center gap-1 px-1 py-0.5 rounded text-[9px] transition-colors ${
                              isVisible ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-500 line-through"
                            }`}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                              style={{ background: cat.color, opacity: isVisible ? 1 : 0.3 }}
                            />
                            {cat.label} ({cat.count})
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {isAohAvailable && (
                <button
                  onClick={() => setShowAoh(!showAoh)}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors flex items-center gap-1 ${
                    showAoh
                      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  }`}
                  title="Toggle Area of Habitat overlay"
                >
                  {aohLoading ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : null}
                  AOH
                </button>
              )}
            </div>
          )}
          {/* Loaded X of Y GBIF records — floating badge, single view only.
              Solid background (not translucent) in both themes: it sits over
              arbitrary map tiles, not a plain page background, so a tinted/
              translucent fill (as used elsewhere in the toolbar) reads with
              poor contrast in dark mode against light-colored tiles. */}
          {!splitView && !loadingOccurrences && totalOccurrences != null && (
            <div className="absolute top-2 right-2 z-[1000] max-w-[85%] px-2 py-1 rounded-lg shadow-md bg-emerald-50 dark:bg-emerald-900 border border-emerald-200 dark:border-emerald-700 text-[11px] text-emerald-700 dark:text-emerald-300">
              {isFullSample ? (
                <>All <strong>{totalOccurrences.toLocaleString()}</strong> GBIF records loaded.</>
              ) : (
                <>Loaded <strong>{occurrences.length.toLocaleString()}</strong> of <strong>{totalOccurrences.toLocaleString()}</strong> total GBIF records.</>
              )}
              {filteredOccurrences.length < occurrences.length && (
                <> Showing <strong>{filteredOccurrences.length.toLocaleString()}</strong> after filters.</>
              )}
            </div>
          )}
          {/* In-range / out-of-range breakdown — only shown while the IUCN range
              layer is on and has at least one visible polygon to test against.
              Auto-updates with every filter (basis of record, uncertainty,
              coordinate-cleaning checks, native range) and every range category
              toggle, since it's derived from the same filteredOccurrences /
              rangePolygons state those already react to. */}
          {showRange && rangeStatsForPanel && rangeStatsForPanel.total > 0 && (
            <div className="absolute bottom-2 right-2 z-[1000] px-2 py-1.5 rounded-lg shadow-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300 min-w-[130px]">
              <div className="font-medium text-zinc-700 dark:text-zinc-200 mb-1">GBIF vs. range map</div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  In range
                </span>
                <strong>{rangeStatsForPanel.inRange.toLocaleString()}</strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
                  Out of range
                </span>
                <strong>{rangeStatsForPanel.outRange.toLocaleString()}</strong>
              </div>
              <div className="mt-1 pt-1 border-t border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400">
                {Math.round((rangeStatsForPanel.inRange / rangeStatsForPanel.total) * 100)}% in range
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Once every GBIF record for this species is loaded (no more to page in), the
  // basis-of-record dropdown's "total" and "loaded" columns are always identical —
  // collapse them into one column rather than showing the same number twice.
  const isFullSample = totalOccurrences == null || totalOccurrences <= occurrences.length;

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50">
      <div className="p-2">
        <div className="flex flex-col gap-2">
          {/* Filter dropdowns + sample-size summary, merged into one row (summary on
              the left) — sit above the map itself, not a separate header bar */}
          <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-2">
              {/* Basis of Record — dropdown checklist */}
              <div className="relative" ref={filtersRef}>
                <button
                  onClick={() => setFiltersOpen(!filtersOpen)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                    filtersOpen
                      ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-500"
                      : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  } text-zinc-700 dark:text-zinc-300`}
                >
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Basis of Record
                  {!loadingBreakdown && (
                    <span className="text-[10px] text-zinc-400 tabular-nums">
                      Selected {pillDefs.filter(p => checkedTypes[p.key]).length} of {pillDefs.length}
                    </span>
                  )}
                  <svg className={`w-3 h-3 text-zinc-400 transition-transform ${filtersOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {filtersOpen && !loadingBreakdown && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-[25rem] bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg py-1">
                    <div className="flex items-center gap-2 px-3 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                      <span className="w-40 shrink-0 flex items-center gap-2">
                        <button
                          onClick={() => setCheckedTypes((prev) => {
                            const next = { ...prev };
                            for (const p of pillDefs) next[p.key] = true;
                            return next;
                          })}
                          className="hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline"
                        >
                          Select all
                        </button>
                        <span className="text-zinc-300 dark:text-zinc-600">·</span>
                        <button
                          onClick={() => setCheckedTypes((prev) => {
                            const next = { ...prev };
                            for (const p of pillDefs) next[p.key] = false;
                            return next;
                          })}
                          className="hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline"
                        >
                          Deselect all
                        </button>
                      </span>
                      {!isFullSample && <span className="w-14 text-right shrink-0">Total</span>}
                      <span className="w-16 text-right shrink-0">{isFullSample ? "Total" : "Loaded"}</span>
                      <span className="w-12 text-right shrink-0">Cleaned</span>
                    </div>
                    {pillDefs.map((pill) => {
                      const active = checkedTypes[pill.key];
                      const loadedShown = basisLoadedShownCounts[pill.key] ?? { loaded: 0, shown: 0 };
                      const canLoadMore = pill.count > loadedShown.loaded;
                      const isLoadingMore = loadingMoreCategory === pill.key;
                      const loadMoreCount = Math.min(BASIS_OF_RECORD_LOAD_MORE_BATCH, pill.count - loadedShown.loaded);
                      return (
                        <div key={pill.key}>
                        <label
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                          title={`${pill.count.toLocaleString()} total across all of GBIF. ${loadedShown.loaded.toLocaleString()} loaded in your current sample. ${loadedShown.shown.toLocaleString()} of those also pass your other active filters (cleaned).`}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleType(pill.key)}
                            className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                          />
                          <span className={`w-40 shrink-0 ${active ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>
                            {pill.label}
                          </span>
                          {!isFullSample && (
                            <span className="w-14 text-right tabular-nums shrink-0 text-zinc-400 dark:text-zinc-500">
                              {pill.count.toLocaleString()}
                            </span>
                          )}
                          <span className="w-16 text-right tabular-nums shrink-0 text-zinc-400 dark:text-zinc-500">
                            {(isFullSample ? pill.count : loadedShown.loaded).toLocaleString()}
                          </span>
                          <span className={`w-12 text-right tabular-nums shrink-0 ${active ? "text-emerald-500 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                            {loadedShown.shown.toLocaleString()}
                          </span>
                        </label>
                        {canLoadMore && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              loadMoreForCategory(pill.key);
                            }}
                            disabled={loadingMoreCategory != null}
                            className="block pl-8 pr-3 -mt-1 pb-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {isLoadingMore ? "(loading…)" : `(load ${loadMoreCount.toLocaleString()} more)`}
                          </button>
                        )}
                        </div>
                      );
                    })}
                    {(() => {
                      const totalCount = pillDefs.reduce((sum, p) => sum + p.count, 0);
                      const totalLoaded = pillDefs.reduce((sum, p) => sum + (basisLoadedShownCounts[p.key]?.loaded ?? 0), 0);
                      const totalShown = pillDefs.reduce((sum, p) => sum + (basisLoadedShownCounts[p.key]?.shown ?? 0), 0);
                      return (
                        <div className="flex items-center gap-2 px-3 py-1.5 mt-1 border-t border-zinc-100 dark:border-zinc-800 text-xs font-medium">
                          <span className="w-3 shrink-0" />
                          <span className="w-40 shrink-0 text-zinc-700 dark:text-zinc-200">Total</span>
                          {!isFullSample && (
                            <span className="w-14 text-right tabular-nums shrink-0 text-zinc-500 dark:text-zinc-400">
                              {totalCount.toLocaleString()}
                            </span>
                          )}
                          <span className="w-12 text-right tabular-nums shrink-0 text-zinc-500 dark:text-zinc-400">
                            {(isFullSample ? totalCount : totalLoaded).toLocaleString()}
                          </span>
                          <span className="w-12 text-right tabular-nums shrink-0 text-emerald-600 dark:text-emerald-400">
                            {totalShown.toLocaleString()}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
              {/* Separator */}
              <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 hidden sm:block" />
              {/* Coordinate cleaning — dropdown: max GPS uncertainty + one checkbox per check */}
              <div className="relative" ref={cleaningFilterRef}>
                <button
                  onClick={() => setCleaningFilterOpen(!cleaningFilterOpen)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                    cleaningFilterOpen
                      ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-500"
                      : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  } text-zinc-700 dark:text-zinc-300`}
                  title="Filter by GPS uncertainty and hide records flagged by coordinate-cleaning checks (e.g. zero coordinates, GBIF headquarters, duplicates)"
                >
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Coordinate cleaning
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    Applied {flagDefs.filter((d) => appliedChecks[d.key]).length + (hasNativeRangeData && nativeRangeOnly ? 1 : 0)} of {flagDefs.length + (hasNativeRangeData ? 1 : 0)}
                    {maxUncertainty != null && ` · ≤ ${formatUncertainty(maxUncertainty)}`}
                  </span>
                  <svg className={`w-3 h-3 text-zinc-400 transition-transform ${cleaningFilterOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {cleaningFilterOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg py-1">
                    <div className="flex items-center px-3 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                      <button
                        onClick={() => {
                          setAppliedChecks((prev) => {
                            const next = { ...prev };
                            for (const d of flagDefs) next[d.key] = true;
                            return next;
                          });
                          if (hasNativeRangeData) setNativeRangeOnly(true);
                        }}
                        className="hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline"
                      >
                        Select all
                      </button>
                      <span className="text-zinc-300 dark:text-zinc-600 mx-2">·</span>
                      <button
                        onClick={() => {
                          setAppliedChecks((prev) => {
                            const next = { ...prev };
                            for (const d of flagDefs) next[d.key] = false;
                            return next;
                          });
                          if (hasNativeRangeData) setNativeRangeOnly(false);
                        }}
                        className="hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline"
                      >
                        Deselect all
                      </button>
                    </div>
                    {flagDefs.map((def) => {
                      const active = appliedChecks[def.key]; // checked = currently hides matching records
                      const impact = flagShownCounts[def.key] ?? 0; // how many would flip visibility if toggled
                      const hasImpact = impact > 0;
                      return (
                        <label
                          key={def.key}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                          title={def.description}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleCheck(def.key)}
                            className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                          />
                          <span className={`flex-1 min-w-0 ${hasImpact ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>
                            {def.label}
                          </span>
                          {def.source && (
                            <a
                              href={def.source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Reference data source: ${def.source.label}`}
                              onClick={(e) => {
                                // Prevent the enclosing <label>'s native click-forwarding from
                                // toggling the checkbox, without also losing the link's own
                                // navigation (preventDefault suppresses both, so re-trigger it
                                // manually).
                                e.preventDefault();
                                e.stopPropagation();
                                window.open(def.source!.url, "_blank", "noopener,noreferrer");
                              }}
                              className="shrink-0 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
                            >
                              <FaInfoCircle className="w-3 h-3" />
                            </a>
                          )}
                          <span className={`ml-auto tabular-nums shrink-0 text-[11px] font-medium ${hasImpact ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"}`}>
                            {!hasImpact
                              ? "0 records"
                              : active
                                ? `${impact.toLocaleString()} record${impact === 1 ? "" : "s"} hidden`
                                : `Hide ${impact.toLocaleString()} record${impact === 1 ? "" : "s"}`}
                          </span>
                        </label>
                      );
                    })}
                    {hasNativeRangeData && (
                      <>
                        <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                        <label
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                          title={
                            nativeRangeSource === "wcvp"
                              ? "Hide occurrences reported in a country outside this species' native range, per Kew's World Checklist of Vascular Plants / Plants of the World Online (POWO). Records with no reported country can't be checked."
                              : "Hide occurrences reported in a country outside this species' native range, per its IUCN Red List assessment (e.g. cultivated botanical-garden specimens). Records with no reported country can't be checked."
                          }
                        >
                          <input
                            type="checkbox"
                            checked={nativeRangeOnly}
                            onChange={() => setNativeRangeOnly((v) => !v)}
                            className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                          />
                          <span className={`flex-1 min-w-0 ${nativeRangeOnly ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>
                            Native range only
                          </span>
                          {/* Source picker — only when BOTH sources have real data for this
                              species, since they can genuinely disagree (issue #82 follow-up:
                              "we need the powo one for plants too and user can choose") */}
                          {hasBothNativeRangeSources && (
                            <div className="flex items-center rounded border border-zinc-300 dark:border-zinc-600 overflow-hidden text-[10px] shrink-0">
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setNativeRangeSource("wcvp");
                                }}
                                title="Native range per Kew's World Checklist of Vascular Plants (POWO)"
                                className={`px-1.5 py-0.5 transition-colors ${
                                  nativeRangeSource === "wcvp"
                                    ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-medium"
                                    : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                }`}
                              >
                                POWO
                              </button>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setNativeRangeSource("redlist");
                                }}
                                title="Native range per the IUCN Red List assessment's locations"
                                className={`px-1.5 py-0.5 transition-colors border-l border-zinc-300 dark:border-zinc-600 ${
                                  nativeRangeSource === "redlist"
                                    ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-medium"
                                    : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                }`}
                              >
                                IUCN
                              </button>
                            </div>
                          )}
                          <span className={`ml-auto tabular-nums shrink-0 text-[11px] font-medium ${nativeRangeHiddenCount > 0 ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"}`}>
                            {nativeRangeHiddenCount === 0
                              ? "0 records"
                              : nativeRangeOnly
                                ? `${nativeRangeHiddenCount.toLocaleString()} record${nativeRangeHiddenCount === 1 ? "" : "s"} hidden`
                                : `Hide ${nativeRangeHiddenCount.toLocaleString()} record${nativeRangeHiddenCount === 1 ? "" : "s"}`}
                          </span>
                        </label>
                        {loadingWcvpRange && isVascularPlantTaxonGroup(taxonGroup) && (
                          <div className="px-3 pb-1 text-[10px] text-zinc-400">Checking POWO…</div>
                        )}
                      </>
                    )}
                    <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs" title="Only show records with a GPS uncertainty at or below this radius">
                      <span className="w-3 shrink-0" />
                      <span className="text-zinc-700 dark:text-zinc-200">Max GPS uncertainty</span>
                      {customUncertaintyMode ? (
                        <span className="ml-auto flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            autoFocus
                            value={customUncertaintyInput}
                            placeholder="meters"
                            onChange={(e) => {
                              const raw = e.target.value;
                              setCustomUncertaintyInput(raw);
                              const n = raw === "" ? null : Math.max(0, parseInt(raw));
                              setMaxUncertainty(n != null && !Number.isNaN(n) ? n : null);
                            }}
                            className="w-16 text-xs px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                          />
                          <span className="text-zinc-400">m</span>
                          <button
                            onClick={() => {
                              setCustomUncertaintyMode(false);
                              setCustomUncertaintyInput("");
                              setMaxUncertainty(null);
                            }}
                            title="Back to preset options"
                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ) : (
                        <select
                          value={maxUncertainty ?? ""}
                          onChange={(e) => {
                            if (e.target.value === "custom") {
                              setCustomUncertaintyMode(true);
                              setCustomUncertaintyInput("");
                              setMaxUncertainty(null);
                            } else {
                              setMaxUncertainty(e.target.value ? parseInt(e.target.value) : null);
                            }
                          }}
                          className="ml-auto text-xs px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                        >
                          {UNCERTAINTY_OPTIONS.map((opt) => (
                            <option key={opt.label} value={opt.value ?? ""}>
                              {opt.label}
                            </option>
                          ))}
                          <option value="custom">Custom…</option>
                        </select>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* Overlays — informational map layers (Protected areas / POWO
                  native range / IUCN native range), independent of the
                  "Native range only" occurrence filter above: these just shade
                  which countries a source considers native, for context. */}
              <div className="relative" ref={overlaysRef}>
                <button
                  onClick={() => setOverlaysOpen(!overlaysOpen)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                    overlaysOpen
                      ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-500"
                      : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  } text-zinc-700 dark:text-zinc-300`}
                  title="Map overlays: protected areas, POWO/IUCN native range"
                >
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Overlays
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {[showProtectedAreas, showPowoRangeOverlay, showIucnRangeOverlay].filter(Boolean).length} of 3
                  </span>
                  <svg className={`w-3 h-3 text-zinc-400 transition-transform ${overlaysOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {overlaysOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg py-1">
                    <label
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                      title="Overlay the World Database on Protected Areas (WDPA) — UNEP-WCMC & IUCN"
                    >
                      <input
                        type="checkbox"
                        checked={showProtectedAreas}
                        onChange={() => setShowProtectedAreas((v) => !v)}
                        className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                      />
                      <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200">Protected areas</span>
                      <a
                        href="https://www.protectedplanet.net"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="World Database on Protected Areas (WDPA), via Protected Planet — UNEP-WCMC & IUCN"
                        onClick={(e) => {
                          // Same pattern as the other info-icon links in this
                          // component: prevent the enclosing <label>'s native
                          // click-forwarding from toggling the checkbox.
                          e.preventDefault();
                          e.stopPropagation();
                          window.open("https://www.protectedplanet.net", "_blank", "noopener,noreferrer");
                        }}
                        className="shrink-0 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
                      >
                        <FaInfoCircle className="w-3 h-3" />
                      </a>
                    </label>
                    <label
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                        nativeCountriesWcvp && nativeCountriesWcvp.length > 0
                          ? "hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                          : "opacity-50 cursor-not-allowed"
                      }`}
                      title="Shade the countries Kew's POWO/World Checklist of Vascular Plants considers this species native to"
                    >
                      <input
                        type="checkbox"
                        checked={showPowoRangeOverlay}
                        disabled={!(nativeCountriesWcvp && nativeCountriesWcvp.length > 0)}
                        onChange={() => setShowPowoRangeOverlay((v) => !v)}
                        className="w-3 h-3 rounded accent-blue-500 shrink-0"
                      />
                      <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200">POWO native range</span>
                      {wcvpPowoId && (
                        <a
                          href={`https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:${wcvpPowoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View this species on Plants of the World Online (POWO)"
                          onClick={(e) => {
                            // See the identical pattern on Coordinate cleaning's
                            // source links: prevent the enclosing <label>'s native
                            // click-forwarding from toggling the checkbox, without
                            // losing the link's own navigation.
                            e.preventDefault();
                            e.stopPropagation();
                            window.open(
                              `https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:${wcvpPowoId}`,
                              "_blank",
                              "noopener,noreferrer"
                            );
                          }}
                          className="shrink-0 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
                        >
                          <FaInfoCircle className="w-3 h-3" />
                        </a>
                      )}
                    </label>
                    <label
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                        nativeCountriesRedList && nativeCountriesRedList.length > 0
                          ? "hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                          : "opacity-50 cursor-not-allowed"
                      }`}
                      title="Shade the countries this species' IUCN Red List assessment lists as native range"
                    >
                      <input
                        type="checkbox"
                        checked={showIucnRangeOverlay}
                        disabled={!(nativeCountriesRedList && nativeCountriesRedList.length > 0)}
                        onChange={() => setShowIucnRangeOverlay((v) => !v)}
                        className="w-3 h-3 rounded accent-amber-500 shrink-0"
                      />
                      <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200">IUCN native range</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Left sidebar (iNat photos + contributors) + Map (right) ── */}
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
            {/* Left column — iNat photo gallery only (hidden if no iNat data); narrow
                since it's just a 2-col thumbnail grid now, leaving more room for the map */}
            {(!breakdown || breakdown.iNaturalist > 0) && (
            <div className="sm:w-44 shrink-0 flex flex-col gap-2">
              {/* iNat photo grid — only shown when photos exist or loading */}
              {(inatPhotos.length > 0 || loadingInatPhotos) && (
                <div className="flex flex-col bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden relative z-10">
                  {/* Header */}
                  <div className="px-2 py-1.5 text-xs sm:text-[10px] font-medium text-zinc-500 dark:text-zinc-400 text-center border-b border-zinc-100 dark:border-zinc-800">
                    iNaturalist Observations
                  </div>
                  {inatPhotos.length > 0 ? (
                    <>
                      {/* Photos — 2-col x 5-row grid */}
                      <div className={`grid grid-cols-2 gap-1 p-1.5 ${loadingInatPhotos ? "opacity-50" : ""}`}>
                        {inatPhotos.slice(0, pageSize).map((obs, idx) => (
                          <div key={`${inatPage}-${idx}`} className="aspect-square">
                            <InatPhotoWithPreview
                              obs={obs}
                              idx={idx}
                              onHover={() => setHoveredObs(obs)}
                              onLeave={() => setHoveredObs(null)}
                            />
                          </div>
                        ))}
                      </div>
                      {/* Pagination */}
                      {inatTotalCount > pageSize && (
                        <div className="flex items-center justify-center gap-1 px-1.5 py-1 border-t border-zinc-100 dark:border-zinc-800">
                          <button
                            onClick={() => {
                              const newPage = inatPage - 1;
                              setInatPage(newPage);
                              fetchInatPhotos(newPage, pageSize);
                            }}
                            disabled={inatPage === 0 || loadingInatPhotos}
                            className="p-1.5 sm:p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Previous page"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <span className="text-xs sm:text-[10px] text-zinc-400 tabular-nums">
                            {inatPage + 1}/{Math.ceil(inatTotalCount / pageSize)}
                          </span>
                          <button
                            onClick={() => {
                              const newPage = inatPage + 1;
                              setInatPage(newPage);
                              fetchInatPhotos(newPage, pageSize);
                            }}
                            disabled={(inatPage + 1) * pageSize >= inatTotalCount || loadingInatPhotos}
                            className="p-1.5 sm:p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Next page"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-6">
                      <svg className="w-4 h-4 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            {/* Map(s) — takes remaining width, stretches to match left column */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {splitView && splitDate ? (
                <div className="flex flex-col gap-2">
                  {/* Split view control bar */}
                  <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs text-zinc-600 dark:text-zinc-300">
                    <span className="font-medium">Split view</span>
                    <span className="text-zinc-400">|</span>
                    <span className="text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Date: <span className="font-medium text-zinc-700 dark:text-zinc-200">{splitDate}</span></span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, Math.round((new Date(sliderMaxDate).getTime() - new Date(sliderMinDate).getTime()) / 86400000))}
                      value={Math.max(0, Math.round((new Date(splitDate).getTime() - new Date(sliderMinDate).getTime()) / 86400000))}
                      onChange={(e) => {
                        const days = parseInt(e.target.value, 10);
                        const d = new Date(sliderMinDate);
                        d.setDate(d.getDate() + days);
                        setSplitDate(d.toISOString().slice(0, 10));
                      }}
                      className="flex-1 min-w-[100px] h-2.5 sm:h-1.5 accent-blue-500"
                    />
                    {assessmentDate && splitDate !== assessmentDate.split("T")[0] && (
                      <button
                        onClick={() => setSplitDate(assessmentDate.split("T")[0])}
                        className="text-xs sm:text-[10px] px-2 py-1 sm:px-1.5 sm:py-0.5 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-700 transition-colors whitespace-nowrap"
                      >
                        Reset to assessment date
                      </button>
                    )}
                    <button
                      onClick={() => setSplitView(false)}
                      className="ml-auto p-1.5 sm:p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                      title="Close split view"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    {renderMapPanel(preAssessmentOccs, bbox, `Before ${splitDate} (${preAssessmentOccs.length})`, "before")}
                    {renderMapPanel(postAssessmentOccs, bbox, `After ${splitDate} (${postAssessmentOccs.length})`, "after")}
                  </div>
                </div>
              ) : (
                renderMapPanel(filteredOccurrences, bbox, null)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
