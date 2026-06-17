"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import dynamic from "next/dynamic";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { countryName, fmtQty } from "./cites-utils";
import type { CountryAnnotation, TradeFlow } from "./TradeFlowMap";

const TradeFlowMap = dynamic(() => import("./TradeFlowMap"), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CompactRecord {
  y: number;
  s: string;
  p: string;
  t: string;
  u: string; // unit ("" = unit-less)
  q: number;
  e: string;
  i: string;
  o: string; // origin (re-export) — "" when same as exporter
}

interface YearData {
  year: number;
  quantity: number;
  records: number;
}

interface CodedData {
  code: string;
  label: string;
  records: number;
}

interface TermCount {
  term: string;
  records: number;
}

interface TermUnitData {
  term: string;
  unit: string;
  records: number;
  quantity: number;
}

interface CountryData {
  code: string;
  records: number;
  quantity: number;
}

interface TradeData {
  found: boolean;
  taxonId: string;
  totalRecords: number;
  yearRange: [number, number];
  byYear: YearData[];
  topPurposes: CodedData[];
  topSources: CodedData[];
  topExporters: CountryData[];
  topImporters: CountryData[];
  topFlows?: TradeFlow[];
  shipments?: CompactRecord[];
  allSources?: CodedData[];
  allPurposes?: CodedData[];
  allTerms?: TermCount[];
  allTermsByUnit?: TermUnitData[];
}

// Sources that indicate wild take — key concern for assessors
const WILD_SOURCE_CODES = new Set(["W", "X", "R", "U"]);

const SOURCE_LABELS: Record<string, string> = {
  A: "Artificially propagated",
  C: "Captive-bred",
  D: "Appendix I captive-bred",
  F: "F1 captive-born",
  I: "Confiscated/seized",
  O: "Pre-Convention",
  R: "Ranched",
  U: "Unknown",
  W: "Wild",
  X: "Marine",
};

const PURPOSE_LABELS: Record<string, string> = {
  B: "Breeding in captivity",
  E: "Educational",
  G: "Botanical garden",
  H: "Hunting trophy",
  L: "Law enforcement",
  M: "Medical/biomedical",
  N: "Reintroduction",
  P: "Personal",
  Q: "Circus/exhibition",
  S: "Scientific",
  T: "Commercial",
  Z: "Zoo",
};

/**
 * Number of most-recent calendar years to treat as "provisional". CITES annual
 * reports for year Y aren't due until 31 Oct of Y+1 and many Parties run years
 * behind, so the most recent years are always under-reported. We draw them
 * dashed + caption them rather than letting the line mislead readers into
 * thinking trade collapsed.
 */
const PROVISIONAL_YEARS = 3;

/** Stable key for a term+unit combination. */
function termUnitKey(term: string, unit: string): string {
  return `${term}|${unit}`;
}

function unitLabel(unit: string): string {
  return unit || "no unit";
}

/* ------------------------------------------------------------------ */
/*  Aggregation                                                        */
/* ------------------------------------------------------------------ */

interface Aggregated {
  totalRecords: number;
  byYear: YearData[];
  topSources: CodedData[];
  topPurposes: CodedData[];
  topExporters: CountryData[];
  topImporters: CountryData[];
  topFlows: TradeFlow[];
  reExportFlows: TradeFlow[];
  termsByUnit: TermUnitData[];
}

/** Aggregate a set of compact shipment records into the derived views. */
function aggregateShipments(rows: CompactRecord[]): Aggregated {
  const yearMap = new Map<number, { quantity: number; records: number }>();
  const sourceMap = new Map<string, number>();
  const purposeMap = new Map<string, number>();
  const exporterMap = new Map<string, { records: number; quantity: number }>();
  const importerMap = new Map<string, { records: number; quantity: number }>();
  const flowMap = new Map<string, { records: number; quantity: number }>();
  const reExportMap = new Map<string, { records: number; quantity: number }>();
  const termUnitMap = new Map<string, TermUnitData>();

  for (const r of rows) {
    const yEntry = yearMap.get(r.y) || { quantity: 0, records: 0 };
    yEntry.records++;
    yEntry.quantity += r.q;
    yearMap.set(r.y, yEntry);

    if (r.s) sourceMap.set(r.s, (sourceMap.get(r.s) || 0) + 1);
    if (r.p) purposeMap.set(r.p, (purposeMap.get(r.p) || 0) + 1);

    if (r.e) {
      const e = exporterMap.get(r.e) || { records: 0, quantity: 0 };
      e.records++;
      e.quantity += r.q;
      exporterMap.set(r.e, e);
    }
    if (r.i) {
      const e = importerMap.get(r.i) || { records: 0, quantity: 0 };
      e.records++;
      e.quantity += r.q;
      importerMap.set(r.i, e);
    }
    if (r.e && r.i) {
      const key = `${r.e}->${r.i}`;
      const e = flowMap.get(key) || { records: 0, quantity: 0 };
      e.records++;
      e.quantity += r.q;
      flowMap.set(key, e);
    }
    // Re-export leg: where specimens originated (origin) before the exporter
    if (r.o && r.e) {
      const key = `${r.o}->${r.e}`;
      const e = reExportMap.get(key) || { records: 0, quantity: 0 };
      e.records++;
      e.quantity += r.q;
      reExportMap.set(key, e);
    }

    const tuKey = termUnitKey(r.t, r.u);
    const tu = termUnitMap.get(tuKey) || {
      term: r.t,
      unit: r.u,
      records: 0,
      quantity: 0,
    };
    tu.records++;
    tu.quantity += r.q;
    termUnitMap.set(tuKey, tu);
  }

  const byYear = Array.from(yearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({ year, ...v }));

  const topSources = Array.from(sourceMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({ code, label: SOURCE_LABELS[code] || code, records }));

  const topPurposes = Array.from(purposeMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({ code, label: PURPOSE_LABELS[code] || code, records }));

  const topExporters = Array.from(exporterMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  const topImporters = Array.from(importerMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  const topFlows = Array.from(flowMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 12)
    .map(([key, v]) => {
      const [from, to] = key.split("->");
      return { from, to, ...v };
    });

  const reExportFlows = Array.from(reExportMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 12)
    .map(([key, v]) => {
      const [from, to] = key.split("->");
      return { from, to, ...v };
    });

  const termsByUnit = Array.from(termUnitMap.values()).sort(
    (a, b) => b.records - a.records
  );

  return {
    totalRecords: rows.length,
    byYear,
    topSources,
    topPurposes,
    topExporters,
    topImporters,
    topFlows,
    reExportFlows,
    termsByUnit,
  };
}

/* ------------------------------------------------------------------ */
/*  Filter checkbox row                                                */
/* ------------------------------------------------------------------ */

function FilterCheckbox({
  label,
  sublabel,
  count,
  checked,
  onChange,
  color,
}: {
  label: string;
  sublabel?: string;
  count: number;
  checked: boolean;
  onChange: () => void;
  color?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 transition-opacity cursor-pointer select-none ${
        checked ? "" : "opacity-40"
      }`}
      onClick={onChange}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onClick={(e) => e.stopPropagation()}
        className="w-3.5 h-3.5 rounded shrink-0"
        style={color ? { accentColor: color } : undefined}
      />
      <span className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 truncate capitalize">
        {label}
        {sublabel && (
          <span className="text-zinc-400 dark:text-zinc-500 ml-1 normal-case">
            ({sublabel})
          </span>
        )}
      </span>
      <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
        {count.toLocaleString()}
      </span>
    </div>
  );
}

/** Section header with All / None bulk-select buttons. */
function FilterSectionHeader({
  title,
  onAll,
  onNone,
}: {
  title: string;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        {title}
      </h5>
      <div className="flex items-center gap-1 text-[10px]">
        <button
          className="text-blue-600 dark:text-blue-400 hover:underline"
          onClick={onAll}
        >
          All
        </button>
        <span className="text-zinc-300 dark:text-zinc-600">/</span>
        <button
          className="text-blue-600 dark:text-blue-400 hover:underline"
          onClick={onNone}
        >
          None
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trend line chart with draggable year-range trim handles            */
/* ------------------------------------------------------------------ */

interface ChartPoint {
  year: number;
  solid: number | null;
  prov: number | null;
}

function ChartTooltip({
  active,
  payload,
  label,
  metric,
  provisionalFromYear,
}: {
  active?: boolean;
  payload?: { value: number | null; dataKey: string }[];
  label?: number;
  metric: "records" | "quantity";
  provisionalFromYear: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload.find((p) => p.value != null);
  if (!point) return null;
  const isProvisional = label != null && label >= provisionalFromYear;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg text-xs px-2.5 py-1.5">
      <div className="text-zinc-400">{label}</div>
      <div className="text-white tabular-nums">
        {(point.value ?? 0).toLocaleString()}{" "}
        {metric === "records" ? "shipments" : "items"}
      </div>
      {isProvisional && (
        <div className="text-amber-400 text-[10px] mt-0.5">
          provisional — incomplete reporting
        </div>
      )}
    </div>
  );
}

function TrendLineChart({
  data,
  metric,
  minYear,
  maxYear,
  brush,
  onBrushChange,
  provisionalFromYear,
}: {
  data: YearData[];
  metric: "records" | "quantity";
  minYear: number;
  maxYear: number;
  brush: [number, number] | null;
  onBrushChange: (range: [number, number] | null) => void;
  provisionalFromYear: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<null | "start" | "end">(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Chart geometry must mirror the recharts margins + YAxis width below.
  const HEIGHT = 160;
  const PLOT_LEFT = 45; // YAxis width
  const PLOT_RIGHT_PAD = 10; // margin.right
  const TRACK_TOP = 4;
  const TRACK_BOTTOM = 132; // leave room for x-axis labels
  const plotRight = Math.max(PLOT_LEFT + 1, width - PLOT_RIGHT_PAD);
  const plotW = plotRight - PLOT_LEFT;
  const span = Math.max(1, maxYear - minYear);

  const xOf = useCallback(
    (year: number) => PLOT_LEFT + ((year - minYear) / span) * plotW,
    [minYear, span, plotW]
  );
  const yearOf = useCallback(
    (px: number) => {
      const clamped = Math.min(plotRight, Math.max(PLOT_LEFT, px));
      return Math.round(minYear + ((clamped - PLOT_LEFT) / plotW) * span);
    },
    [minYear, span, plotW, plotRight]
  );

  const start = brush ? brush[0] : minYear;
  const end = brush ? brush[1] : maxYear;

  // Build chart series: solid up to the last complete year, dashed beyond.
  const lastComplete = provisionalFromYear - 1;
  const lookup = new Map(data.map((d) => [d.year, d[metric]]));
  const chartData: ChartPoint[] = [];
  for (let y = minYear; y <= maxYear; y++) {
    const v = lookup.get(y) ?? 0;
    chartData.push({
      year: y,
      solid: y <= lastComplete ? v : null,
      // include the junction year so the dashed segment connects to the solid one
      prov: y >= lastComplete ? v : null,
    });
  }
  const hasProvisional = maxYear >= provisionalFromYear;

  function onHandleDown(which: "start" | "end") {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = which;
      (e.target as Element).setPointerCapture(e.pointerId);
    };
  }
  function onHandleMove(e: React.PointerEvent) {
    if (!dragging.current || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const year = yearOf(e.clientX - rect.left);
    let nextStart = start;
    let nextEnd = end;
    if (dragging.current === "start") nextStart = Math.min(year, end);
    else nextEnd = Math.max(year, start);
    if (nextStart <= minYear && nextEnd >= maxYear) onBrushChange(null);
    else onBrushChange([nextStart, nextEnd]);
  }
  function onHandleUp() {
    dragging.current = null;
  }

  const startX = xOf(start);
  const endX = xOf(end);
  const active = brush !== null;

  return (
    <div ref={wrapRef} className="relative" style={{ touchAction: "none" }}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: PLOT_RIGHT_PAD, left: 0, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-700"
          />
          <XAxis
            dataKey="year"
            type="number"
            domain={[minYear, maxYear]}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            width={PLOT_LEFT}
            tickFormatter={(v: number) => fmtQty(v)}
          />
          <Tooltip
            content={
              <ChartTooltip
                metric={metric}
                provisionalFromYear={provisionalFromYear}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="solid"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#3b82f6", strokeWidth: 2, stroke: "#fff" }}
            connectNulls={false}
            isAnimationActive={false}
          />
          {hasProvisional && (
            <Line
              type="monotone"
              dataKey="prov"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeOpacity={0.55}
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6", strokeWidth: 2, stroke: "#fff" }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Trim overlay: dimmed regions outside the selected range + drag handles */}
      {width > 0 && (
        <svg
          ref={svgRef}
          className="absolute inset-0"
          width={width}
          height={HEIGHT}
          style={{ pointerEvents: "none" }}
        >
          {active && startX > PLOT_LEFT && (
            <rect
              x={PLOT_LEFT}
              y={TRACK_TOP}
              width={Math.max(0, startX - PLOT_LEFT)}
              height={TRACK_BOTTOM - TRACK_TOP}
              className="fill-zinc-400/15 dark:fill-zinc-900/40"
            />
          )}
          {active && endX < plotRight && (
            <rect
              x={endX}
              y={TRACK_TOP}
              width={Math.max(0, plotRight - endX)}
              height={TRACK_BOTTOM - TRACK_TOP}
              className="fill-zinc-400/15 dark:fill-zinc-900/40"
            />
          )}
          {/* Handles */}
          {[
            { which: "start" as const, x: startX },
            { which: "end" as const, x: endX },
          ].map(({ which, x }) => (
            <g
              key={which}
              transform={`translate(${x},0)`}
              style={{ cursor: "ew-resize", pointerEvents: "all" }}
              onPointerDown={onHandleDown(which)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
            >
              {/* wide invisible hit target */}
              <rect
                x={-7}
                y={TRACK_TOP}
                width={14}
                height={TRACK_BOTTOM - TRACK_TOP}
                fill="transparent"
              />
              <line
                x1={0}
                y1={TRACK_TOP}
                x2={0}
                y2={TRACK_BOTTOM}
                stroke="#3b82f6"
                strokeWidth={active ? 2 : 1.5}
                strokeOpacity={active ? 0.9 : 0.5}
              />
              <rect
                x={-3}
                y={TRACK_TOP}
                width={6}
                height={16}
                rx={2}
                fill="#3b82f6"
                fillOpacity={active ? 1 : 0.6}
              />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trend summary text                                                 */
/* ------------------------------------------------------------------ */

function TrendSummary({
  data,
  metric,
}: {
  data: YearData[];
  metric: "records" | "quantity";
}) {
  if (data.length < 4) return null;
  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid);
  const secondHalf = data.slice(mid);
  const key = metric;
  const avgFirst = firstHalf.reduce((s, d) => s + d[key], 0) / firstHalf.length;
  const avgSecond =
    secondHalf.reduce((s, d) => s + d[key], 0) / secondHalf.length;
  if (avgFirst === 0 && avgSecond === 0) return null;
  const pctChange = avgFirst === 0 ? 100 : ((avgSecond - avgFirst) / avgFirst) * 100;

  if (Math.abs(pctChange) < 15) {
    return (
      <span className="text-zinc-400 dark:text-zinc-500 text-[11px]" title="Stable trend">
        Trend: stable
      </span>
    );
  }
  if (pctChange > 0) {
    return (
      <span
        className="text-red-500 dark:text-red-400 text-[11px] font-medium"
        title={`Increased ~${Math.round(pctChange)}% (comparing first/second half of period)`}
      >
        &#9650; +{Math.round(pctChange)}%
      </span>
    );
  }
  return (
    <span
      className="text-emerald-500 dark:text-emerald-400 text-[11px] font-medium"
      title={`Decreased ~${Math.round(Math.abs(pctChange))}% (comparing first/second half of period)`}
    >
      &#9660; {Math.round(pctChange)}%
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Source breakdown (wild vs captive bar)                              */
/* ------------------------------------------------------------------ */

function SourceBreakdown({ sources }: { sources: CodedData[] }) {
  const total = sources.reduce((s, d) => s + d.records, 0);
  if (total === 0) return null;

  const wildSources = sources.filter((s) => WILD_SOURCE_CODES.has(s.code));
  const captiveSources = sources.filter((s) => !WILD_SOURCE_CODES.has(s.code));
  const wildRecords = wildSources.reduce((sum, s) => sum + s.records, 0);
  const captiveRecords = captiveSources.reduce((sum, s) => sum + s.records, 0);
  const wildPct = Math.round((wildRecords / total) * 100);
  const captivePct = 100 - wildPct;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 text-zinc-600 dark:text-zinc-300 shrink-0">Wild</span>
        <div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-amber-400 dark:bg-amber-500 rounded"
            style={{ width: `${Math.max(wildPct, 1)}%` }}
          />
        </div>
        <span className="w-20 text-right text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
          {wildPct}% ({wildRecords.toLocaleString()})
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 text-zinc-600 dark:text-zinc-300 shrink-0">Captive</span>
        <div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-emerald-300 dark:bg-emerald-600 rounded"
            style={{ width: `${Math.max(captivePct, 1)}%` }}
          />
        </div>
        <span className="w-20 text-right text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
          {captivePct}% ({captiveRecords.toLocaleString()})
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Country table                                                      */
/* ------------------------------------------------------------------ */

function CountryTable({ data, label }: { data: CountryData[]; label: string }) {
  if (data.length === 0) return null;
  const top = [...data].sort((a, b) => b.records - a.records).slice(0, 5);

  return (
    <div>
      <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
        {label}
      </h5>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-400 dark:text-zinc-500">
            <th className="font-medium pb-1 pr-2">Country</th>
            <th className="font-medium pb-1 text-right">Records</th>
          </tr>
        </thead>
        <tbody>
          {top.map((c) => (
            <tr
              key={c.code}
              className="border-t border-zinc-100 dark:border-zinc-800/50"
            >
              <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-300">
                {countryName(c.code)}
                <span className="text-zinc-400 dark:text-zinc-500 ml-1">
                  ({c.code})
                </span>
              </td>
              <td className="py-1 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                {c.records.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CitesTradeSummary({
  citesId,
  prefetchedData,
  prefetchedLoading,
  suspensionCountries,
  countryAnnotations,
}: {
  citesId: number;
  prefetchedData?: Record<string, unknown> | null;
  prefetchedLoading?: boolean;
  suspensionCountries?: Set<string>;
  countryAnnotations?: Record<string, CountryAnnotation>;
}) {
  const [ownData, setOwnData] = useState<TradeData | null>(null);
  const [ownLoading, setOwnLoading] = useState(
    !prefetchedData && prefetchedLoading === undefined
  );
  const [error, setError] = useState<string | null>(null);

  // Trend is always measured in shipment records. Quantities are NEVER plotted
  // as a single line because the CITES guide warns they cannot be aggregated
  // across incompatible units (kg, m, pieces, unit-less) — per-unit quantities
  // live in the Commodities table instead.
  const metric = "records" as const;

  // Filter state — all checked by default
  const [checkedSources, setCheckedSources] = useState<Record<string, boolean>>({});
  const [checkedPurposes, setCheckedPurposes] = useState<Record<string, boolean>>({});
  const [checkedTerms, setCheckedTerms] = useState<Record<string, boolean>>({});
  const [filtersInitialized, setFiltersInitialized] = useState(false);
  const [termSearch, setTermSearch] = useState("");

  // Year-range trim (null = full range)
  const [brush, setBrush] = useState<[number, number] | null>(null);

  // Use prefetched data from parent when available; fall back to own fetch
  const data = (prefetchedData as TradeData | null) ?? ownData;
  const loading = prefetchedLoading ?? ownLoading;

  useEffect(() => {
    if (prefetchedData !== undefined || prefetchedLoading !== undefined) return;

    let cancelled = false;

    async function fetchTrade() {
      setOwnLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/cites/trade?taxon_id=${citesId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (!cancelled) setOwnData(result);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setOwnLoading(false);
      }
    }

    fetchTrade();
    return () => {
      cancelled = true;
    };
  }, [citesId, prefetchedData, prefetchedLoading]);

  // Initialize filter checkboxes when data arrives
  useEffect(() => {
    if (!data || !data.found || filtersInitialized) return;

    if (data.allSources) {
      const init: Record<string, boolean> = {};
      for (const s of data.allSources) init[s.code] = true;
      setCheckedSources(init);
    }
    if (data.allPurposes) {
      const init: Record<string, boolean> = {};
      for (const p of data.allPurposes) init[p.code] = true;
      setCheckedPurposes(init);
    }
    if (data.allTermsByUnit) {
      const init: Record<string, boolean> = {};
      for (const t of data.allTermsByUnit) init[termUnitKey(t.term, t.unit)] = true;
      setCheckedTerms(init);
    }
    setFiltersInitialized(true);
  }, [data, filtersInitialized]);

  // Toggle helpers
  const toggleSource = useCallback((code: string) => {
    setCheckedSources((prev) => ({ ...prev, [code]: !prev[code] }));
  }, []);
  const togglePurpose = useCallback((code: string) => {
    setCheckedPurposes((prev) => ({ ...prev, [code]: !prev[code] }));
  }, []);
  const toggleTerm = useCallback((key: string) => {
    setCheckedTerms((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setAll = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
      keys: string[],
      value: boolean
    ) => {
      setter((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = value;
        return next;
      });
    },
    []
  );

  // Commodity rows filtered by the search box
  const visibleTermRows = useMemo(() => {
    const rows = data?.allTermsByUnit ?? [];
    const q = termSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) =>
      `${t.term} ${t.unit}`.toLowerCase().includes(q)
    );
  }, [data?.allTermsByUnit, termSearch]);

  // Are any filters active (something unchecked, or a year range trimmed)?
  const hasActiveFilters = useMemo(() => {
    const anySourceOff = Object.values(checkedSources).some((v) => !v);
    const anyPurposeOff = Object.values(checkedPurposes).some((v) => !v);
    const anyTermOff = Object.values(checkedTerms).some((v) => !v);
    return anySourceOff || anyPurposeOff || anyTermOff || brush !== null;
  }, [checkedSources, checkedPurposes, checkedTerms, brush]);

  // Clear all filters (re-check everything, reset the year trim)
  const clearFilters = useCallback(() => {
    setCheckedSources((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = true;
      return next;
    });
    setCheckedPurposes((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = true;
      return next;
    });
    setCheckedTerms((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = true;
      return next;
    });
    setBrush(null);
    setTermSearch("");
  }, []);

  // Shipments passing the checkbox filters (all years) — drives the chart line.
  const checkboxRows = useMemo(() => {
    if (!data?.found || !data.shipments) return [];
    return data.shipments.filter((r) => {
      if (r.s && checkedSources[r.s] === false) return false;
      if (r.p && checkedPurposes[r.p] === false) return false;
      if (checkedTerms[termUnitKey(r.t, r.u)] === false) return false;
      return true;
    });
  }, [data, checkedSources, checkedPurposes, checkedTerms]);

  // Chart series (all years, checkbox-filtered)
  const chartAgg = useMemo(() => aggregateShipments(checkboxRows), [checkboxRows]);

  // Everything else also respects the year-range trim
  const display = useMemo(() => {
    const rows = brush
      ? checkboxRows.filter((r) => r.y >= brush[0] && r.y <= brush[1])
      : checkboxRows;
    return aggregateShipments(rows);
  }, [checkboxRows, brush]);

  const hasShipments = !!data?.shipments && data.shipments.length > 0;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 py-3">
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading trade data...
      </div>
    );
  }

  if (error || !data || !data.found) {
    return null;
  }

  const [minYear, maxYear] = data.yearRange;
  const currentYear = new Date().getFullYear();
  const provisionalFromYear = currentYear - PROVISIONAL_YEARS + 1;
  const effectiveRange: [number, number] = brush ?? data.yearRange;

  // Fall back to server-provided byYear when no shipments for client filtering
  const chartByYear =
    hasShipments && chartAgg.byYear.length > 0 ? chartAgg.byYear : data.byYear;
  const displaySources =
    hasShipments && display.topSources.length > 0 ? display.topSources : data.topSources;
  const displayPurposes =
    hasShipments && display.topPurposes.length > 0 ? display.topPurposes : data.topPurposes;
  const displayExporters =
    hasShipments && display.topExporters.length > 0 ? display.topExporters : data.topExporters;
  const displayImporters =
    hasShipments && display.topImporters.length > 0 ? display.topImporters : data.topImporters;
  const displayFlows =
    hasShipments && display.topFlows.length > 0 ? display.topFlows : data.topFlows ?? [];

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-sm text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold tabular-nums">
            {display.totalRecords.toLocaleString()}
          </span>{" "}
          shipments
          <span className="text-zinc-400 dark:text-zinc-500 ml-1">
            {effectiveRange[0]}–{effectiveRange[1]}
          </span>
          {brush && (
            <span className="text-zinc-400 dark:text-zinc-500 ml-1">
              (of {minYear}–{maxYear})
            </span>
          )}
        </span>
        <TrendSummary data={display.byYear} metric={metric} />
        {hasActiveFilters && (
          <button
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline ml-auto"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Trade flow map */}
      {displayFlows.length > 0 && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800/30">
          <TradeFlowMap
            flows={displayFlows}
            reExportFlows={display.reExportFlows}
            exporters={displayExporters}
            importers={displayImporters}
            suspensionCountries={suspensionCountries}
            countryAnnotations={countryAnnotations}
          />
        </div>
      )}

      {/* Exporters & Importers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CountryTable data={displayExporters} label="Top exporters" />
        <CountryTable data={displayImporters} label="Top importers" />
      </div>

      {/* Filters + Chart side by side */}
      <div
        className={`grid grid-cols-1 gap-4 ${
          hasShipments ? "md:grid-cols-[230px_1fr]" : ""
        }`}
      >
        {/* Filter panel */}
        {hasShipments && (
          <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-800/20 max-h-[520px] overflow-y-auto">
            {/* Source filters */}
            {data.allSources && data.allSources.length > 0 && (
              <div>
                <FilterSectionHeader
                  title="Source"
                  onAll={() =>
                    setAll(setCheckedSources, data.allSources!.map((s) => s.code), true)
                  }
                  onNone={() =>
                    setAll(setCheckedSources, data.allSources!.map((s) => s.code), false)
                  }
                />
                <div className="space-y-1">
                  {data.allSources.map((s) => (
                    <FilterCheckbox
                      key={s.code}
                      label={s.label}
                      sublabel={s.code}
                      count={s.records}
                      checked={checkedSources[s.code] ?? true}
                      onChange={() => toggleSource(s.code)}
                      color={WILD_SOURCE_CODES.has(s.code) ? "#f59e0b" : "#34d399"}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Purpose filters */}
            {data.allPurposes && data.allPurposes.length > 0 && (
              <div>
                <FilterSectionHeader
                  title="Purpose"
                  onAll={() =>
                    setAll(setCheckedPurposes, data.allPurposes!.map((p) => p.code), true)
                  }
                  onNone={() =>
                    setAll(setCheckedPurposes, data.allPurposes!.map((p) => p.code), false)
                  }
                />
                <div className="space-y-1">
                  {data.allPurposes.map((p) => (
                    <FilterCheckbox
                      key={p.code}
                      label={p.label}
                      sublabel={p.code}
                      count={p.records}
                      checked={checkedPurposes[p.code] ?? true}
                      onChange={() => togglePurpose(p.code)}
                      color="#3b82f6"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Commodity (term + unit) filters — searchable, no truncation */}
            {data.allTermsByUnit && data.allTermsByUnit.length > 0 && (
              <div>
                <FilterSectionHeader
                  title="Commodity"
                  onAll={() =>
                    setAll(
                      setCheckedTerms,
                      visibleTermRows.map((t) => termUnitKey(t.term, t.unit)),
                      true
                    )
                  }
                  onNone={() =>
                    setAll(
                      setCheckedTerms,
                      visibleTermRows.map((t) => termUnitKey(t.term, t.unit)),
                      false
                    )
                  }
                />
                {data.allTermsByUnit.length > 6 && (
                  <input
                    type="text"
                    value={termSearch}
                    onChange={(e) => setTermSearch(e.target.value)}
                    placeholder="Search commodities…"
                    className="w-full mb-1.5 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400"
                  />
                )}
                <div className="space-y-1">
                  {visibleTermRows.map((t) => {
                    const key = termUnitKey(t.term, t.unit);
                    return (
                      <FilterCheckbox
                        key={key}
                        label={t.term}
                        sublabel={unitLabel(t.unit)}
                        count={t.records}
                        checked={checkedTerms[key] ?? true}
                        onChange={() => toggleTerm(key)}
                        color="#8b5cf6"
                      />
                    );
                  })}
                  {visibleTermRows.length === 0 && (
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      No commodities match “{termSearch}”.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chart + details */}
        <div className="space-y-4 min-w-0">
          {/* Metric toggle + line chart with trim handles */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Trade over time
              </span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 normal-case">
                (shipments)
              </span>
              {brush && (
                <span className="text-[11px] text-blue-600 dark:text-blue-400 tabular-nums ml-auto">
                  {brush[0]}–{brush[1]}
                </span>
              )}
            </div>
            <TrendLineChart
              data={chartByYear}
              metric={metric}
              minYear={minYear}
              maxYear={maxYear}
              brush={brush}
              onBrushChange={setBrush}
              provisionalFromYear={provisionalFromYear}
            />
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 leading-snug">
              Drag the handles to trim the year range.
              {maxYear >= provisionalFromYear && (
                <>
                  {" "}
                  Recent years (dashed, {provisionalFromYear}+) are{" "}
                  <span className="text-amber-500 dark:text-amber-400">provisional</span> —
                  CITES reporting lags by a few years, so they are usually incomplete
                  rather than showing a real drop.
                </>
              )}
            </p>
          </div>

          {/* Source breakdown — most important for assessors */}
          {displaySources.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Wild vs. Captive
              </h5>
              <SourceBreakdown sources={displaySources} />
            </div>
          )}

          {/* Commodities — grouped by term + unit (never aggregated across units) */}
          {display.termsByUnit.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                Commodities
              </h5>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400 dark:text-zinc-500">
                    <th className="font-medium pb-1 pr-2">Term</th>
                    <th className="font-medium pb-1 pr-2">Unit</th>
                    <th className="font-medium pb-1 pr-2 text-right">Records</th>
                    <th className="font-medium pb-1 text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {display.termsByUnit.slice(0, 8).map((t) => (
                    <tr
                      key={termUnitKey(t.term, t.unit)}
                      className="border-t border-zinc-100 dark:border-zinc-800/50"
                    >
                      <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-300 capitalize">
                        {t.term}
                      </td>
                      <td className="py-1 pr-2 text-zinc-500 dark:text-zinc-400">
                        {t.unit || "—"}
                      </td>
                      <td className="py-1 pr-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {t.records.toLocaleString()}
                      </td>
                      <td className="py-1 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {fmtQty(t.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Purpose */}
          {displayPurposes.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Purpose
              </h5>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                {displayPurposes.map((p) => (
                  <span key={p.code} className="tabular-nums">
                    {p.label}{" "}
                    <span className="text-zinc-400 dark:text-zinc-500">
                      ({p.records})
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
