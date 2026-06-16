"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Brush,
} from "recharts";
import { countryName, fmtQty } from "./cites-utils";
import type { CountryAnnotation } from "./TradeFlowMap";

const TradeFlowMap = dynamic(() => import("./TradeFlowMap"), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CompactRecord {
  y: number;
  s: string;
  p: string;
  t: string;
  q: number;
  e: string;
  i: string;
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
}

interface AggregatedData {
  byYear: YearData[];
  totalRecords: number;
  totalQty: number;
  topTerms: TermData[];
  topSources: CodedData[];
  topPurposes: CodedData[];
  topExporters: CountryData[];
  topImporters: CountryData[];
  topFlows: FlowData[];
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
/*  Aggregation helper                                                 */
/* ------------------------------------------------------------------ */

function aggregateShipments(
  rows: CompactRecord[],
  fillYearRange?: [number, number]
): AggregatedData {
  // byYear
  const yearMap = new Map<number, { quantity: number; records: number }>();
  for (const r of rows) {
    const entry = yearMap.get(r.y) || { quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += r.q;
    yearMap.set(r.y, entry);
  }
  if (fillYearRange) {
    for (let y = fillYearRange[0]; y <= fillYearRange[1]; y++) {
      if (!yearMap.has(y)) yearMap.set(y, { quantity: 0, records: 0 });
    }
  }
  const byYear = Array.from(yearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({ year, ...v }));

  // terms
  const termMap = new Map<string, { quantity: number; records: number }>();
  for (const r of rows) {
    const entry = termMap.get(r.t) || { quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += r.q;
    termMap.set(r.t, entry);
  }
  const topTerms = Array.from(termMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([term, v]) => ({ term, ...v }));

  // sources
  const sourceMap = new Map<string, number>();
  for (const r of rows) {
    if (r.s) sourceMap.set(r.s, (sourceMap.get(r.s) || 0) + 1);
  }
  const topSources = Array.from(sourceMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({
      code,
      label: SOURCE_LABELS[code] || code,
      records,
    }));

  // purposes
  const purposeMap = new Map<string, number>();
  for (const r of rows) {
    if (r.p) purposeMap.set(r.p, (purposeMap.get(r.p) || 0) + 1);
  }
  const topPurposes = Array.from(purposeMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({
      code,
      label: PURPOSE_LABELS[code] || code,
      records,
    }));

  // exporters
  const exporterMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
    if (!r.e) continue;
    const entry = exporterMap.get(r.e) || { records: 0, quantity: 0 };
    entry.records++;
    entry.quantity += r.q;
    exporterMap.set(r.e, entry);
  }
  const topExporters = Array.from(exporterMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  // importers
  const importerMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
    if (!r.i) continue;
    const entry = importerMap.get(r.i) || { records: 0, quantity: 0 };
    entry.records++;
    entry.quantity += r.q;
    importerMap.set(r.i, entry);
  }
  const topImporters = Array.from(importerMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  // flows
  const flowMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
    if (!r.e || !r.i) continue;
    const key = `${r.e}->${r.i}`;
    const entry = flowMap.get(key) || { records: 0, quantity: 0 };
    entry.records++;
    entry.quantity += r.q;
    flowMap.set(key, entry);
  }
  const topFlows = Array.from(flowMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 12)
    .map(([key, v]) => {
      const [from, to] = key.split("->");
      return { from, to, ...v };
    });

  return {
    byYear,
    totalRecords: rows.length,
    totalQty: rows.reduce((s, r) => s + r.q, 0),
    topTerms,
    topSources,
    topPurposes,
    topExporters,
    topImporters,
    topFlows,
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
/*  Trend line chart with brush                                        */
/* ------------------------------------------------------------------ */

function TrendLineChart({
  data,
  metric,
  brushStartIndex,
  brushEndIndex,
  onBrushChange,
}: {
  data: YearData[];
  metric: "records" | "quantity";
  brushStartIndex?: number;
  brushEndIndex?: number;
  onBrushChange?: (startIndex: number, endIndex: number) => void;
}) {
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={195}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="currentColor"
          className="text-zinc-200 dark:text-zinc-700"
        />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 11, fill: "#a1a1aa" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#a1a1aa" }}
          tickLine={false}
          axisLine={false}
          width={45}
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
        />
        <Brush
          dataKey="year"
          height={24}
          startIndex={brushStartIndex}
          endIndex={brushEndIndex !== undefined ? brushEndIndex : data.length - 1}
          onChange={(range) => {
            if (
              onBrushChange &&
              range &&
              typeof range.startIndex === "number" &&
              typeof range.endIndex === "number"
            ) {
              onBrushChange(range.startIndex, range.endIndex);
            }
          }}
          stroke="#6366f1"
          fill="#e0e7ff"
          travellerWidth={8}
        />
      </LineChart>
    </ResponsiveContainer>
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

  // Filter state — all checked by default
  const [checkedSources, setCheckedSources] = useState<Record<string, boolean>>({});
  const [checkedPurposes, setCheckedPurposes] = useState<Record<string, boolean>>({});
  const [checkedTerms, setCheckedTerms] = useState<Record<string, boolean>>({});
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  // Brush year range — indices into filtered.byYear
  const [brushStartIndex, setBrushStartIndex] = useState<number | undefined>(undefined);
  const [brushEndIndex, setBrushEndIndex] = useState<number | undefined>(undefined);

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
    if (data.allTerms) {
      const init: Record<string, boolean> = {};
      for (const t of data.allTerms) init[t.term] = true;
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
  const toggleTerm = useCallback((term: string) => {
    setCheckedTerms((prev) => ({ ...prev, [term]: !prev[term] }));
  }, []);

  // Aggregated data from source/purpose/term filters (full year range for chart)
  const filtered = useMemo((): AggregatedData => {
    if (!data?.found || !data.shipments) {
      return {
        byYear: data?.byYear || [],
        totalRecords: data?.totalRecords || 0,
        totalQty: data?.byYear?.reduce((s, d) => s + d.quantity, 0) || 0,
        topTerms: data?.topTerms || [],
        topSources: data?.topSources || [],
        topPurposes: data?.topPurposes || [],
        topExporters: data?.topExporters || [],
        topImporters: data?.topImporters || [],
        topFlows: data?.topFlows || [],
      };
    }

    const rows = data.shipments.filter((r) => {
      if (!checkedSources[r.s] && r.s) return false;
      if (!checkedPurposes[r.p] && r.p) return false;
      if (!checkedTerms[r.t]) return false;
      return true;
    });

    return aggregateShipments(rows, data.yearRange);
  }, [data, checkedSources, checkedPurposes, checkedTerms]);

  // Derive the active year range from brush indices
  const brushYearRange = useMemo<[number, number] | null>(() => {
    if (brushStartIndex === undefined || brushEndIndex === undefined) return null;
    const { byYear } = filtered;
    if (!byYear.length) return null;
    const si = Math.min(brushStartIndex, byYear.length - 1);
    const ei = Math.min(brushEndIndex, byYear.length - 1);
    // If brush covers entire range, treat as inactive
    if (si === 0 && ei >= byYear.length - 1) return null;
    const start = byYear[si]?.year;
    const end = byYear[ei]?.year;
    if (start === undefined || end === undefined) return null;
    return [start, end];
  }, [brushStartIndex, brushEndIndex, filtered]);

  // Data filtered by both source/purpose/term AND the brush year range
  const display = useMemo((): AggregatedData => {
    if (!brushYearRange || !data?.found || !data.shipments) return filtered;
    const [startYear, endYear] = brushYearRange;

    const rows = data.shipments.filter((r) => {
      if (!checkedSources[r.s] && r.s) return false;
      if (!checkedPurposes[r.p] && r.p) return false;
      if (!checkedTerms[r.t]) return false;
      return r.y >= startYear && r.y <= endYear;
    });

    return {
      ...aggregateShipments(rows, [startYear, endYear]),
      // Chart always shows the full year range (brush sits on top of it)
      byYear: filtered.byYear,
    };
  }, [brushYearRange, filtered, data, checkedSources, checkedPurposes, checkedTerms]);

  // Are any filters active (something unchecked or brush narrowed)?
  const hasActiveFilters = useMemo(() => {
    const brushActive = brushYearRange !== null;
    const anySourceOff = Object.values(checkedSources).some((v) => !v);
    const anyPurposeOff = Object.values(checkedPurposes).some((v) => !v);
    const anyTermOff = Object.values(checkedTerms).some((v) => !v);
    return brushActive || anySourceOff || anyPurposeOff || anyTermOff;
  }, [brushYearRange, checkedSources, checkedPurposes, checkedTerms]);

  // Clear all filters (re-check everything, reset brush)
  const clearFilters = useCallback(() => {
    setBrushStartIndex(undefined);
    setBrushEndIndex(undefined);
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
  }, []);

  const handleBrushChange = useCallback((startIndex: number, endIndex: number) => {
    setBrushStartIndex(startIndex);
    setBrushEndIndex(endIndex);
  }, []);

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

  // Year range label — shows brush range when active
  const yearRangeLabel = brushYearRange
    ? `${brushYearRange[0]}–${brushYearRange[1]}`
    : `${data.yearRange[0]}–${data.yearRange[1]}`;

  return (
    <div className="space-y-4">
      {/* Headline + trend */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-sm text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold tabular-nums">
            {display.totalRecords.toLocaleString()}
          </span>{" "}
          shipments
          <span className="text-zinc-400 dark:text-zinc-500 mx-1">/</span>
          <span className="font-semibold tabular-nums">
            {fmtQty(display.totalQty)}
          </span>{" "}
          reported items
          <span className="text-zinc-400 dark:text-zinc-500 ml-1">
            {yearRangeLabel}
          </span>
        </span>
        <TrendSummary data={filtered.byYear} metric={metric} />
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
                <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                  Source
                </h5>
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
                <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                  Purpose
                </h5>
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

            {/* Term/commodity filters */}
            {data.allTerms && data.allTerms.length > 0 && (
              <div>
                <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                  Commodity
                </h5>
                <div className="space-y-1">
                  {data.allTerms.slice(0, 10).map((t) => (
                    <FilterCheckbox
                      key={t.term}
                      label={t.term}
                      count={t.records}
                      checked={checkedTerms[t.term] ?? true}
                      onChange={() => toggleTerm(t.term)}
                      color="#8b5cf6"
                    />
                  ))}
                  {data.allTerms.length > 10 && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      +{data.allTerms.length - 10} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chart + details */}
        <div className="space-y-4 min-w-0">
          {/* Metric toggle + line chart with brush */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Trade over time
              </span>
              {brushYearRange && (
                <span className="text-[11px] text-indigo-500 dark:text-indigo-400 font-medium">
                  {brushYearRange[0]}–{brushYearRange[1]}
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
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-1.5">
              Drag the handles below the chart to filter by year range
            </p>
            <TrendLineChart
              data={filtered.byYear}
              metric={metric}
              brushStartIndex={brushStartIndex}
              brushEndIndex={brushEndIndex}
              onBrushChange={handleBrushChange}
            />
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

          {/* Commodities — table with quantities */}
          {display.topTerms.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                Commodities
              </h5>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400 dark:text-zinc-500">
                    <th className="font-medium pb-1 pr-2">Term</th>
                    <th className="font-medium pb-1 pr-2 text-right">
                      Records
                    </th>
                    <th className="font-medium pb-1 text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {display.topTerms.slice(0, 6).map((t) => (
                    <tr
                      key={t.term}
                      className="border-t border-zinc-100 dark:border-zinc-800/50"
                    >
                      <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-300 capitalize">
                        {t.term}
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
