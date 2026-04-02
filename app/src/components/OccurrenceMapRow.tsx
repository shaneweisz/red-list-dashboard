"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { MapRef, ViewStateChangeEvent, MapLayerMouseEvent } from "react-map-gl/maplibre";
import type maplibregl from "maplibre-gl";

// Fixed page size for iNat photo grid (5 columns x 2 rows)
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
const MapImageTooltip = dynamic(
  () => import("./MapImageTooltip"),
  { ssr: false }
);
const MapOccurrenceTooltip = dynamic(
  () => import("./MapOccurrenceTooltip"),
  { ssr: false }
);
const InatContributorsChart = dynamic(
  () => import("./InatContributorsChart"),
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

// Convert an eventDate string (or year-only) to a numeric value for interpolation
function dateToNumeric(eventDate?: string | null, year?: number | null): number | null {
  if (eventDate) {
    const ts = new Date(eventDate).getTime();
    if (!isNaN(ts)) return ts;
  }
  if (year != null) return new Date(year, 0, 1).getTime();
  return null;
}

// Date-based color interpolation (oldest=amber, newest=green)
function dateToColor(dateNum: number, minDate: number, maxDate: number): { stroke: string; fill: string } {
  if (minDate === maxDate) return { stroke: "#15803d", fill: "#22c55e" };
  const t = (dateNum - minDate) / (maxDate - minDate); // 0 = oldest, 1 = newest
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
  humanOther: "Other Human Obs.",
  machineObservation: "Machine Obs.",
  observation: "Observation",
  preservedSpecimen: "Preserved",
  fossilSpecimen: "Fossil",
  livingSpecimen: "Living",
  materialSample: "Material",
  materialCitation: "Citation",
  occurrence: "Occurrence",
};

// Classify an occurrence into one of the checkbox categories (standalone for YearRangeTrimmer)
function classifyOccurrence(o: OccurrenceFeature): string {
  const basis = o.properties.basisOfRecord;
  if (basis === "HUMAN_OBSERVATION") {
    return o.properties.datasetKey === INAT_DATASET_KEY ? "iNaturalist" : "humanOther";
  }
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

// Inline year range bar chart with draggable trim handles (like editing a video clip)
function YearRangeTrimmer({
  features,
  yearRange,
  onRangeChange,
  assessmentYear,
  hoveredYear,
  onHoverYear,
  animatingYear,
  onAnimationScrub,
  className,
}: {
  features: OccurrenceFeature[];
  yearRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  assessmentYear?: number | null;
  hoveredYear?: number | null;
  onHoverYear?: (year: number | null) => void;
  animatingYear?: number | null;
  onAnimationScrub?: (year: number) => void;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | "animation" | null>(null);
  const clipId = useRef(`trim-${Math.random().toString(36).slice(2, 8)}`).current;

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

  const scrubRef = useRef(onAnimationScrub);
  scrubRef.current = onAnimationScrub;

  const startDrag = useCallback((handle: "start" | "end" | "animation") => {
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
      } else if (handle === "end") {
        onRangeChange([cur[0], Math.max(year, cur[0])]);
      } else if (handle === "animation") {
        const clamped = Math.max(cur[0], Math.min(year, cur[1]));
        scrubRef.current?.(clamped);
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
              onMouseEnter={() => onHoverYear?.(b.year)}
              onMouseLeave={() => onHoverYear?.(null)}
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
        {/* Animation year indicator (draggable) */}
        {animatingYear != null && animatingYear >= minY && animatingYear <= maxY && (
          <>
            <line
              x1={yearToX(animatingYear)}
              y1={0}
              x2={yearToX(animatingYear)}
              y2={chartH}
              stroke="#f59e0b"
              strokeWidth={2}
              opacity={0.9}
            />
            <rect
              x={yearToX(animatingYear) - 8}
              y={0}
              width={16}
              height={chartH}
              fill="transparent"
              className="cursor-ew-resize"
              onPointerDown={(e) => { e.preventDefault(); startDrag("animation"); }}
            />
          </>
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
          className="absolute top-full mt-1 z-50 pointer-events-none"
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
  license?: string | null;
  rightsHolder?: string | null;
}

/** Format CC license URL to short label, e.g. ".../by-nc/4.0/legalcode" -> "CC BY-NC 4.0" */
function formatLicense(url: string): string {
  const match = url.match(/creativecommons\.org\/licenses\/([^/]+)\/([^/]+)/);
  if (!match) return url;
  return `CC ${match[1].toUpperCase()} ${match[2]}`;
}

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

      // Prefer showing below; only show above if not enough room below
      const previewHeight = 280;
      const showBelow = rect.bottom + previewHeight + 8 < window.innerHeight;
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
              {obs.license && (
                <div className="text-[9px] text-zinc-400">{formatLicense(obs.license)}</div>
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
  assessmentDate,
}: OccurrenceMapRowProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceFeature[]>([]);
  const [breakdown, setBreakdown] = useState<RecordTypeBreakdown | null>(null);
  const [loadingOccurrences, setLoadingOccurrences] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);

  // Checkbox state for each observation type category (default: all checked except specimens, citations & occurrence)
  const [checkedTypes, setCheckedTypes] = useState({
    iNaturalist: true,
    humanOther: true,
    machineObservation: true,
    observation: false,
    preservedSpecimen: false,
    fossilSpecimen: false,
    livingSpecimen: false,
    materialSample: true,
    materialCitation: false,
    occurrence: false,
  });

  // Advanced filter state
  const [maxUncertainty, setMaxUncertainty] = useState<number | null>(null);
  const [colorByDate, setColorByDate] = useState(true);
  const [basemap, setBasemap] = useState<BasemapKey>("streets");
  const [splitView, setSplitView] = useState(false);
  const [splitDate, setSplitDate] = useState<string>(assessmentDate?.split("T")[0] || "");
  const [sharedViewState, setSharedViewState] = useState({ longitude: 0, latitude: 20, zoom: 1.5 });
  const mapRef = useRef<MapRef>(null);
  const [sampleSize, setSampleSize] = useState(1000);
  const [yearRange, setYearRange] = useState<[number, number]>([0, 9999]);

  // Filters dropdown state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

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

  // Hovered iNat observation (for map highlight)
  const [hoveredObs, setHoveredObs] = useState<InatObservation | null>(null);

  // Hovered year from histogram (for linked brushing)
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);

  // Hovered observation type pill (for linked brushing)
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  // Hovered occurrence on map (for hover tooltip)
  const [hoveredFeature, setHoveredFeature] = useState<OccurrenceFeature | null>(null);
  const [hoveredPanel, setHoveredPanel] = useState<string | null>(null);

  // Animation state: step through unique sorted dates
  const [animatingDateIdx, setAnimatingDateIdx] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Animation playback interval (date by date)
  useEffect(() => {
    if (!isPlaying) return;
    if (animatingDateIdx == null) {
      setAnimatingDateIdx(0);
    }
    const totalDays = animationDateRange.totalDays;
    // Base step: aim for ~20s animation at 1x, scale with speed
    const baseStep = Math.max(1, Math.ceil(totalDays / (20 * 60)));
    const step = baseStep * playbackSpeed;
    animationRef.current = setInterval(() => {
      setAnimatingDateIdx((prev) => {
        const cur = prev ?? 0;
        const next = cur + step;
        if (next >= totalDays) {
          setIsPlaying(false);
          return totalDays - 1;
        }
        return next;
      });
    }, 16);
    return () => {
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, [isPlaying, playbackSpeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop animation when user manually changes year range
  const handleYearRangeChange = useCallback((range: [number, number]) => {
    setYearRange(range);
    if (isPlaying) {
      setIsPlaying(false);
      setAnimatingDateIdx(null);
      if (animationRef.current) clearInterval(animationRef.current);
    }
  }, [isPlaying]);

  // Multi-stage filtering pipeline (before animation)
  const filteredBeforeAnimation = useMemo(() => {
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
    // 3. Year range filter
    result = result.filter((o) => {
      const y = o.properties.year;
      if (y == null) return true; // keep records without year data
      return y >= yearRange[0] && y <= yearRange[1];
    });
    return result;
  }, [occurrences, checkedTypes, maxUncertainty, yearRange]);

  // Continuous date range for animation (every day from earliest to latest)
  const animationDateRange = useMemo(() => {
    let minDate: string | null = null;
    let maxDate: string | null = null;
    for (const o of filteredBeforeAnimation) {
      const d = o.properties.eventDate ?? (o.properties.year != null ? `${o.properties.year}-01-01` : null);
      if (d == null) continue;
      if (minDate == null || d < minDate) minDate = d;
      if (maxDate == null || d > maxDate) maxDate = d;
    }
    if (!minDate || !maxDate) return { start: null, totalDays: 0 };
    const startMs = new Date(minDate).getTime();
    const endMs = new Date(maxDate).getTime();
    const totalDays = Math.floor((endMs - startMs) / 86400000) + 1;
    return { start: startMs, totalDays };
  }, [filteredBeforeAnimation]);

  // The current animation date cutoff
  const animatingDate = useMemo(() => {
    if (animatingDateIdx == null || animationDateRange.start == null) return null;
    const idx = Math.min(animatingDateIdx, animationDateRange.totalDays - 1);
    const d = new Date(animationDateRange.start + idx * 86400000);
    return d.toISOString().slice(0, 10);
  }, [animatingDateIdx, animationDateRange]);

  // Scrub animation to a year (from dragging the orange line)
  const handleAnimationScrub = useCallback((year: number) => {
    // Pause playback while scrubbing
    if (isPlaying) {
      if (animationRef.current) clearInterval(animationRef.current);
      animationRef.current = null;
      setIsPlaying(false);
    }
    // Convert year to a date index (Jan 1 of that year)
    if (animationDateRange.start == null) return;
    const targetMs = new Date(`${year}-01-01`).getTime();
    const dayIdx = Math.max(0, Math.min(
      Math.floor((targetMs - animationDateRange.start) / 86400000),
      animationDateRange.totalDays - 1
    ));
    setAnimatingDateIdx(dayIdx);
  }, [isPlaying, animationDateRange]);

  // Apply animation filter
  const filteredOccurrences = useMemo(() => {
    if (animatingDate != null) {
      return filteredBeforeAnimation.filter((o) => {
        const d = o.properties.eventDate ?? (o.properties.year != null ? String(o.properties.year) : null);
        return d != null && d <= animatingDate;
      });
    }
    return filteredBeforeAnimation;
  }, [filteredBeforeAnimation, animatingDate]);

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

  // Filter definitions — GBIF basis of record terminology with iNat kept separate
  const pillDefs = useMemo(() => {
    if (!breakdown) return [];
    const humanOtherCount = Math.max(0, breakdown.humanObservation - breakdown.iNaturalist);
    return [
      { key: "iNaturalist" as const, label: "iNaturalist (community science)", count: breakdown.iNaturalist },
      { key: "humanOther" as const, label: "Human observation (e.g. eBird, field surveys)", count: humanOtherCount },
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

  // Build GeoJSON FeatureCollection with computed styling properties for the circle layer
  const buildStyledFeatureCollection = useCallback((
    panelOccurrences: OccurrenceFeature[],
  ): GeoJSON.FeatureCollection => {
    const features = panelOccurrences.map((feature) => {
      const category = classifyOccurrence(feature);
      const isTypeBrushed = hoveredType != null && category === hoveredType;
      const isTypeDimmed = hoveredType != null && category !== hoveredType;
      const isBrushed = (hoveredYear != null && feature.properties.year === hoveredYear) || isTypeBrushed;
      const isDimmed = (hoveredYear != null && feature.properties.year !== hoveredYear) || isTypeDimmed;
      const isFeatureHovered = hoveredFeature?.properties.gbifID === feature.properties.gbifID;

      let strokeColor: string;
      let fillColor: string;
      if (isFeatureHovered) {
        strokeColor = "#1d4ed8";
        fillColor = "#3b82f6";
      } else if (isBrushed) {
        strokeColor = "#d97706";
        fillColor = "#f59e0b";
      } else if (colorByDate) {
        const dNum = dateToNumeric(feature.properties.eventDate, feature.properties.year);
        if (dNum != null) {
          const colors = dateToColor(dNum, minDateNum, maxDateNum);
          strokeColor = colors.stroke;
          fillColor = colors.fill;
        } else {
          strokeColor = "#6b7280";
          fillColor = "#9ca3af";
        }
      } else {
        // Color by before/after assessment year
        const isNew = !assessmentYear || (feature.properties.eventDate
          ? new Date(feature.properties.eventDate).getFullYear() > assessmentYear
          : false);
        strokeColor = isNew ? "#16a34a" : "#6b7280";
        fillColor = isNew ? "#4ade80" : "#9ca3af";
      }

      const radius = isFeatureHovered ? 7 : (isBrushed ? 6 : (isDimmed ? 4 : 5));
      const strokeWidth = isDimmed ? 1 : (isFeatureHovered || isBrushed ? 3 : 2);
      const opacity = isDimmed ? 0.15 : (isFeatureHovered || isBrushed ? 1 : 0.9);

      return {
        type: "Feature" as const,
        properties: {
          ...feature.properties,
          _fillColor: fillColor,
          _strokeColor: strokeColor,
          _radius: radius,
          _strokeWidth: strokeWidth,
          _opacity: opacity,
        },
        geometry: feature.geometry,
      };
    });
    return { type: "FeatureCollection", features };
  }, [hoveredType, hoveredYear, hoveredFeature, colorByDate, minDateNum, maxDateNum, assessmentYear]);

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
    if (!filteredBbox || animatingDateIdx != null) return;
    const key = filteredBbox.join(",");
    if (fittedBboxRef.current === key) return;
    if (fitMapToBbox(filteredBbox)) {
      fittedBboxRef.current = key;
      pendingBboxRef.current = null;
    } else {
      // Map not ready yet — store as pending for onLoad
      pendingBboxRef.current = filteredBbox;
    }
  }, [filteredBbox, animatingDateIdx, fitMapToBbox]);

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
                      width: 14, height: 14, borderRadius: "50%",
                      background: "rgba(59, 130, 246, 0.4)",
                      border: "2px solid #1d4ed8",
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
                    <div className="w-3 h-3 rounded-full" style={{ background: "hsl(30, 60%, 50%)", border: "2px solid hsl(30, 60%, 30%)" }} />
                    <span>{minDateLabel}</span>
                  </div>
                  <span>→</span>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: "hsl(142, 80%, 50%)", border: "2px solid hsl(142, 80%, 30%)" }} />
                    <span>{maxDateLabel}</span>
                  </div>
                  <span className="text-zinc-400">({panelOccurrences.length})</span>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-gray-500" />
                    <span>≤{assessmentYear}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-green-400 border-2 border-green-600" />
                    <span>After {assessmentYear}</span>
                  </div>
                  <span className="text-zinc-400">({panelOccurrences.length})</span>
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
                    {colorByDate ? "Before/after" : "By date"}
                  </button>
                  {!splitView && (
                    <button
                      onClick={() => {
                        if (!splitDate && assessmentDate) setSplitDate(assessmentDate.split("T")[0]);
                        setSplitView(true);
                        setIsPlaying(false);
                        setAnimatingDateIdx(null);
                        if (animationRef.current) clearInterval(animationRef.current);
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
          {/* Animating badge */}
          {!splitView && animatingDate != null && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-amber-500 text-white text-sm font-bold px-3 py-1 rounded-full shadow-md tabular-nums flex items-center gap-2">
              <span>{animatingDate}</span>
              <span className="text-xs font-normal text-amber-100">{panelOccurrences.length} / {filteredBeforeAnimation.length}</span>
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
        </div>
        {/* Sample size bar (only in single view) */}
        {!splitView && totalOccurrences != null && totalOccurrences > occurrences.length && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
            <span>
              Showing{" "}
              {filteredOccurrences.length < occurrences.length ? (
                <><strong>{filteredOccurrences.length.toLocaleString()}</strong> of <strong>{occurrences.length.toLocaleString()}</strong> loaded (filtered) &mdash; </>
              ) : null}
              <strong>{occurrences.length.toLocaleString()}</strong> of <strong>{totalOccurrences.toLocaleString()}</strong> total records
            </span>
            <span className="flex items-center gap-1.5">
              <span>Load more:</span>
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
      </div>
    );
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50">
      <div className="p-2">
        <div className="flex flex-col gap-2">
          {/* ── Filter Bar ── */}
          <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-2">
              {/* Filter by basis of record — dropdown checklist */}
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
                  Filter by basis of record
                  {!loadingBreakdown && (
                    <span className="text-[10px] text-zinc-400 tabular-nums">
                      {pillDefs.filter(p => checkedTypes[p.key]).length}/{pillDefs.length}
                    </span>
                  )}
                  <svg className={`w-3 h-3 text-zinc-400 transition-transform ${filtersOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {filtersOpen && !loadingBreakdown && (
                  <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg py-1">
                    {pillDefs.map((pill) => {
                      const active = checkedTypes[pill.key];
                      return (
                        <label
                          key={pill.key}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                          onMouseEnter={() => setHoveredType(pill.key)}
                          onMouseLeave={() => setHoveredType(null)}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleType(pill.key)}
                            className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                          />
                          <span className={active ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}>
                            {pill.label}
                          </span>
                          <span className={`ml-auto tabular-nums shrink-0 ${active ? "text-emerald-500 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                            {pill.count.toLocaleString()}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              {loadingBreakdown && (
                <div className="flex items-center gap-2 text-zinc-400 text-xs">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading...
                </div>
              )}

              {/* Separator */}
              <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 hidden sm:block" />

              {/* Year range trimmer */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Obs. by year</span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                  {yearRange[0]}
                </span>
                <YearRangeTrimmer
                  features={occurrences.filter((o) => {
                    if (!checkedTypes[classifyOccurrence(o) as keyof typeof checkedTypes]) return false;
                    if (maxUncertainty != null) {
                      const u = o.properties.coordinateUncertaintyInMeters;
                      if (u == null || u > maxUncertainty) return false;
                    }
                    return true;
                  })}
                  yearRange={yearRange}
                  onRangeChange={handleYearRangeChange}
                  assessmentYear={assessmentYear}
                  hoveredYear={hoveredYear}
                  onHoverYear={setHoveredYear}
                  animatingYear={animatingDate != null
                    ? parseInt(animatingDate.slice(0, 4)) || null
                    : null}
                  onAnimationScrub={handleAnimationScrub}
                  className="w-32 sm:w-44 h-8"
                />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                  {yearRange[1]}
                </span>
                {/* Play/pause animation */}
                <button
                  onClick={() => {
                    if (isPlaying) {
                      if (animationRef.current) clearInterval(animationRef.current);
                      animationRef.current = null;
                      setIsPlaying(false);
                    } else {
                      // Reset to start if at the end
                      if (animatingDateIdx != null && animatingDateIdx >= animationDateRange.totalDays - 1) {
                        setAnimatingDateIdx(0);
                      } else if (animatingDateIdx == null) {
                        setAnimatingDateIdx(0);
                      }
                      setIsPlaying(true);
                    }
                  }}
                  className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  title={isPlaying ? "Pause" : "Play timeline"}
                  disabled={animationDateRange.totalDays === 0}
                >
                  {isPlaying ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                {(isPlaying || animatingDateIdx != null) && (
                  <>
                    <button
                      onClick={() => {
                        if (animationRef.current) clearInterval(animationRef.current);
                        animationRef.current = null;
                        setIsPlaying(false);
                        setAnimatingDateIdx(null);
                      }}
                      className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                      title="Stop animation"
                    >
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setPlaybackSpeed((s) => s === 1 ? 2 : s === 2 ? 3 : s === 3 ? 5 : 1)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
                      title="Playback speed"
                    >
                      {playbackSpeed}x
                    </button>
                  </>
                )}
              </div>

              {/* Separator */}
              <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 hidden sm:block" />

              {/* GPS Uncertainty */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">GPS Uncertainty:</span>
                <select
                  value={maxUncertainty ?? ""}
                  onChange={(e) => setMaxUncertainty(e.target.value ? parseInt(e.target.value) : null)}
                  className="text-xs px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                >
                  {UNCERTAINTY_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.value ?? ""}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

            </div>
          </div>

          {/* ── Left sidebar (iNat photos + contributors) + Map (right) ── */}
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
            {/* Left column — iNat photos on top, contributors below (hidden if no iNat data) */}
            {(!breakdown || breakdown.iNaturalist > 0) && (
            <div className="sm:w-1/3 shrink-0 flex flex-col gap-2">
              {/* iNat photo grid — only shown when photos exist or loading */}
              {(inatPhotos.length > 0 || loadingInatPhotos) && (
                <div className="flex flex-col bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden relative z-10">
                  {/* Header */}
                  <div className="px-2 py-1.5 text-xs sm:text-[10px] font-medium text-zinc-500 dark:text-zinc-400 text-center border-b border-zinc-100 dark:border-zinc-800">
                    iNaturalist Photos {inatTotalCount > 0 && <span className="tabular-nums">— {inatTotalCount.toLocaleString()} observations</span>}
                  </div>
                  {inatPhotos.length > 0 ? (
                    <>
                      {/* Photos — 5-col grid */}
                      <div className={`grid grid-cols-5 gap-1 p-1.5 ${loadingInatPhotos ? "opacity-50" : ""}`}>
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

              {/* Observers / Identifiers chart (memoized to avoid rerender on hover state changes) */}
              {useMemo(() => <InatContributorsChart speciesKey={speciesKey} />, [speciesKey])}
            </div>
            )}

            {/* Map(s) — takes remaining width, stretches to match left column */}
            <div className="flex-1 min-w-0 flex flex-col">
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
