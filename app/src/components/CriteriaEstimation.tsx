"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  EOO_THRESHOLDS,
  AOO_THRESHOLDS,
  LOCATION_THRESHOLDS,
  type CriteriaEstimationResult,
  type OccurrencePoint,
  type GridCellBounds,
  type LocationCluster,
  type AOOMethod,
} from "@/lib/criteria-estimation";

// ── Dynamic Leaflet imports (SSR-safe) ───────────────────────────────────

const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false },
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false },
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((mod) => mod.CircleMarker),
  { ssr: false },
);
const Circle = dynamic(
  () => import("react-leaflet").then((mod) => mod.Circle),
  { ssr: false },
);
const Polygon = dynamic(
  () => import("react-leaflet").then((mod) => mod.Polygon),
  { ssr: false },
);
const Rectangle = dynamic(
  () => import("react-leaflet").then((mod) => mod.Rectangle),
  { ssr: false },
);
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false },
);
const FitBounds = dynamic(() => import("./FitBounds"), { ssr: false });

// ── Types ────────────────────────────────────────────────────────────────

interface CriteriaEstimationProps {
  speciesKey: number;
  assessmentYear?: number | null;
}

interface Params {
  minYear: number;
  maxUncertainty: number;
  gridSize: number;
  clusterDistance: number;
  outlierDistance: number;
  aooMethod: AOOMethod;
  prevalence: number;
}

/** Point from API (slightly different from OccurrencePoint — nulls not undefined) */
interface MapPoint {
  lat: number;
  lng: number;
  year: number | null;
  coordinateUncertainty: number | null;
  basisOfRecord: string | null;
}

