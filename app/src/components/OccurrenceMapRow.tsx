"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

// Fixed page size for iNat photo filmstrip (2 columns x 5 rows on desktop)
const INAT_PAGE_SIZE = 10;

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

// Category labels for tooltip display
const CATEGORY_LABELS: Record<string, string> = {
  iNaturalist: "iNaturalist",
  humanOther: "Human Obs.",
  machineObservation: "Machine Obs.",
  preservedSpecimen: "Specimens",
  materialSample: "Material",
  other: "Other",
};

// Classify an occurrence into one of the 6 checkbox categories (standalone for YearRangeTrimmer)
function classifyOccurrence(o: OccurrenceFeature): string {
  const basis = o.properties.basisOfRecord;
  if (basis === "HUMAN_OBSERVATION") {
    return o.properties.datasetKey === INAT_DATASET_KEY ? "iNaturalist" : "humanOther";
  }
  if (basis === "MACHINE_OBSERVATION") return "machineObservation";
  if (basis === "PRESERVED_SPECIMEN") return "preservedSpecimen";
  if (basis === "MATERIAL_SAMPLE") return "materialSample";
  return "other";
}

// Inline year range bar chart with draggable trim handles (like editing a video clip)
function YearRangeTrimmer({
  features,
  yearRange,
  onRangeChange,
  assessmentYear,
  className,
}: {
  features: OccurrenceFeature[];
  yearRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  assessmentYear?: number | null;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);
  const clipId = useRef(`trim-${Math.random().toString(36).slice(2, 8)}`).current;
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);

  const yearBreakdown = useMemo(() => {
    const breakdown = new Map<number, { total: number; categories: Record<string, number> }>();
    for (const f of features) {
      const y = f.properties.year;
      if (y == null) continue;
      let entry = breakdown.get(y);
      if (!entry) {
        entry = { total: 0, categories: {} };
        breakdown.set(y, entry);
      }
      entry.total++;
      const cat = classifyOccurrence(f);
      entry.categories[cat] = (entry.categories[cat] || 0) + 1;
    }
    return breakdown;
  }, [features]);

  const chartW = 200;
  const chartH = 32;
  const pad = 6; // left/right padding for handle overhang

  const chartData = useMemo(() => {
    const allYears = Array.from(yearBreakdown.keys()).sort((a, b) => a - b);
    if (allYears.length < 2) return null;

    // Use the union of data range and yearRange so handles are always on-screen
    const dataMinY = allYears[0];
    const dataMaxY = allYears[allYears.length - 1];
    const minY = Math.min(dataMinY, yearRange[0]);
    const maxY = Math.max(dataMaxY, yearRange[1]);
    const maxCount = Math.max(...Array.from(yearBreakdown.values()).map((v) => v.total));

    const yearToX = (year: number) => pad + ((year - minY) / (maxY - minY)) * (chartW - pad * 2);
    const totalSpan = maxY - minY + 1;
    const barW = (chartW - pad * 2) / totalSpan; // flush histogram bars, no gaps

    const bars: { year: number; x: number; barH: number; total: number }[] = [];
    for (let y = dataMinY; y <= dataMaxY; y++) {
      const entry = yearBreakdown.get(y);
      const count = entry?.total || 0;
      const x = yearToX(y);
      const barH = maxCount > 0 ? (count / maxCount) * (chartH - 4) : 0;
      bars.push({ year: y, x, barH, total: count });
    }

    return { minY, maxY, bars, barW, yearToX };
  }, [yearBreakdown, yearRange]);

  // Keep yearRange in a ref so drag handlers always see the latest value
  const rangeRef = useRef(yearRange);
  rangeRef.current = yearRange;

  const startDrag = useCallback((handle: "start" | "end") => {
    dragging.current = handle;

    const onMove = (e: PointerEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * chartW;
      if (!chartData) return;
      const t = Math.max(0, Math.min(1, (x - pad) / (chartW - pad * 2)));
      const year = Math.round(chartData.minY + t * (chartData.maxY - chartData.minY));
      const cur = rangeRef.current;
      if (handle === "start") {
        onRangeChange([Math.min(year, cur[1]), cur[1]]);
      } else {
        onRangeChange([cur[0], Math.max(year, cur[0])]);
      }
    };

    const onUp = () => {
      dragging.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [chartData, onRangeChange]);

  // Compute tooltip position (percentage from left) for the hovered bar
  const tooltipInfo = useMemo(() => {
    if (hoveredYear == null || !chartData) return null;
    const entry = yearBreakdown.get(hoveredYear);
    if (!entry) return null;
    const x = chartData.yearToX(hoveredYear);
    const pct = (x / chartW) * 100;
    return { pct, year: hoveredYear, total: entry.total, categories: entry.categories };
  }, [hoveredYear, chartData, yearBreakdown]);

  if (!chartData) return null;

  const { minY, maxY, bars, barW, yearToX } = chartData;
  const startX = yearToX(yearRange[0]);
  const endX = yearToX(yearRange[1]);

  return (
    <div className={`relative ${className || ""}`} ref={wrapperRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full h-full select-none"
        preserveAspectRatio="none"
      >
        {/* Dimmed bars */}
        {bars.map((b) => (
          <rect
            key={b.year}
            x={b.x - barW / 2}
            y={chartH - 2 - b.barH}
            width={barW}
            height={b.barH}
            fill="currentColor"
            className="text-zinc-300 dark:text-zinc-600"
            opacity={0.4}
          />
        ))}
        {/* Highlighted bars in selected range — clip to the range */}
        <clipPath id={clipId}>
          <rect x={startX} y={0} width={Math.max(endX - startX, 0)} height={chartH} />
        </clipPath>
        {bars.map((b) => (
          <rect
            key={b.year}
            x={b.x - barW / 2}
            y={chartH - 2 - b.barH}
            width={barW}
            height={b.barH}
            fill="currentColor"
            className="text-emerald-500 dark:text-emerald-400"
            opacity={0.7}
            clipPath={`url(#${clipId})`}
          />
        ))}
        {/* Invisible wider hit targets for hover */}
        {bars.map((b) => {
          const hitW = Math.max(barW + 2, (chartW - pad * 2) / bars.length);
          return (
            <rect
              key={`hit-${b.year}`}
              x={b.x - hitW / 2}
              y={0}
              width={hitW}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHoveredYear(b.year)}
              onMouseLeave={() => setHoveredYear(null)}
            />
          );
        })}
        {/* Assessment year marker */}
        {assessmentYear != null && assessmentYear >= minY && assessmentYear <= maxY && (
          <line
            x1={yearToX(assessmentYear)}
            y1={0}
            x2={yearToX(assessmentYear)}
            y2={chartH}
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="3,2"
            opacity={0.5}
          />
        )}
        {/* Start handle */}
        <line x1={startX} y1={0} x2={startX} y2={chartH} stroke="currentColor" className="text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
        <rect
          x={startX - 8}
          y={0}
          width={16}
          height={chartH}
          fill="transparent"
          className="cursor-ew-resize"
          onPointerDown={(e) => { e.preventDefault(); startDrag("start"); }}
        />
        {/* End handle */}
        <line x1={endX} y1={0} x2={endX} y2={chartH} stroke="currentColor" className="text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
        <rect
          x={endX - 8}
          y={0}
          width={16}
          height={chartH}
          fill="transparent"
          className="cursor-ew-resize"
          onPointerDown={(e) => { e.preventDefault(); startDrag("end"); }}
        />
      </svg>
      {/* Hover tooltip */}
      {tooltipInfo && (
        <div
          className="absolute bottom-full mb-1 z-50 pointer-events-none"
          style={{ left: `${tooltipInfo.pct}%`, transform: "translateX(-50%)" }}
        >
          <div className="bg-zinc-900 dark:bg-zinc-800 text-white text-[10px] rounded px-2 py-1.5 shadow-lg whitespace-nowrap">
            <div className="font-medium text-[11px] mb-0.5">{tooltipInfo.year} — {tooltipInfo.total} obs.</div>
            {Object.entries(tooltipInfo.categories)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => (
                <div key={cat} className="flex justify-between gap-3 text-zinc-300">
                  <span>{CATEGORY_LABELS[cat] || cat}</span>
                  <span className="tabular-nums">{count}</span>
                </div>
              ))}
          </div>
        </div>
      )}
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
  const [maxUncertainty, setMaxUncertainty] = useState<number | null>(10000);
  const [showUncertaintyCircles, setShowUncertaintyCircles] = useState(false);
  const [colorByYear, setColorByYear] = useState(false);
  const [dedupEnabled, setDedupEnabled] = useState(false);
  const [dedupGrid, setDedupGrid] = useState(0.01); // ~1km
  const [sampleSize, setSampleSize] = useState(500);
  const [yearRange, setYearRange] = useState<[number, number]>([0, 9999]);

  // "More" popover state
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Fixed page size for filmstrip
  const pageSize = INAT_PAGE_SIZE;

  // iNat photos pagination
  const [inatPage, setInatPage] = useState(0);
  const [inatPhotos, setInatPhotos] = useState<InatObservation[]>([]);
  const [inatTotalCount, setInatTotalCount] = useState(0);
  const [loadingInatPhotos, setLoadingInatPhotos] = useState(false);

  // Close "More" popover on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

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

  // Pill definitions for the filter bar
  const pillDefs = useMemo(() => {
    if (!breakdown) return [];
    const humanOtherCount = Math.max(0, breakdown.humanObservation - breakdown.iNaturalist);
    return [
      { key: "iNaturalist" as const, label: "iNaturalist", count: breakdown.iNaturalist },
      { key: "humanOther" as const, label: "Human Obs.", count: humanOtherCount },
      { key: "machineObservation" as const, label: "Machine Obs.", count: breakdown.machineObservation },
      { key: "preservedSpecimen" as const, label: "Specimens", count: breakdown.preservedSpecimen },
      { key: "materialSample" as const, label: "Material", count: breakdown.materialSample || 0 },
      ...(breakdown.other > 0 ? [{ key: "other" as const, label: "Other", count: breakdown.other }] : []),
    ];
  }, [breakdown]);

  // Cumulative counts per GPS uncertainty threshold (from type-filtered sample)
  const uncertaintyCounts = useMemo(() => {
    const typeFiltered = occurrences.filter((o) => checkedTypes[getCategory(o)]);
    const counts = new Map<number | null, number>();
    // "Any" = total type-filtered count
    counts.set(null, typeFiltered.length);
    for (const opt of UNCERTAINTY_OPTIONS) {
      if (opt.value == null) continue;
      const count = typeFiltered.filter((o) => {
        const u = o.properties.coordinateUncertaintyInMeters;
        return u != null && u <= opt.value;
      }).length;
      counts.set(opt.value, count);
    }
    return counts;
  }, [occurrences, checkedTypes]);

  const toggleType = (key: keyof typeof checkedTypes) => {
    setCheckedTypes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50">
      <div className="p-2">
        <div className="flex flex-col gap-2">
          {/* ── Filter Bar ── */}
          <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-2">
              {/* Observation type pills */}
              {loadingBreakdown ? (
                <div className="flex items-center gap-2 text-zinc-400 text-xs">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading...
                </div>
              ) : (
                pillDefs.map((pill) => {
                  const active = checkedTypes[pill.key];
                  return (
                    <button
                      key={pill.key}
                      onClick={() => toggleType(pill.key)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        active
                          ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
                          : "bg-transparent border-zinc-300 dark:border-zinc-600 text-zinc-400 dark:text-zinc-500"
                      }`}
                      title={`${active ? "Hide" : "Show"} ${pill.label} on map`}
                    >
                      {pill.label}
                      <span className={`tabular-nums ${active ? "text-emerald-500 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                        {pill.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })
              )}

              {/* Separator */}
              <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 hidden sm:block" />

              {/* Year range trimmer */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                  {yearRange[0]}
                </span>
                <YearRangeTrimmer
                  features={occurrences.filter((o) => {
                    if (!checkedTypes[getCategory(o)]) return false;
                    if (maxUncertainty != null) {
                      const u = o.properties.coordinateUncertaintyInMeters;
                      if (u == null || u > maxUncertainty) return false;
                    }
                    return true;
                  })}
                  yearRange={yearRange}
                  onRangeChange={setYearRange}
                  assessmentYear={assessmentYear}
                  className="w-32 sm:w-44 h-8"
                />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                  {yearRange[1]}
                </span>
              </div>

              {/* Separator */}
              <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 hidden sm:block" />

              {/* GPS Uncertainty */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">GPS:</span>
                <select
                  value={maxUncertainty ?? ""}
                  onChange={(e) => setMaxUncertainty(e.target.value ? parseInt(e.target.value) : null)}
                  className="text-xs px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                >
                  {UNCERTAINTY_OPTIONS.map((opt) => {
                    const count = uncertaintyCounts.get(opt.value ?? null);
                    return (
                      <option key={opt.label} value={opt.value ?? ""}>
                        {opt.label}{count != null ? ` (${count})` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Separator */}
              <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 hidden sm:block" />

              {/* "More" popover trigger */}
              <div className="relative" ref={moreRef}>
                <button
                  onClick={() => setMoreOpen(!moreOpen)}
                  className={`p-1.5 rounded border transition-colors ${
                    moreOpen
                      ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-500"
                      : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                  title="More filters"
                >
                  <svg className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg p-3 space-y-3">
                    {/* Show uncertainty radius */}
                    <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showUncertaintyCircles}
                        onChange={(e) => setShowUncertaintyCircles(e.target.checked)}
                        className="w-3 h-3 rounded accent-blue-500"
                      />
                      Show uncertainty radius on map
                    </label>

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
                                  ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                                  : "border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── iNat filmstrip (left) + Map (right) ── */}
          <div className="flex flex-col sm:flex-row gap-2">
            {/* iNat photo filmstrip — 2-col grid on sm+, horizontal row on mobile */}
            {inatPhotos.length > 0 && (
              <div className="sm:w-[10.5rem] shrink-0 flex flex-col bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden relative z-10">
                {/* Header with count */}
                <div className="px-2 py-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 text-center border-b border-zinc-100 dark:border-zinc-800">
                  iNaturalist <span className="tabular-nums">({inatTotalCount.toLocaleString()})</span>
                </div>
                {/* Photos — horizontal scroll on mobile, 2-col grid on sm+ */}
                <div className={`flex sm:grid sm:grid-cols-2 gap-1.5 p-1.5 overflow-x-auto sm:overflow-x-visible sm:overflow-y-visible flex-1 ${loadingInatPhotos ? "opacity-50" : ""}`}>
                  {inatPhotos.slice(0, pageSize).map((obs, idx) => (
                    <div key={`${inatPage}-${idx}`} className="w-14 sm:w-full shrink-0">
                      <InatPhotoWithPreview
                        obs={obs}
                        idx={idx}
                        onHover={() => setHoveredObs(obs)}
                        onLeave={() => setHoveredObs(null)}
                      />
                    </div>
                  ))}
                </div>
                {/* Pagination arrows */}
                {inatTotalCount > pageSize && (
                  <div className="flex items-center justify-center gap-1 px-1.5 py-1 border-t border-zinc-100 dark:border-zinc-800">
                    <button
                      onClick={() => {
                        const newPage = inatPage - 1;
                        setInatPage(newPage);
                        fetchInatPhotos(newPage, pageSize);
                      }}
                      disabled={inatPage === 0 || loadingInatPhotos}
                      className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Previous page"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="text-[10px] text-zinc-400 tabular-nums">
                      {inatPage + 1}/{Math.ceil(inatTotalCount / pageSize)}
                    </span>
                    <button
                      onClick={() => {
                        const newPage = inatPage + 1;
                        setInatPage(newPage);
                        fetchInatPhotos(newPage, pageSize);
                      }}
                      disabled={(inatPage + 1) * pageSize >= inatTotalCount || loadingInatPhotos}
                      className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Next page"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Map */}
            <div className="flex-1 flex flex-col rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 relative isolate z-0">
            {/* Sample size bar */}
            {totalOccurrences != null && totalOccurrences > sampleSize && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
                <span>
                  Sampled <strong>{sampleSize.toLocaleString()}</strong> of <strong>{totalOccurrences.toLocaleString()}</strong> records
                </span>
                <span className="flex items-center gap-1.5">
                  <span>Increase sample:</span>
                <select
                  value={sampleSize}
                  onChange={(e) => setSampleSize(parseInt(e.target.value))}
                  className="text-xs px-1.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-zinc-800 text-emerald-700 dark:text-emerald-300"
                >
                  {SAMPLE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n.toLocaleString()}</option>
                  ))}
                </select>
                </span>
              </div>
            )}
            <div className="h-[300px] sm:h-[450px] flex-1 relative">
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
                  {filteredBbox && <FitBounds bbox={filteredBbox} />}
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
                    <span className="text-zinc-400">(sampled)</span>
                  )}
                </div>
              )}
            </div>
            </div>{/* close outer map flex-col div */}
          </div>
        </div>
      </div>
    </div>
  );
}
