"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

// Hook to get responsive grid column count: 3 (mobile portrait), 5 (landscape/sm+)
function useGridColumns() {
  const [cols, setCols] = useState(5);
  useEffect(() => {
    const smQuery = window.matchMedia("(min-width: 640px)");
    const update = () => setCols(smQuery.matches ? 5 : 3);
    update();
    smQuery.addEventListener("change", update);
    return () => smQuery.removeEventListener("change", update);
  }, []);
  return cols;
}

// Dynamically import Leaflet components
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((mod) => mod.CircleMarker),
  { ssr: false }
);
const Circle = dynamic(
  () => import("react-leaflet").then((mod) => mod.Circle),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
);
const LocateControl = dynamic(
  () => import("./LocateControl"),
  { ssr: false }
);
const MapImageTooltip = dynamic(
  () => import("./MapImageTooltip"),
  { ssr: false }
);
const FitBounds = dynamic(
  () => import("./FitBounds"),
  { ssr: false }
);

const INAT_DATASET_KEY = "50c9509d-22c7-4a22-a47d-8c48425ef4a7";

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

// Deduplication grid sizes
const DEDUP_OPTIONS = [
  { label: "~10m", value: 0.0001 },
  { label: "~100m", value: 0.001 },
  { label: "~1km", value: 0.01 },
  { label: "~10km", value: 0.1 },
] as const;

// Sample size options
const SAMPLE_SIZE_OPTIONS = [100, 300, 500, 1000, 2000] as const;

// Spatial deduplication: keep one record per grid cell, preferring newest
function deduplicateSpatially(
  features: OccurrenceFeature[],
  gridDeg: number
): OccurrenceFeature[] {
  const cells = new Map<string, OccurrenceFeature>();
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const cellKey = `${Math.round(lat / gridDeg)},${Math.round(lon / gridDeg)}`;
    const existing = cells.get(cellKey);
    if (!existing || (f.properties.year ?? 0) > (existing.properties.year ?? 0)) {
      cells.set(cellKey, f);
    }
  }
  return Array.from(cells.values());
}

// Year-based color interpolation (oldest=amber, newest=green)
function yearToColor(year: number, minYear: number, maxYear: number): { stroke: string; fill: string } {
  if (minYear === maxYear) return { stroke: "#15803d", fill: "#22c55e" };
  const t = (year - minYear) / (maxYear - minYear); // 0 = oldest, 1 = newest
  // Interpolate hue from 30 (amber) to 142 (green)
  const hue = Math.round(30 + t * 112);
  const sat = Math.round(60 + t * 20);
  return {
    stroke: `hsl(${hue}, ${sat}%, 30%)`,
    fill: `hsl(${hue}, ${sat}%, 50%)`,
  };
}

