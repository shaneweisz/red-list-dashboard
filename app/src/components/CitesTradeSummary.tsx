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
/*  Interactive filter bar chart                                        */
/* ------------------------------------------------------------------ */

interface FilterBar {
  /** Stable key passed back to onToggle (source/purpose code or term key). */
  key: string;
  label: string;
  sublabel?: string;
  records: number;
  /** Whether this category is currently included by the filter. */
  active: boolean;
  /** Tailwind classes for the bar fill. */
  barClass: string;
  /** Optional tooltip override (defaults to "label (sublabel) — N records"). */
  title?: string;
}

/**
 * A scrollable horizontal bar chart that doubles as a cross-filter: clicking a
 * bar calls onToggle(key) to add/remove that category, and de-selected bars are
 * dimmed but stay visible so they can be toggled back on. An optional search box
 * (used by the Commodity chart) filters the rows shown.
 */
function FilterBarChart({
  title,
  bars,
  onToggle,
  search,
  onSearchChange,
  searchPlaceholder,
  emptyHint,
}: {
  title: string;
  bars: FilterBar[];
  onToggle?: (key: string) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  emptyHint?: string;
}) {
  const max = bars.reduce((m, b) => Math.max(m, b.records), 0);

  return (
    <div className="min-w-0">
      {/* Fixed-height header row so the bar lists in adjacent charts line up,
          whether or not a chart has an inline search box. */}
      <div className="flex items-center gap-2 mb-1.5 h-7">
        <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider shrink-0">
          {title}
        </h5>
        {onSearchChange && (
          <input
            type="text"
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="ml-auto w-32 px-2 py-0.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400"
          />
        )}
      </div>
      <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1">
        {bars.map((b) => {
          const pct = max > 0 ? (b.records / max) * 100 : 0;
          return (
            <div
              key={b.key}
              onClick={onToggle ? () => onToggle(b.key) : undefined}
              title={
                b.title ??
                `${b.label}${b.sublabel ? ` (${b.sublabel})` : ""} — ${b.records.toLocaleString()} records`
              }
              className={`flex items-center gap-2 text-xs select-none transition-opacity ${
                onToggle ? "cursor-pointer" : ""
              } ${b.active ? "" : "opacity-40"}`}
            >
              <span className="w-24 shrink-0 truncate capitalize text-zinc-700 dark:text-zinc-300">
                {b.label}
                {b.sublabel && (
                  <span className="text-zinc-400 dark:text-zinc-500 ml-1 normal-case">
                    {b.sublabel}
                  </span>
                )}
              </span>
              <div className="flex-1 h-3.5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                <div
                  className={`h-full rounded ${b.barClass}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <span className="w-12 text-right text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
                {b.records.toLocaleString()}
              </span>
            </div>
          );
        })}
        {bars.length === 0 && emptyHint && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {emptyHint}
          </span>
        )}
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
/*  Country table                                                      */
/* ------------------------------------------------------------------ */

function CountryTable({ data, label }: { data: CountryData[]; label: string }) {
  if (data.length === 0) return null;
  const top = [...data].sort((a, b) => b.records - a.records).slice(0, 5);

  return (
    <div>
      <h5 className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-0.5">
        {label}
      </h5>
      <div>
        {top.map((c) => (
          <div
            key={c.code}
            className="flex items-baseline justify-between gap-2 text-[11px] py-px"
          >
            <span className="truncate text-zinc-700 dark:text-zinc-300">
              {countryName(c.code)}
              <span className="text-zinc-400 dark:text-zinc-500 ml-1">
                ({c.code})
              </span>
            </span>
            <span className="text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
              {c.records.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
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

  // Cross-filter views: each interactive chart aggregates rows passing every
  // active filter EXCEPT its own dimension, so its categories stay visible and
  // a click can toggle them back on (rather than vanishing once de-selected).
  const commodityChart = useMemo(() => {
    if (!data?.found || !data.shipments) return [];
    const rows = data.shipments.filter((r) => {
      if (r.s && checkedSources[r.s] === false) return false;
      if (r.p && checkedPurposes[r.p] === false) return false;
      if (brush && (r.y < brush[0] || r.y > brush[1])) return false;
      return true;
    });
    return aggregateShipments(rows).termsByUnit;
  }, [data, checkedSources, checkedPurposes, brush]);

  const sourceChart = useMemo(() => {
    if (!data?.found || !data.shipments) return [];
    const rows = data.shipments.filter((r) => {
      if (r.p && checkedPurposes[r.p] === false) return false;
      if (checkedTerms[termUnitKey(r.t, r.u)] === false) return false;
      if (brush && (r.y < brush[0] || r.y > brush[1])) return false;
      return true;
    });
    return aggregateShipments(rows).topSources;
  }, [data, checkedPurposes, checkedTerms, brush]);

  const purposeChart = useMemo(() => {
    if (!data?.found || !data.shipments) return [];
    const rows = data.shipments.filter((r) => {
      if (r.s && checkedSources[r.s] === false) return false;
      if (checkedTerms[termUnitKey(r.t, r.u)] === false) return false;
      if (brush && (r.y < brush[0] || r.y > brush[1])) return false;
      return true;
    });
    return aggregateShipments(rows).topPurposes;
  }, [data, checkedSources, checkedTerms, brush]);

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
  const displayExporters =
    hasShipments && display.topExporters.length > 0 ? display.topExporters : data.topExporters;
  const displayImporters =
    hasShipments && display.topImporters.length > 0 ? display.topImporters : data.topImporters;
  const displayFlows =
    hasShipments && display.topFlows.length > 0 ? display.topFlows : data.topFlows ?? [];

  // Build the three interactive filter charts. Source bars keep the
  // wild (amber) vs captive (emerald) distinction by colour.
  const sourceBars: FilterBar[] = sourceChart.map((s) => ({
    key: s.code,
    label: s.label,
    sublabel: s.code,
    records: s.records,
    active: checkedSources[s.code] !== false,
    barClass: WILD_SOURCE_CODES.has(s.code)
      ? "bg-amber-400 dark:bg-amber-500"
      : "bg-emerald-300 dark:bg-emerald-600",
  }));

  const purposeBars: FilterBar[] = purposeChart.map((p) => ({
    key: p.code,
    label: p.label,
    sublabel: p.code,
    records: p.records,
    active: checkedPurposes[p.code] !== false,
    barClass: "bg-blue-400 dark:bg-blue-500",
  }));

  const commoditySearch = termSearch.trim().toLowerCase();
  const commodityBars: FilterBar[] = commodityChart
    .filter((t) =>
      commoditySearch
        ? `${t.term} ${t.unit}`.toLowerCase().includes(commoditySearch)
        : true
    )
    .map((t) => {
      const key = termUnitKey(t.term, t.unit);
      return {
        key,
        label: t.term,
        sublabel: t.unit || undefined,
        records: t.records,
        active: checkedTerms[key] !== false,
        barClass: "bg-violet-400 dark:bg-violet-500",
        title: `${t.term}${t.unit ? ` (${t.unit})` : ""} — ${t.records.toLocaleString()} records / ${fmtQty(t.quantity)} items`,
      };
    });

  const hasFilterCharts =
    sourceBars.length > 0 || purposeBars.length > 0 || commodityChart.length > 0;

  // Trade-over-time chart, placed in the map's side column (or full width when
  // there is no map).
  const tradeOverTimeChart = (
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
  );

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
        {hasActiveFilters && (
          <button
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline ml-auto"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Trade flow map, with Top exporters / importers and the trade-over-time
          chart stacked in the side column. */}
      {displayFlows.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800/30">
            <TradeFlowMap
              flows={displayFlows}
              reExportFlows={display.reExportFlows}
              exporters={displayExporters}
              importers={displayImporters}
              suspensionCountries={suspensionCountries}
              countryAnnotations={countryAnnotations}
            />
          </div>
          <div className="space-y-3">
            <CountryTable data={displayExporters} label="Top exporters" />
            <CountryTable data={displayImporters} label="Top importers" />
            {tradeOverTimeChart}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CountryTable data={displayExporters} label="Top exporters" />
            <CountryTable data={displayImporters} label="Top importers" />
          </div>
          {tradeOverTimeChart}
        </div>
      )}

      {/* Filter charts below the map — click a bar to cross-filter the whole
          summary. Source bars are coloured wild (amber) vs captive (emerald). */}
      {hasFilterCharts && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FilterBarChart
            title="Commodity"
            bars={commodityBars}
            onToggle={hasShipments ? toggleTerm : undefined}
            search={termSearch}
            onSearchChange={setTermSearch}
            searchPlaceholder="Search…"
            emptyHint={
              commoditySearch
                ? `No commodities match “${termSearch}”.`
                : undefined
            }
          />
          <FilterBarChart
            title="Purpose"
            bars={purposeBars}
            onToggle={hasShipments ? togglePurpose : undefined}
          />
          <FilterBarChart
            title="Source"
            bars={sourceBars}
            onToggle={hasShipments ? toggleSource : undefined}
          />
        </div>
      )}
    </div>
  );
}
