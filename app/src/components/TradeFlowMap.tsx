"use client";

import React, { useState, useMemo, memo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import { geoNaturalEarth1 } from "d3-geo";
import { useTheme } from "next-themes";
import { ALPHA2_TO_NAME } from "./WorldMap";
import { countryName, fmtQty } from "./cites-utils";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Reverse mapping: country name (as used in TopoJSON) -> alpha-2 code
const NAME_TO_ALPHA2 = Object.fromEntries(
  Object.entries(ALPHA2_TO_NAME).map(([code, name]) => [name, code])
);

// Approximate centroids (lon, lat) for countries likely to appear in CITES trade
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AF: [67.7, 33.9], AL: [20.2, 41.2], DZ: [3.0, 28.0], AO: [17.9, -12.3],
  AR: [-63.6, -38.4], AM: [45.0, 40.1], AU: [133.8, -25.3], AT: [14.6, 47.7],
  AZ: [47.6, 40.1], BD: [90.4, 23.7], BY: [27.9, 53.7], BE: [4.5, 50.5],
  BJ: [2.3, 9.3], BT: [90.4, 27.5], BO: [-63.6, -16.3], BA: [17.8, 43.9],
  BW: [24.7, -22.3], BR: [-51.9, -14.2], BN: [114.7, 4.5], BG: [25.5, 42.7],
  BF: [-1.6, 12.3], BI: [29.9, -3.4], KH: [105.0, 12.6], CM: [12.4, 6.0],
  CA: [-106.3, 56.1], CF: [21.0, 6.6], TD: [18.7, 15.5], CL: [-71.5, -35.7],
  CN: [104.2, 35.9], CO: [-74.3, 4.6], CG: [15.8, -0.2], CD: [21.8, -4.0],
  CR: [-84.0, 9.7], CI: [-5.5, 7.5], HR: [15.2, 45.1], CU: [-77.8, 21.5],
  CY: [33.4, 35.1], CZ: [15.5, 49.8], DK: [9.5, 56.3], DJ: [42.6, 11.8],
  DO: [-70.2, 18.7], EC: [-78.2, -1.8], EG: [30.8, 26.8], SV: [-88.9, 13.8],
  GQ: [10.3, 1.7], ER: [39.8, 15.2], EE: [25.0, 58.6], SZ: [31.5, -26.5],
  ET: [40.5, 9.1], FJ: [178.1, -17.7], FI: [25.7, 61.9], FR: [2.2, 46.2],
  GA: [11.6, -0.8], GM: [-15.3, 13.4], GE: [43.4, 42.3], DE: [10.5, 51.2],
  GH: [-1.0, 7.9], GR: [21.8, 39.1], GT: [-90.2, 15.8], GN: [-9.9, 9.9],
  GW: [-15.2, 12.0], GY: [-58.9, 5.0], HT: [-72.3, 19.0], HN: [-86.2, 15.0],
  HU: [19.5, 47.2], IS: [-19.0, 65.0], IN: [78.9, 20.6], ID: [113.9, -0.8],
  IR: [53.7, 32.4], IQ: [44.0, 33.2], IE: [-8.2, 53.4], IL: [34.9, 31.0],
  IT: [12.6, 41.9], JM: [-77.3, 18.1], JP: [138.3, 36.2], JO: [36.2, 30.6],
  KZ: [67.0, 48.0], KE: [38.0, -0.0], KP: [127.5, 40.3], KR: [128.0, 35.9],
  KW: [47.5, 29.3], KG: [74.8, 41.2], LA: [102.5, 19.9], LV: [24.6, 56.9],
  LB: [35.9, 33.9], LS: [28.2, -29.6], LR: [-9.4, 6.4], LY: [17.2, 26.3],
  LT: [23.9, 55.2], LU: [6.1, 49.8], MG: [46.9, -18.8], MW: [34.3, -13.3],
  MY: [101.9, 4.2], MV: [73.5, 3.2], ML: [-4.0, 17.6], MT: [14.4, 35.9],
  MR: [-10.9, 21.0], MU: [57.6, -20.3], MX: [-102.6, 23.6], MD: [28.4, 47.4],
  MN: [103.8, 46.9], ME: [19.4, 42.7], MA: [-7.1, 31.8], MZ: [35.5, -18.7],
  MM: [96.0, 21.9], NA: [18.5, -22.0], NP: [84.1, 28.4], NL: [5.3, 52.1],
  NZ: [174.9, -40.9], NI: [-85.2, 12.9], NE: [8.1, 17.6], NG: [8.7, 9.1],
  NO: [8.5, 60.5], OM: [55.9, 21.5], PK: [69.3, 30.4], PA: [-80.8, 8.5],
  PG: [143.9, -6.3], PY: [-58.4, -23.4], PE: [-75.0, -9.2], PH: [121.8, 12.9],
  PL: [19.1, 51.9], PT: [-8.2, 39.4], QA: [51.2, 25.4], RO: [24.7, 45.9],
  RU: [105.3, 61.5], RW: [29.9, -1.9], SA: [45.1, 23.9], SN: [-14.5, 14.5],
  RS: [21.0, 44.0], SG: [103.8, 1.4], SK: [19.7, 48.7], SI: [14.5, 46.2],
  SB: [160.2, -9.6], SO: [46.2, 5.2], ZA: [22.9, -30.6], SS: [31.3, 6.9],
  ES: [-3.7, 40.5], LK: [80.8, 7.9], SD: [30.2, 12.9], SR: [-56.0, 4.0],
  SE: [18.6, 60.1], CH: [8.2, 46.8], SY: [39.0, 34.8], TW: [121.0, 23.7],
  TJ: [71.3, 38.9], TZ: [34.9, -6.4], TH: [100.9, 15.9], TL: [125.7, -8.9],
  TG: [1.2, 8.6], TT: [-61.2, 10.7], TN: [9.5, 33.9], TR: [35.2, 39.9],
  TM: [59.6, 38.9], UG: [32.3, 1.4], UA: [31.2, 48.4], AE: [53.8, 23.4],
  GB: [-3.4, 55.4], US: [-95.7, 37.1], UY: [-55.8, -32.5], UZ: [64.6, 41.4],
  VU: [166.9, -15.4], VE: [-66.6, 6.4], VN: [108.3, 14.1], YE: [48.5, 15.6],
  ZM: [27.8, -13.1], ZW: [29.2, -19.0],
  // Smaller territories that may appear in CITES trade
  HK: [114.2, 22.3], MO: [113.5, 22.2], RE: [55.5, -21.1], GP: [-61.6, 16.0],
  MQ: [-61.0, 14.6], GF: [-53.1, 4.0], NC: [165.6, -21.1], PF: [-149.4, -17.7],
  CW: [-69.0, 12.2], AW: [-70.0, 12.5], BM: [-64.8, 32.3], KY: [-81.3, 19.5],
  SC: [55.5, -4.7], BS: [-77.4, 25.0], BB: [-59.5, 13.2], LC: [-61.0, 13.9],
  AG: [-61.8, 17.1], DM: [-61.4, 15.4], GD: [-61.7, 12.1], KN: [-62.7, 17.4],
  VC: [-61.2, 13.3], BZ: [-88.5, 17.2], FO: [-6.9, 62.0], GL: [-42.6, 71.7],
  PS: [35.2, 32.0], XK: [21.0, 42.6], MK: [21.7, 41.5],
};

