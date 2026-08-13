"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { MapRef, ViewStateChangeEvent, MapLayerMouseEvent } from "react-map-gl/maplibre";
import type maplibregl from "maplibre-gl";
import { taxonGroupCountsPreservedSpecimens } from "@/lib/gbif";
import { InatObservation, getThumbUrl, InatPhotoWithPreview } from "./InatPhotoCard";
import { QualityFlag, QUALITY_FLAG_LABELS, QUALITY_FLAG_DESCRIPTIONS, QUALITY_FLAG_SOURCES } from "@/lib/coordinate-cleaning";
import { CATEGORY_COLORS, normalizeCategory } from "@/config/taxa";
import { FaInfoCircle } from "react-icons/fa";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { OccurrenceFeature as OccurrenceFeatureType } from "./OccurrenceListTable";
import {
  loadGeoreferences,
  saveGeoreferences,
  loadExclusions,
  saveExclusions,
  type Exclusion,
  csvToGeoreferences,
  occurrencesToCsv,
  uncertaintyCircle,
  type Georeference,
} from "@/lib/georeferences";

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
// The list (table) view of the same occurrences — only pulled in when the user
// actually switches to it.
const OccurrenceListTable = dynamic(
  () => import("./OccurrenceListTable"),
  { ssr: false }
);
const GeoreferenceEditor = dynamic(
  () => import("./GeoreferenceEditor"),
  { ssr: false }
);
const ExclusionDialog = dynamic(
  () => import("./ExclusionDialog"),
  { ssr: false }
);

// Shape of coordinate-cleaning-refdata/countries.json (Natural Earth admin-0
// country polygons, keyed by ISO 3166-1 alpha-2), dynamically imported for the
// POWO/IUCN native-range overlays.
interface CountryPolygon {
  iso_a2: string;
  polygon: GeoJSON.Polygon;
}

// The occurrence record shape is shared with the list view (which renders the
// same records as table rows, including the Darwin Core fields a map dot has
// nowhere to show), so it lives there.
type OccurrenceFeature = OccurrenceFeatureType;

/**
 * The assessor's own point on the map.
 *
 * Its hover handlers are attached natively rather than as React props: a
 * MapLibre marker's children are portalled into the map's own DOM, and React's
 * synthetic mouseenter/mouseleave (which it synthesises from delegated
 * mouseover/mouseout) doesn't reach them there — onClick does, which is what
 * makes the omission easy to miss.
 */
function GeoreferenceMarkerDot({
  hovered,
  onClick,
  onEnter,
  onLeave,
}: {
  hovered: boolean;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A marker sits inside the map container, so its mousemoves bubble to
    // MapLibre, which queries the layers underneath, finds nothing, and clears
    // the hover this element just set. Keep those to ourselves.
    const swallow = (e: Event) => e.stopPropagation();
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("mousemove", swallow);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("mousemove", swallow);
    };
  }, [onEnter, onLeave]);
  return (
    <div
      ref={ref}
      onClick={onClick}
      title="Drag to move · click to edit"
      style={{
        width: hovered ? 18 : 14,
        height: hovered ? 18 : 14,
        borderRadius: "50%",
        background: "#7c3aed",
        border: "2px solid #ffffff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        cursor: "grab",
      }}
    />
  );
}