interface MapLayers {
  points: boolean;
  hull: boolean;
  aooCells: boolean;
  clusters: boolean;
  uncertainty: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: Params = {
  minYear: 0,
  maxUncertainty: 10_000,
  gridSize: 2,
  clusterDistance: 10,
  outlierDistance: 0,
  aooMethod: "eoo-prevalence",
  prevalence: 100,
};

const DEFAULT_LAYERS: MapLayers = {
  points: true,
  hull: true,
  aooCells: true,
  clusters: false,
  uncertainty: false,
};

const UNCERTAINTY_OPTIONS = [
  { label: "100 m", value: 100 },
  { label: "1 km", value: 1_000 },
  { label: "10 km", value: 10_000 },
  { label: "50 km", value: 50_000 },
  { label: "No limit", value: 0 },
];

const GRID_SIZE_OPTIONS = [
  { label: "1 km", value: 1 },
  { label: "2 km (IUCN standard)", value: 2 },
  { label: "4 km", value: 4 },
  { label: "10 km", value: 10 },
];

// ── Category styling ─────────────────────────────────────────────────────

const CATEGORY_STYLE: Record<string, { color: string; bg: string }> = {
  CR: { color: "#dc2626", bg: "#fef2f2" },
  EN: { color: "#ea580c", bg: "#fff7ed" },
  VU: { color: "#ca8a04", bg: "#fefce8" },
};

// ── Year-based point coloring ────────────────────────────────────────────

/** Color occurrence points by recency: older=cool/blue, recent=warm/red */
function yearColor(year: number | null, minYear: number, maxYear: number): string {
  if (year == null) return "#94a3b8"; // grey for unknown year
  const range = maxYear - minYear || 1;
  const t = Math.max(0, Math.min(1, (year - minYear) / range));
  // Blue (old) → Yellow → Red (recent)
  if (t < 0.5) {
    const s = t * 2;
    const r = Math.round(59 + s * (234 - 59));
    const g = Math.round(130 + s * (179 - 130));
    const b = Math.round(246 - s * 246);
    return `rgb(${r},${g},${b})`;
  }
  const s = (t - 0.5) * 2;
  const r = Math.round(234 + s * (220 - 234));
  const g = Math.round(179 - s * 141);
  const b = Math.round(0 + s * 38);
  return `rgb(${r},${g},${b})`;
}

/** Flag suspicious points: Null Island, extreme coordinates */
function isSuspicious(p: MapPoint): string | null {
  if (Math.abs(p.lat) < 0.1 && Math.abs(p.lng) < 0.1) return "Near Null Island (0,0) — likely a data error";
  if (Math.abs(p.lat) > 85) return "Near pole — coordinate may be erroneous";
  return null;
}

// ── Map component ────────────────────────────────────────────────────────

function CriterionBMap({
  points,
  hullVertices,
  cellBounds,
  clusters,
  layers,
}: {
  points: MapPoint[];
  hullVertices: [number, number][];
  cellBounds: GridCellBounds[];
  clusters: LocationCluster[];
  layers: MapLayers;
}) {
  // Compute bounds from all points
  const bbox = useMemo(() => {
    if (points.length === 0) return null;
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    return [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
  }, [points]);

  // Year range for coloring
  const [minYear, maxYear] = useMemo(() => {
    const years = points.map((p) => p.year).filter((y): y is number => y != null);
    if (years.length === 0) return [2000, 2024];
    return [Math.min(...years), Math.max(...years)];
  }, [points]);

  // Suspicious points
  const suspiciousPoints = useMemo(
    () => points.filter((p) => isSuspicious(p) !== null),
    [points],
  );

  if (!bbox || points.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700" style={{ height: 420 }}>
        <MapContainer
          center={[(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2]}
          zoom={4}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          />
          <FitBounds bbox={bbox} />

          {/* AOO grid cells — render below points */}
          {layers.aooCells && cellBounds.map((cell, i) => (
            <Rectangle
              key={`cell-${i}`}
              bounds={[
                [cell.bounds[0], cell.bounds[1]],
                [cell.bounds[2], cell.bounds[3]],
              ]}
              pathOptions={{
                color: "#f59e0b",
                weight: 1,
                fillColor: "#f59e0b",
                fillOpacity: 0.15,
              }}
            >
              <Popup>
                <div className="text-xs">
                  <strong>AOO grid cell</strong><br />
                  {cell.pointCount} occurrence{cell.pointCount !== 1 ? "s" : ""}
                </div>
              </Popup>
            </Rectangle>
          ))}

          {/* EOO convex hull polygon */}
          {layers.hull && hullVertices.length >= 3 && (
            <Polygon
              positions={hullVertices.map(([lat, lng]) => [lat, lng] as [number, number])}
              pathOptions={{
                color: "#3b82f6",
                weight: 2,
                dashArray: "6 4",
                fillColor: "#3b82f6",
                fillOpacity: 0.06,
              }}
            >
              <Popup>
                <div className="text-xs">
                  <strong>EOO Convex Hull</strong><br />
                  {hullVertices.length} vertices
                </div>
              </Popup>
            </Polygon>
          )}

          {/* Location clusters */}
          {layers.clusters && clusters.map((cluster, i) => (
            <Circle
              key={`cluster-${i}`}
              center={[cluster.centroid[0], cluster.centroid[1]]}
              radius={Math.max(cluster.radiusKm * 1000, 500)}
              pathOptions={{
                color: "#8b5cf6",
                weight: 1.5,
                dashArray: "4 3",
                fillColor: "#8b5cf6",
                fillOpacity: 0.08,
              }}
            >
              <Popup>
                <div className="text-xs">
                  <strong>Location {i + 1}</strong><br />
                  {cluster.pointCount} point{cluster.pointCount !== 1 ? "s" : ""}<br />
                  Radius: {cluster.radiusKm.toFixed(1)} km
                </div>
              </Popup>
            </Circle>
          ))}

          {/* Coordinate uncertainty circles */}
          {layers.uncertainty && points
            .filter((p) => p.coordinateUncertainty != null && p.coordinateUncertainty > 0)
            .map((p, i) => (
              <Circle
                key={`unc-${i}`}
                center={[p.lat, p.lng]}
                radius={p.coordinateUncertainty!}
                pathOptions={{
                  color: "#94a3b8",
                  weight: 0.5,
                  fillColor: "#94a3b8",
                  fillOpacity: 0.05,
                }}
              />
            ))}

          {/* Occurrence points — rendered last (on top) */}
          {layers.points && points.map((p, i) => {
            const suspicious = isSuspicious(p);
            return (
              <CircleMarker
                key={`pt-${i}`}
                center={[p.lat, p.lng]}
                radius={suspicious ? 5 : 3}
                pathOptions={{
                  color: suspicious ? "#ef4444" : yearColor(p.year, minYear, maxYear),
                  weight: suspicious ? 2 : 1,
                  fillColor: suspicious ? "#ef4444" : yearColor(p.year, minYear, maxYear),
                  fillOpacity: 0.7,
                }}
              >
                <Popup>
                  <div className="text-xs space-y-0.5">
                    <div><strong>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</strong></div>
                    {p.year && <div>Year: {p.year}</div>}
                    {p.basisOfRecord && <div>{p.basisOfRecord}</div>}
                    {p.coordinateUncertainty != null && (
                      <div>Uncertainty: {p.coordinateUncertainty >= 1000
                        ? `${(p.coordinateUncertainty / 1000).toFixed(1)} km`
                        : `${p.coordinateUncertainty} m`
                      }</div>
                    )}
                    {suspicious && (
                      <div className="text-red-600 font-semibold mt-1">{suspicious}</div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {/* Year color legend */}
      <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400 px-1">
        <span>Older ({minYear})</span>
        <div className="flex-1 h-2 rounded-full" style={{
          background: `linear-gradient(to right, rgb(59,130,246), rgb(234,179,0), rgb(220,38,38))`,
        }} />
        <span>Recent ({maxYear})</span>
        <span className="ml-2 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
          No year
        </span>
      </div>

      {/* Warnings */}
      {suspiciousPoints.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
          <strong>{suspiciousPoints.length} suspicious point{suspiciousPoints.length !== 1 ? "s" : ""} detected</strong> (shown in red) — these may be data errors. Consider enabling outlier exclusion.
        </div>
      )}
    </div>
  );
}

// ── Layer toggle controls ────────────────────────────────────────────────

function LayerToggles({
  layers,
  onChange,
  hullVertexCount,
  cellCount,
  clusterCount,
}: {
  layers: MapLayers;
  onChange: (layers: MapLayers) => void;
  hullVertexCount: number;
  cellCount: number;
  clusterCount: number;
}) {
  const toggles: { key: keyof MapLayers; label: string; color: string; detail: string }[] = [
    { key: "points", label: "Occurrences", color: "#6366f1", detail: "colored by year" },
    { key: "hull", label: "EOO Hull", color: "#3b82f6", detail: `${hullVertexCount} vertices` },
    { key: "aooCells", label: "GBIF Cells", color: "#f59e0b", detail: `${cellCount} cells` },
    { key: "clusters", label: "Locations", color: "#8b5cf6", detail: `${clusterCount} clusters` },
    { key: "uncertainty", label: "Uncertainty", color: "#94a3b8", detail: "coord. radius" },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {toggles.map(({ key, label, color, detail }) => (
        <button
          key={key}
          onClick={() => onChange({ ...layers, [key]: !layers[key] })}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors ${
            layers[key]
              ? "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
              : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 opacity-50"
          }`}
        >
          <span
            className="w-2.5 h-2.5 rounded-sm inline-block"
            style={{ backgroundColor: layers[key] ? color : "#d4d4d8" }}
          />
          <span className="font-medium">{label}</span>
          <span className="text-zinc-400 dark:text-zinc-500">{detail}</span>
        </button>
      ))}
    </div>
  );
}

// ── Threshold gauge component ────────────────────────────────────────────

function ThresholdGauge({
  label,
  value,
  unit,
  thresholds,
  suggestedCategory,
  description,
}: {
  label: string;
  value: number;
  unit: string;
  thresholds: { CR: number; EN: number; VU: number };
  suggestedCategory: string | null;
  description?: string;
}) {
  const maxDisplay = thresholds.VU * 3;
  const logValue = Math.log10(Math.max(value, 0.1));
  const logMax = Math.log10(maxDisplay);
  const logMin = Math.log10(Math.max(thresholds.CR * 0.1, 0.1));
  const position = Math.min(100, Math.max(0, ((logValue - logMin) / (logMax - logMin)) * 100));

  const crPos = ((Math.log10(thresholds.CR) - logMin) / (logMax - logMin)) * 100;
  const enPos = ((Math.log10(thresholds.EN) - logMin) / (logMax - logMin)) * 100;
  const vuPos = ((Math.log10(thresholds.VU) - logMin) / (logMax - logMin)) * 100;

  const style = suggestedCategory ? CATEGORY_STYLE[suggestedCategory] : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
            {value < 1 ? value.toFixed(2) : value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
          <span className="text-xs text-zinc-500">{unit}</span>
          {suggestedCategory && style && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ color: style.color, backgroundColor: style.bg }}
            >
              {suggestedCategory}
            </span>
          )}
        </span>
      </div>
      {description && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      )}
      <div className="relative h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-visible">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-red-100 dark:bg-red-900/30" style={{ width: `${crPos}%` }} />
        <div className="absolute inset-y-0 bg-orange-100 dark:bg-orange-900/30" style={{ left: `${crPos}%`, width: `${enPos - crPos}%` }} />
        <div className="absolute inset-y-0 bg-yellow-100 dark:bg-yellow-900/30" style={{ left: `${enPos}%`, width: `${vuPos - enPos}%` }} />
        <div className="absolute inset-y-0 rounded-r-full bg-green-100 dark:bg-green-900/30" style={{ left: `${vuPos}%`, right: 0 }} />
        {[
          { pos: crPos, label: "CR", val: thresholds.CR },
          { pos: enPos, label: "EN", val: thresholds.EN },
          { pos: vuPos, label: "VU", val: thresholds.VU },
        ].map(({ pos, label: lbl, val }) => (
          <div key={lbl} className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: `${pos}%` }}>
            <div className="w-px h-full bg-zinc-400 dark:bg-zinc-600" />
            <span className="absolute -bottom-4 text-[10px] text-zinc-500 whitespace-nowrap" style={{ transform: "translateX(-50%)" }}>
              {val >= 1000 ? `${val / 1000}K` : val}
            </span>
          </div>
        ))}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 shadow-sm"
          style={{
            left: `${position}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: style?.color || "#22c55e",
          }}
        />
      </div>
      <div className="h-3" />
    </div>
  );
}

// ── Trend row ────────────────────────────────────────────────────────────

function TrendRow({
  label,
  earlier,
  later,
  changePercent,
  earlierPeriod,
  laterPeriod,
  unit,
}: {
  label: string;
  earlier: number;
  later: number;
  changePercent: number;
  earlierPeriod: string;
  laterPeriod: string;
  unit: string;
}) {
  const isDecline = changePercent < -10;
  const isIncrease = changePercent > 10;
  const color = isDecline ? "#ef4444" : isIncrease ? "#22c55e" : "#71717a";
  const arrow = isDecline ? "↓" : isIncrease ? "↑" : "→";

  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-3 tabular-nums">
        <span className="text-zinc-500 text-xs">{earlierPeriod}: {earlier.toLocaleString()} {unit}</span>
        <span className="font-bold" style={{ color }}>
          {arrow} {changePercent > 0 ? "+" : ""}{changePercent}%
        </span>
        <span className="text-zinc-500 text-xs">{laterPeriod}: {later.toLocaleString()} {unit}</span>
      </div>
    </div>
  );
}

// ── Subcriterion badge ───────────────────────────────────────────────────

function SubcriterionBadge({ code, label, met }: { code: string; label: string; met: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
      met
        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
    }`}>
      <span className={`w-3 h-3 rounded-full inline-flex items-center justify-center text-[8px] font-bold ${
        met ? "bg-red-500 text-white" : "border border-zinc-300 dark:border-zinc-600"
      }`}>
        {met ? "✓" : ""}
      </span>
      <span className="font-medium">{code}</span>
      {label}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────

/** Result type from the API (without filteredPoints, which are sent separately) */
type APIResult = Omit<CriteriaEstimationResult, "filteredPoints">;

export default function CriteriaEstimation({ speciesKey, assessmentYear }: CriteriaEstimationProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [result, setResult] = useState<APIResult | null>(null);
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [showMap, setShowMap] = useState(true);
  const [activeSubtab, setActiveSubtab] = useState<string>("criterion-b");

  const runEstimation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const searchParams = new URLSearchParams({
        speciesKey: String(speciesKey),
      });
      if (params.minYear > 0) searchParams.set("minYear", String(params.minYear));
      if (params.maxUncertainty > 0) searchParams.set("maxUncertainty", String(params.maxUncertainty));
      if (params.gridSize !== 2) searchParams.set("gridSize", String(params.gridSize));
      if (params.clusterDistance !== 10) searchParams.set("clusterDistance", String(params.clusterDistance));
      if (params.outlierDistance > 0) searchParams.set("outlierDistance", String(params.outlierDistance));
      if (params.aooMethod !== "gbif") searchParams.set("aooMethod", params.aooMethod);
      if (params.prevalence !== 100) searchParams.set("prevalence", String(params.prevalence / 100));

      const res = await fetch(`/api/redlist/criteria-estimate?${searchParams}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else if (data.result) {
        setResult(data.result);
        setMapPoints(data.filteredPoints ?? []);
      } else {
        setError(data.message || "No data available");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [speciesKey, params]);

  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Parameter Estimation
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Estimate parameters to assist with drafting IUCN Red List assessments
          </p>
        </div>
      </div>

      {/* Subtab navigation */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-700 -mx-4 px-4">
        <button
          onClick={() => setActiveSubtab("criterion-b")}
          className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
            activeSubtab === "criterion-b"
              ? "text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400"
              : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Criterion B
        </button>
        {(["Criterion A", "Criterion C", "Criterion D"] as const).map((label) => (
          <span
            key={label}
            className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-600 cursor-default border-b-2 border-transparent"
          >
            {label} <span className="text-[10px] opacity-60">soon</span>
          </span>
        ))}
        <span className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-600 cursor-default border-b-2 border-transparent">
          Supporting Info <span className="text-[10px] opacity-60">soon</span>
        </span>
      </div>

      {/* Criterion B subtab */}
      {activeSubtab === "criterion-b" && (<>
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Geographic range: EOO, AOO, and number of locations from GBIF occurrence data
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowParams(!showParams)}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            {showParams ? "Hide" : "Show"} Parameters
          </button>
          <button
            onClick={runEstimation}
            disabled={loading}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                Analyzing...
              </span>
            ) : result ? "Re-run Analysis" : "Run Analysis"}
          </button>
        </div>
      </div>

      {/* Parameter controls (collapsible) */}
      {showParams && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Min. year
            </label>
            <input
              type="number"
              value={params.minYear || ""}
              placeholder="All time"
              onChange={(e) => updateParam("minYear", parseInt(e.target.value) || 0)}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Max uncertainty
            </label>
            <select
              value={params.maxUncertainty}
              onChange={(e) => updateParam("maxUncertainty", parseInt(e.target.value))}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            >
              {UNCERTAINTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Observation grid cell size
            </label>
            <select
              value={params.gridSize}
              onChange={(e) => updateParam("gridSize", parseFloat(e.target.value))}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            >
              {GRID_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Location cluster distance (km)
            </label>
            <input
              type="number"
              value={params.clusterDistance}
              min={1}
              max={500}
              onChange={(e) => updateParam("clusterDistance", parseFloat(e.target.value) || 10)}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Outlier exclusion (km from median, 0=off)
            </label>
            <input
              type="number"
              value={params.outlierDistance}
              min={0}
              max={10000}
              onChange={(e) => updateParam("outlierDistance", parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            />
          </div>
          <div className="col-span-2 sm:col-span-3 space-y-2">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              AOO estimation method
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => updateParam("aooMethod", "gbif")}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  params.aooMethod === "gbif"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                    : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                }`}
              >
                GBIF Records
              </button>
              <button
                onClick={() => updateParam("aooMethod", "eoo-prevalence")}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  params.aooMethod === "eoo-prevalence"
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium"
                    : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                }`}
              >
                EOO × Prevalence
              </button>
              <span className="px-3 py-1.5 text-xs rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-400 dark:text-zinc-500 cursor-default">
                AOH × Prevalence <span className="text-[10px] ml-1 opacity-70">coming soon</span>
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {params.aooMethod === "gbif"
                ? "Count of 2 km grid cells with GBIF occurrence records. Likely underestimates AOO for poorly-sampled species."
                : "Overlay the EOO hull with a grid, then apply a prevalence estimate. Adjust the slider below."}
            </p>
            {params.aooMethod === "eoo-prevalence" && (
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Prevalence: <strong>{params.prevalence}%</strong> of EOO grid cells occupied
                </label>
                <input
                  type="range"
                  value={params.prevalence}
                  min={1}
                  max={100}
                  step={1}
                  onChange={(e) => updateParam("prevalence", parseInt(e.target.value))}
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-400 mt-0.5">
                  <span>1%</span>
                  <span className="text-zinc-500">{result ? `${Math.ceil(result.aoo.totalEOOCells * params.prevalence / 100)} of ${result.aoo.totalEOOCells} EOO cells = ${(Math.ceil(result.aoo.totalEOOCells * params.prevalence / 100) * params.gridSize * params.gridSize).toLocaleString()} km²` : "Run analysis first"}</span>
                  <span>100%</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setParams(DEFAULT_PARAMS)}
              className="px-3 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              Reset defaults
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Data summary */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 pb-2 border-b border-zinc-200 dark:border-zinc-700">
            <span>Points used: <strong className="text-zinc-700 dark:text-zinc-300">{result.meta.usedPoints.toLocaleString()}</strong> of {result.meta.totalPoints.toLocaleString()}</span>
            {result.meta.filteredOut.uncertainty > 0 && <span>Excluded (uncertainty): {result.meta.filteredOut.uncertainty}</span>}
            {result.meta.filteredOut.year > 0 && <span>Excluded (year): {result.meta.filteredOut.year}</span>}
            {result.meta.filteredOut.outlier > 0 && <span>Excluded (outlier): {result.meta.filteredOut.outlier}</span>}
            {result.meta.filteredOut.duplicate > 0 && <span>Deduplicated: {result.meta.filteredOut.duplicate}</span>}
          </div>

          {/* Map visualization */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                Sense-check Map
              </h4>
              <button
                onClick={() => setShowMap(!showMap)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                {showMap ? "Hide map" : "Show map"}
              </button>
            </div>
            {showMap && (
              <>
                <LayerToggles
                  layers={layers}
                  onChange={setLayers}
                  hullVertexCount={result.eoo.hullVertices.length}
                  cellCount={result.aoo.observationCells}
                  clusterCount={result.locations.count}
                />
                <CriterionBMap
                  points={mapPoints}
                  hullVertices={result.eoo.hullVertices}
                  cellBounds={result.aoo.cellBounds ?? []}
                  clusters={result.locations.clusters}
                  layers={layers}
                />
                <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">Sense-check guidance (IUCN Mapping Standards)</p>
                  <ul className="text-[11px] text-blue-600 dark:text-blue-400/80 space-y-0.5 list-disc list-inside">
                    <li>Verify that occurrence points fall within the species&apos; known range — look for outliers in unexpected regions</li>
                    <li>Check that the <strong>convex hull</strong> (blue dashed line) does not include large uninhabitable areas (e.g. ocean for terrestrial species)</li>
                    <li>GBIF observation cells (amber) show where records exist — switch to <strong>EOO × Prevalence</strong> mode and adjust the slider if GBIF sampling is incomplete</li>
                    <li>Assess whether <strong>location clusters</strong> (purple) correspond to distinct threat-affected areas, not just point density</li>
                    <li>Older points (blue) near the edge may no longer reflect the current range — consider adjusting the minimum year filter</li>
                    <li>Red-highlighted points near (0,0) or poles are likely data errors and should be excluded</li>
                  </ul>
                </div>
              </>
            )}
          </div>

          {/* Gauges */}
          <div className="space-y-5">
            <ThresholdGauge
              label="EOO (Extent of Occurrence)"
              value={result.eoo.areaKm2}
              unit="km²"
              thresholds={EOO_THRESHOLDS}
              suggestedCategory={result.eoo.suggestedCategory}
              description={`Minimum convex polygon enclosing ${result.eoo.pointCount} occurrence points (${result.eoo.hullVertices.length} hull vertices)`}
            />
            <ThresholdGauge
              label="AOO (Area of Occupancy)"
              value={result.aoo.areaKm2}
              unit="km²"
              thresholds={AOO_THRESHOLDS}
              suggestedCategory={result.aoo.suggestedCategory}
              description={
                result.aoo.method === "gbif"
                  ? `${result.aoo.observationCells} GBIF observation grid cells (${result.aoo.gridSizeKm}×${result.aoo.gridSizeKm} km)`
                  : `${result.aoo.occupiedCells} of ${result.aoo.totalEOOCells} EOO grid cells (${Math.round(result.aoo.prevalence * 100)}% prevalence)`
              }
            />
            <ThresholdGauge
              label="Number of Locations"
              value={result.locations.count}
              unit={result.locations.count === 1 ? "location" : "locations"}
              thresholds={LOCATION_THRESHOLDS}
              suggestedCategory={
                result.locations.count <= LOCATION_THRESHOLDS.CR ? "CR" :
                result.locations.count <= LOCATION_THRESHOLDS.EN ? "EN" :
                result.locations.count <= LOCATION_THRESHOLDS.VU ? "VU" : null
              }
              description={`Clusters at ${result.locations.clusterDistanceKm} km distance threshold (largest cluster: ${result.locations.clusters[0]?.pointCount ?? 0} points)`}
            />
          </div>

          {/* Temporal trends */}
          {(result.temporal.eooTrend || result.temporal.aooTrend) && (
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
              <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Temporal Trends (split at {result.temporal.splitYear})
              </h4>
              {result.temporal.eooTrend && (
                <TrendRow
                  label="EOO"
                  earlier={result.temporal.eooTrend.earlierValue}
                  later={result.temporal.eooTrend.laterValue}
                  changePercent={result.temporal.eooTrend.changePercent}
                  earlierPeriod={result.temporal.eooTrend.earlierPeriod}
                  laterPeriod={result.temporal.eooTrend.laterPeriod}
                  unit="km²"
                />
              )}
              {result.temporal.aooTrend && (
                <TrendRow
                  label="AOO"
                  earlier={result.temporal.aooTrend.earlierValue}
                  later={result.temporal.aooTrend.laterValue}
                  changePercent={result.temporal.aooTrend.changePercent}
                  earlierPeriod={result.temporal.aooTrend.earlierPeriod}
                  laterPeriod={result.temporal.aooTrend.laterPeriod}
                  unit="km²"
                />
              )}
              {result.temporal.locationsTrend && (
                <TrendRow
                  label="Locations"
                  earlier={result.temporal.locationsTrend.earlierValue}
                  later={result.temporal.locationsTrend.laterValue}
                  changePercent={result.temporal.locationsTrend.changePercent}
                  earlierPeriod={result.temporal.locationsTrend.earlierPeriod}
                  laterPeriod={result.temporal.locationsTrend.laterPeriod}
                  unit=""
                />
              )}
            </div>
          )}

          {/* Criterion B assessment */}
          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-2">
              Criterion B Assessment
            </h4>
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                  <span className="text-xs font-medium text-zinc-500">B1 (EOO)</span>
                  <div className="mt-0.5">
                    {result.criterionB.b1.meetsThreshold ? (
                      <span className="font-semibold" style={{ color: CATEGORY_STYLE[result.criterionB.b1.eooCategory!]?.color }}>
                        {result.criterionB.b1.eooCategory} threshold met
                      </span>
                    ) : (
                      <span className="text-zinc-400">Above thresholds</span>
                    )}
                  </div>
                </div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                  <span className="text-xs font-medium text-zinc-500">B2 (AOO)</span>
                  <div className="mt-0.5">
                    {result.criterionB.b2.meetsThreshold ? (
                      <span className="font-semibold" style={{ color: CATEGORY_STYLE[result.criterionB.b2.aooCategory!]?.color }}>
                        {result.criterionB.b2.aooCategory} threshold met
                      </span>
                    ) : (
                      <span className="text-zinc-400">Above thresholds</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                <span className="text-xs font-medium text-zinc-500">Subcriteria (need ≥2 for Criterion B)</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <SubcriterionBadge code="(a)" label="Few locations" met={result.criterionB.subcriteria.a} />
                  <SubcriterionBadge code="(b)(i)" label="EOO decline" met={result.criterionB.subcriteria.bi} />
                  <SubcriterionBadge code="(b)(ii)" label="AOO decline" met={result.criterionB.subcriteria.bii} />
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 inline-block" />
                    (b)(iii-v), (c) — requires additional data
                  </span>
                </div>
              </div>

              {result.criterionB.overallCategory ? (
                <div
                  className="px-4 py-3 rounded-lg border text-sm"
                  style={{
                    borderColor: CATEGORY_STYLE[result.criterionB.overallCategory]?.color + "40",
                    backgroundColor: CATEGORY_STYLE[result.criterionB.overallCategory]?.bg,
                  }}
                >
                  <span className="font-bold" style={{ color: CATEGORY_STYLE[result.criterionB.overallCategory]?.color }}>
                    Criterion B suggests: {result.criterionB.overallCategory}
                  </span>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                    Based on geographic range thresholds and {[
                      result.criterionB.subcriteria.a && "few locations",
                      result.criterionB.subcriteria.bi && "EOO decline",
                      result.criterionB.subcriteria.bii && "AOO decline",
                    ].filter(Boolean).join(", ")}. This is an automated estimate — expert review is essential.
                  </p>
                </div>
              ) : (
                <div className="px-4 py-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400">
                  {(result.criterionB.b1.meetsThreshold || result.criterionB.b2.meetsThreshold)
                    ? "Geographic range meets a threshold, but fewer than 2 subcriteria are met from GBIF data alone. Additional evidence may change this assessment."
                    : "Geographic range is above all Criterion B thresholds based on GBIF occurrence data."}
                </div>
              )}
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
            These estimates are derived from GBIF occurrence records and should be treated as
            approximations. EOO and AOO calculations follow IUCN standards (minimum convex polygon
            and 2×2 km grid respectively). Number of locations is approximated by spatial clustering
            and does not account for threat-based definitions. Assessors should verify results using
            additional data sources and expert knowledge per IUCN Red List Guidelines and Mapping Standards.
          </p>
        </div>
      )}

      {/* Initial empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-8 text-zinc-400 dark:text-zinc-500">
          <p className="text-sm">Click &quot;Run Analysis&quot; to estimate Criterion B parameters from GBIF occurrences</p>
          <p className="text-xs mt-1">Fetches up to 10,000 georeferenced records and computes EOO, AOO, and locations</p>
        </div>
      )}
      </>)}

      {/* Coming-soon subtab placeholders */}
      {activeSubtab !== "criterion-b" && (
        <div className="text-center py-12 text-zinc-400 dark:text-zinc-500">
          <p className="text-sm font-medium">Coming soon</p>
          <p className="text-xs mt-1 max-w-md mx-auto">
            Automated parameter estimation for additional IUCN criteria and supporting information is in development.
          </p>
        </div>
      )}
    </div>
  );
}
