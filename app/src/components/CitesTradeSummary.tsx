"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceArea,
} from "recharts";
import { countryName, fmtQty } from "./cites-utils";
import type { CountryAnnotation } from "./TradeFlowMap";

const TradeFlowMap = dynamic(() => import("./TradeFlowMap"), { ssr: false });

/** Stable key for a term+unit combination (units must never be aggregated) */
function termKey(term: string, unit: string): string {
  return `${term}|${unit}`;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CompactRecord {
  y: number;
  s: string;
  p: string;
  t: string;
  u: string;
  q: number;
  e: string;
  i: string;
  o: string;
}

interface YearData {
  year: number;
  quantity: number;
  records: number;
}

interface TermData {
  term: string;
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

interface FlowData {
  from: string;
  to: string;
  records: number;
  quantity: number;
}

interface TradeData {
  found: boolean;
  taxonId: string;
  totalRecords: number;
  yearRange: [number, number];
  byYear: YearData[];
  topTerms: TermData[];
  topPurposes: CodedData[];
  topSources: CodedData[];
  topExporters: CountryData[];
  topImporters: CountryData[];
  topFlows?: FlowData[];
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
      <span className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 truncate">
        {label}
        {sublabel && (
          <span className="text-zinc-400 dark:text-zinc-500 ml-1">
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

/* ------------------------------------------------------------------ */
/*  Filter section header with All / None bulk-select                  */
/* ------------------------------------------------------------------ */

function SectionHeader({
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

const CHART_HEIGHT = 170;
const PLOT_LEFT = 45; // YAxis width (margin.left = 0)
const PLOT_RIGHT_PAD = 10; // margin.right

function TrendLineChart({
  data,
  metric,
  minYear,
  maxYear,
  selStart,
  selEnd,
  onRangeChange,
}: {
  data: YearData[];
  metric: "records" | "quantity";
  minYear: number;
  maxYear: number;
  selStart: number;
  selEnd: number;
  onRangeChange: (start: number, end: number) => void;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<null | "start" | "end">(null);

  // Track container width so we can position the handles over the plot area
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(1, maxYear - minYear);
  const plotWidth = Math.max(0, width - PLOT_LEFT - PLOT_RIGHT_PAD);
  const canBrush = data.length > 1 && plotWidth > 0;

  const yearToX = useCallback(
    (year: number) => PLOT_LEFT + (plotWidth * (year - minYear)) / span,
    [plotWidth, minYear, span]
  );

  // Drag handling — translate pointer position to the nearest year
  useEffect(() => {
    if (!dragging) return;
    function move(e: PointerEvent) {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const frac = (e.clientX - rect.left - PLOT_LEFT) / plotWidth;
      let year = Math.round(minYear + frac * span);
      year = Math.max(minYear, Math.min(maxYear, year));
      if (dragging === "start") {
        onRangeChange(Math.min(year, selEnd), selEnd);
      } else {
        onRangeChange(selStart, Math.max(year, selStart));
      }
    }
    function up() {
      setDragging(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, plotWidth, minYear, maxYear, span, selStart, selEnd, onRangeChange]);

  if (data.length === 0) return null;

  const dimFill = dark ? "#09090b" : "#71717a";
  const handleColor = dark ? "#fbbf24" : "#d97706";

  return (
    <div ref={wrapRef} className="relative select-none" style={{ height: CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 5, right: PLOT_RIGHT_PAD, left: 0, bottom: 5 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-700"
          />
          <XAxis
            dataKey="year"
            type="number"
            domain={[minYear, maxYear]}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            width={PLOT_LEFT}
            tickFormatter={(v: number) => fmtQty(v)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "8px",
              fontSize: 12,
            }}
            itemStyle={{ color: "#fff" }}
            labelStyle={{ color: "#a1a1aa" }}
            formatter={(value: number) => [
              value.toLocaleString(),
              metric === "records" ? "Shipments" : "Items",
            ]}
          />
          <Line
            type="monotone"
            dataKey={metric}
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#3b82f6", strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive={false}
          />
          {/* Dim the regions outside the selected year range */}
          {selStart > minYear && (
            <ReferenceArea
              x1={minYear}
              x2={selStart}
              fill={dimFill}
              fillOpacity={0.35}
              ifOverflow="visible"
            />
          )}
          {selEnd < maxYear && (
            <ReferenceArea
              x1={selEnd}
              x2={maxYear}
              fill={dimFill}
              fillOpacity={0.35}
              ifOverflow="visible"
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Draggable trim handles overlaid on the plot area */}
      {canBrush &&
        (
          [
            { side: "start" as const, year: selStart },
            { side: "end" as const, year: selEnd },
          ]
        ).map(({ side, year }) => {
          const x = yearToX(year);
          return (
            <div
              key={side}
              role="slider"
              aria-label={side === "start" ? "Range start year" : "Range end year"}
              aria-valuenow={year}
              aria-valuemin={minYear}
              aria-valuemax={maxYear}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(side);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const delta = e.key === "ArrowLeft" ? -1 : 1;
                  const next = Math.max(minYear, Math.min(maxYear, year + delta));
                  if (side === "start") onRangeChange(Math.min(next, selEnd), selEnd);
                  else onRangeChange(selStart, Math.max(next, selStart));
                }
              }}
              className="absolute top-0 flex flex-col items-center cursor-ew-resize touch-none group"
              style={{ left: x - 7, width: 14, height: CHART_HEIGHT - 22 }}
            >
              {/* grip */}
              <div
                className="rounded-sm shadow-sm"
                style={{ width: 8, height: 16, backgroundColor: handleColor }}
              />
              {/* line */}
              <div className="flex-1" style={{ width: 2, backgroundColor: handleColor }} />
            </div>
          );
        })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trend summary text                                                 */
/* ------------------------------------------------------------------ */

function TrendSummary({ data, metric }: { data: YearData[]; metric: "records" | "quantity" }) {
  if (data.length < 4) return null;
  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid);
  const secondHalf = data.slice(mid);
  const key = metric;
  const avgFirst = firstHalf.reduce((s, d) => s + d[key], 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, d) => s + d[key], 0) / secondHalf.length;
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

function CountryTable({
  data,
  label,
}: {
  data: CountryData[];
  label: string;
}) {
  if (data.length === 0) return null;
  const top = [...data].sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  return (
    <div>
      <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
        {label}
      </h5>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-400 dark:text-zinc-500">
            <th className="font-medium pb-1 pr-2">Country</th>
            <th className="font-medium pb-1 pr-2 text-right">Records</th>
            <th className="font-medium pb-1 text-right">Quantity</th>
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
              <td className="py-1 pr-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                {c.records.toLocaleString()}
              </td>
              <td className="py-1 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                {fmtQty(c.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Aggregation (shared by the chart and the year-trimmed panels)      */
/* ------------------------------------------------------------------ */

function aggregate(rows: CompactRecord[], yearRange: [number, number]) {
  // By year — fill every year in range so the chart line is continuous
  const yearMap = new Map<number, { quantity: number; records: number }>();
  for (const r of rows) {
    const entry = yearMap.get(r.y) || { quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += r.q;
    yearMap.set(r.y, entry);
  }
  for (let y = yearRange[0]; y <= yearRange[1]; y++) {
    if (!yearMap.has(y)) yearMap.set(y, { quantity: 0, records: 0 });
  }
  const byYear = Array.from(yearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({ year, ...v }));

  // By term + unit — never aggregate quantities across units
  const termUnitMap = new Map<string, TermUnitData>();
  for (const r of rows) {
    const key = termKey(r.t, r.u);
    const entry = termUnitMap.get(key) || { term: r.t, unit: r.u, records: 0, quantity: 0 };
    entry.records++;
    entry.quantity += r.q;
    termUnitMap.set(key, entry);
  }
  const topTermUnits = Array.from(termUnitMap.values()).sort((a, b) => b.records - a.records);

  // Sources
  const sourceMap = new Map<string, number>();
  for (const r of rows) if (r.s) sourceMap.set(r.s, (sourceMap.get(r.s) || 0) + 1);
  const topSources = Array.from(sourceMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({ code, label: SOURCE_LABELS[code] || code, records }));

  // Purposes
  const purposeMap = new Map<string, number>();
  for (const r of rows) if (r.p) purposeMap.set(r.p, (purposeMap.get(r.p) || 0) + 1);
  const topPurposes = Array.from(purposeMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({ code, label: PURPOSE_LABELS[code] || code, records }));

  // Exporters / importers
  const exporterMap = new Map<string, { records: number; quantity: number }>();
  const importerMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
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
  }
  const topExporters = Array.from(exporterMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));
  const topImporters = Array.from(importerMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  // Bilateral flows (exporter → importer)
  const flowMap = new Map<string, { records: number; quantity: number }>();
  // Re-export legs (origin → exporter), where goods passed through an intermediary
  const reexportMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
    if (r.e && r.i) {
      const key = `${r.e}->${r.i}`;
      const entry = flowMap.get(key) || { records: 0, quantity: 0 };
      entry.records++;
      entry.quantity += r.q;
      flowMap.set(key, entry);
    }
    if (r.o && r.e && r.o !== r.e) {
      const key = `${r.o}->${r.e}`;
      const entry = reexportMap.get(key) || { records: 0, quantity: 0 };
      entry.records++;
      entry.quantity += r.q;
      reexportMap.set(key, entry);
    }
  }
  const topFlows = Array.from(flowMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 12)
    .map(([key, v]) => {
      const [from, to] = key.split("->");
      return { from, to, ...v };
    });
  const reexportFlows = Array.from(reexportMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 12)
    .map(([key, v]) => {
      const [from, to] = key.split("->");
      return { from, to, ...v };
    });

  return {
    byYear,
    totalRecords: rows.length,
    topTermUnits,
    topSources,
    topPurposes,
    topExporters,
    topImporters,
    topFlows,
    reexportFlows,
  };
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

  // Metric toggle: show records (shipments) or quantity (items)
  const [metric, setMetric] = useState<"records" | "quantity">("records");

  // Filter state — all checked by default. Terms are keyed by term+unit.
  const [checkedSources, setCheckedSources] = useState<Record<string, boolean>>({});
  const [checkedPurposes, setCheckedPurposes] = useState<Record<string, boolean>>({});
  const [checkedTerms, setCheckedTerms] = useState<Record<string, boolean>>({});
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  // Commodity search box (filters which term rows are shown in the panel)
  const [termSearch, setTermSearch] = useState("");

  // Year-range trim selection (null = full range). Set by dragging the
  // handles on the trade-over-time chart.
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);

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
      for (const t of data.allTermsByUnit) init[termKey(t.term, t.unit)] = true;
      setCheckedTerms(init);
    } else if (data.allTerms) {
      const init: Record<string, boolean> = {};
      for (const t of data.allTerms) init[termKey(t.term, "")] = true;
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

  // Bulk All / None per section
  const setAll = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
      value: boolean,
      onlyKeys?: string[]
    ) => {
      setter((prev) => {
        const next = { ...prev };
        const keys = onlyKeys ?? Object.keys(next);
        for (const k of keys) next[k] = value;
        return next;
      });
    },
    []
  );

  // Full year range from the dataset
  const fullYearRange = useMemo<[number, number]>(
    () => (data?.yearRange ? [data.yearRange[0], data.yearRange[1]] : [0, 0]),
    [data?.yearRange]
  );

  // Effective (selected) year range — clamps to the dataset bounds
  const selStart = brushStart ?? fullYearRange[0];
  const selEnd = brushEnd ?? fullYearRange[1];
  const yearTrimActive =
    fullYearRange[1] > fullYearRange[0] &&
    (selStart > fullYearRange[0] || selEnd < fullYearRange[1]);

  const onRangeChange = useCallback((start: number, end: number) => {
    setBrushStart(start);
    setBrushEnd(end);
  }, []);

  // Are any filters active (something unchecked, search text, or year trim)?
  const hasActiveFilters = useMemo(() => {
    const anySourceOff = Object.values(checkedSources).some((v) => !v);
    const anyPurposeOff = Object.values(checkedPurposes).some((v) => !v);
    const anyTermOff = Object.values(checkedTerms).some((v) => !v);
    return anySourceOff || anyPurposeOff || anyTermOff || yearTrimActive || termSearch.trim() !== "";
  }, [checkedSources, checkedPurposes, checkedTerms, yearTrimActive, termSearch]);

  // Clear all filters (re-check everything, reset year trim + search)
  const clearFilters = useCallback(() => {
    const recheck = (prev: Record<string, boolean>) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = true;
      return next;
    };
    setCheckedSources(recheck);
    setCheckedPurposes(recheck);
    setCheckedTerms(recheck);
    setBrushStart(null);
    setBrushEnd(null);
    setTermSearch("");
  }, []);

  // Rows passing the source/purpose/term filters (but NOT the year trim)
  const baseRows = useMemo(() => {
    if (!data?.found || !data.shipments) return [];
    return data.shipments.filter((r) => {
      if (r.s && checkedSources[r.s] === false) return false;
      if (r.p && checkedPurposes[r.p] === false) return false;
      if (checkedTerms[termKey(r.t, r.u)] === false) return false;
      return true;
    });
  }, [data, checkedSources, checkedPurposes, checkedTerms]);

  // Chart data spans the full year range (so the trim handles stay anchored)
  const chartByYear = useMemo(
    () => aggregate(baseRows, fullYearRange).byYear,
    [baseRows, fullYearRange]
  );

  // Everything else reflects the trimmed year range
  const display = useMemo(() => {
    const rows = yearTrimActive
      ? baseRows.filter((r) => r.y >= selStart && r.y <= selEnd)
      : baseRows;
    return aggregate(rows, [selStart, selEnd]);
  }, [baseRows, yearTrimActive, selStart, selEnd]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 py-3">
        <svg
          className="animate-spin h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
        >
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

  const hasShipments = !!data.shipments && data.shipments.length > 0;

  // Term+unit rows for the filter panel (prefer the unit-aware list)
  const allTermUnitRows: TermUnitData[] =
    data.allTermsByUnit ??
    (data.allTerms?.map((t) => ({ term: t.term, unit: "", records: t.records, quantity: 0 })) ??
      []);
  const termSearchLower = termSearch.trim().toLowerCase();
  const visibleTermRows = termSearchLower
    ? allTermUnitRows.filter(
        (t) =>
          t.term.toLowerCase().includes(termSearchLower) ||
          t.unit.toLowerCase().includes(termSearchLower)
      )
    : allTermUnitRows;
  const sourceKeys = (data.allSources ?? []).map((s) => s.code);
  const purposeKeys = (data.allPurposes ?? []).map((p) => p.code);
  const termKeys = allTermUnitRows.map((t) => termKey(t.term, t.unit));

  return (
    <div className="space-y-4">
      {/* Headline + trend */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-sm text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold tabular-nums">
            {display.totalRecords.toLocaleString()}
          </span>{" "}
          shipments
          <span className="text-zinc-400 dark:text-zinc-500 ml-1">
            {selStart}–{selEnd}
          </span>
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
      {display.topFlows && display.topFlows.length > 0 && (
        <div>
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800/30">
            <TradeFlowMap
              flows={display.topFlows}
              reexportFlows={display.reexportFlows}
              suspensionCountries={suspensionCountries}
              countryAnnotations={countryAnnotations}
            />
          </div>
        </div>
      )}

      {/* Exporters & Importers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CountryTable data={display.topExporters} label="Top exporters" />
        <CountryTable data={display.topImporters} label="Top importers" />
      </div>

      {/* Filters + Chart side by side */}
      <div className={`grid grid-cols-1 gap-4 ${hasShipments ? "md:grid-cols-[220px_1fr]" : ""}`}>
        {/* Filter panel */}
        {hasShipments && (
          <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-800/20 max-h-[500px] overflow-y-auto">
            {/* Source filters */}
            {data.allSources && data.allSources.length > 0 && (
              <div>
                <SectionHeader
                  title="Source"
                  onAll={() => setAll(setCheckedSources, true, sourceKeys)}
                  onNone={() => setAll(setCheckedSources, false, sourceKeys)}
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
                <SectionHeader
                  title="Purpose"
                  onAll={() => setAll(setCheckedPurposes, true, purposeKeys)}
                  onNone={() => setAll(setCheckedPurposes, false, purposeKeys)}
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

            {/* Term/commodity filters — searchable, keyed by term+unit */}
            {allTermUnitRows.length > 0 && (
              <div>
                <SectionHeader
                  title="Commodity"
                  onAll={() => setAll(setCheckedTerms, true, termKeys)}
                  onNone={() => setAll(setCheckedTerms, false, termKeys)}
                />
                {allTermUnitRows.length > 6 && (
                  <input
                    type="text"
                    value={termSearch}
                    onChange={(e) => setTermSearch(e.target.value)}
                    placeholder="Search commodities…"
                    className="w-full mb-1.5 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                )}
                <div className="space-y-1">
                  {visibleTermRows.map((t) => {
                    const key = termKey(t.term, t.unit);
                    return (
                      <FilterCheckbox
                        key={key}
                        label={t.term}
                        sublabel={t.unit || undefined}
                        count={t.records}
                        checked={checkedTerms[key] ?? true}
                        onChange={() => toggleTerm(key)}
                        color="#8b5cf6"
                      />
                    );
                  })}
                  {visibleTermRows.length === 0 && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
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
          {/* Metric toggle + line chart */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Trade over time
              </span>
              {yearTrimActive && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 tabular-nums">
                  {selStart}–{selEnd}
                </span>
              )}
              <div className="flex items-center gap-1 ml-auto bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                <button
                  className={`px-2 py-0.5 text-[11px] rounded ${
                    metric === "records"
                      ? "bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                  onClick={() => setMetric("records")}
                >
                  Shipments
                </button>
                <button
                  className={`px-2 py-0.5 text-[11px] rounded ${
                    metric === "quantity"
                      ? "bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                  onClick={() => setMetric("quantity")}
                >
                  Volume
                </button>
              </div>
            </div>
            <TrendLineChart
              data={chartByYear}
              metric={metric}
              minYear={fullYearRange[0]}
              maxYear={fullYearRange[1]}
              selStart={selStart}
              selEnd={selEnd}
              onRangeChange={onRangeChange}
            />
            {data.yearRange[1] > data.yearRange[0] && (
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
                Drag the handles to trim the year range.
              </p>
            )}
          </div>

          {/* Source breakdown — most important for assessors */}
          {display.topSources.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Wild vs. Captive
              </h5>
              <SourceBreakdown sources={display.topSources} />
            </div>
          )}

          {/* Commodities — one row per term+unit (units are never aggregated) */}
          {display.topTermUnits.length > 0 && (
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
                  {display.topTermUnits.slice(0, 8).map((t) => (
                    <tr
                      key={termKey(t.term, t.unit)}
                      className="border-t border-zinc-100 dark:border-zinc-800/50"
                    >
                      <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-300 capitalize">
                        {t.term}
                      </td>
                      <td className="py-1 pr-2 text-zinc-500 dark:text-zinc-400">
                        {t.unit || <span className="text-zinc-300 dark:text-zinc-600">items</span>}
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
          {display.topPurposes.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Purpose
              </h5>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                {display.topPurposes.map((p) => (
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