/** A record GBIF has coordinates for, i.e. one the map can actually draw. */
type PositionedOccurrence = OccurrenceFeature & { geometry: NonNullable<OccurrenceFeature["geometry"]> };
function hasPosition(o: OccurrenceFeature): o is PositionedOccurrence {
  return o.geometry != null;
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

// Comparable yyyy-mm-dd key for the date-range filter — full eventDate when
// available, otherwise Jan 1 of `year` (same fallback the split-view before/after
// partition uses). Records with neither can't be placed in a date window, so they
// have no key and are excluded whenever the date-range filter is active.
function occurrenceDateKey(o: OccurrenceFeature): string | null {
  const e = o.properties.eventDate;
  if (e && e.length >= 10) return e.slice(0, 10);
  if (o.properties.year != null) return `${String(o.properties.year).padStart(4, "0")}-01-01`;
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

// Two thirds of the fullscreen height to the map, and the bounds the divider
// can be dragged between — enough map to stay a map, enough list to stay a list.
const FULLSCREEN_DEFAULT_MAP_PCT = 66;
const FULLSCREEN_MIN_MAP_PCT = 20;
const FULLSCREEN_MAX_MAP_PCT = 85;

// How many additional records to fetch per click of the general "Load N more" button
// next to the "Loaded X of Y" badge (all basis-of-record categories together).
const OVERALL_LOAD_MORE_BATCH = 200;

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
  speciesKey: string;
  countryCode?: string | null;
  mounted: boolean;
  assessmentYear?: number | null;
  assessmentDate?: string | null;
  assessmentId?: number | null;
  sisTaxonId?: number | null;
  /** This species' current IUCN Red List category (e.g. "VU", "EN") — shown as a
   * small colored badge on the current-assessment marker in the date-range
   * timeline, alongside the same badges for previousAssessments' categories. */
  category?: string | null;
  /** This species' current assessment's Red List criteria (e.g. "A2bd") — shown
   * in the current-assessment marker's tooltip alongside its category. */
  criteria?: string | null;
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
  /** This species' past Red List assessments (most recent one is covered by
   * assessmentDate/assessmentYear above, not repeated here unless the caller's
   * history array happens to include it too — de-duped by date either way when
   * building the date-range slider's assessment markers). Lazily populated by
   * RedListView's own history fetch, so may still be empty/stale on first render
   * of this tab — markers just don't appear yet in that case. */
  previousAssessments?: { year: string; date: string | null; category?: string; criteria?: string | null }[];
  /** The species' node in the taxonomy, as the dashboard's `taxa` URL token —
   *  needed to send someone back to a filtered dashboard rather than a bare one. */
  dashboardTaxonToken?: string | null;
  /** The dashboard's row id for this species, so leaving fullscreen lands on
   *  the row already open rather than on a list to hunt through. */
  dashboardSpeciesId?: number | null;
  /** Render as the fullscreen page: map above, record list below, filling the
   *  height given to it. Driven by the /mapping/<key> route. */
  fullscreen?: boolean;
  /** Called once the occurrence data has loaded and there are no records to show,
   * letting the parent fall back to another tab (e.g. Catalogue of Life). */
  onEmpty?: () => void;
}

/**
 * Plants & fungi rely heavily on herbarium/fungarium specimens in GBIF, so
 * preserved specimens are ON by default for those kingdoms — the same rule the
 * counts behind this map are now fetched under, so the checkbox a species opens
 * with matches the number that got the user here. Re-exported rather than
 * redefined so the two cannot drift.
 */
export const isPlantOrFungiTaxonGroup = taxonGroupCountsPreservedSpecimens;

/**
 * Which record types are selected when the viewer opens.
 *
 * Plants and fungi start with every one of them, because for these kingdoms
 * the herbarium or fungarium sheet is often the only record there is, and a
 * default that quietly drops record types hides the very evidence an
 * assessment gets written from. Animals keep the narrower set: field
 * observations, with specimens and literature citations off until asked for.
 */
export function defaultCheckedTypes(taxonGroup: string | undefined) {
  const everything = isPlantOrFungiTaxonGroup(taxonGroup);
  return {
    humanObservation: true,
    machineObservation: true,
    observation: everything,
    preservedSpecimen: everything,
    fossilSpecimen: everything,
    livingSpecimen: everything,
    materialSample: true,
    materialCitation: everything,
    occurrence: everything,
  };
}

/**
 * Which coordinate-cleaning checks are applied when the viewer opens.
 *
 * None at all for plants and fungi — same reasoning: these checks are
 * plausibility heuristics with real false-positive rates, and a herbarium
 * record trimmed by one is a record an assessor never sees. Everything else
 * starts with the two that flag coordinates nothing can defend: null island,
 * and exact duplicates.
 */
export function defaultAppliedChecks(taxonGroup: string | undefined): Record<QualityFlag, boolean> {
  const clean = !isPlantOrFungiTaxonGroup(taxonGroup);
  return {
    ZERO_COORDINATE: clean,
    EQUAL_COORDINATES: false,
    GBIF_HEADQUARTERS: false,
    DUPLICATE: clean,
    NEAR_CAPITAL: false,
    NEAR_CENTROID: false,
    NEAR_INSTITUTION: false,
    OCEAN: false,
    URBAN_AREA: false,
    ARTIFICIAL_HOTSPOT: false,
    OUTSIDE_REPORTED_COUNTRY: false,
  };
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
  category,
  criteria,
  taxonGroup,
  scientificName,
  nativeCountriesRedList,
  previousAssessments,
  fullscreen: fullscreenProp,
  dashboardTaxonToken,
  dashboardSpeciesId,
  onEmpty,
}: OccurrenceMapRowProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceFeature[]>([]);
  const [breakdown, setBreakdown] = useState<RecordTypeBreakdown | null>(null);
  const [loadingOccurrences, setLoadingOccurrences] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);

  const [checkedTypes, setCheckedTypes] = useState(() => defaultCheckedTypes(taxonGroup));

  // Advanced filter state
  const [maxUncertainty, setMaxUncertainty] = useState<number | null>(null);
  // Custom max-uncertainty entry, shown instead of the preset <select> when active
  const [customUncertaintyMode, setCustomUncertaintyMode] = useState(false);
  const [customUncertaintyInput, setCustomUncertaintyInput] = useState("");
  // Date-range filter — client-side, narrows the *already-loaded* sample to an
  // eventDate window. null means "no restriction on that end" (mirrors
  // maxUncertainty's null-means-off pattern); both start null so the slider's
  // handles sit at the full loaded range until the user actually drags one.
  const [dateRangeFrom, setDateRangeFrom] = useState<string | null>(null);
  const [dateRangeTo, setDateRangeTo] = useState<string | null>(null);
  // Coordinate-cleaning checks (zero/equal coords, GBIF HQ, duplicates — see
  // src/lib/coordinate-cleaning.ts), individually toggleable. Default all off —
  // opt-in, since these are plausibility heuristics with real false-positive risk
  // (documented per-check), not the same as GBIF's own hasGeospatialIssue=false
  // parsing-error filter, which stays on unconditionally upstream of this. Two
  // exceptions default on: zero/null-island coordinates (no plausible reading of
  // (0,0) or an axis-zero point as a real location), and repeated coordinates
  // (an exact duplicate of another record adds nothing on the map and is a very
  // common GBIF artifact — only the repeat is hidden, the first stays visible).
  const [appliedChecks, setAppliedChecks] = useState<Record<QualityFlag, boolean>>(() =>
    defaultAppliedChecks(taxonGroup)
  );
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
  // Whether the current hover started on the map — the list scrolls to meet a
  // map hover, but must not yank itself around under the pointer for its own.
  const [hoverFromMap, setHoverFromMap] = useState(false);

  // Which way the two panels sit. Dragging the divider resizes them; this flips
  // the axis, for when the list reads better beside the map than beneath it.
  const [panelLayout, setPanelLayout] = useState<"rows" | "columns">("rows");

  // Fullscreen — map above, record list below, and nothing else on the page —
  // is a route of its own (/mapping/<key>), so it can be linked, shared,
  // and loaded without the dashboard's own queries. The component just renders
  // that way when told to.
  const fullscreen = !!fullscreenProp;

  // Leaving fullscreen returns to this species on the dashboard, not the
  // landing page — a shared link is usually the first thing someone sees, and
  // dropping them into an unfiltered dashboard loses the species they came for.
  // The taxon token matters as much as the search text: the Not Evaluated view
  // won't list anything until the tree is narrowed (there are 1.8M unassessed
  // species), so `search=` on its own arrives at an empty dashboard.
  const dashboardHref = useMemo(() => {
    if (!scientificName) return "/";
    const params = new URLSearchParams({ search: scientificName });
    if (category === "NE") params.set("view", "new-assessments");
    if (dashboardTaxonToken) params.set("taxa", dashboardTaxonToken);
    // Open the row itself, on the tab you were just looking at — the dashboard
    // already reads both of these from the URL.
    if (dashboardSpeciesId != null) {
      params.set("species", String(dashboardSpeciesId));
      params.set("tab", "gbif");
    }
    return `/?${params}`;
  }, [scientificName, category, dashboardTaxonToken, dashboardSpeciesId]);
  // Share of the fullscreen height given to the map, as a percentage. Two
  // thirds by default, dragged from the divider between map and list.
  const [mapHeightPct, setMapHeightPct] = useState(FULLSCREEN_DEFAULT_MAP_PCT);
  const [draggingDivider, setDraggingDivider] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitView, setSplitView] = useState(false);
  const [splitDate, setSplitDate] = useState<string>(assessmentDate?.split("T")[0] || "");
  const [sharedViewState, setSharedViewState] = useState({ longitude: 0, latitude: 20, zoom: 1.5 });
  const mapRef = useRef<MapRef>(null);
  // Initial fetch size — no longer user-adjustable; loading more of a specific
  // basis-of-record category is handled by loadMoreForCategory below instead.
  const sampleSize = 300;

  // GBIF points toggle (on by default)
  const [showGbif, setShowGbif] = useState(true);

  // Range maps and AOH are both restricted for now — hide their toggles
  // unless the signed-in user is an admin. The real enforcement is
  // server-side (the /range-map and /aoh API routes themselves 403); this is
  // just so unauthorized users don't see a toggle for a layer they can't
  // actually load. Triggered on either assessmentId or sisTaxonId since AOH
  // availability keys off sisTaxonId, not assessmentId.
  const [canViewRangeMap, setCanViewRangeMap] = useState(false);
  // The signed-in account, if any — used to fill georeferencedBy on a saved
  // georeference. Nothing here is gated on it.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { canViewRangeMap: false, email: null }))
      .then((data: { canViewRangeMap?: boolean; email?: string | null }) => {
        if (cancelled) return;
        setCanViewRangeMap(!!data.canViewRangeMap);
        setAccountEmail(data.email ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Records struck out by hand, each with the reason given. Distinct from a
  // filter: the filters answer "which records match these rules", this answers
  // "I have looked at that one and it shouldn't count" — and the reason is the
  // part worth keeping, so it's stored alongside the georeferences.
  const [exclusions, setExclusions] = useState<Record<number, Exclusion>>({});
  const [pendingExclusion, setPendingExclusion] = useState<number[] | null>(null);

  useEffect(() => {
    setExclusions(loadExclusions(speciesKey));
  }, [speciesKey]);

  const persistExclusions = useCallback(
    (next: Record<number, Exclusion>) => {
      setExclusions(next);
      if (!saveExclusions(speciesKey, next)) {
        setGeorefMessage({ kind: "error", text: "Couldn't save to this browser's storage." });
      }
    },
    [speciesKey]
  );

  const confirmExclusion = useCallback(
    (justification: string) => {
      if (!pendingExclusion) return;
      const next = { ...exclusions };
      for (const gbifID of pendingExclusion) {
        next[gbifID] = {
          gbifID,
          justification,
          excludedAt: new Date().toISOString(),
          excludedBy: accountEmail || undefined,
        };
      }
      persistExclusions(next);
      setPendingExclusion(null);
    },
    [pendingExclusion, exclusions, persistExclusions, accountEmail]
  );

  const includeAgain = useCallback(
    (gbifID: number) => {
      const next = { ...exclusions };
      delete next[gbifID];
      persistExclusions(next);
    },
    [exclusions, persistExclusions]
  );

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

  // AOH layer state. taxonGroup is the friendly bucket name ("birds", not
  // "aves") — matches taxon_group from the species API, not class_name.
  // Gated behind the same admin check as the range map layer — the AOH API
  // routes enforce this server-side too, this just hides the toggle from
  // users who can't load it anyway.
  const isAohAvailable = !!(sisTaxonId && taxonGroup && canViewRangeMap &&
    ["mammals", "birds", "reptiles", "amphibians"].includes(taxonGroup.toLowerCase()));
  const [showAoh, setShowAoh] = useState(false);
  const [aohLoading, setAohLoading] = useState(false);

  // Filters dropdown state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  // Coordinate-cleaning checks dropdown state
  const [cleaningFilterOpen, setCleaningFilterOpen] = useState(false);
  const cleaningFilterRef = useRef<HTMLDivElement>(null);

  // Date-range filter dropdown state
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const dateRangeRef = useRef<HTMLDivElement>(null);
  // Which of the two overlapping range-input handles was most recently grabbed —
  // given the raise-on-interaction z-index below, so whichever the user is actively
  // dragging always stays on top and stays grabbable even where the handles overlap.
  const [activeDateHandle, setActiveDateHandle] = useState<"from" | "to" | null>(null);

  // Overlays dropdown state (Protected areas / POWO native range / IUCN native countries)
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

  // Close date-range popover on outside click
  useEffect(() => {
    if (!dateRangeOpen) return;
    const handler = (e: MouseEvent) => {
      if (dateRangeRef.current && !dateRangeRef.current.contains(e.target as Node)) {
        setDateRangeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dateRangeOpen]);

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
  // Which of the records sharing a point the tooltip is showing, and whether
  // the pointer has moved onto the tooltip itself — without that, reaching for
  // the pager takes the pointer off the point and dismisses the thing.
  const [groupIndex, setGroupIndex] = useState(0);
  const [tooltipHeld, setTooltipHeld] = useState(false);
  /**
   * Clearing the hover is delayed by a beat so the pointer can travel from the
   * point (or the row) onto the tooltip itself. Without the gap the tooltip
   * unmounts the instant you set off towards its pager, which makes paging
   * between co-located records impossible to actually reach.
   */
  const hoverClearTimer = useRef<number | null>(null);
  /** Mirrors tooltipPinned, which is derived far below this. */
  const tooltipPinnedRef = useRef(false);
  const cancelHoverClear = useCallback(() => {
    if (hoverClearTimer.current != null) {
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
  }, []);
  const closeTooltip = useCallback(() => {
    cancelHoverClear();
    setTooltipHeld(false);
    setHoveredFeature(null);
    setHoveredPanel(null);
  }, [cancelHoverClear]);

  const clearHoverSoon = useCallback(() => {
    // A pinned tooltip (several records at one point) ignores hover-out
    // entirely; see tooltipPinned below.
    if (tooltipPinnedRef.current) return;
    cancelHoverClear();
    hoverClearTimer.current = window.setTimeout(() => {
      hoverClearTimer.current = null;
      setHoveredFeature(null);
      setHoveredPanel(null);
    }, 220);
  }, [cancelHoverClear]);

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
  // How far into GBIF's own (unfiltered, all-basis-of-record) result ordering we've
  // paged — GBIF has no date-sort param (see api/occurrences/route.ts), but its default
  // order is newest-year-first, so paging further with this offset surfaces the next
  // oldest batch. Kept separate from occurrences.length, which also grows via
  // loadMoreForCategory's per-category fetches and would desync from what GBIF's
  // unfiltered ordering actually considers "next" if reused here.
  const [generalOffset, setGeneralOffset] = useState(0);

  // Opt-in record sets the viewer has always filtered out: records GBIF has no
  // coordinates for, and records whose coordinates GBIF flags. Both are only
  // useful in the list (one can't be drawn at all, the other shouldn't be
  // trusted where it's drawn), and both are what an assessor georeferences by
  // hand — so they're off until asked for, and their totals are always fetched
  // so the toggles can name what's being hidden.
  // Fetched automatically in fullscreen — the list is the only place they can
  // be read, and it's the whole point of that page. Off elsewhere, where
  // there's no list to put them in.
  const includeMissing = !!fullscreenProp;
  // Records GBIF flags are always fetched now: they have coordinates, so they
  // belong with the rest and are hidden (or not) by a coordinate-cleaning check
  // like any other suspect point, rather than by a separate opt-in.
  // Off for plants and fungi, on for everything else — the same rule the other
  // cleaning checks follow, since this is now one of them.
  const [hideGbifFlagged, setHideGbifFlagged] = useState(() => !isPlantOrFungiTaxonGroup(taxonGroup));
  const [recordSetTotals, setRecordSetTotals] = useState<{ mapped: number; issue: number; missing: number } | null>(null);

  // The assessor's own georeferences for this species, keyed by gbifID. Held in
  // the browser (see lib/georeferences.ts) and never sent to GBIF: they are one
  // person's working interpretation of a locality description, not a correction
  // anyone has vouched for.
  const [georeferences, setGeoreferences] = useState<Record<number, Georeference>>({});
  const [editingFeature, setEditingFeature] = useState<OccurrenceFeature | null>(null);
  const [georefMessage, setGeorefMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGeoreferences(loadGeoreferences(speciesKey));
  }, [speciesKey]);

  // Every write goes through here so the in-memory copy and the stored copy
  // can't drift, and so a failed write (quota, private window) is reported
  // rather than silently losing an afternoon's work.
  const persistGeoreferences = useCallback(
    (next: Record<number, Georeference>) => {
      setGeoreferences(next);
      if (!saveGeoreferences(speciesKey, next)) {
        setGeorefMessage({
          kind: "error",
          text: "Couldn't save to this browser's storage — export before you close the tab.",
        });
      }
    },
    [speciesKey]
  );

  // Fetch occurrences (re-fetches when the requested record sets change)
  useEffect(() => {
    setLoadingOccurrences(true);
    const params = new URLSearchParams({
      speciesKey,
      limit: sampleSize.toString(),
    });
    if (countryCode) {
      params.set("country", countryCode);
    }
    if (includeMissing) params.set("includeMissing", "true");
    params.set("includeIssues", "true");
    fetch(`/api/occurrences?${params}`)
      .then((res) => res.json())
      .then((data) => {
        const features = data.features || [];
        setOccurrences(features);
        setTotalOccurrences(data.metadata?.total ?? null);
        setBbox(data.metadata?.bbox ?? null);
        setRecordSetTotals(data.metadata?.totals ?? null);
        setGeneralOffset(features.length);
      })
      .catch(console.error)
      .finally(() => setLoadingOccurrences(false));
  }, [speciesKey, countryCode, sampleSize, includeMissing]);

  // Basis-of-record category currently fetching more records, if any (drives the
  // per-row "Load more" spinner/disabled state in the dropdown).
  const [loadingMoreCategory, setLoadingMoreCategory] = useState<string | null>(null);
  // True while the general "Load N more" button (next to the "Loaded X of Y" badge)
  // is fetching the next unfiltered batch — separate from loadingMoreCategory since
  // this isn't scoped to one basis-of-record category.
  const [loadingMoreOverall, setLoadingMoreOverall] = useState(false);
  const [loadingMoreMissing, setLoadingMoreMissing] = useState(false);

  // Records with no coordinates arrive as their own bounded sample, so a
  // species with hundreds of unlocalised sheets doesn't stall the first paint.
  // This pages that set alone, from however many are already loaded.
  const loadMoreMissing = useCallback(() => {
    setLoadingMoreMissing(true);
    const loaded = occurrences.filter((o) => o.properties.coordinateStatus === "missing").length;
    const params = new URLSearchParams({
      speciesKey,
      limit: sampleSize.toString(),
      offset: loaded.toString(),
      onlyMissing: "true",
    });
    if (countryCode) params.set("country", countryCode);
    fetch(`/api/occurrences?${params}`)
      .then((res) => res.json())
      .then((data) => {
        const next: OccurrenceFeature[] = data.features || [];
        setOccurrences((prev) => {
          const seen = new Set(prev.map((o) => o.properties.gbifID));
          return [...prev, ...next.filter((f) => !seen.has(f.properties.gbifID))];
        });
      })
      .catch(console.error)
      .finally(() => setLoadingMoreMissing(false));
  }, [occurrences, speciesKey, countryCode, sampleSize]);

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
      speciesKey,
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

  // Load the next batch across all basis-of-record categories together — the general
  // "Load N more" button next to the "Loaded X of Y" badge. Paginates via generalOffset
  // rather than occurrences.length so per-category loads (loadMoreForCategory) don't
  // desync it from GBIF's own unfiltered offset; de-dupes the merge by gbifID for the
  // same reason (a record already pulled in by a per-category load may reappear here).
  const loadMoreOverall = useCallback(() => {
    setLoadingMoreOverall(true);
    const params = new URLSearchParams({
      speciesKey,
      limit: OVERALL_LOAD_MORE_BATCH.toString(),
      offset: generalOffset.toString(),
    });
    if (countryCode) {
      params.set("country", countryCode);
    }
    // Keep paging the same record sets the user asked for, or the extra sets
    // would silently drop out of the sample on the first "load more".
    if (includeMissing) params.set("includeMissing", "true");
    params.set("includeIssues", "true");
    fetch(`/api/occurrences?${params}`)
      .then((res) => res.json())
      .then((data) => {
        const newFeatures: OccurrenceFeature[] = data.features || [];
        setOccurrences((prev) => {
          const seen = new Set(prev.map((o) => o.properties.gbifID));
          const toAdd = newFeatures.filter((f) => !seen.has(f.properties.gbifID));
          return [...prev, ...toAdd];
        });
        setGeneralOffset((prev) => prev + newFeatures.length);
        setTotalOccurrences(data.metadata?.total ?? null);
      })
      .catch(console.error)
      .finally(() => setLoadingMoreOverall(false));
  }, [generalOffset, speciesKey, countryCode, includeMissing]);

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
  // Only a species with a Red List assessment has an IUCN native range. An
  // unassessed species arrives here with no list at all (the dashboard withholds
  // its GBIF-derived countries), and an overlay offered but permanently disabled
  // reads as "we couldn't load it" rather than "there is no such thing".
  const hasIucnNativeRange = (nativeCountriesRedList?.length ?? 0) > 0;
  const hasNativeRangeData = hasIucnNativeRange || (nativeCountriesWcvp?.length ?? 0) > 0;
  // Same "outside native range" signal the map tooltip shows, bound to the
  // currently selected source, for the list view's Flags column.
  const isOutsideNativeRangeForList = useCallback(
    (countryCode: string | null | undefined) => isOutsideNativeRange(countryCode, effectiveNativeCountries),
    [effectiveNativeCountries]
  );
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

  // Multi-stage filtering pipeline, minus the date-range filter — kept as a separate
  // memo so the date-range slider's own track (sliderMinDate/sliderMaxDate below)
  // reflects the full span these other filters allow through, not a span already
  // narrowed by wherever the slider's own handles currently sit.
  const dateFilterableOccurrences = useMemo(() => {
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
    // 3b. GBIF's own geospatial issues, treated as one more cleaning check
    if (hideGbifFlagged) {
      result = result.filter((o) => !(o.properties.gbifIssues?.length));
    }
    // 4. Native range only — hide occurrences reported outside this species' native countries
    if (nativeRangeOnly) {
      result = result.filter((o) => !isOutsideNativeRange(o.properties.countryCode, effectiveNativeCountries));
    }
    return result;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks, hideGbifFlagged, nativeRangeOnly, effectiveNativeCountries]);

  // 5. Date range — applied last, on top of every filter above.
  const filteredOccurrences = useMemo(() => {
    if (dateRangeFrom == null && dateRangeTo == null) return dateFilterableOccurrences;
    return dateFilterableOccurrences.filter((o) => {
      const d = occurrenceDateKey(o);
      if (!d) return false;
      if (dateRangeFrom != null && d < dateRangeFrom) return false;
      if (dateRangeTo != null && d > dateRangeTo) return false;
      return true;
    });
  }, [dateFilterableOccurrences, dateRangeFrom, dateRangeTo]);

  // What the map draws and the export writes: everything the filters allow,
  // less anything struck out by hand. The list still shows all of it, greyed.
  const includedOccurrences = useMemo(
    () => filteredOccurrences.filter((o) => !exclusions[o.properties.gbifID]),
    [filteredOccurrences, exclusions]
  );

  // Records the filters have removed, for the list's Excluded column.
  const excludedIds = useMemo(() => {
    const kept = new Set(filteredOccurrences.map((o) => o.properties.gbifID));
    return new Set(occurrences.filter((o) => !kept.has(o.properties.gbifID)).map((o) => o.properties.gbifID));
  }, [occurrences, filteredOccurrences]);

  // The subset the map actually draws — the list shows all of filteredOccurrences,
  // including any fetched with no coordinates.
  const georeferencedFilteredCount = useMemo(
    () => includedOccurrences.filter(hasPosition).length,
    [includedOccurrences]
  );

  // Georeferences for records currently passing the filters — what the map
  // draws and what an export covers. A stored georeference whose record isn't
  // in the loaded sample stays in storage untouched.
  const visibleGeoreferences = useMemo(() => {
    const shown = new Set(includedOccurrences.map((o) => o.properties.gbifID));
    return Object.values(georeferences).filter((g) => shown.has(g.gbifID));
  }, [georeferences, includedOccurrences]);

  // The uncertainty radius, drawn to scale on the ground. A georeferenced
  // locality is an area, not a pinpoint, and showing it as a bare dot would
  // overstate it exactly the way the radius exists to prevent.
  const georeferenceCirclesGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: visibleGeoreferences.map((g) => ({
        type: "Feature" as const,
        properties: { gbifID: g.gbifID },
        geometry: uncertaintyCircle(
          g.decimalLatitude,
          g.decimalLongitude,
          g.coordinateUncertaintyInMeters
        ),
      })),
    }),
    [visibleGeoreferences]
  );

  const handleSaveGeoreference = useCallback(
    (georeference: Georeference) => {
      persistGeoreferences({ ...georeferences, [georeference.gbifID]: georeference });
      setEditingFeature(null);
      setGeorefMessage(null);
    },
    [georeferences, persistGeoreferences]
  );

  // Dragging a marker moves the point and leaves everything else — radius,
  // notes, the record it belongs to — alone.
  const handleGeoreferenceDragged = useCallback(
    (gbifID: number, lat: number, lon: number) => {
      const existing = georeferences[gbifID];
      if (!existing) return;
      persistGeoreferences({
        ...georeferences,
        [gbifID]: {
          ...existing,
          decimalLatitude: Number(lat.toFixed(5)),
          decimalLongitude: Number(lon.toFixed(5)),
          georeferencedDate: new Date().toISOString(),
        },
      });
    },
    [georeferences, persistGeoreferences]
  );

  const openGeoreferenceEditor = useCallback(
    (gbifID: number) => {
      const record = occurrences.find((o) => o.properties.gbifID === gbifID);
      if (record) setEditingFeature(record);
    },
    [occurrences]
  );

  const handleMarkerHover = useCallback(
    (gbifID: number) => {
      const record = occurrences.find((o) => o.properties.gbifID === gbifID);
      if (!record) return;
      setHoverFromMap(true);
      setHoveredFeature(record);
      setHoveredPanel("main");
    },
    [occurrences]
  );

  const handleDeleteGeoreference = useCallback(() => {
    if (!editingFeature) return;
    const next = { ...georeferences };
    delete next[editingFeature.properties.gbifID];
    persistGeoreferences(next);
    setEditingFeature(null);
  }, [editingFeature, georeferences, persistGeoreferences]);


  /**
   * Exports the table as it stands: every record the filters left in, minus
   * anything struck out by hand, with the assessor's coordinates in place of
   * GBIF's where they supplied any. Exporting only the georeferenced handful
   * would separate them from the evidence they were read against.
   *
   * Built in the browser — the assessor's own work over public GBIF fields,
   * with no Red List data in it, so there's nothing to gate.
   */
  const handleExport = useCallback(() => {
    if (includedOccurrences.length === 0) return;
    setGeorefMessage(null);
    try {
      const stamped: Record<number, Georeference> = Object.fromEntries(
        Object.entries(georeferences).map(([id, g]) => [
          Number(id),
          { ...g, georeferencedBy: g.georeferencedBy || accountEmail || undefined },
        ])
      );
      const csv = occurrencesToCsv(includedOccurrences, stamped);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(scientificName ?? speciesKey).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-occurrences.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const mine = includedOccurrences.filter((o) => georeferences[o.properties.gbifID]).length;
      setGeorefMessage({
        kind: "ok",
        text: `Exported ${includedOccurrences.length.toLocaleString()} record${includedOccurrences.length === 1 ? "" : "s"}${mine > 0 ? `, ${mine} with your coordinates` : ""}.`,
      });
    } catch {
      setGeorefMessage({ kind: "error", text: "Export failed." });
    }
  }, [includedOccurrences, georeferences, speciesKey, scientificName, accountEmail]);

  const handleImportFile = useCallback(
    async (file: File) => {
      setGeorefMessage(null);
      const text = await file.text();
      const { georeferences: imported, errors } = csvToGeoreferences(text);
      if (imported.length > 0) {
        const next = { ...georeferences };
        for (const g of imported) next[g.gbifID] = g;
        persistGeoreferences(next);
      }
      const parts: string[] = [];
      if (imported.length > 0) parts.push(`Imported ${imported.length} georeference${imported.length === 1 ? "" : "s"}.`);
      if (errors.length > 0) parts.push(`${errors.length} row${errors.length === 1 ? "" : "s"} skipped: ${errors[0]}${errors.length > 1 ? " …" : ""}`);
      setGeorefMessage({
        kind: imported.length > 0 ? "ok" : "error",
        text: parts.join(" ") || "Nothing to import.",
      });
    },
    [georeferences, persistGeoreferences]
  );

  // Would this record survive everything except the GBIF-flagged check? Used
  // to say what that one check is deciding on its own, the same way the other
  // cleaning rows report their own impact.
  const passesFiltersIgnoringGbifFlag = useCallback(
    (o: OccurrenceFeature) => {
      if (!checkedTypes[classifyOccurrence(o) as keyof typeof checkedTypes]) return false;
      if (maxUncertainty != null) {
        const u = o.properties.coordinateUncertaintyInMeters;
        if (u == null || u > maxUncertainty) return false;
      }
      if (o.properties.qualityFlags?.some((f) => appliedChecks[f as QualityFlag])) return false;
      if (nativeRangeOnly && isOutsideNativeRange(o.properties.countryCode, effectiveNativeCountries)) return false;
      return true;
    },
    [checkedTypes, maxUncertainty, appliedChecks, nativeRangeOnly, effectiveNativeCountries]
  );

  // How many flagged records are loaded, and how many the check alone decides
  // (i.e. they pass every other active filter) — same "shown of loaded" reading
  // as the other cleaning rows.
  const gbifFlaggedCounts = useMemo(() => {
    const flagged = occurrences.filter((o) => o.properties.gbifIssues?.length);
    const others = new Set(filteredOccurrences.map((o) => o.properties.gbifID));
    return {
      loaded: flagged.length,
      shown: hideGbifFlagged
        ? flagged.filter((o) => passesFiltersIgnoringGbifFlag(o)).length
        : flagged.filter((o) => others.has(o.properties.gbifID)).length,
    };
  }, [occurrences, filteredOccurrences, hideGbifFlagged, passesFiltersIgnoringGbifFlag]);

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
      if (dateRangeFrom != null || dateRangeTo != null) {
        const d = occurrenceDateKey(o);
        if (!d) continue;
        if (dateRangeFrom != null && d < dateRangeFrom) continue;
        if (dateRangeTo != null && d > dateRangeTo) continue;
      }
      if (isOutsideNativeRange(o.properties.countryCode, effectiveNativeCountries)) count++;
    }
    return count;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks, effectiveNativeCountries, dateRangeFrom, dateRangeTo]);

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
  // active filter — basis of record, uncertainty, date range, native range, and every
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
      if (dateRangeFrom != null || dateRangeTo != null) {
        const d = occurrenceDateKey(o);
        if (!d) continue;
        if (dateRangeFrom != null && d < dateRangeFrom) continue;
        if (dateRangeTo != null && d > dateRangeTo) continue;
      }
      const flags = o.properties.qualityFlags ?? [];
      for (const f of flags) {
        const key = f as QualityFlag;
        const blockedByOtherCheck = flags.some((f2) => f2 !== key && appliedChecks[f2 as QualityFlag]);
        if (!blockedByOtherCheck) counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [occurrences, checkedTypes, maxUncertainty, appliedChecks, nativeRangeOnly, effectiveNativeCountries, dateRangeFrom, dateRangeTo]);

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

  // Full date span of what's currently loaded and passing every filter except the
  // date-range filter itself — shared as the track bounds for both the split-view
  // before/after slider and the date-range filter slider below, so neither slider's
  // own bounds shrink as the user drags it.
  const { sliderMinDate, sliderMaxDate } = useMemo(() => {
    const dates = dateFilterableOccurrences
      .map((o) => o.properties.eventDate)
      .filter((d): d is string => d != null && d.length >= 10)
      .map((d) => d.slice(0, 10));
    if (dates.length === 0) return { sliderMinDate: splitDate, sliderMaxDate: splitDate };
    dates.sort();
    return { sliderMinDate: dates[0], sliderMaxDate: dates[dates.length - 1] };
  }, [dateFilterableOccurrences, splitDate]);

  // Assessment dates to mark on the date-range timeline — the current assessment
  // plus every past one (year-only entries fall back to Jan 1 of that year, same
  // as elsewhere in this file), de-duped by date since previousAssessments may or
  // may not already include the current assessment depending on the caller.
  const assessmentMarkers = useMemo(() => {
    const seen = new Set<string>();
    const markers: { date: string; category: string | null; criteria: string | null; isCurrent: boolean }[] = [];
    const add = (
      date: string | null | undefined,
      year: string | number | null | undefined,
      isCurrent: boolean,
      cat?: string | null,
      crit?: string | null,
    ) => {
      const d = date && date.length >= 10 ? date.slice(0, 10) : year != null ? `${year}-01-01` : null;
      if (!d || seen.has(d)) return;
      seen.add(d);
      markers.push({ date: d, category: cat ? normalizeCategory(cat) : null, criteria: crit || null, isCurrent });
    };
    add(assessmentDate, assessmentYear, true, category, criteria);
    for (const a of previousAssessments ?? []) {
      add(a.date, a.year, false, a.category, a.criteria);
    }
    return markers.sort((a, b) => a.date.localeCompare(b.date));
  }, [assessmentDate, assessmentYear, category, criteria, previousAssessments]);

  // Partition occurrences by exact assessment date — computed regardless of
  // split view so the Before/After rows of the range coverage table below stay
  // populated even when the user isn't in split view.
  const { preAssessmentOccs, postAssessmentOccs } = useMemo(() => {
    if (!splitDate) {
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
  }, [splitDate, filteredOccurrences]);

  // In-range/out-of-range breakdown of the currently-filtered GBIF occurrences
  // against the currently-visible IUCN range polygons — recomputed whenever the
  // range layer's polygons or the filtered occurrence set change, so it tracks
  // both the coordinate-cleaning/basis-of-record filters and the range category
  // toggles automatically. Before/after rows use the same assessment-date split
  // as split view, but are populated regardless of whether split view is open.
  const rangeCoverageStats = useMemo(() => {
    if (!rangePolygons || rangePolygons.length === 0) return null;
    const polygons = rangePolygons as Feature<Polygon | MultiPolygon>[];
    const computeFor = (allOccs: OccurrenceFeature[]) => {
      // In/out of the range polygons is only answerable for positioned records.
      const occs = allOccs.filter(hasPosition);
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
      total: computeFor(filteredOccurrences),
      before: splitDate ? computeFor(preAssessmentOccs) : null,
      after: splitDate ? computeFor(postAssessmentOccs) : null,
    };
  }, [rangePolygons, filteredOccurrences, splitDate, preAssessmentOccs, postAssessmentOccs]);

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
  // every other active filter — uncertainty, date range, coordinate cleaning, native
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
      if (dateRangeFrom != null || dateRangeTo != null) {
        const d = occurrenceDateKey(o);
        if (!d) continue;
        if (dateRangeFrom != null && d < dateRangeFrom) continue;
        if (dateRangeTo != null && d > dateRangeTo) continue;
      }
      entry.shown++;
    }
    return counts;
  }, [occurrences, maxUncertainty, appliedChecks, nativeRangeOnly, effectiveNativeCountries, dateRangeFrom, dateRangeTo]);

  // Build GeoJSON FeatureCollection with computed styling properties for the circle layer
  const buildStyledFeatureCollection = useCallback((
    panelOccurrences: OccurrenceFeature[],
  ): GeoJSON.FeatureCollection => {
    // Records with no coordinates can't be drawn — they're carried through the
    // same filter pipeline so the list can show them, and dropped here.
    const features = panelOccurrences.filter(hasPosition).map((feature) => {
      const isFeatureHovered = hoveredFeature?.properties.gbifID === feature.properties.gbifID;

      let strokeColor: string;
      let fillColor: string;
      if (feature.properties.coordinateStatus === "issue") {
        // Amber regardless of the colour mode: a record GBIF flags shouldn't be
        // indistinguishable from one it vouches for just because it happens to
        // be recent.
        strokeColor = "#b45309";
        fillColor = "#fbbf24";
      } else if (colorByDate) {
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

  // Entering or leaving fullscreen changes the map's size dramatically, and a
  // map keeps its centre and zoom when it resizes — so on a species whose
  // records sit off to one side, the change can slide them straight out of
  // view. Re-fit to the data once the new layout has settled.
  const prevFullscreenRef = useRef(fullscreen);
  useEffect(() => {
    if (prevFullscreenRef.current === fullscreen) return;
    prevFullscreenRef.current = fullscreen;
    if (!bbox) return;
    const timer = window.setTimeout(() => {
      mapRef.current?.resize();
      if (!fitMapToBbox(bbox)) pendingBboxRef.current = bbox;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fullscreen, bbox, fitMapToBbox]);

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
  /**
   * Fit whenever a map instance loads, not only when a fit was left pending.
   *
   * The panel swaps the map out for a spinner while occurrences are fetching,
   * so every refetch — fetching the records without coordinates, loading more —
   * mounts a brand new map at its default world view. The fit-once-per-bbox
   * guard then skips it, because that bbox was already fitted on the previous
   * instance, and the species' records end up as specks somewhere off-centre.
   */
  const handleMapLoad = useCallback(() => {
    const target = pendingBboxRef.current ?? bbox;
    if (!target) return;
    if (fitMapToBbox(target)) {
      fittedBboxRef.current = target.join(",");
      pendingBboxRef.current = null;
    }
  }, [bbox, fitMapToBbox]);

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

  // Loaded records by gbifID — the map hands back only what it stored on a
  // feature, which for the assessor-georeference layer is just an id.
  const occurrencesByGbifId = useMemo(
    () => new Map(occurrences.map((o) => [o.properties.gbifID, o])),
    [occurrences]
  );

  const handleMapMouseMove = useCallback((e: MapLayerMouseEvent, panelId: string) => {
    if (isTouchDevice) return;
    const features = e.features;
    if (features && features.length > 0) {
      const props = features[0].properties;
      if (props) {
        // Prefer the record we already hold: the assessor-georeference layer
        // carries nothing but a gbifID, and even the occurrence layer's own
        // properties arrive flattened (arrays stringified) through MapLibre.
        const known = occurrencesByGbifId.get(Number(props.gbifID));
        if (known) {
          cancelHoverClear();
          setHoverFromMap(true);
          if (known.properties.gbifID !== hoveredFeature?.properties.gbifID) setGroupIndex(0);
          setHoveredFeature(known);
          setHoveredPanel(panelId);
          return;
        }
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
    } else if (!tooltipHeld) {
      clearHoverSoon();
    }
  }, [isTouchDevice, occurrencesByGbifId, tooltipHeld, hoveredFeature, clearHoverSoon, cancelHoverClear]);

  const handleMapMouseLeave = useCallback(() => {
    if (tooltipHeld) return;
    clearHoverSoon();
  }, [tooltipHeld, clearHoverSoon]);

  // Dragging the divider between map and list. Pointer capture keeps the drag
  // alive when the pointer outruns the handle, which it will — the handle is
  // only a few pixels tall.
  const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingDivider(true);
  }, []);

  const handleDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingDivider) return;
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const span = panelLayout === "rows" ? rect.height : rect.width;
    if (span === 0) return;
    const pct = panelLayout === "rows"
      ? ((e.clientY - rect.top) / span) * 100
      : ((e.clientX - rect.left) / span) * 100;
    setMapHeightPct(Math.min(FULLSCREEN_MAX_MAP_PCT, Math.max(FULLSCREEN_MIN_MAP_PCT, pct)));
  }, [draggingDivider, panelLayout]);

  const handleDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDraggingDivider(false);
    // MapLibre tracks its container's size itself, but ask once at the end so
    // the final frame is definitely drawn at the size it settled on.
    mapRef.current?.resize();
  }, []);

  // Arrow keys move the divider too, so it isn't mouse-only.
  const handleDividerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowUp" ? -5 : e.key === "ArrowDown" ? 5 : 0;
    if (step === 0) return;
    e.preventDefault();
    setMapHeightPct((pct) =>
      Math.min(FULLSCREEN_MAX_MAP_PCT, Math.max(FULLSCREEN_MIN_MAP_PCT, pct + step))
    );
  }, []);

  /**
   * Hovering a row in the record list highlights that record on the map, using
   * the same hoveredFeature the map's own hover sets — so the link works in
   * both directions, and the map's tooltip appears for a row you're only
   * pointing at in the table. Rows GBIF has no coordinates for still set it
   * (the list highlights), there's simply nothing on the map to grow.
   */
  const handleHoverRow = useCallback(
    (feature: OccurrenceFeature | null) => {
      setHoverFromMap(false);
      if (!feature) {
        clearHoverSoon();
        return;
      }
      cancelHoverClear();
      setGroupIndex(0);
      setHoveredFeature(feature);
      setHoveredPanel("main");
    },
    [clearHoverSoon, cancelHoverClear]
  );

  // Handle view state change for split view sync
  const handleMoveForSync = useCallback((e: ViewStateChangeEvent) => {
    setSharedViewState({
      longitude: e.viewState.longitude,
      latitude: e.viewState.latitude,
      zoom: e.viewState.zoom,
    });
  }, []);

  // Where a hovered record sits on the map: the assessor's own coordinates
  // when they've supplied any, otherwise GBIF's. Null for a record with
  // neither, which is the one case with nothing to point at.
  const hoveredPosition = useMemo<[number, number] | null>(() => {
    if (!hoveredFeature) return null;
    const mine = georeferences[hoveredFeature.properties.gbifID];
    if (mine) return [mine.decimalLongitude, mine.decimalLatitude];
    return hoveredFeature.geometry?.coordinates ?? null;
  }, [hoveredFeature, georeferences]);

  /**
   * Records sharing a position, keyed by rounded coordinates.
   *
   * Duplicate sheets from one collection, or a series collected at one camp,
   * land on the same pixel and hide each other. Grouping them lets the tooltip
   * page through what's actually under the cursor instead of showing whichever
   * one happened to be on top.
   */
  const coLocatedByPosition = useMemo(() => {
    const groups = new Map<string, OccurrenceFeature[]>();
    for (const o of includedOccurrences) {
      const position = georeferences[o.properties.gbifID]
        ? [georeferences[o.properties.gbifID].decimalLongitude, georeferences[o.properties.gbifID].decimalLatitude]
        : o.geometry?.coordinates;
      if (!position) continue;
      const key = `${position[0].toFixed(4)},${position[1].toFixed(4)}`;
      const group = groups.get(key);
      if (group) group.push(o);
      else groups.set(key, [o]);
    }
    return groups;
  }, [includedOccurrences, georeferences]);

  const hoveredGroup = useMemo(() => {
    if (!hoveredFeature || !hoveredPosition) return [];
    const key = `${hoveredPosition[0].toFixed(4)},${hoveredPosition[1].toFixed(4)}`;
    return coLocatedByPosition.get(key) ?? [hoveredFeature];
  }, [hoveredFeature, hoveredPosition, coLocatedByPosition]);

  /**
   * A tooltip showing several records at one point stays put until you click
   * away: it has controls, and something you're paging through shouldn't
   * disappear because the pointer drifted off it. A single-record tooltip is
   * still pure hover — there's nothing in it to reach for.
   */
  const tooltipPinned = hoveredGroup.length > 1;
  tooltipPinnedRef.current = tooltipPinned;

  useEffect(() => {
    if (!tooltipPinned) return;
    const onPointerDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-occurrence-tooltip]")) return;
      closeTooltip();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTooltip();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tooltipPinned, closeTooltip]);

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
      <div className={`flex-1 flex flex-col rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 relative isolate z-0${fullscreen ? " min-h-0" : ""}`}>
        <div className={`${
          fullscreen
            ? "flex-1 min-h-[240px]"
            : splitView
              ? "h-[250px] sm:h-auto sm:min-h-[400px]"
              : "h-[300px] sm:h-auto sm:min-h-[450px]"
        } sm:flex-1 relative`}>
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
              interactiveLayerIds={[`occ-circles-${panelId}`, `georef-point-${panelId}`]}
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
              {/* The assessor's own georeferences — drawn above the GBIF points
                  in a colour used nowhere else, with the uncertainty radius to
                  scale. They are never merged into the GBIF layer or into any
                  GBIF count: one person's reading of a locality description
                  shouldn't become indistinguishable from a published record. */}
              {visibleGeoreferences.length > 0 && (
                <>
                  <Source id={`georef-circles-${panelId}`} type="geojson" data={georeferenceCirclesGeoJson}>
                    <Layer
                      id={`georef-circle-fill-${panelId}`}
                      type="fill"
                      paint={{ "fill-color": "#7c3aed", "fill-opacity": 0.12 }}
                    />
                    <Layer
                      id={`georef-circle-line-${panelId}`}
                      type="line"
                      paint={{ "line-color": "#7c3aed", "line-width": 1, "line-dasharray": [2, 2] }}
                    />
                  </Source>
                  {visibleGeoreferences.map((g) => (
                    <MapLibreMarker
                      key={g.gbifID}
                      longitude={g.decimalLongitude}
                      latitude={g.decimalLatitude}
                      anchor="center"
                      draggable
                      onDragEnd={(e) => handleGeoreferenceDragged(g.gbifID, e.lngLat.lat, e.lngLat.lng)}
                    >
                      {/* Drag to correct the position, click to open the editor —
                          the two things you do to a point you placed yourself. */}
                      <GeoreferenceMarkerDot
                        hovered={hoveredFeature?.properties.gbifID === g.gbifID}
                        onClick={() => openGeoreferenceEditor(g.gbifID)}
                        onEnter={() => handleMarkerHover(g.gbifID)}
                        onLeave={() => handleHoverRow(null)}
                      />
                    </MapLibreMarker>
                  ))}
                </>
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
              {/* Hover tooltip for map markers. A record you've georeferenced
                  yourself gets one too, anchored to your point — it's on the
                  map, so hovering its row should say something. Your
                  coordinates win over GBIF's where you've supplied both (you
                  only ever georeference a record GBIF got wrong or left
                  blank). */}
              {hoveredFeature && hoveredPosition && !hoveredObs && hoveredPanel === panelId && (() => {
                const [hLon, hLat] = hoveredPosition;
                const shown = hoveredGroup[Math.min(groupIndex, hoveredGroup.length - 1)] ?? hoveredFeature;
                const hInat = inatPhotosByGbifId.get(shown.properties.gbifID);
                const mine = georeferences[shown.properties.gbifID];
                return (
                  <MapOccurrenceTooltip
                    lat={hLat}
                    lng={hLon}
                    species={shown.properties.species}
                    basisOfRecord={shown.properties.basisOfRecord}
                    datasetName={shown.properties.datasetName}
                    eventDate={shown.properties.eventDate}
                    coordinateUncertaintyInMeters={mine?.coordinateUncertaintyInMeters ?? shown.properties.coordinateUncertaintyInMeters}
                    imageUrl={hInat?.imageUrl ?? null}
                    observer={hInat?.observer ?? null}
                    qualityFlags={mine ? undefined : shown.properties.qualityFlags}
                    outsideNativeRange={isOutsideNativeRange(shown.properties.countryCode, effectiveNativeCountries)}
                    country={shown.properties.country}
                    locality={shown.properties.locality || shown.properties.verbatimLocality}
                    yourGeoreference={mine ? { protocol: mine.georeferenceProtocol } : undefined}
                    images={shown.properties.images}
                    page={
                      hoveredGroup.length > 1
                        ? {
                            index: Math.min(groupIndex, hoveredGroup.length - 1),
                            total: hoveredGroup.length,
                            onPrev: () => setGroupIndex((i) => (i - 1 + hoveredGroup.length) % hoveredGroup.length),
                            onNext: () => setGroupIndex((i) => (i + 1) % hoveredGroup.length),
                          }
                        : undefined
                    }
                    onPointerEnter={() => {
                      cancelHoverClear();
                      setTooltipHeld(true);
                    }}
                    onPointerLeave={() => {
                      setTooltipHeld(false);
                      clearHoverSoon();
                    }}
                    onClose={hoveredGroup.length > 1 ? closeTooltip : undefined}
                  />
                );
              })()}
              {/* IUCN Range Map layer */}
              {showRange && assessmentId && canViewRangeMap && (
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
          {/* Loaded X of Y GBIF records — floating badge, single view only.
              Solid background (not translucent) in both themes: it sits over
              arbitrary map tiles, not a plain page background, so a tinted/
              translucent fill (as used elsewhere in the toolbar) reads with
              poor contrast in dark mode against light-colored tiles. */}
          {!splitView && !loadingOccurrences && totalOccurrences != null && (
            <div className="absolute top-2 right-2 z-[1000] max-w-[85%] px-2 py-1 rounded-lg shadow-md bg-emerald-50 dark:bg-emerald-900 border border-emerald-200 dark:border-emerald-700 text-[11px] text-emerald-700 dark:text-emerald-300">
              {isFullSample ? (
                <>All <strong>{(georeferencedTotal ?? 0).toLocaleString()}</strong> georeferenced GBIF records loaded.</>
              ) : (
                <>Loaded <strong>{georeferencedLoadedCount.toLocaleString()}</strong> of <strong>{(georeferencedTotal ?? 0).toLocaleString()}</strong> georeferenced GBIF records.</>
              )}
              {!isFullSample && (
                <>
                  {" "}
                  <button
                    onClick={loadMoreOverall}
                    disabled={loadingMoreOverall}
                    className="underline decoration-dotted hover:decoration-solid disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingMoreOverall
                      ? "Loading…"
                      : `Click to load ${Math.min(OVERALL_LOAD_MORE_BATCH, (georeferencedTotal ?? 0) - georeferencedLoadedCount).toLocaleString()} more`}
                  </button>
                </>
              )}
              {visibleGeoreferences.length > 0 && (
                <> Plus <strong>{visibleGeoreferences.length.toLocaleString()}</strong> you georeferenced.</>
              )}
              {georeferencedFilteredCount < georeferencedLoadedCount && (
                <> Showing <strong>{georeferencedFilteredCount.toLocaleString()}</strong> after filters.</>
              )}
            </div>
          )}
          {/* Records with no coordinates get their own badge, since they're
              counted, paged and read separately — nothing about them appears on
              the map itself. */}
          {fullscreen && !loadingOccurrences && (recordSetTotals?.missing ?? 0) > 0 && (
            <div className="absolute top-11 right-2 z-[1000] max-w-[85%] px-2 py-1 rounded-lg shadow-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300">
              {missingLoadedCount >= (recordSetTotals?.missing ?? 0) ? (
                <>All <strong>{(recordSetTotals?.missing ?? 0).toLocaleString()}</strong> records without coordinates loaded.</>
              ) : (
                <>
                  Loaded <strong>{missingLoadedCount.toLocaleString()}</strong> of{" "}
                  <strong>{(recordSetTotals?.missing ?? 0).toLocaleString()}</strong> without coordinates.{" "}
                  <button
                    onClick={loadMoreMissing}
                    disabled={loadingMoreMissing}
                    className="underline decoration-dotted hover:decoration-solid disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingMoreMissing
                      ? "Loading…"
                      : `Click to load ${Math.min(sampleSize, (recordSetTotals?.missing ?? 0) - missingLoadedCount).toLocaleString()} more`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Georeferenced records — the ones GBIF has coordinates for, whether or not
  // it flags them. Counted apart from `occurrences.length`, which can also hold
  // records fetched with no coordinates at all and would otherwise make a
  // partial sample look complete.
  const georeferencedLoadedCount = useMemo(
    () => occurrences.filter(hasPosition).length,
    [occurrences]
  );
  const missingLoadedCount = useMemo(
    () => occurrences.filter((o) => o.properties.coordinateStatus === "missing").length,
    [occurrences]
  );
  const georeferencedTotal = recordSetTotals
    ? recordSetTotals.mapped + recordSetTotals.issue
    : totalOccurrences;

  // Once every GBIF record for this species is loaded (no more to page in), the
  // basis-of-record dropdown's "total" and "loaded" columns are always identical —
  // collapse them into one column rather than showing the same number twice.
  const isFullSample = georeferencedTotal == null || georeferencedTotal <= georeferencedLoadedCount;

  // All toggleable map layers in the Overlays dropdown, for its "N of M" badge —
  // GBIF/range/AOH only count when actually available for this species.
  const overlayToggleValues = [
    showGbif,
    ...(assessmentId && canViewRangeMap ? [showRange] : []),
    ...(isAohAvailable ? [showAoh] : []),
    showProtectedAreas,
    showPowoRangeOverlay,
    ...(hasIucnNativeRange ? [showIucnRangeOverlay] : []),
  ];

  return (
    <div
      className={
        fullscreen
          ? "flex flex-col h-full min-h-0 bg-white dark:bg-zinc-900"
          : "bg-zinc-50 dark:bg-zinc-800/50"
      }
    >
      {pendingExclusion && (
        <ExclusionDialog
          gbifIDs={pendingExclusion}
          onConfirm={confirmExclusion}
          onCancel={() => setPendingExclusion(null)}
        />
      )}
      {editingFeature && (
        <GeoreferenceEditor
          feature={editingFeature}
          existing={georeferences[editingFeature.properties.gbifID]}
          georeferencedBy={accountEmail}
          scientificName={scientificName}
          onSave={handleSaveGeoreference}
          onDelete={handleDeleteGeoreference}
          onClose={() => setEditingFeature(null)}
        />
      )}
      <div className={fullscreen ? "p-2 flex-1 min-h-0 flex flex-col" : "p-2"}>
        <div className={`flex flex-col gap-2${fullscreen ? " flex-1 min-h-0" : ""}`}>
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
                    {/* Counts every row in the dropdown, GBIF's own verdict included */}
                    Applied {flagDefs.filter((d) => appliedChecks[d.key]).length + (hideGbifFlagged ? 1 : 0) + (hasNativeRangeData && nativeRangeOnly ? 1 : 0)} of {flagDefs.length + 1 + (hasNativeRangeData ? 1 : 0)}
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
                          setHideGbifFlagged(true);
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
                          setHideGbifFlagged(false);
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
                    {/* GBIF's own verdict on a record's coordinates, sitting
                        with the checks rather than apart from them: it's the
                        same kind of judgement — this point looks wrong — just
                        made upstream. Flagged records are always fetched, so
                        this only ever hides or shows what's already loaded. */}
                    <label
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                        gbifFlaggedCounts.loaded > 0
                          ? "hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                          : "opacity-50 cursor-not-allowed"
                      }`}
                      title="GBIF flags these coordinates as suspect — zero coordinates, a country that doesn't match the position, swapped or negated latitude/longitude. Shown in amber on the map when not hidden."
                    >
                      <input
                        type="checkbox"
                        checked={hideGbifFlagged}
                        disabled={gbifFlaggedCounts.loaded === 0}
                        onChange={() => setHideGbifFlagged((v) => !v)}
                        className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                      />
                      <span className={`flex-1 min-w-0 ${gbifFlaggedCounts.shown > 0 ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}>
                        Flagged by GBIF
                      </span>
                      <a
                        href="https://techdocs.gbif.org/en/openapi/"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Reference: GBIF's own geospatial occurrence issues"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.open("https://techdocs.gbif.org/en/openapi/", "_blank", "noopener,noreferrer");
                        }}
                        className="shrink-0 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
                      >
                        <FaInfoCircle className="w-3 h-3" />
                      </a>
                      <span className={`ml-auto tabular-nums shrink-0 text-[11px] font-medium ${gbifFlaggedCounts.shown > 0 ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"}`}>
                        {gbifFlaggedCounts.shown === 0
                          ? "0 records"
                          : hideGbifFlagged
                            ? `${gbifFlaggedCounts.shown.toLocaleString()} record${gbifFlaggedCounts.shown === 1 ? "" : "s"} hidden`
                            : `Hide ${gbifFlaggedCounts.shown.toLocaleString()} record${gbifFlaggedCounts.shown === 1 ? "" : "s"}`}
                      </span>
                    </label>
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
              {/* Date range — client-side slider filtering the currently loaded sample
                  to an eventDate window. The track spans whatever the filters above
                  allow through (dateFilterableOccurrences), not the species' full GBIF
                  history — the "Load N more" button next to the map's "Loaded X of Y"
                  badge is what extends that span. GBIF's search API has no server-side
                  date sort/filter of its own (see api/occurrences/route.ts), so this
                  operates entirely on what's already been paged in. */}
              <div className="relative" ref={dateRangeRef}>
                <button
                  onClick={() => setDateRangeOpen(!dateRangeOpen)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                    dateRangeOpen
                      ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-500"
                      : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  } text-zinc-700 dark:text-zinc-300`}
                  title="Filter the loaded sample to an observation date range"
                >
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="4" width="18" height="17" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18M8 2v4M16 2v4" />
                  </svg>
                  Date range
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {dateRangeFrom == null && dateRangeTo == null
                      ? "All dates"
                      : `${dateRangeFrom ?? sliderMinDate} – ${dateRangeTo ?? sliderMaxDate}`}
                  </span>
                  <svg className={`w-3 h-3 text-zinc-400 transition-transform ${dateRangeOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {dateRangeOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg p-3">
                    {sliderMinDate === sliderMaxDate ? (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">Not enough dated records loaded to filter by range.</p>
                    ) : (
                      (() => {
                        const totalDays = Math.max(1, Math.round((new Date(sliderMaxDate).getTime() - new Date(sliderMinDate).getTime()) / 86400000));
                        const fromDays = dateRangeFrom != null
                          ? Math.round((new Date(dateRangeFrom).getTime() - new Date(sliderMinDate).getTime()) / 86400000)
                          : 0;
                        const toDays = dateRangeTo != null
                          ? Math.round((new Date(dateRangeTo).getTime() - new Date(sliderMinDate).getTime()) / 86400000)
                          : totalDays;
                        const dayOffsetToDate = (days: number) => {
                          const d = new Date(sliderMinDate);
                          d.setDate(d.getDate() + days);
                          return d.toISOString().slice(0, 10);
                        };
                        const pct = (days: number) => Math.max(0, Math.min(100, (days / totalDays) * 100));

                        // Assessment markers, positioned against this same track's day
                        // offsets. Most assessments predate the currently-loaded GBIF
                        // window (GBIF's own paging is recency-biased — see the comment
                        // on the outer wrapper), so "before"/"after" the visible track
                        // are the common case, not an edge case — collapse those into a
                        // single count badge at the relevant edge rather than a pile of
                        // off-track dots.
                        const markerDays = assessmentMarkers.map((m) => ({
                          ...m,
                          days: Math.round((new Date(m.date).getTime() - new Date(sliderMinDate).getTime()) / 86400000),
                        }));
                        const inRangeMarkers = markerDays.filter((m) => m.days >= 0 && m.days <= totalDays);
                        const beforeMarkers = markerDays.filter((m) => m.days < 0);
                        const afterMarkers = markerDays.filter((m) => m.days > totalDays);
                        const markerLabel = (m: (typeof markerDays)[number]) =>
                          `${m.date}${m.category ? ` — ${m.category}${m.criteria ? ` (${m.criteria})` : ""}` : ""}${m.isCurrent ? " (current)" : ""}`;
                        const titleFor = (list: typeof markerDays) => list.map(markerLabel).join("\n");

                        // Snap a handle onto a nearby in-range assessment marker (within
                        // ~1.5% of the track) so it's easy to trim exactly to "everything
                        // since this assessment" rather than fighting day-by-day precision.
                        // Returns the marker itself (not just its day offset) so callers can
                        // use its exact date string — going back through dayOffsetToDate's
                        // UTC-parsed-diff/local-reconstructed round trip can drift by a day.
                        const snapThresholdDays = Math.max(1, Math.round(totalDays * 0.015));
                        const snapToMarker = (days: number) => {
                          let closest: (typeof inRangeMarkers)[number] | null = null;
                          let closestDist = Infinity;
                          for (const m of inRangeMarkers) {
                            const dist = Math.abs(m.days - days);
                            if (dist <= snapThresholdDays && dist < closestDist) {
                              closest = m;
                              closestDist = dist;
                            }
                          }
                          return closest;
                        };

                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                              <span className="font-medium">{dateRangeFrom ?? sliderMinDate}</span>
                              <span className="text-zinc-400">to</span>
                              <span className="font-medium">{dateRangeTo ?? sliderMaxDate}</span>
                            </div>
                            {/* Timeline: assessment markers above a single track with two
                                overlapping trim handles — see the .dual-range-thumb rules
                                in globals.css for how the inputs stack without one
                                swallowing the other's clicks. Markers and track share the
                                same relative coordinate space so their % positions line up. */}
                            <div className={`relative ${assessmentMarkers.length > 0 ? "pt-4" : ""}`}>
                              {assessmentMarkers.length > 0 && (
                                <div className="absolute inset-x-0 top-0 h-4">
                                  {inRangeMarkers.map((m) => {
                                    const color = m.category ? CATEGORY_COLORS[m.category] : null;
                                    const solidText = m.category === "EX" || m.category === "EW";
                                    return (
                                      <div
                                        key={m.date}
                                        className="absolute bottom-0"
                                        style={{ left: `${pct(m.days)}%`, transform: "translateX(-50%)" }}
                                        title={`Assessed ${markerLabel(m)}`}
                                      >
                                        {color ? (
                                          <span
                                            className={`block px-1 rounded-sm text-[8px] leading-[11px] font-semibold whitespace-nowrap ${
                                              m.isCurrent ? "ring-1 ring-offset-1 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-900" : ""
                                            }`}
                                            style={
                                              solidText
                                                ? { backgroundColor: color, color: "#fff" }
                                                : { backgroundColor: `${color}20`, color }
                                            }
                                          >
                                            {m.category}
                                          </span>
                                        ) : (
                                          <div className={`w-1.5 h-1.5 rounded-full mx-auto ${m.isCurrent ? "bg-amber-500" : "bg-amber-400/70 dark:bg-amber-500/60"}`} />
                                        )}
                                        <div className={`w-px h-1 mx-auto ${m.isCurrent ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                                      </div>
                                    );
                                  })}
                                  {beforeMarkers.length > 0 && (
                                    <div
                                      className="absolute bottom-0 left-0 text-[9px] leading-none text-amber-600 dark:text-amber-400 cursor-default"
                                      title={`Assessed before ${sliderMinDate}:\n${titleFor(beforeMarkers)}`}
                                    >
                                      ‹{beforeMarkers.length}
                                    </div>
                                  )}
                                  {afterMarkers.length > 0 && (
                                    <div
                                      className="absolute bottom-0 right-0 text-[9px] leading-none text-amber-600 dark:text-amber-400 cursor-default"
                                      title={`Assessed after ${sliderMaxDate}:\n${titleFor(afterMarkers)}`}
                                    >
                                      {afterMarkers.length}›
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="relative h-5 flex items-center">
                                <div className="absolute inset-x-0 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                                <div
                                  className="absolute h-1.5 rounded-full bg-blue-500"
                                  style={{
                                    left: `${pct(Math.min(fromDays, toDays))}%`,
                                    right: `${100 - pct(Math.max(fromDays, toDays))}%`,
                                  }}
                                />
                                <input
                                  type="range"
                                  min={0}
                                  max={totalDays}
                                  value={Math.min(fromDays, toDays)}
                                  onChange={(e) => {
                                    const raw = Math.min(parseInt(e.target.value, 10), toDays);
                                    const snapped = snapToMarker(raw);
                                    if (snapped) {
                                      setDateRangeFrom(snapped.days <= 0 ? null : snapped.date);
                                    } else {
                                      setDateRangeFrom(raw <= 0 ? null : dayOffsetToDate(raw));
                                    }
                                  }}
                                  onPointerDown={() => setActiveDateHandle("from")}
                                  style={{ zIndex: activeDateHandle === "from" ? 5 : 3 }}
                                  className="dual-range-thumb"
                                  aria-label="From date"
                                />
                                <input
                                  type="range"
                                  min={0}
                                  max={totalDays}
                                  value={Math.max(toDays, fromDays)}
                                  onChange={(e) => {
                                    const raw = Math.max(parseInt(e.target.value, 10), fromDays);
                                    const snapped = snapToMarker(raw);
                                    if (snapped) {
                                      setDateRangeTo(snapped.days >= totalDays ? null : snapped.date);
                                    } else {
                                      setDateRangeTo(raw >= totalDays ? null : dayOffsetToDate(raw));
                                    }
                                  }}
                                  onPointerDown={() => setActiveDateHandle("to")}
                                  style={{ zIndex: activeDateHandle === "to" ? 5 : 4 }}
                                  className="dual-range-thumb"
                                  aria-label="To date"
                                />
                              </div>
                              <div className="flex items-center justify-between text-[9px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                                <span>{sliderMinDate}</span>
                                <span>{sliderMaxDate}</span>
                              </div>
                            </div>
                            {assessmentMarkers.length > 0 && (
                              <div className="text-[9px] text-zinc-400 dark:text-zinc-500">
                                Marked dates are Red List assessments, colored by category — drag a handle near one to snap to it.
                              </div>
                            )}
                            {(dateRangeFrom != null || dateRangeTo != null) && (
                              <button
                                onClick={() => { setDateRangeFrom(null); setDateRangeTo(null); }}
                                className="self-start text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline"
                              >
                                Reset to all dates
                              </button>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>
              {/* Overlays — every toggleable map layer lives here: GBIF points/
                  IUCN range map/AOH (species-specific data layers) plus
                  Protected areas/POWO native range/IUCN native countries
                  (contextual native-range shading), independent of the
                  "Native range only" occurrence filter above. */}
              <div className="relative" ref={overlaysRef}>
                <button
                  onClick={() => setOverlaysOpen(!overlaysOpen)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                    overlaysOpen
                      ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-500"
                      : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  } text-zinc-700 dark:text-zinc-300`}
                  title="Map overlays: GBIF points, IUCN range map, AOH, protected areas, POWO/IUCN native countries"
                >
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Overlays
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {overlayToggleValues.filter(Boolean).length} of {overlayToggleValues.length}
                  </span>
                  <svg className={`w-3 h-3 text-zinc-400 transition-transform ${overlaysOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {overlaysOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg py-1">
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={showGbif}
                        onChange={() => setShowGbif((v) => !v)}
                        className="w-3 h-3 rounded accent-blue-500 shrink-0"
                      />
                      <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200">GBIF Points</span>
                    </label>
                    {assessmentId && canViewRangeMap && (
                      <div>
                        <label
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                          title="Toggle IUCN range map overlay. Range maps are indicative only and may not reflect current distributions."
                        >
                          <input
                            type="checkbox"
                            checked={showRange}
                            onChange={() => setShowRange((v) => !v)}
                            className="w-3 h-3 rounded accent-rose-500 shrink-0"
                          />
                          <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200 flex items-center gap-1">
                            IUCN Range Map
                            {rangeLoading && (
                              <svg className="w-3 h-3 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            )}
                          </span>
                          {showRange && rangeCategories.length > 1 && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRangeCategoriesExpanded(!rangeCategoriesExpanded); }}
                              className="shrink-0 text-zinc-400 hover:text-zinc-600"
                            >
                              {rangeCategoriesExpanded ? "▴" : "▾"}
                            </button>
                          )}
                        </label>
                        {showRange && rangeNotFound && (
                          <span className="block px-3 pb-1.5 text-[10px] text-zinc-400 italic">Not yet available</span>
                        )}
                        {showRange && !rangeNotFound && rangeSimplification && (
                          <span
                            className="flex items-center gap-1 px-3 pb-1.5 text-[10px] text-amber-600 dark:text-amber-400 cursor-help"
                            title={`This range map has been simplified at ${rangeSimplification.tolerance}° (~${Math.round(rangeSimplification.tolerance * 111)}km) to reduce file size. Fine-scale boundary details may be lost.`}
                          >
                            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M12 16v-4M12 8h.01" />
                            </svg>
                            Simplified to {rangeSimplification.tolerance}°
                          </span>
                        )}
                        {showRange && rangeCategoriesExpanded && rangeCategories.length > 0 && (
                          <div className="flex flex-col gap-0.5 px-3 pb-1.5 pl-6">
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
                                  className={`flex items-center gap-1 py-0.5 rounded text-[10px] transition-colors ${
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
                      <label
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                        title="Toggle Area of Habitat overlay"
                      >
                        <input
                          type="checkbox"
                          checked={showAoh}
                          onChange={() => setShowAoh((v) => !v)}
                          className="w-3 h-3 rounded accent-green-500 shrink-0"
                        />
                        <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200 flex items-center gap-1">
                          AOH
                          {aohLoading && (
                            <svg className="w-3 h-3 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          )}
                        </span>
                      </label>
                    )}
                    <div className="border-t border-zinc-100 dark:border-zinc-800 my-1" />
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
{hasIucnNativeRange && (
                    <label
                      className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                      title="Shade the countries this species' IUCN Red List assessment lists as native range"
                    >
                      <input
                        type="checkbox"
                        checked={showIucnRangeOverlay}
                        onChange={() => setShowIucnRangeOverlay((v) => !v)}
                        className="w-3 h-3 rounded accent-amber-500 shrink-0"
                      />
                      <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200">IUCN native countries</span>
                    </label>
                    )}
                  </div>
                )}
              </div>
              {/* Everything to the right of the filters: actions rather
                  than filters, kept together so they don't scatter when
                  some of them are hidden. */}
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                {/* Georeference export/import. On the toolbar rather than in a
                    dropdown because they're actions, not filters — and ungated:
                    a georeference is the assessor's own work over public GBIF
                    fields, with no Red List data in it. */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {georefMessage && (
                      <span
                        className={`max-w-[16rem] truncate text-[10px] ${
                          georefMessage.kind === "ok"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                        title={georefMessage.text}
                      >
                        {georefMessage.text}
                      </span>
                    )}
                    <button
                      onClick={handleExport}
                      disabled={includedOccurrences.length === 0}
                      title={`Download the ${includedOccurrences.length.toLocaleString()} record${includedOccurrences.length === 1 ? "" : "s"} currently in the table as a Darwin Core CSV, with your own coordinates in place of GBIF's wherever you've added them.`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      Export CSV
                      <span className="tabular-nums text-[10px] text-zinc-400">
                        {includedOccurrences.length.toLocaleString()}
                      </span>
                    </button>
                    <button
                      onClick={() => importInputRef.current?.click()}
                      title="Load georeferences from a CSV exported here"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 8l5-5 5 5M12 3v12" />
                      </svg>
                      Import CSV
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportFile(file);
                        e.target.value = "";
                      }}
                    />
                </div>
                {fullscreen && (
                  <button
                    onClick={() => setPanelLayout((v) => (v === "rows" ? "columns" : "rows"))}
                    title={
                      panelLayout === "rows"
                        ? "Put the list beside the map"
                        : "Put the list below the map"
                    }
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shrink-0"
                  >
                    <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <rect x="3" y="4" width="18" height="16" rx="1.5" />
                      {panelLayout === "rows" ? (
                        <path strokeLinecap="round" d="M3 13h18" />
                      ) : (
                        <path strokeLinecap="round" d="M13 4v16" />
                      )}
                    </svg>
                    {panelLayout === "rows" ? "Side by side" : "Stacked"}
                  </button>
                )}
                {/* Fullscreen is a page of its own, so this is a real link:
                    it can be copied, opened in a new tab, and shared, and the
                    page it opens skips every dashboard query. In fullscreen the
                    same slot becomes the way out — one button, not two. */}
                {fullscreen ? (
                  <Link
                    href={dashboardHref}
                    title="Back to this species on the dashboard"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shrink-0"
                  >
                    <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4H6a2 2 0 00-2 2v3m0 6v3a2 2 0 002 2h3m6 0h3a2 2 0 002-2v-3m0-6V6a2 2 0 00-2-2h-3" />
                    </svg>
                    Exit fullscreen
                  </Link>
                ) : (
                  <Link
                    href={`/mapping/${encodeURIComponent(speciesKey)}`}
                    title="Open the map and record list fullscreen, on their own shareable page"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shrink-0"
                  >
                    <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V5a1 1 0 011-1h3m8 0h3a1 1 0 011 1v3m0 8v3a1 1 0 01-1 1h-3m-8 0H5a1 1 0 01-1-1v-3" />
                    </svg>
                    Fullscreen
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* ── Left sidebar (iNat photos + contributors) + Map (right) ── */}
          <div
            ref={splitRef}
            className={
              fullscreen
                ? `flex flex-1 min-h-0 ${panelLayout === "rows" ? "flex-col" : "flex-row"}`
                : "flex flex-col sm:flex-row sm:items-stretch gap-2"
            }
          >
            {/* Left column — iNat photo gallery only (hidden if no iNat data); narrow
                since it's just a 2-col thumbnail grid now, leaving more room for the map.
                Ordered after the map on mobile (order-2) since the map is the primary
                content there; back to its normal DOM order (first, on the left) at sm+. */}
            {/* Hidden in fullscreen — that view is the map and the record list
                and nothing else, and the photo grid plays the same
                hover-to-highlight role the list does there. */}
            {!fullscreen && (!breakdown || breakdown.iNaturalist > 0) && (
            <div className="order-2 sm:order-none sm:w-44 shrink-0 flex flex-col gap-2">
              {/* iNat photo grid — only shown when photos exist or loading */}
              {(inatPhotos.length > 0 || loadingInatPhotos) && (
                <div className="flex flex-col bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden relative z-10">
                  {/* Header */}
                  <div className="px-2 py-1.5 text-xs sm:text-[10px] font-medium text-zinc-500 dark:text-zinc-400 text-center border-b border-zinc-100 dark:border-zinc-800">
                    iNaturalist Observations
                  </div>
                  {inatPhotos.length > 0 ? (
                    <>
                      {/* Photos — 5-col x 2-row grid on mobile (full-width column there),
                          2-col x 5-row once the sidebar narrows to w-44 at sm+ */}
                      <div className={`grid grid-cols-5 sm:grid-cols-2 gap-1 p-1.5 ${loadingInatPhotos ? "opacity-50" : ""}`}>
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
            <div
              className={`order-1 sm:order-none flex-1 min-w-0 flex flex-col gap-2${fullscreen ? " min-h-0" : ""}`}
              // Two thirds by default, and whatever the divider has been
              // dragged to after that.
              style={fullscreen ? { flex: `0 0 ${mapHeightPct}%` } : undefined}
            >
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
                  renderMapPanel(includedOccurrences, bbox, null)
                )}
                {/* In-range/out-of-range breakdown vs. the currently-visible IUCN
                    range polygons — one table covering Total plus (when a split
                    date is available — defaults to the assessment date, but
                    tracks wherever the split view slider is dragged to) Before/
                    After rows, regardless of whether split view is open.
                    Auto-updates with every occurrence filter and every range
                    category toggle. Rendered in-flow below the map(s) (not
                    floated over them) — it collides with the bottom legend/
                    toolbar row when floated, since that row can grow wide
                    enough to reach the corner. */}
                {showRange && rangeCoverageStats && rangeCoverageStats.total.total > 0 && (
                  <div className="w-full px-3 py-2 rounded-lg shadow-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left font-medium text-zinc-700 dark:text-zinc-200 pr-3 pb-1 w-2/5">GBIF vs. range map</th>
                          <th className="text-right font-medium text-zinc-400 dark:text-zinc-500 px-2 pb-1 w-[15%]"># Total</th>
                          <th className="text-right font-medium text-zinc-400 dark:text-zinc-500 px-2 pb-1 w-[15%]"># In range</th>
                          <th className="text-right font-medium text-zinc-400 dark:text-zinc-500 px-2 pb-1 w-[15%]"># Out range</th>
                          <th className="text-right font-medium text-zinc-400 dark:text-zinc-500 pl-2 pb-1 w-[15%]">% In range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["Total", rangeCoverageStats.total, true],
                            ...(rangeCoverageStats.before ? [[`Before ${splitDate}`, rangeCoverageStats.before, false] as const] : []),
                            ...(rangeCoverageStats.after ? [[`After ${splitDate}`, rangeCoverageStats.after, false] as const] : []),
                          ] as [string, { inRange: number; outRange: number; total: number }, boolean][]
                        ).map(([rowLabel, stats, isTotal]) => (
                          <tr
                            key={rowLabel}
                            className={
                              isTotal
                                ? "border-t border-b-2 border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900/40 font-semibold text-zinc-800 dark:text-zinc-100"
                                : "border-t border-zinc-100 dark:border-zinc-700"
                            }
                          >
                            <td className="text-left pr-3 py-1">{rowLabel}</td>
                            <td className="text-right px-2 py-1">{stats.total.toLocaleString()}</td>
                            <td className="text-right px-2 py-1">{stats.inRange.toLocaleString()}</td>
                            <td className="text-right px-2 py-1">{stats.outRange.toLocaleString()}</td>
                            <td className="text-right pl-2 py-1">
                              {stats.total > 0 ? `${Math.round((stats.inRange / stats.total) * 100)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>

            {/* Record list — only in fullscreen, where there's room to read it
                against the map. Hovering a row highlights that record's point
                and vice versa: the table carries the locality and collection
                detail, the map carries the position. Stacks below the map on
                narrow screens. */}
            {fullscreen && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize map and record list"
                aria-valuenow={Math.round(mapHeightPct)}
                aria-valuemin={FULLSCREEN_MIN_MAP_PCT}
                aria-valuemax={FULLSCREEN_MAX_MAP_PCT}
                tabIndex={0}
                onPointerDown={handleDividerPointerDown}
                onPointerMove={handleDividerPointerMove}
                onPointerUp={handleDividerPointerUp}
                onPointerCancel={handleDividerPointerUp}
                onKeyDown={handleDividerKeyDown}
                title="Drag to resize the map and the list"
                className={`order-2 sm:order-none group relative shrink-0 touch-none flex items-center justify-center ${
                  panelLayout === "rows" ? "w-full h-3 cursor-row-resize" : "h-full w-3 cursor-col-resize"
                } ${
                  draggingDivider ? "bg-blue-100 dark:bg-blue-900/40" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                } focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded`}
              >
                <div
                  className={`rounded-full transition-colors ${panelLayout === "rows" ? "h-0.5 w-10" : "w-0.5 h-10"} ${
                    draggingDivider
                      ? "bg-blue-500"
                      : "bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500"
                  }`}
                />
              </div>
            )}
            {fullscreen && (
              <div className="order-3 sm:order-none flex flex-col gap-2 min-w-0 flex-1 min-h-0">
                <OccurrenceListTable
                  occurrences={occurrences}
                  loading={loadingOccurrences}
                  isOutsideNativeRange={isOutsideNativeRangeForList}
                  georeferences={georeferences}
                  onEditGeoreference={setEditingFeature}
                  hoveredGbifId={hoveredFeature?.properties.gbifID ?? null}
                  onHoverRow={handleHoverRow}
                  hoverFromMap={hoverFromMap}
                  excludedIds={excludedIds}
                  exclusions={exclusions}
                  onExclude={setPendingExclusion}
                  onInclude={includeAgain}
                  fillHeight
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