const MAP_WIDTH = 800;
const MAP_HEIGHT = 400;
const MAP_OFFSET: [number, number] = [30, 20];

// Build projection that matches the ComposableMap settings
const projection = geoNaturalEarth1()
  .scale(160)
  .center([0, 0])
  .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);

/** Project [lon, lat] to SVG [x, y] inside the offset <g> */
function project(coords: [number, number]): [number, number] | null {
  const p = projection(coords);
  return p ? [p[0] + MAP_OFFSET[0], p[1] + MAP_OFFSET[1]] : null;
}

/** Build a quadratic bezier arc from→to, curving left of the direction of travel */
function arcPath(
  from: [number, number],
  to: [number, number],
  curvature = 0.25
): string | null {
  const p1 = project(from);
  const p2 = project(to);
  if (!p1 || !p2) return null;

  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;

  // Control point: offset perpendicular to midpoint
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  const nx = -dy / len; // perpendicular unit
  const ny = dx / len;
  const offset = len * curvature;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;

  return `M${p1[0]},${p1[1]} Q${cx},${cy} ${p2[0]},${p2[1]}`;
}

/** Compute the angle of the curve at the endpoint (for arrowhead rotation) */
function endAngle(from: [number, number], to: [number, number], curvature = 0.25): number {
  const p1 = project(from);
  const p2 = project(to);
  if (!p1 || !p2) return 0;

  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return 0;

  // Tangent at t=1 of Q(p1, cp, p2) = 2*(1-t)*(cp-p1) + 2*t*(p2-cp) evaluated at t=1 = 2*(p2-cp)
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = len * curvature;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;

  const tdx = p2[0] - cx;
  const tdy = p2[1] - cy;
  return (Math.atan2(tdy, tdx) * 180) / Math.PI;
}