// Mini bar chart of occurrences per year (pure SVG)
function YearHistogram({
  features,
  yearRange,
  onRangeChange,
  assessmentYear,
}: {
  features: OccurrenceFeature[];
  yearRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  assessmentYear?: number | null;
}) {
  const yearCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const f of features) {
      const y = f.properties.year;
      if (y != null) counts.set(y, (counts.get(y) || 0) + 1);
    }
    return counts;
  }, [features]);

  const allYears = useMemo(() => {
    const years = Array.from(yearCounts.keys()).sort((a: number, b: number) => a - b);
    return years;
  }, [yearCounts]);

  if (allYears.length < 2) return null;

  const minY = allYears[0];
  const maxY = allYears[allYears.length - 1];
  const maxCount = Math.max(...Array.from(yearCounts.values()));
  const barW = Math.max(2, Math.min(8, 200 / (maxY - minY + 1)));
  const chartW = (maxY - minY + 1) * (barW + 1);
  const chartH = 40;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span>{minY}</span>
        <span>{maxY}</span>
      </div>
      <div className="overflow-x-auto">
        <svg width={Math.max(chartW, 100)} height={chartH} className="w-full" viewBox={`0 0 ${Math.max(chartW, 100)} ${chartH}`} preserveAspectRatio="none">
          {Array.from({ length: maxY - minY + 1 }, (_, i) => {
            const year = minY + i;
            const count = yearCounts.get(year) || 0;
            const h = maxCount > 0 ? (count / maxCount) * (chartH - 2) : 0;
            const x = i * (barW + 1);
            const inRange = year >= yearRange[0] && year <= yearRange[1];
            const isAssessmentYear = assessmentYear != null && year === assessmentYear;
            return (
              <rect
                key={year}
                x={x}
                y={chartH - h}
                width={barW}
                height={Math.max(h, 0.5)}
                rx={0.5}
                className={
                  isAssessmentYear
                    ? "fill-blue-400"
                    : inRange
                    ? "fill-emerald-500 dark:fill-emerald-400"
                    : "fill-zinc-300 dark:fill-zinc-600"
                }
                opacity={inRange ? 1 : 0.3}
              >
                <title>{year}: {count} records</title>
              </rect>
            );
          })}
          {/* Assessment year marker line */}
          {assessmentYear != null && assessmentYear >= minY && assessmentYear <= maxY && (
            <line
              x1={(assessmentYear - minY) * (barW + 1) + barW / 2}
              y1={0}
              x2={(assessmentYear - minY) * (barW + 1) + barW / 2}
              y2={chartH}
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="2,2"
              opacity={0.6}
            />
          )}
        </svg>
      </div>
      {/* Year range slider */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={minY}
          max={maxY}
          value={yearRange[0]}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            onRangeChange([Math.min(v, yearRange[1]), yearRange[1]]);
          }}
          className="flex-1 h-1 accent-emerald-500"
          title={`From: ${yearRange[0]}`}
        />
        <span className="text-[10px] text-zinc-500 tabular-nums w-20 text-center">
          {yearRange[0]}–{yearRange[1]}
        </span>
        <input
          type="range"
          min={minY}
          max={maxY}
          value={yearRange[1]}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            onRangeChange([yearRange[0], Math.max(v, yearRange[0])]);
          }}
          className="flex-1 h-1 accent-emerald-500"
          title={`To: ${yearRange[1]}`}
        />
      </div>
    </div>
  );
}

// Format basisOfRecord to human-readable string
function formatBasisOfRecord(basis?: string): string {
  if (!basis) return "";
  const labels: Record<string, string> = {
    HUMAN_OBSERVATION: "Human observation",
    PRESERVED_SPECIMEN: "Preserved specimen (museum collection)",
    MACHINE_OBSERVATION: "Machine observation (camera trap / acoustic)",
    FOSSIL_SPECIMEN: "Fossil specimen",
    LIVING_SPECIMEN: "Living specimen (zoo / garden)",
    MATERIAL_SAMPLE: "Material sample (eDNA / tissue)",
    OCCURRENCE: "Occurrence",
    MATERIAL_CITATION: "Material citation",
  };
  return labels[basis] || basis.replace(/_/g, " ").toLowerCase();
}

interface InatObservation {
  url: string;
  date: string | null;
  imageUrl: string | null;
  location: string | null;
  observer: string | null;
  mediaType?: "StillImage" | "Sound" | "MovingImage" | null;
  audioUrl?: string | null;
  gbifID?: number | null;
  decimalLatitude?: number | null;
  decimalLongitude?: number | null;
}

interface RecordTypeBreakdown {
  humanObservation: number;
  preservedSpecimen: number;
  materialSample: number;
  machineObservation: number;
  other: number;
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
}

// Convert iNaturalist photo URLs to a smaller size for thumbnails
// e.g. .../photos/123/original.jpeg -> .../photos/123/small.jpeg (240px)
function getThumbUrl(url: string): string {
  return url.replace(/\/original\./, '/small.');
}

