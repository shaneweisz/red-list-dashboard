"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type L from "leaflet";

// Fixed page size for iNat photo grid (5 columns x 2 rows)
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
const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
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
const MapOccurrenceTooltip = dynamic(
  () => import("./MapOccurrenceTooltip"),
  { ssr: false }
);
const InatContributorsChart = dynamic(
  () => import("./InatContributorsChart"),
  { ssr: false }
);

// Syncs two Leaflet maps: when one moves/zooms, the other follows
function MapSync({ syncRef }: { syncRef: React.MutableRefObject<{ center: [number, number]; zoom: number } | null> }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require("react-leaflet");
  const map = useMap();
  const isSyncing = useRef(false);

  useEffect(() => {
    const onMoveEnd = () => {
      if (isSyncing.current) return;
      const c = map.getCenter();
      syncRef.current = { center: [c.lat, c.lng], zoom: map.getZoom() };
    };
    map.on("moveend", onMoveEnd);
    map.on("zoomend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onMoveEnd);
    };
  }, [map, syncRef]);

  // Poll for changes from the other map (lightweight — only sets view when different)
  useEffect(() => {
    const interval = setInterval(() => {
      const s = syncRef.current;
      if (!s) return;
      const c = map.getCenter();
      const z = map.getZoom();
      if (Math.abs(c.lat - s.center[0]) > 0.0001 || Math.abs(c.lng - s.center[1]) > 0.0001 || z !== s.zoom) {
        isSyncing.current = true;
        map.setView(s.center, s.zoom, { animate: false });
        // Reset after Leaflet fires its events
        requestAnimationFrame(() => { isSyncing.current = false; });
      }
    }, 50);
    return () => clearInterval(interval);
  }, [map, syncRef]);

  return null;
}

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

// Basemap tile options
const BASEMAP_OPTIONS = {
  streets: {
    label: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; <a href="https://www.esri.com">Esri</a> World Imagery',
  },
  terrain: {
    label: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  },
} as const;
type BasemapKey = keyof typeof BASEMAP_OPTIONS;