export interface TradeFlow {
  from: string;
  to: string;
  records: number;
  quantity: number;
}

export interface CountryAnnotation {
  suspensions?: { type: "import" | "export"; startDate: string }[];
  quotas?: { quota: number; unit: string | null }[];
}

interface TradeFlowMapProps {
  flows: TradeFlow[];
  /**
   * Re-export legs: where specimens originally came from before the exporter
   * (origin → re-exporter). Shown as an opt-in dashed overlay.
   */
  reExportFlows?: TradeFlow[];
  /** ISO alpha-2 codes of countries with active trade suspensions */
  suspensionCountries?: Set<string>;
  /** Per-country suspension/quota annotations for hover tooltip */
  countryAnnotations?: Record<string, CountryAnnotation>;
}

function TradeFlowMap({
  flows,
  reExportFlows,
  suspensionCountries,
  countryAnnotations,
}: TradeFlowMapProps) {
  const { resolvedTheme } = useTheme();
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);
  const [hoveredReExport, setHoveredReExport] = useState<number | null>(null);
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [showReExports, setShowReExports] = useState(true);

  // Only render flows where we have centroids for both endpoints
  const renderableFlows = useMemo(
    () => flows.filter((f) => COUNTRY_CENTROIDS[f.from] && COUNTRY_CENTROIDS[f.to]),
    [flows]
  );

  // Re-export legs (origin → re-exporter) with known centroids
  const renderableReExports = useMemo(
    () =>
      (reExportFlows ?? []).filter(
        (f) => COUNTRY_CENTROIDS[f.from] && COUNTRY_CENTROIDS[f.to]
      ),
    [reExportFlows]
  );

  if (renderableFlows.length === 0) return null;

  const dark = resolvedTheme === "dark";

  // Filter flows to selected country (if any)
  const visibleFlows = selectedCountry
    ? renderableFlows.filter((f) => f.from === selectedCountry || f.to === selectedCountry)
    : renderableFlows;

  // Re-export legs to show: only when toggled on, respecting any country filter
  const visibleReExports =
    showReExports && renderableReExports.length > 0
      ? selectedCountry
        ? renderableReExports.filter(
            (f) => f.from === selectedCountry || f.to === selectedCountry
          )
        : renderableReExports
      : [];

  // Tally each country's export vs import volume across the visible flows so we
  // can colour it by its DOMINANT role. Previously a country was painted
  // "exporter"/"importer"/"both" purely on whether it appeared as a flow's
  // source/destination — so a major net exporter like South Africa (which also
  // receives a few large regional shipments) showed up as an importer/"both",
  // contradicting the Top Exporters table. (#307)
  const exportRecords = new Map<string, number>();
  const importRecords = new Map<string, number>();
  for (const f of visibleFlows) {
    exportRecords.set(f.from, (exportRecords.get(f.from) ?? 0) + f.records);
    importRecords.set(f.to, (importRecords.get(f.to) ?? 0) + f.records);
  }

  type TradeRole = "exporter" | "importer" | "both";

  /**
   * Classify a country by its dominant direction of trade in the visible flows.
   * "both" is reserved for genuinely balanced hubs (within a 60/40 split);
   * otherwise we go with the larger side so the colour matches the headline
   * Top Exporters / Top Importers tables.
   */
  function roleOf(code: string): TradeRole | null {
    const ex = exportRecords.get(code) ?? 0;
    const im = importRecords.get(code) ?? 0;
    if (ex === 0 && im === 0) return null;
    if (im === 0) return "exporter";
    if (ex === 0) return "importer";
    const exShare = ex / (ex + im);
    if (exShare >= 0.6) return "exporter";
    if (exShare <= 0.4) return "importer";
    return "both";
  }

  const maxRecords = visibleFlows.length > 0 ? Math.max(...visibleFlows.map((f) => f.records)) : 0;

  // Theme-aware colors for SVG fills (can't use Tailwind classes in SVG)
  const colors = dark
    ? { base: "#18181b", exporter: "#7f1d1d", importer: "#1e3a5f", both: "#4c1d95", stroke: "#27272a", suspension: "#991b1b", arcDefault: "#f87171", arcHover: "#fbbf24", reExport: "#d97706" }
    : { base: "#f4f4f5", exporter: "#fee2e2", importer: "#dbeafe", both: "#e9d5ff", stroke: "#d4d4d8", suspension: "#fecaca", arcDefault: "#ef4444", arcHover: "#f59e0b", reExport: "#d97706" };

  const hoveredFlowData = hoveredFlow !== null ? visibleFlows[hoveredFlow] : null;
  const hoveredReExportData =
    hoveredReExport !== null ? visibleReExports[hoveredReExport] : null;

  return (
    <div className="relative">
      {/* Direct-flow tooltip — labelled with CITES roles (Exporter → Importer) */}
      {hoveredFlowData && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-zinc-800 dark:bg-zinc-700 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg pointer-events-none whitespace-nowrap">
          <span className="text-zinc-400">Exporter </span>
          <span className="font-medium">{countryName(hoveredFlowData.from)}</span>
          <span className="text-zinc-300 mx-1.5">&rarr;</span>
          <span className="text-zinc-400">Importer </span>
          <span className="font-medium">{countryName(hoveredFlowData.to)}</span>
          <span className="text-zinc-400 ml-2">
            {hoveredFlowData.records.toLocaleString()} records
          </span>
          {hoveredFlowData.quantity > 0 && (
            <span className="text-zinc-400 ml-1">
              / {fmtQty(hoveredFlowData.quantity)} items
            </span>
          )}
        </div>
      )}

      {/* Re-export pathway tooltip — CITES terms: Origin → Exporter (re-exporter) */}
      {hoveredReExportData && !hoveredFlowData && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-zinc-800 dark:bg-zinc-700 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg pointer-events-none max-w-[320px] text-center">
          <span className="text-amber-300">Origin </span>
          <span className="font-medium">{countryName(hoveredReExportData.from)}</span>
          <span className="text-zinc-300 mx-1.5">&rarr;</span>
          <span className="text-zinc-400">re-exported by </span>
          <span className="font-medium">{countryName(hoveredReExportData.to)}</span>
          <span className="text-zinc-400 ml-1.5">
            {hoveredReExportData.records.toLocaleString()} records
          </span>
        </div>
      )}

      {/* Country annotation tooltip (suspensions/quotas) */}
      {hoveredCountry && !hoveredFlowData && !hoveredReExportData && countryAnnotations?.[hoveredCountry] && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-zinc-800 dark:bg-zinc-700 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg pointer-events-none max-w-[280px]">
          <div className="font-medium mb-1">{countryName(hoveredCountry)}</div>
          {countryAnnotations[hoveredCountry].suspensions && countryAnnotations[hoveredCountry].suspensions!.length > 0 && (
            <div className="text-red-300">
              {countryAnnotations[hoveredCountry].suspensions!.map((s, i) => (
                <div key={i}>
                  Trade suspension ({s.type}) since {new Date(s.startDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </div>
              ))}
            </div>
          )}
          {countryAnnotations[hoveredCountry].quotas && countryAnnotations[hoveredCountry].quotas!.length > 0 && (
            <div className="text-amber-300">
              {countryAnnotations[hoveredCountry].quotas!.map((q, i) => (
                <div key={i}>
                  Quota: {q.quota.toLocaleString()}{q.unit ? ` ${q.unit}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected country filter chip */}
      {selectedCountry && (
        <button
          className="absolute top-2 right-2 z-10 bg-zinc-800 dark:bg-zinc-700 text-white text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 hover:bg-zinc-700 dark:hover:bg-zinc-600 transition-colors"
          onClick={() => setSelectedCountry(null)}
        >
          {countryName(selectedCountry)}
          <span className="text-zinc-400">&times;</span>
        </button>
      )}

      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 160, center: [0, 0] }}
        style={{ width: "100%", height: "auto" }}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
      >
        <g transform={`translate(${MAP_OFFSET[0]}, ${MAP_OFFSET[1]})`}>
          {/* Base map */}
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies
                .filter((geo) => geo.properties.name !== "Antarctica")
                .map((geo) => {
                  const name = geo.properties.name;
                  const alpha2 = NAME_TO_ALPHA2[name];
                  const role = alpha2 ? roleOf(alpha2) : null;
                  const isSuspended = alpha2 ? suspensionCountries?.has(alpha2) : false;

                  let fill = colors.base;
                  if (isSuspended) fill = colors.suspension;
                  else if (role === "both") fill = colors.both;
                  else if (role === "exporter") fill = colors.exporter;
                  else if (role === "importer") fill = colors.importer;

                  const hasAnnotation = alpha2 && countryAnnotations?.[alpha2];

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fill}
                      stroke={isSuspended ? (dark ? "#f87171" : "#dc2626") : colors.stroke}
                      strokeWidth={isSuspended ? 1 : 0.4}
                      strokeDasharray={isSuspended ? "3,2" : undefined}
                      onMouseEnter={() => hasAnnotation && setHoveredCountry(alpha2)}
                      onMouseLeave={() => setHoveredCountry(null)}
                      style={{
                        default: { outline: "none", cursor: hasAnnotation ? "pointer" : "default" },
                        hover: { outline: "none", fill: hasAnnotation ? (dark ? "#3f3f46" : "#e4e4e7") : fill, cursor: hasAnnotation ? "pointer" : "default" },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
            }
          </Geographies>
        </g>

        {/* Re-export legs (origin → re-exporter), drawn underneath the direct
            flows as dashed amber arcs so they read as the upstream part of the
            pathway rather than a competing flow. */}
        {visibleReExports.map((flow, i) => {
          const from = COUNTRY_CENTROIDS[flow.from];
          const to = COUNTRY_CENTROIDS[flow.to];
          const path = arcPath(from, to);
          if (!path) return null;
          const isHovered = hoveredReExport === i;
          const dest = project(to);
          const angle = endAngle(from, to);
          return (
            <g key={`reexport-${flow.from}-${flow.to}`}>
              <path
                d={path}
                fill="none"
                stroke={colors.reExport}
                strokeWidth={isHovered ? 2.5 : 1.5}
                strokeLinecap="round"
                strokeDasharray="4,3"
                strokeOpacity={isHovered ? 0.95 : 0.6}
                onMouseEnter={() => setHoveredReExport(i)}
                onMouseLeave={() => setHoveredReExport(null)}
                style={{ cursor: "pointer" }}
              />
              {dest && (
                <polygon
                  points="-4,-2.5 0,0 -4,2.5"
                  fill={colors.reExport}
                  fillOpacity={isHovered ? 0.95 : 0.6}
                  transform={`translate(${dest[0]},${dest[1]}) rotate(${angle})`}
                />
              )}
            </g>
          );
        })}

        {/* Origin markers for re-export legs (hollow amber diamonds) */}
        {visibleReExports.length > 0 &&
          (() => {
            const seen = new Set<string>();
            const markers: React.ReactNode[] = [];
            for (const flow of visibleReExports) {
              if (seen.has(flow.from)) continue;
              seen.add(flow.from);
              const p = project(COUNTRY_CENTROIDS[flow.from]);
              if (!p) continue;
              markers.push(
                <rect
                  key={`origin-${flow.from}`}
                  x={p[0] - 3}
                  y={p[1] - 3}
                  width={6}
                  height={6}
                  transform={`rotate(45 ${p[0]} ${p[1]})`}
                  fill="none"
                  stroke={colors.reExport}
                  strokeWidth={1.2}
                />
              );
            }
            return markers;
          })()}

        {/* Curved flow arcs with arrowheads — rendered outside the offset <g> since we project manually */}
        {visibleFlows.map((flow, i) => {
          const from = COUNTRY_CENTROIDS[flow.from];
          const to = COUNTRY_CENTROIDS[flow.to];
          const path = arcPath(from, to);
          if (!path) return null;

          const ratio = maxRecords > 0 ? flow.records / maxRecords : 0;
          const strokeWidth = 1.5 + ratio * 2.5;
          const isHovered = hoveredFlow === i;

          // Arrowhead at destination
          const angle = endAngle(from, to);
          const dest = project(to);

          return (
            <g key={`flow-${flow.from}-${flow.to}`}>
              <path
                d={path}
                fill="none"
                stroke={isHovered ? colors.arcHover : colors.arcDefault}
                strokeWidth={isHovered ? strokeWidth + 1 : strokeWidth}
                strokeLinecap="round"
                strokeOpacity={isHovered ? 0.95 : dark ? 0.7 : 0.45}
                onMouseEnter={() => setHoveredFlow(i)}
                onMouseLeave={() => setHoveredFlow(null)}
                style={{ cursor: "pointer" }}
              />
              {/* Arrowhead triangle */}
              {dest && (
                <polygon
                  points="-5,-3 0,0 -5,3"
                  fill={isHovered ? colors.arcHover : colors.arcDefault}
                  fillOpacity={isHovered ? 0.95 : dark ? 0.85 : 0.7}
                  transform={`translate(${dest[0]},${dest[1]}) rotate(${angle})`}
                />
              )}
            </g>
          );
        })}

        {/* Endpoint markers (deduplicated) — clickable for filtering */}
        <g transform={`translate(${MAP_OFFSET[0]}, ${MAP_OFFSET[1]})`}>
          {(() => {
            const seen = new Set<string>();
            const markers: React.ReactNode[] = [];
            for (const flow of visibleFlows) {
              for (const code of [flow.from, flow.to]) {
                if (seen.has(code)) continue;
                seen.add(code);
                const coords = COUNTRY_CENTROIDS[code];
                if (!coords) continue;
                const role = roleOf(code);
                const isSelected = selectedCountry === code;

                let fill =
                  role === "importer" ? "#3b82f6" : role === "both" ? "#8b5cf6" : "#ef4444";
                if (isSelected) fill = "#f59e0b";

                markers.push(
                  <Marker key={`m-${code}`} coordinates={coords}>
                    <circle
                      r={isSelected ? 4 : 3}
                      fill={fill}
                      stroke={dark ? "#18181b" : "#fff"}
                      strokeWidth={isSelected ? 1 : 0.5}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedCountry(selectedCountry === code ? null : code)}
                    />
                    {isSelected && (
                      <text
                        y={-8}
                        textAnchor="middle"
                        className="text-[8px] font-semibold"
                        fill={dark ? "#e4e4e7" : "#3f3f46"}
                      >
                        {code}
                      </text>
                    )}
                  </Marker>
                );
              }
            }
            return markers;
          })()}
        </g>
      </ComposableMap>

      {/* Legend — labelled with CITES roles */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          Exporter
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
          Importer (destination)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
          Exporter &amp; importer
        </span>
        <span className="flex items-center gap-1">
          <svg width="16" height="8" className="inline-block">
            <line x1="0" y1="4" x2="12" y2="4" stroke="#ef4444" strokeWidth="2" strokeOpacity="0.5" />
            <polygon points="12,1.5 16,4 12,6.5" fill="#ef4444" fillOpacity="0.7" />
          </svg>
          Exporter &rarr; Importer
        </span>
        {suspensionCountries && suspensionCountries.size > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm border border-dashed border-red-500 bg-red-100 dark:bg-red-900/30" />
            Suspension
          </span>
        )}
        {renderableReExports.length > 0 && (
          <>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" className="inline-block">
                <rect x="2.5" y="2.5" width="7" height="7" transform="rotate(45 6 6)" fill="none" stroke="#d97706" strokeWidth="1.2" />
              </svg>
              Country of origin
            </span>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showReExports}
                onChange={() => setShowReExports((v) => !v)}
                className="w-3 h-3 rounded"
                style={{ accentColor: "#d97706" }}
              />
              <svg width="16" height="8" className="inline-block">
                <line x1="0" y1="4" x2="12" y2="4" stroke="#d97706" strokeWidth="1.5" strokeDasharray="3,2" />
                <polygon points="12,1.5 16,4 12,6.5" fill="#d97706" />
              </svg>
              Re-exports (Origin &rarr; Exporter)
            </label>
          </>
        )}
        <span className="text-zinc-400 dark:text-zinc-500 italic">click dot to filter</span>
      </div>
    </div>
  );
}

export default memo(TradeFlowMap);