// Audio player card for sound-only observations
function InatAudioCard({ obs, idx, onHover, onLeave }: { obs: InatObservation; idx: number; onHover?: () => void; onLeave?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  return (
    <div
      className="aspect-[3/4] sm:aspect-square relative group"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <a
        href={obs.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full h-full"
      >
        <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900 rounded ring-1 ring-emerald-200 dark:ring-emerald-800 flex flex-col items-center justify-center gap-1 p-2 transition-all group-hover:ring-2 group-hover:ring-emerald-400 dark:group-hover:ring-emerald-600">
          {/* Waveform-style icon */}
          <div className="flex items-end gap-[2px] h-6 mb-0.5">
            {[40, 70, 55, 85, 45, 75, 50].map((h, i) => (
              <div
                key={i}
                className={`w-[3px] rounded-full ${playing ? 'animate-pulse' : ''}`}
                style={{
                  height: `${h}%`,
                  backgroundColor: playing ? '#10b981' : '#6ee7b7',
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
          {obs.date && (
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate max-w-full">{obs.date}</div>
          )}
        </div>
      </a>
      {obs.audioUrl && (
        <>
          <audio
            ref={audioRef}
            preload="none"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            aria-label={`Audio observation ${idx + 1}`}
          >
            <source src={obs.audioUrl} />
          </audio>
          <button
            onClick={togglePlay}
            className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-sm transition-colors"
            title={playing ? "Pause" : "Play audio"}
          >
            {playing ? (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// iNat photo thumbnail with hover preview using portal (desktop only)
function InatPhotoWithPreview({ obs, idx, onHover, onLeave }: { obs: InatObservation; idx: number; onHover?: () => void; onLeave?: () => void }) {
  // If this is an audio-only observation (no image), render the audio card
  if (!obs.imageUrl && obs.audioUrl) {
    return <InatAudioCard obs={obs} idx={idx} onHover={onHover} onLeave={onLeave} />;
  }

  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ anchorTop: 0, left: 0, showBelow: false });
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const thumbRef = useRef<HTMLDivElement>(null);
  const hasAudio = !!obs.audioUrl;

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (isHovered && thumbRef.current && !isTouchDevice) {
      const rect = thumbRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const previewWidth = 208;

      // Center horizontally on the thumbnail
      let left = rect.left + rect.width / 2 - previewWidth / 2;
      if (left < 8) left = 8;
      if (left + previewWidth > viewportWidth - 8) {
        left = viewportWidth - 8 - previewWidth;
      }

      // If not enough room above (~100px min), show below instead
      const showBelow = rect.top < 100;
      const anchorTop = showBelow ? rect.bottom + 4 : rect.top - 4;

      setPosition({ anchorTop, left, showBelow });
    }
  }, [isHovered, isTouchDevice, hasAudio]);

  return (
    <div
      ref={thumbRef}
      className="aspect-[3/4] sm:aspect-square relative"
      onMouseEnter={() => { if (!isTouchDevice) setIsHovered(true); onHover?.(); }}
      onMouseLeave={() => { setIsHovered(false); onLeave?.(); }}
    >
      <a
        href={obs.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full h-full"
      >
        {obs.imageUrl ? (
          <img
            src={getThumbUrl(obs.imageUrl)}
            alt={`iNaturalist observation ${idx + 1}`}
            className={`w-full h-full object-cover rounded ring-1 ring-zinc-200 dark:ring-zinc-700 transition-all ${isHovered ? 'ring-2 ring-blue-500' : ''}`}
          />
        ) : (
          <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 text-xs">
            ?
          </div>
        )}
      </a>
      {/* Audio badge for observations that have both image and audio */}
      {hasAudio && obs.imageUrl && (
        <div className="absolute bottom-1 right-1 bg-black/60 rounded-full p-1" title="Has audio">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        </div>
      )}
      {!isTouchDevice && isHovered && (obs.imageUrl || obs.audioUrl) && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999]"
          style={{
            top: position.anchorTop,
            left: position.left,
            ...(position.showBelow ? {} : { transform: 'translateY(-100%)' }),
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden w-52">
            {obs.imageUrl && (
              <a href={obs.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={obs.imageUrl}
                  alt={`iNaturalist observation ${idx + 1}`}
                  className="w-full hover:opacity-90 cursor-pointer"
                />
              </a>
            )}
            {hasAudio && (
              <div className="px-2 pt-2">
                <audio
                  controls
                  preload="none"
                  className="w-full h-8"
                  aria-label={`Audio for observation ${idx + 1}`}
                >
                  <source src={obs.audioUrl!} />
                </audio>
              </div>
            )}
            <div className="p-2 text-xs space-y-1">
              {obs.date && (
                <div className="text-zinc-500 dark:text-zinc-400">{obs.date}</div>
              )}
              {obs.observer && (
                <div className="text-zinc-700 dark:text-zinc-300 truncate">
                  <span className="text-zinc-400">by</span> {obs.observer}
                </div>
              )}
              {obs.location && (
                <div className="text-zinc-600 dark:text-zinc-400 truncate" title={obs.location}>
                  {obs.location}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function OccurrenceMapRow({
  speciesKey,
  countryCode,
  mounted,
  assessmentYear,
}: OccurrenceMapRowProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceFeature[]>([]);
  const [breakdown, setBreakdown] = useState<RecordTypeBreakdown | null>(null);
  const [loadingOccurrences, setLoadingOccurrences] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);

  // Checkbox state for each observation type category (default: all checked except preserved, material & other)
  const [checkedTypes, setCheckedTypes] = useState({
    iNaturalist: true,
    humanOther: true,
    machineObservation: true,
    preservedSpecimen: false,
    materialSample: false,
    other: false,
  });

  // Advanced filter state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maxUncertainty, setMaxUncertainty] = useState<number | null>(null);
  const [showUncertaintyCircles, setShowUncertaintyCircles] = useState(false);
  const [colorByYear, setColorByYear] = useState(false);
  const [dedupEnabled, setDedupEnabled] = useState(false);
  const [dedupGrid, setDedupGrid] = useState(0.01); // ~1km
  const [sampleSize, setSampleSize] = useState(500);
  const [yearRange, setYearRange] = useState<[number, number]>([0, 9999]);

  // Responsive grid columns and page size (always 2 rows)
  const gridCols = useGridColumns();
  const pageSize = gridCols * 2;

  // iNat photos pagination
  const [inatPage, setInatPage] = useState(0);
  const [inatPhotos, setInatPhotos] = useState<InatObservation[]>([]);
  const [inatTotalCount, setInatTotalCount] = useState(0);
  const [loadingInatPhotos, setLoadingInatPhotos] = useState(false);

  // Hovered iNat observation (for map highlight)
  const [hoveredObs, setHoveredObs] = useState<InatObservation | null>(null);

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
        // Initialize year range from data
        const years = features
          .map((f: OccurrenceFeature) => f.properties.year)
          .filter((y: number | null | undefined): y is number => y != null);
        if (years.length > 0) {
          setYearRange([Math.min(...years), Math.max(...years)]);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingOccurrences(false));
  }, [speciesKey, countryCode, sampleSize]);

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

  // Classify an occurrence into one of the 6 checkbox categories
  const getCategory = (o: OccurrenceFeature): keyof typeof checkedTypes => {
    const basis = o.properties.basisOfRecord;
    if (basis === "HUMAN_OBSERVATION") {
      return o.properties.datasetKey === INAT_DATASET_KEY ? "iNaturalist" : "humanOther";
    }
    if (basis === "MACHINE_OBSERVATION") return "machineObservation";
    if (basis === "PRESERVED_SPECIMEN") return "preservedSpecimen";
    if (basis === "MATERIAL_SAMPLE") return "materialSample";
    return "other";
  };

  // Multi-stage filtering pipeline
  const filteredOccurrences = useMemo(() => {
    let result = occurrences;
    // 1. Basis of record checkboxes
    result = result.filter((o) => checkedTypes[getCategory(o)]);
    // 2. GPS uncertainty filter
    if (maxUncertainty != null) {
      result = result.filter((o) => {
        const u = o.properties.coordinateUncertaintyInMeters;
        return u != null && u <= maxUncertainty;
      });
    }
    // 3. Year range filter
    result = result.filter((o) => {
      const y = o.properties.year;
      if (y == null) return true; // keep records without year data
      return y >= yearRange[0] && y <= yearRange[1];
    });
    // 4. Spatial deduplication
    if (dedupEnabled) {
      result = deduplicateSpatially(result, dedupGrid);
    }
    return result;
  }, [occurrences, checkedTypes, maxUncertainty, yearRange, dedupEnabled, dedupGrid]);

  // Helper to check if an occurrence is after the assessment year
  const isNewRecord = (eventDate?: string): boolean => {
    if (!assessmentYear || !eventDate) return false;
    const recordYear = new Date(eventDate).getFullYear();
    return recordYear > assessmentYear;
  };

  // Year range for color gradient
  const { minYear, maxYear } = useMemo(() => {
    const years = filteredOccurrences
      .map((o) => o.properties.year)
      .filter((y): y is number => y != null);
    return {
      minYear: years.length > 0 ? Math.min(...years) : 0,
      maxYear: years.length > 0 ? Math.max(...years) : 0,
    };
  }, [filteredOccurrences]);

  // Count by category for the legend (just pre/post assessment)
  const newRecords = filteredOccurrences.filter((o) => isNewRecord(o.properties.eventDate));
  const oldRecords = filteredOccurrences.filter((o) => !isNewRecord(o.properties.eventDate));

  return (
        <div
          className="bg-zinc-50 dark:bg-zinc-800/50"
        >
          <div className="p-2">
            {/* Main layout: 1/3 left (breakdown + photos), 2/3 right (map) */}
            <div className="flex flex-col lg:flex-row gap-3">
              {/* Left column: Breakdown + iNat photos (1/3 width) */}
              <div className="lg:w-1/3 flex flex-col gap-3 relative z-10">
                {/* Observation type breakdown */}
                <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Observation Types</div>
                  {loadingBreakdown ? (
                    <div className="flex items-center gap-2 text-zinc-400 text-sm py-1">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Loading...
                    </div>
                  ) : breakdown ? (() => {
                    const baseParams = `taxon_key=${speciesKey}&has_coordinate=true&has_geospatial_issue=false${countryCode ? `&country=${countryCode}` : ''}`;
                    const humanOtherCount = Math.max(0, breakdown.humanObservation - breakdown.iNaturalist);

                    // Calculate total from checked types only
                    const checkedTotal =
                      (checkedTypes.iNaturalist ? breakdown.iNaturalist : 0) +
                      (checkedTypes.humanOther ? humanOtherCount : 0) +
                      (checkedTypes.machineObservation ? breakdown.machineObservation : 0) +
                      (checkedTypes.preservedSpecimen ? breakdown.preservedSpecimen : 0) +
                      (checkedTypes.materialSample ? (breakdown.materialSample || 0) : 0) +
                      (checkedTypes.other ? breakdown.other : 0);

                    const toggleType = (key: keyof typeof checkedTypes) => {
                      setCheckedTypes((prev) => ({ ...prev, [key]: !prev[key] }));
                    };

                    const rowClass = (checked: boolean) =>
                      `flex items-center gap-2 transition-opacity ${checked ? '' : 'opacity-40'}`;

                    return (
                    <div className="space-y-1.5 text-sm">
                      {/* Human Observations (iNaturalist) */}
                      <div className={rowClass(checkedTypes.iNaturalist)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.iNaturalist}
                          onChange={() => toggleType('iNaturalist')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&dataset_key=50c9509d-22c7-4a22-a47d-8c48425ef4a7`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Human Obs. (iNaturalist)</span>
                          <span className="tabular-nums">{breakdown.iNaturalist.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Human Observations (other) */}
                      <div className={rowClass(checkedTypes.humanOther)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.humanOther}
                          onChange={() => toggleType('humanOther')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=HUMAN_OBSERVATION`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Human Obs. (other)</span>
                          <span className="tabular-nums">{humanOtherCount.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Machine Observations (camera traps, acoustic sensors) */}
                      <div className={rowClass(checkedTypes.machineObservation)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.machineObservation}
                          onChange={() => toggleType('machineObservation')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=MACHINE_OBSERVATION`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Machine Obs. (camera trap / acoustic)</span>
                          <span className="tabular-nums">{breakdown.machineObservation.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Preserved Specimens (museum collections) */}
                      <div className={rowClass(checkedTypes.preservedSpecimen)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.preservedSpecimen}
                          onChange={() => toggleType('preservedSpecimen')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=PRESERVED_SPECIMEN`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Preserved Specimens (museum)</span>
                          <span className="tabular-nums">{breakdown.preservedSpecimen.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Material Samples (eDNA / tissue) */}
                      <div className={rowClass(checkedTypes.materialSample)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.materialSample}
                          onChange={() => toggleType('materialSample')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=MATERIAL_SAMPLE`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Material Samples (eDNA / tissue)</span>
                          <span className="tabular-nums">{(breakdown.materialSample || 0).toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Other */}
                      <div className={rowClass(checkedTypes.other)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.other}
                          onChange={() => toggleType('other')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <div className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400">
                          <span>Other</span>
                          <span className="tabular-nums">{breakdown.other.toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Total (of checked types) */}
                      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-1 mt-1 flex justify-between font-medium text-zinc-700 dark:text-zinc-300">
                        <span>Total</span>
                        <span className="tabular-nums">{checkedTotal.toLocaleString()}</span>
                      </div>
                    </div>
                    );
                  })() : null}
                </div>

                {/* Advanced Filters (collapsible) */}
                <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <button
                    onClick={() => setAdvancedOpen(!advancedOpen)}
                    className="w-full px-3 py-2 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <span>Advanced Filters</span>
                    <svg
                      className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {advancedOpen && (
                    <div className="px-3 pb-3 space-y-3 border-t border-zinc-100 dark:border-zinc-800">
                      {/* GPS Uncertainty */}
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">GPS Uncertainty</span>
                          <select
                            value={maxUncertainty ?? ""}
                            onChange={(e) => setMaxUncertainty(e.target.value ? parseInt(e.target.value) : null)}
                            className="text-xs px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                          >
                            {UNCERTAINTY_OPTIONS.map((opt) => (
                              <option key={opt.label} value={opt.value ?? ""}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showUncertaintyCircles}
                            onChange={(e) => setShowUncertaintyCircles(e.target.checked)}
                            className="w-3 h-3 rounded accent-blue-500"
                          />
                          Show uncertainty radius on map
                        </label>
                      </div>

                      {/* Year Range + Histogram */}
                      <div>
                        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Year Range</span>
                        <YearHistogram
                          features={occurrences.filter((o) => checkedTypes[getCategory(o)])}
                          yearRange={yearRange}
                          onRangeChange={setYearRange}
                          assessmentYear={assessmentYear}
                        />
                      </div>

                      {/* Color by year toggle */}
                      <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={colorByYear}
                          onChange={(e) => setColorByYear(e.target.checked)}
                          className="w-3 h-3 rounded accent-blue-500"
                        />
                        Color markers by year
                        {colorByYear && (
                          <span className="ml-auto flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full" style={{ background: "hsl(30, 60%, 50%)" }} />
                            <span>old</span>
                            <span className="w-2 h-2 rounded-full" style={{ background: "hsl(142, 80%, 50%)" }} />
                            <span>new</span>
                          </span>
                        )}
                      </label>

                      {/* Spatial deduplication */}
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={dedupEnabled}
                            onChange={(e) => setDedupEnabled(e.target.checked)}
                            className="w-3 h-3 rounded accent-blue-500"
                          />
                          Deduplicate nearby points
                        </label>
                        {dedupEnabled && (
                          <div className="mt-1 flex items-center gap-1.5 ml-[18px]">
                            <span className="text-[10px] text-zinc-400">Grid:</span>
                            {DEDUP_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setDedupGrid(opt.value)}
                                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                  dedupGrid === opt.value
                                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                                    : 'border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Sample size */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Sample size</span>
                        <select
                          value={sampleSize}
                          onChange={(e) => setSampleSize(parseInt(e.target.value))}
                          className="text-xs px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                        >
                          {SAMPLE_SIZE_OPTIONS.map((n) => (
                            <option key={n} value={n}>{n.toLocaleString()}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* iNaturalist photos grid with pagination */}
                {inatPhotos.length > 0 && (
                  <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 flex-1 overflow-hidden">
                    <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>iNaturalist</span>
                        <span className="text-zinc-400 text-xs">({inatTotalCount.toLocaleString()} total)</span>
                      </div>
                      {/* Pagination controls */}
                      {inatTotalCount > pageSize && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              const newPage = inatPage - 1;
                              setInatPage(newPage);
                              fetchInatPhotos(newPage, pageSize);
                            }}
                            disabled={inatPage === 0 || loadingInatPhotos}
                            className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ‹ Prev
                          </button>
                          <span className="text-xs text-zinc-400 tabular-nums">
                            {inatPage + 1} / {Math.ceil(inatTotalCount / pageSize)}
                          </span>
                          <button
                            onClick={() => {
                              const newPage = inatPage + 1;
                              setInatPage(newPage);
                              fetchInatPhotos(newPage, pageSize);
                            }}
                            disabled={(inatPage + 1) * pageSize >= inatTotalCount || loadingInatPhotos}
                            className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            Next ›
                          </button>
                        </div>
                      )}
                    </div>
                    <div className={`grid grid-cols-3 sm:grid-cols-5 gap-1.5 ${loadingInatPhotos ? 'opacity-50' : ''}`}>
                      {inatPhotos.slice(0, pageSize).map((obs, idx) => (
                        <InatPhotoWithPreview
                          key={`${inatPage}-${idx}`}
                          obs={obs}
                          idx={idx}
                          onHover={() => setHoveredObs(obs)}
                          onLeave={() => setHoveredObs(null)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right column: Map (2/3 width) */}
              <div className="lg:w-2/3 flex flex-col gap-2">
                {/* Map */}
                <div className="h-[300px] md:h-[400px] rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 relative isolate z-0">
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
                <MapContainer
                  center={[20, 0]}
                  zoom={2}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <LocateControl />
                  {bbox && <FitBounds bbox={bbox} />}
                  {/* Uncertainty circles (rendered behind markers) */}
                  {showUncertaintyCircles && filteredOccurrences.map((feature, idx) => {
                    const uncertainty = feature.properties.coordinateUncertaintyInMeters;
                    if (uncertainty == null || uncertainty <= 0) return null;
                    const [lon, lat] = feature.geometry.coordinates;
                    return (
                      <Circle
                        key={`unc-${feature.properties.gbifID || idx}`}
                        center={[lat, lon]}
                        radius={uncertainty}
                        pathOptions={{
                          color: "#6366f1",
                          fillColor: "#6366f1",
                          fillOpacity: 0.06,
                          weight: 0.5,
                          opacity: 0.3,
                        }}
                      />
                    );
                  })}
                  {/* Render occurrences: colored by age or year gradient */}
                  {filteredOccurrences.map((feature, idx) => {
                    const [lon, lat] = feature.geometry.coordinates;
                    const isNew = isNewRecord(feature.properties.eventDate);
                    const isHighlighted = hoveredObs?.gbifID != null && feature.properties.gbifID === hoveredObs.gbifID;
                    let strokeColor: string;
                    let fillColor: string;
                    if (isHighlighted) {
                      strokeColor = "#1d4ed8";
                      fillColor = "#3b82f6";
                    } else if (colorByYear && feature.properties.year != null) {
                      const colors = yearToColor(feature.properties.year, minYear, maxYear);
                      strokeColor = colors.stroke;
                      fillColor = colors.fill;
                    } else {
                      strokeColor = isNew ? "#15803d" : "#6b7280";
                      fillColor = isNew ? "#22c55e" : "#9ca3af";
                    }
                    const inatMatch = inatPhotosByGbifId.get(feature.properties.gbifID);
                    const uncertainty = feature.properties.coordinateUncertaintyInMeters;
                    return (
                      <CircleMarker
                        key={feature.properties.gbifID || idx}
                        center={[lat, lon]}
                        radius={isHighlighted ? 9 : 5}
                        pathOptions={{
                          color: strokeColor,
                          fillColor: fillColor,
                          fillOpacity: isHighlighted ? 1 : 0.9,
                          weight: isHighlighted ? 3 : 2,
                        }}
                      >
                        <Popup>
                          <div className="text-sm" style={{ maxWidth: 220 }}>
                            {inatMatch?.imageUrl && (
                              <a href={inatMatch.url} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={inatMatch.imageUrl}
                                  alt={`${feature.properties.species} observation`}
                                  className="w-full h-32 object-cover rounded mb-2 hover:opacity-90 cursor-pointer"
                                />
                              </a>
                            )}
                            <div className="font-medium italic">
                              {feature.properties.species}
                            </div>
                            {feature.properties.basisOfRecord && (
                              <div className="text-xs text-gray-600">
                                {formatBasisOfRecord(feature.properties.basisOfRecord)}
                              </div>
                            )}
                            {feature.properties.datasetName && (
                              <div className="text-xs text-gray-500">
                                {feature.properties.datasetName}
                              </div>
                            )}
                            {feature.properties.eventDate && (
                              <div className="text-xs">
                                {feature.properties.eventDate}
                              </div>
                            )}
                            {uncertainty != null && (
                              <div className="text-xs text-gray-500">
                                GPS uncertainty: {uncertainty >= 1000 ? `${(uncertainty / 1000).toFixed(1)}km` : `${uncertainty}m`}
                              </div>
                            )}
                            {inatMatch?.observer && (
                              <div className="text-xs text-gray-600">by {inatMatch.observer}</div>
                            )}
                            {inatMatch?.location && (
                              <div className="text-xs text-gray-500 truncate" title={inatMatch.location}>{inatMatch.location}</div>
                            )}
                            <div className="text-xs text-gray-500">
                              {lat.toFixed(4)}, {lon.toFixed(4)}
                            </div>
                            <a
                              href={`https://www.gbif.org/occurrence/${feature.properties.gbifID}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 inline-block"
                            >
                              View on GBIF →
                            </a>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                  {/* Highlighted dot when hovering an iNat thumbnail */}
                  {hoveredObs && hoveredObs.decimalLatitude != null && hoveredObs.decimalLongitude != null && (
                    <>
                      <CircleMarker
                        center={[hoveredObs.decimalLatitude, hoveredObs.decimalLongitude]}
                        radius={7}
                        pathOptions={{
                          color: "#1d4ed8",
                          fillColor: "#3b82f6",
                          fillOpacity: 0.4,
                          weight: 2,
                        }}
                      />
                      {hoveredObs.imageUrl && (
                        <MapImageTooltip
                          lat={hoveredObs.decimalLatitude!}
                          lng={hoveredObs.decimalLongitude!}
                          imageUrl={getThumbUrl(hoveredObs.imageUrl)}
                        />
                      )}
                    </>
                  )}
                </MapContainer>
              ) : null}
              {!loadingOccurrences && (
                <div className="absolute bottom-2 left-2 z-[1000] bg-white dark:bg-zinc-800 px-2 py-1.5 rounded text-xs text-zinc-600 dark:text-zinc-300 shadow flex flex-wrap items-center gap-x-3 gap-y-1 max-w-[90%]">
                  {/* Legend */}
                  {colorByYear ? (
                    <>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full" style={{ background: "hsl(30, 60%, 50%)", border: "2px solid hsl(30, 60%, 30%)" }} />
                        <span>{minYear}</span>
                      </div>
                      <span>→</span>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full" style={{ background: "hsl(142, 80%, 50%)", border: "2px solid hsl(142, 80%, 30%)" }} />
                        <span>{maxYear}</span>
                      </div>
                      <span className="text-zinc-400">({filteredOccurrences.length})</span>
                    </>
                  ) : assessmentYear ? (
                    <>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-gray-500" />
                        <span>≤{assessmentYear} ({oldRecords.length})</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-700" />
                        <span>New since {assessmentYear} ({newRecords.length})</span>
                      </div>
                    </>
                  ) : (
                    <span>
                      {totalOccurrences && totalOccurrences > occurrences.length
                        ? `${filteredOccurrences.length} of ${totalOccurrences.toLocaleString()} occurrences`
                        : `${filteredOccurrences.length} occurrences`}
                    </span>
                  )}
                  {dedupEnabled && (
                    <span className="text-zinc-400">(deduped)</span>
                  )}
                  {totalOccurrences != null && totalOccurrences > sampleSize && (
                    <span className="text-zinc-400">sample of {totalOccurrences.toLocaleString()}</span>
                  )}
                </div>
              )}
                </div>
              </div>
            </div>
          </div>
        </div>
  );
}