// Shape icon factory for marker shapes by record type
const shapeIconCache = new Map<string, unknown>();
function getShapeIcon(
  category: string,
  fillColor: string,
  strokeColor: string,
  size: number,
): unknown {
  const key = `${category}-${fillColor}-${strokeColor}-${size}`;
  const cached = shapeIconCache.get(key);
  if (cached) return cached;

  const sw = 1.5;
  const s = size;
  let svgContent: string;

  switch (category) {
    case "iNaturalist":
      svgContent = `<circle cx="${s/2}" cy="${s/2}" r="${s/2 - sw}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}"/>`;
      break;
    case "humanOther":
      svgContent = `<circle cx="${s/2}" cy="${s/2}" r="${s/2 - sw}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}"/><circle cx="${s/2}" cy="${s/2}" r="1.5" fill="${strokeColor}"/>`;
      break;
    case "machineObservation":
      svgContent = `<rect x="${sw}" y="${sw}" width="${s - sw*2}" height="${s - sw*2}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}"/>`;
      break;
    case "preservedSpecimen":
      svgContent = `<rect x="${s*0.15}" y="${s*0.15}" width="${s*0.7}" height="${s*0.7}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}" transform="rotate(45 ${s/2} ${s/2})"/>`;
      break;
    case "materialSample":
      svgContent = `<polygon points="${s/2},${sw} ${s-sw},${s-sw} ${sw},${s-sw}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${sw}"/>`;
      break;
    default:
      svgContent = `<line x1="${s/2}" y1="${sw+1}" x2="${s/2}" y2="${s-sw-1}" stroke="${strokeColor}" stroke-width="${sw+1}" stroke-linecap="round"/><line x1="${sw+1}" y1="${s/2}" x2="${s-sw-1}" y2="${s/2}" stroke="${strokeColor}" stroke-width="${sw+1}" stroke-linecap="round"/>`;
      break;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require("leaflet");
  const icon = L.divIcon({
    html: `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`,
    className: "shape-marker-icon",
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  });
  shapeIconCache.set(key, icon);
  return icon;
}

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
  const [showUncertaintyCircles, setShowUncertaintyCircles] = useState(false);
  const [colorByDate, setColorByDate] = useState(true);
  const [dedupEnabled, setDedupEnabled] = useState(false);
  const [basemap, setBasemap] = useState<BasemapKey>("streets");
  const [shapeByType, setShapeByType] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [splitDate, setSplitDate] = useState<string>(assessmentDate?.split("T")[0] || "");
  const mapSyncRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [dedupGrid, setDedupGrid] = useState(0.01); // ~1km
  const [sampleSize, setSampleSize] = useState(1000);
  const [yearRange, setYearRange] = useState<[number, number]>([0, 9999]);

  // "More" popover state
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

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

  // Close "More" popover on outside click
  useEffect(() => {
    if (!moreOpen && !filtersOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreOpen && moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
      if (filtersOpen && filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen, filtersOpen]);

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

  // Classify an occurrence into one of the checkbox categories
  const getCategory = (o: OccurrenceFeature): keyof typeof checkedTypes => {
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
  };

  // Multi-stage filtering pipeline (before animation)
  const filteredBeforeAnimation = useMemo(() => {
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

  // Helper to check if an occurrence is after the assessment year
  const isNewRecord = (eventDate?: string): boolean => {
    // In new-assessments mode (no assessment year), all records are "new" (green)
    if (!assessmentYear) return true;
    if (!eventDate) return false;
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
  const { preAssessmentOccs, postAssessmentOccs, preBbox, postBbox } = useMemo(() => {
    if (!splitView || !splitDate) {
      return { preAssessmentOccs: [], postAssessmentOccs: [], preBbox: null, postBbox: null };
    }
    const pre: OccurrenceFeature[] = [];
    const post: OccurrenceFeature[] = [];
    for (const o of filteredOccurrences) {
      const d = o.properties.eventDate;
      if (d && d > splitDate) {
        post.push(o);
      } else {
        pre.push(o);
      }
    }
    const computeBbox = (features: OccurrenceFeature[]): [number, number, number, number] | null => {
      if (features.length === 0) return bbox;
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const f of features) {
        const [lon, lat] = f.geometry.coordinates;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      return [minLon, minLat, maxLon, maxLat];
    };
    return {
      preAssessmentOccs: pre,
      postAssessmentOccs: post,
      preBbox: computeBbox(pre),
      postBbox: computeBbox(post),
    };
  }, [splitView, splitDate, filteredOccurrences, bbox]);

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

  // Count by category for the legend (just pre/post assessment)
  const newRecords = filteredOccurrences.filter((o) => isNewRecord(o.properties.eventDate));
  const oldRecords = filteredOccurrences.filter((o) => !isNewRecord(o.properties.eventDate));

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

  // Reusable map panel renderer (used once in normal mode, twice in split view)
  const renderMapPanel = (
    panelOccurrences: OccurrenceFeature[],
    panelBbox: [number, number, number, number] | null,
    label: string | null,
    panelId: string = "main",
  ) => {
    const panelNewRecords = panelOccurrences.filter((o) => isNewRecord(o.properties.eventDate));
    const panelOldRecords = panelOccurrences.filter((o) => !isNewRecord(o.properties.eventDate));
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
            <MapContainer
              center={[20, 0]}
              zoom={2}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                key={basemap}
                attribution={BASEMAP_OPTIONS[basemap].attribution}
                url={BASEMAP_OPTIONS[basemap].url}
              />
              {splitView && <MapSync syncRef={mapSyncRef} />}
              <LocateControl />
              {panelBbox && animatingDateIdx == null && <FitBounds bbox={panelBbox} />}
              {/* Uncertainty circles */}
              {showUncertaintyCircles && panelOccurrences.map((feature, idx) => {
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
              {/* Render markers */}
              {panelOccurrences.map((feature, idx) => {
                const [lon, lat] = feature.geometry.coordinates;
                const isNew = isNewRecord(feature.properties.eventDate);
                const isHighlighted = hoveredObs?.gbifID != null && feature.properties.gbifID === hoveredObs.gbifID;
                const category = classifyOccurrence(feature);
                const isTypeBrushed = hoveredType != null && category === hoveredType;
                const isBrushed = (hoveredYear != null && feature.properties.year === hoveredYear) || isTypeBrushed;
                let strokeColor: string;
                let fillColor: string;
                if (isHighlighted) {
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
                  strokeColor = isNew ? "#15803d" : "#6b7280";
                  fillColor = isNew ? "#22c55e" : "#9ca3af";
                }
                const inatMatch = inatPhotosByGbifId.get(feature.properties.gbifID);
                const isFeatureHovered = hoveredFeature?.properties.gbifID === feature.properties.gbifID;
                const isEmphasized = isHighlighted || isFeatureHovered;
                const markerSize = isEmphasized ? 10 : (isBrushed ? 10 : 8);
                const clickHandler = () => {
                  window.open(`https://www.gbif.org/occurrence/${feature.properties.gbifID}`, "_blank");
                };
                const hoverHandlers = {
                  click: clickHandler,
                  ...(isTouchDevice ? {} : {
                    mouseover: () => { setHoveredFeature(feature); setHoveredPanel(panelId); },
                    mouseout: () => { setHoveredFeature(null); setHoveredPanel(null); },
                  }),
                };
                const markerOpacity = 1;

                if (shapeByType) {
                  const icon = getShapeIcon(category, fillColor, strokeColor, markerSize) as L.DivIcon;
                  return (
                    <Marker
                      key={feature.properties.gbifID || idx}
                      position={[lat, lon]}
                      icon={icon}
                      opacity={markerOpacity}
                      eventHandlers={hoverHandlers}
                    />
                  );
                }

                return (
                  <CircleMarker
                    key={feature.properties.gbifID || idx}
                    center={[lat, lon]}
                    radius={isEmphasized ? 7 : (isBrushed ? 6 : 5)}
                    pathOptions={{
                      color: strokeColor,
                      fillColor: fillColor,
                      fillOpacity: isEmphasized || isBrushed ? 1 : 0.9,
                      weight: isEmphasized || isBrushed ? 3 : 2,
                    }}
                    eventHandlers={hoverHandlers}
                  />
                );
              })}
              {/* Highlighted dot when hovering an iNat thumbnail */}
              {hoveredObs && hoveredObs.decimalLatitude != null && hoveredObs.decimalLongitude != null && (
                <>
                  <CircleMarker
                    center={[hoveredObs.decimalLatitude, hoveredObs.decimalLongitude]}
                    radius={5}
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
            </MapContainer>
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
              ) : assessmentYear && !splitView ? (
                <>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-gray-500" />
                    <span>≤{assessmentYear} ({panelOldRecords.length})</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-700" />
                    <span>New since {assessmentYear} ({panelNewRecords.length})</span>
                  </div>
                </>
              ) : label ? (
                <span>{panelOccurrences.length} occurrences</span>
              ) : (
                <span>
                  {totalOccurrences && totalOccurrences > occurrences.length
                    ? `${panelOccurrences.length} of ${totalOccurrences.toLocaleString()} occurrences`
                    : `${panelOccurrences.length} occurrences`}
                </span>
              )}
              {shapeByType && (
                <>
                  <span className="text-zinc-400">|</span>
                  {([
                    ["iNaturalist", "iNat"],
                    ["humanOther", "Other Human"],
                    ["machineObservation", "Machine"],
                    ["preservedSpecimen", "Specimen"],
                    ["materialSample", "Material"],
                  ] as const).map(([cat, catLabel]) => (
                    <div key={cat} className="flex items-center gap-0.5">
                      <svg width="10" height="10" viewBox="0 0 12 12" className="shrink-0">
                        {cat === "iNaturalist" && <circle cx="6" cy="6" r="4.5" fill="#22c55e" stroke="#15803d" strokeWidth="1.5"/>}
                        {cat === "humanOther" && <><circle cx="6" cy="6" r="4.5" fill="#22c55e" stroke="#15803d" strokeWidth="1.5"/><circle cx="6" cy="6" r="1.5" fill="#15803d"/></>}
                        {cat === "machineObservation" && <rect x="1.5" y="1.5" width="9" height="9" fill="#22c55e" stroke="#15803d" strokeWidth="1.5"/>}
                        {cat === "preservedSpecimen" && <rect x="1.8" y="1.8" width="8.4" height="8.4" fill="#22c55e" stroke="#15803d" strokeWidth="1.5" transform="rotate(45 6 6)"/>}
                        {cat === "materialSample" && <polygon points="6,1.5 10.5,10.5 1.5,10.5" fill="#22c55e" stroke="#15803d" strokeWidth="1.5"/>}
                      </svg>
                      <span className="text-[10px]">{catLabel}</span>
                    </div>
                  ))}
                </>
              )}
              {dedupEnabled && (
                <span className="text-zinc-400">(deduped)</span>
              )}
            </div>
          )}
          {/* Split view button */}
          {!loadingOccurrences && assessmentYear && !splitView && (
            <button
              onClick={() => {
                if (!splitDate && assessmentDate) setSplitDate(assessmentDate.split("T")[0]);
                setSplitView(true);
                setIsPlaying(false);
                setAnimatingDateIdx(null);
                if (animationRef.current) clearInterval(animationRef.current);
              }}
              className="absolute bottom-2 right-2 z-[1000] bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[11px] font-medium px-2.5 py-1.5 rounded shadow border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="1" y="2" width="14" height="12" rx="1.5" />
                <line x1="8" y1="2" x2="8" y2="14" />
              </svg>
              Split view
            </button>
          )}
          {/* Animating badge */}
          {!splitView && animatingDate != null && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-amber-500 text-white text-sm font-bold px-3 py-1 rounded-full shadow-md tabular-nums flex items-center gap-2">
              <span>{animatingDate}</span>
              <span className="text-xs font-normal text-amber-100">{filteredOccurrences.length} / {filteredBeforeAnimation.length}</span>
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
              {(Object.entries(BASEMAP_OPTIONS) as [BasemapKey, (typeof BASEMAP_OPTIONS)[BasemapKey]][]).map(([key, opt]) => (
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
                    if (!checkedTypes[getCategory(o)]) return false;
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
                  title={splitView ? "Disable split view to use animation" : isPlaying ? "Pause" : "Play timeline"}
                  disabled={animationDateRange.totalDays === 0 || splitView}
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
                  {UNCERTAINTY_OPTIONS.map((opt) => {
                    const count = uncertaintyCounts.get(opt.value ?? null);
                    return (
                      <option key={opt.label} value={opt.value ?? ""}>
                        {opt.label}
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

                    {/* Color by date toggle */}
                    <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={colorByDate}
                        onChange={(e) => setColorByDate(e.target.checked)}
                        className="w-3 h-3 rounded accent-blue-500"
                      />
                      Color markers by date
                      {colorByDate && (
                        <span className="ml-auto flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ background: "hsl(30, 60%, 50%)" }} />
                          <span>old</span>
                          <span className="w-2 h-2 rounded-full" style={{ background: "hsl(142, 80%, 50%)" }} />
                          <span>new</span>
                        </span>
                      )}
                    </label>

                    {/* Shape by record type toggle */}
                    <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shapeByType}
                        onChange={(e) => setShapeByType(e.target.checked)}
                        className="w-3 h-3 rounded accent-blue-500"
                      />
                      Shape markers by record type
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

              {/* Observers / Identifiers chart */}
              <InatContributorsChart speciesKey={speciesKey} />
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
