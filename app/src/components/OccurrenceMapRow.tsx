"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import type { MapRef, ViewStateChangeEvent, MapLayerMouseEvent } from "react-map-gl/maplibre";
import type maplibregl from "maplibre-gl";
import { mapTaxonId } from "@/lib/data/taxonomy-constants";
import { InatObservation, getThumbUrl, InatPhotoWithPreview } from "./InatPhotoCard";
import { QualityFlag, QUALITY_FLAG_LABELS, QUALITY_FLAG_DESCRIPTIONS } from "@/lib/coordinate-cleaning";

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
interface OccurrenceFeature {
  type: "Feature";
  properties: {
    gbifID: number;
    species: string;
    eventDate?: string;
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

// Sample size options
const SAMPLE_SIZE_OPTIONS = [100, 300, 500, 1000, 2000] as const;

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
  /** CSV taxon group (e.g. "flowering_plants", "mushrooms") — used to default
   * preserved specimens ON for plants & fungi, where herbarium/fungarium
   * records are a core data source. */
  taxonGroup?: string;
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

export default function OccurrenceMapRow({
  speciesKey,
  countryCode,
  mounted,
  assessmentYear,
  assessmentDate,
  taxonGroup,
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
  });
  const [colorByDate, setColorByDate] = useState(true);
  const [basemap, setBasemap] = useState<BasemapKey>("streets");
  const [showProtectedAreas, setShowProtectedAreas] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [splitDate, setSplitDate] = useState<string>(assessmentDate?.split("T")[0] || "");
  const [sharedViewState, setSharedViewState] = useState({ longitude: 0, latitude: 20, zoom: 1.5 });
  const mapRef = useRef<MapRef>(null);
  const [sampleSize, setSampleSize] = useState(300);

  // Filters dropdown state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  // Coordinate-cleaning checks dropdown state
  const [cleaningFilterOpen, setCleaningFilterOpen] = useState(false);
  const cleaningFilterRef = useRef<HTMLDivElement>(null);

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

  // Hovered iNat observation (for map highlight)
  const [hoveredObs, setHoveredObs] = useState<InatObservation | null>(null);

  // Hovered occurrence on map (for hover tooltip)
  const [hoveredFeature, setHoveredFeature] = useState<OccurrenceFeature | null>(null);
  const [hoveredPanel, setHoveredPanel] = useState<string | null>(null);

  // Touch-only device detection (no hover tooltips on touch-only devices)
  // Check for coarse pointer (phone/tablet) rather than maxTouchPoints which is true on Mac trackpads
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    setIsTouchDevice(window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches); // eslint-disable-line react-hooks/set-state-in-effect -- detect on mount
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
    setLoadingOccurrences(true); // eslint-disable-line react-hooks/set-state-in-effect -- loading state for fetch
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
    setLoadingBreakdown(true); // eslint-disable-line react-hooks/set-state-in-effect -- loading state for fetch
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
    setInatPage(0); // eslint-disable-line react-hooks/set-state-in-effect -- reset pagination on resize
    fetchInatPhotos(0, pageSize);
  }, [pageSize, fetchInatPhotos]);

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
    return result;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks]);

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
  // active filter — basis of record, uncertainty, year range, and every other applied
  // coordinate-cleaning check). Mirrors basisLoadedShownCounts's "shown of loaded"
  // semantics so both dropdowns read the same way.
  const flagShownCounts = useMemo(() => {
    const counts: Partial<Record<QualityFlag, number>> = {};
    for (const o of occurrences) {
      if (!checkedTypes[classifyOccurrence(o) as keyof typeof checkedTypes]) continue;
      if (maxUncertainty != null) {
        const u = o.properties.coordinateUncertaintyInMeters;
        if (u == null || u > maxUncertainty) continue;
      }
      const flags = o.properties.qualityFlags ?? [];
      for (const f of flags) {
        const key = f as QualityFlag;
        const blockedByOtherCheck = flags.some((f2) => f2 !== key && appliedChecks[f2 as QualityFlag]);
        if (!blockedByOtherCheck) counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks]);

  const flagDefs = useMemo(
    () =>
      (Object.keys(QUALITY_FLAG_LABELS) as QualityFlag[]).map((key) => ({
        key,
        label: QUALITY_FLAG_LABELS[key],
        description: QUALITY_FLAG_DESCRIPTIONS[key],
        count: flagCounts[key] ?? 0,
        shown: flagShownCounts[key] ?? 0,
      })),
    [flagCounts, flagShownCounts]
  );

  const toggleCheck = (key: QualityFlag) => {
    setAppliedChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Bounding box from filtered occurrences
  const filteredBbox = useMemo<[number, number, number, number] | null>(() => {
    if (filteredOccurrences.length === 0) return bbox; // fall back to API bbox
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const f of filteredOccurrences) {
      const [lon, lat] = f.geometry.coordinates;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return [minLon, minLat, maxLon, maxLat];
  }, [filteredOccurrences, bbox]);

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
  // every other active filter — uncertainty, year range, coordinate cleaning — but not
  // the basis-of-record checkboxes themselves ("shown"). Distinct from pillDefs' counts,
  // which are true GBIF-wide totals from a separate server aggregation.
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
      entry.shown++;
    }
    return counts;
  }, [occurrences, maxUncertainty, appliedChecks]);

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
      if (filteredBbox) {
        pendingBboxRef.current = filteredBbox;
      }
    }
  }, [splitView, filteredBbox]);

  // Fit bounds when bbox changes (may need to wait for map to be ready)
  useEffect(() => {
    if (!filteredBbox) return;
    const key = filteredBbox.join(",");
    if (fittedBboxRef.current === key) return;
    if (fitMapToBbox(filteredBbox)) {
      fittedBboxRef.current = key;
      pendingBboxRef.current = null;
    } else {
      // Map not ready yet — store as pending for onLoad
      pendingBboxRef.current = filteredBbox;
    }
  }, [filteredBbox, fitMapToBbox]);

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
              {/* Occurrence circles (GeoJSON source + circle layer) */}
              <Source id={`occurrences-${panelId}`} type="geojson" data={styledGeoJson}>
                <Layer {...circleLayerStyle} />
              </Source>
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
                  />
                );
              })()}
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
          {/* Protected areas (WDPA) overlay toggle */}
          {!loadingOccurrences && mounted && (
            <div className="absolute top-2 right-2 z-[1000]">
              <button
                onClick={() => setShowProtectedAreas((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg shadow-md border text-[11px] font-medium transition-colors ${
                  showProtectedAreas
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                }`}
                title="Overlay World Database on Protected Areas (WDPA) — UNEP-WCMC & IUCN"
              >
                <span
                  className={`w-3 h-3 rounded-sm border ${
                    showProtectedAreas
                      ? "bg-white/30 border-white/70"
                      : "bg-emerald-500/40 border-emerald-600"
                  }`}
                />
                Protected areas
              </button>
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
                  <div className="absolute left-0 top-full mt-1 z-50 w-[36rem] bg-white/75 dark:bg-zinc-900/75 backdrop-blur-sm rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg py-1">
                    <div className="flex items-center gap-2 px-3 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                      <button
                        onClick={() => {
                          const allChecked = pillDefs.every((p) => checkedTypes[p.key]);
                          setCheckedTypes((prev) => {
                            const next = { ...prev };
                            for (const p of pillDefs) next[p.key] = !allChecked;
                            return next;
                          });
                        }}
                        className="flex-1 min-w-0 text-left hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline"
                      >
                        {pillDefs.every((p) => checkedTypes[p.key]) ? "Deselect all" : "Select all"}
                      </button>
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
                        <label
                          key={pill.key}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                          title={`${pill.count.toLocaleString()} total across all of GBIF. ${loadedShown.loaded.toLocaleString()} loaded in your current sample. ${loadedShown.shown.toLocaleString()} of those also pass your other active filters (cleaned).`}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleType(pill.key)}
                            className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                          />
                          <span className={`flex-1 min-w-0 ${active ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>
                            {pill.label}
                          </span>
                          {!isFullSample && (
                            <span className="w-14 text-right tabular-nums shrink-0 text-zinc-400 dark:text-zinc-500">
                              {pill.count.toLocaleString()}
                            </span>
                          )}
                          <span className="shrink-0 text-right text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                            <span className="w-16 inline-block tabular-nums">{(isFullSample ? pill.count : loadedShown.loaded).toLocaleString()}</span>
                            {canLoadMore && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  loadMoreForCategory(pill.key);
                                }}
                                disabled={loadingMoreCategory != null}
                                className="ml-1 text-[10px] hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {isLoadingMore ? "(loading…)" : `(load ${loadMoreCount.toLocaleString()} more)`}
                              </button>
                            )}
                          </span>
                          <span className={`w-12 text-right tabular-nums shrink-0 ${active ? "text-emerald-500 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                            {loadedShown.shown.toLocaleString()}
                          </span>
                        </label>
                      );
                    })}
                    {(() => {
                      const totalCount = pillDefs.reduce((sum, p) => sum + p.count, 0);
                      const totalLoaded = pillDefs.reduce((sum, p) => sum + (basisLoadedShownCounts[p.key]?.loaded ?? 0), 0);
                      const totalShown = pillDefs.reduce((sum, p) => sum + (basisLoadedShownCounts[p.key]?.shown ?? 0), 0);
                      return (
                        <div className="flex items-center gap-2 px-3 py-1.5 mt-1 border-t border-zinc-100 dark:border-zinc-800 text-xs font-medium">
                          <span className="w-3 shrink-0" />
                          <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200">Total</span>
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
                    Applied {flagDefs.filter((d) => appliedChecks[d.key]).length} of {flagDefs.length}
                    {maxUncertainty != null && ` · ≤ ${formatUncertainty(maxUncertainty)}`}
                  </span>
                  <svg className={`w-3 h-3 text-zinc-400 transition-transform ${cleaningFilterOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {cleaningFilterOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white/75 dark:bg-zinc-900/75 backdrop-blur-sm rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg py-1">
                    <div className="flex items-center px-3 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                      <button
                        onClick={() => {
                          const allChecked = flagDefs.every((d) => appliedChecks[d.key]);
                          setAppliedChecks((prev) => {
                            const next = { ...prev };
                            for (const d of flagDefs) next[d.key] = !allChecked;
                            return next;
                          });
                        }}
                        className="hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline"
                      >
                        {flagDefs.every((d) => appliedChecks[d.key]) ? "Deselect all" : "Select all"}
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
              {!splitView && totalOccurrences != null && (
                <div className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
                  <span>
                    {isFullSample ? (
                      <>All <strong>{totalOccurrences.toLocaleString()}</strong> GBIF records loaded.</>
                    ) : (
                      <>Loaded <strong>{occurrences.length.toLocaleString()}</strong> of <strong>{totalOccurrences.toLocaleString()}</strong> total GBIF records.</>
                    )}
                    {filteredOccurrences.length < occurrences.length && (
                      <> Showing <strong>{filteredOccurrences.length.toLocaleString()}</strong> after filters.</>
                    )}
                  </span>
                  {!isFullSample && (
                    <select
                      value={sampleSize}
                      onChange={(e) => setSampleSize(parseInt(e.target.value))}
                      className="text-xs px-1.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-zinc-800 text-emerald-700 dark:text-emerald-300"
                      title="Load more records"
                    >
                      {SAMPLE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n.toLocaleString()}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
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
                    {renderMapPanel(preAssessmentOccs, filteredBbox, `Before ${splitDate} (${preAssessmentOccs.length})`, "before")}
                    {renderMapPanel(postAssessmentOccs, filteredBbox, `After ${splitDate} (${postAssessmentOccs.length})`, "after")}
                  </div>
                </div>
              ) : (
                renderMapPanel(filteredOccurrences, filteredBbox, null)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
