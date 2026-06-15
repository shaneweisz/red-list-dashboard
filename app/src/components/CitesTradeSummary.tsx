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
  unit?: string;
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

interface FilteredData {
  byYear: YearData[];
  totalRecords: number;
  totalQty: number;
  topTerms: TermData[];
  topSources: CodedData[];
  topPurposes: CodedData[];
  topExporters: CountryData[];
  topImporters: CountryData[];
  topFlows: FlowData[];
  reExportFlows: FlowData[];
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
/*  Trend line chart                                                   */
/* ------------------------------------------------------------------ */

function TrendLineChart({
  data,
  metric,
}: {
  data: YearData[];
  metric: "records" | "quantity";
}) {
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={160}>
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

  // Commodity search for the filter sidebar
  const [termSearch, setTermSearch] = useState("");

  // Year range filter
  const [yearFrom, setYearFrom] = useState<number | null>(null);
  const [yearTo, setYearTo] = useState<number | null>(null);

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
    if (data.yearRange) {
      setYearFrom(data.yearRange[0]);
      setYearTo(data.yearRange[1]);
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

  // Per-section select-all / select-none
  const selectAllSources = useCallback(() => {
    if (!data?.allSources) return;
    setCheckedSources(Object.fromEntries(data.allSources.map((s) => [s.code, true])));
  }, [data?.allSources]);
  const selectNoneSources = useCallback(() => {
    if (!data?.allSources) return;
    setCheckedSources(Object.fromEntries(data.allSources.map((s) => [s.code, false])));
  }, [data?.allSources]);

  const selectAllPurposes = useCallback(() => {
    if (!data?.allPurposes) return;
    setCheckedPurposes(Object.fromEntries(data.allPurposes.map((p) => [p.code, true])));
  }, [data?.allPurposes]);
  const selectNonePurposes = useCallback(() => {
    if (!data?.allPurposes) return;
    setCheckedPurposes(Object.fromEntries(data.allPurposes.map((p) => [p.code, false])));
  }, [data?.allPurposes]);

  const selectAllTerms = useCallback(() => {
    if (!data?.allTerms) return;
    setCheckedTerms(Object.fromEntries(data.allTerms.map((t) => [t.term, true])));
  }, [data?.allTerms]);
  const selectNoneTerms = useCallback(() => {
    if (!data?.allTerms) return;
    setCheckedTerms(Object.fromEntries(data.allTerms.map((t) => [t.term, false])));
  }, [data?.allTerms]);

  // Are any filters active (i.e. something is unchecked or year range narrowed)?
  const hasActiveFilters = useMemo(() => {
    const anySourceOff = Object.values(checkedSources).some((v) => !v);
    const anyPurposeOff = Object.values(checkedPurposes).some((v) => !v);
    const anyTermOff = Object.values(checkedTerms).some((v) => !v);
    const anyYearFiltered = data?.yearRange
      ? (yearFrom !== null && yearFrom > data.yearRange[0]) ||
        (yearTo !== null && yearTo < data.yearRange[1])
      : false;
    return anySourceOff || anyPurposeOff || anyTermOff || anyYearFiltered;
  }, [checkedSources, checkedPurposes, checkedTerms, yearFrom, yearTo, data?.yearRange]);

  // Clear all filters (re-check everything, reset year range)
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
    setTermSearch("");
    if (data?.yearRange) {
      setYearFrom(data.yearRange[0]);
      setYearTo(data.yearRange[1]);
    }
  }, [data?.yearRange]);

  // Filter shipments and recompute all derived data
  const filtered = useMemo((): FilteredData => {
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
        reExportFlows: [],
      };
    }

    const rows = data.shipments.filter((r) => {
      if (!checkedSources[r.s] && r.s) return false;
      if (!checkedPurposes[r.p] && r.p) return false;
      if (!checkedTerms[r.t]) return false;
      if (yearFrom !== null && r.y < yearFrom) return false;
      if (yearTo !== null && r.y > yearTo) return false;
      return true;
    });

    // byYear — fill gaps so the chart shows a continuous axis
    const yearMap = new Map<number, { quantity: number; records: number }>();
    for (const r of rows) {
      const entry = yearMap.get(r.y) || { quantity: 0, records: 0 };
      entry.records++;
      entry.quantity += r.q;
      yearMap.set(r.y, entry);
    }
    const displayFrom = yearFrom ?? data.yearRange[0];
    const displayTo = yearTo ?? data.yearRange[1];
    for (let y = displayFrom; y <= displayTo; y++) {
      if (!yearMap.has(y)) yearMap.set(y, { quantity: 0, records: 0 });
    }
    const byYear = Array.from(yearMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([year, v]) => ({ year, ...v }));

    // terms — group by term+unit so different units aren't aggregated together
    const termUnitMap = new Map<string, { term: string; unit: string; quantity: number; records: number }>();
    for (const r of rows) {
      const key = `${r.t}\0${r.u}`;
      const existing = termUnitMap.get(key);
      if (existing) {
        existing.records++;
        existing.quantity += r.q;
      } else {
        termUnitMap.set(key, { term: r.t, unit: r.u, quantity: r.q, records: 1 });
      }
    }
    const topTerms = Array.from(termUnitMap.values())
      .sort((a, b) => b.records - a.records)
      .slice(0, 8);

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

    // flows (exporter → importer)
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

    // re-export flows: origin → exporter legs where goods passed through an intermediary
    const reExportFlowMap = new Map<string, { records: number; quantity: number }>();
    for (const r of rows) {
      if (!r.o || r.o === r.e || !r.e) continue;
      const key = `${r.o}->${r.e}`;
      const entry = reExportFlowMap.get(key) || { records: 0, quantity: 0 };
      entry.records++;
      entry.quantity += r.q;
      reExportFlowMap.set(key, entry);
    }
    const reExportFlows = Array.from(reExportFlowMap.entries())
      .sort(([, a], [, b]) => b.records - a.records)
      .slice(0, 8)
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
      reExportFlows,
    };
  }, [data, checkedSources, checkedPurposes, checkedTerms, yearFrom, yearTo]);

  // Commodity list filtered by the search input
  const filteredTermList = useMemo(() => {
    const terms = data?.allTerms || [];
    if (!termSearch.trim()) return terms;
    const q = termSearch.toLowerCase();
    return terms.filter((t) => t.term.toLowerCase().includes(q));
  }, [data?.allTerms, termSearch]);

  // Year options derived from the full data range
  const availableYears = useMemo(() => {
    if (!data?.yearRange) return [];
    const [min, max] = data.yearRange;
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, [data?.yearRange]);

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

  return (
    <div className="space-y-4">
      {/* Headline + trend */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-sm text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold tabular-nums">
            {filtered.totalRecords.toLocaleString()}
          </span>{" "}
          shipments
          <span className="text-zinc-400 dark:text-zinc-500 mx-1">/</span>
          <span className="font-semibold tabular-nums">
            {fmtQty(filtered.totalQty)}
          </span>{" "}
          reported items
          <span className="text-zinc-400 dark:text-zinc-500 ml-1">
            {yearFrom ?? data.yearRange[0]}–{yearTo ?? data.yearRange[1]}
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
      {filtered.topFlows && filtered.topFlows.length > 0 && (
        <div>
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800/30">
            <TradeFlowMap
              flows={filtered.topFlows}
              reExportFlows={filtered.reExportFlows}
              suspensionCountries={suspensionCountries}
              countryAnnotations={countryAnnotations}
            />
          </div>
        </div>
      )}

      {/* Exporters & Importers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CountryTable data={filtered.topExporters} label="Top exporters" />
        <CountryTable data={filtered.topImporters} label="Top importers" />
      </div>

      {/* Filters + Chart side by side */}
      <div className={`grid grid-cols-1 gap-4 ${hasShipments ? "md:grid-cols-[220px_1fr]" : ""}`}>
        {/* Filter panel */}
        {hasShipments && (
          <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-800/20 max-h-[560px] overflow-y-auto">
            {/* Year range filter */}
            {availableYears.length > 1 && (
              <div>
                <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                  Year Range
                </h5>
                <div className="flex items-center gap-1 text-xs">
                  <select
                    value={yearFrom ?? data.yearRange[0]}
                    onChange={(e) => setYearFrom(Number(e.target.value))}
                    className="flex-1 text-xs border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1 py-0.5 min-w-0"
                  >
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <span className="text-zinc-400 shrink-0">–</span>
                  <select
                    value={yearTo ?? data.yearRange[1]}
                    onChange={(e) => setYearTo(Number(e.target.value))}
                    className="flex-1 text-xs border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1 py-0.5 min-w-0"
                  >
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Source filters */}
            {data.allSources && data.allSources.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Source
                  </h5>
                  <div className="flex gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <button onClick={selectAllSources} className="hover:text-zinc-600 dark:hover:text-zinc-300">All</button>
                    <span>/</span>
                    <button onClick={selectNoneSources} className="hover:text-zinc-600 dark:hover:text-zinc-300">None</button>
                  </div>
                </div>
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
                <div className="flex items-center justify-between mb-1.5">
                  <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Purpose
                  </h5>
                  <div className="flex gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <button onClick={selectAllPurposes} className="hover:text-zinc-600 dark:hover:text-zinc-300">All</button>
                    <span>/</span>
                    <button onClick={selectNonePurposes} className="hover:text-zinc-600 dark:hover:text-zinc-300">None</button>
                  </div>
                </div>
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

            {/* Term/commodity filters — searchable, shows all */}
            {data.allTerms && data.allTerms.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Commodity
                    {data.allTerms.length > 1 && (
                      <span className="ml-1 font-normal text-zinc-400">({data.allTerms.length})</span>
                    )}
                  </h5>
                  <div className="flex gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <button onClick={selectAllTerms} className="hover:text-zinc-600 dark:hover:text-zinc-300">All</button>
                    <span>/</span>
                    <button onClick={selectNoneTerms} className="hover:text-zinc-600 dark:hover:text-zinc-300">None</button>
                  </div>
                </div>
                {data.allTerms.length > 5 && (
                  <input
                    type="text"
                    value={termSearch}
                    onChange={(e) => setTermSearch(e.target.value)}
                    placeholder="Search commodities…"
                    className="w-full text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 mb-1.5 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  />
                )}
                <div className="space-y-1">
                  {filteredTermList.length === 0 ? (
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 italic">No matching commodities</p>
                  ) : (
                    filteredTermList.map((t) => (
                      <FilterCheckbox
                        key={t.term}
                        label={t.term}
                        count={t.records}
                        checked={checkedTerms[t.term] ?? true}
                        onChange={() => toggleTerm(t.term)}
                        color="#8b5cf6"
                      />
                    ))
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
            <TrendLineChart data={filtered.byYear} metric={metric} />
          </div>

          {/* Source breakdown — most important for assessors */}
          {filtered.topSources.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Wild vs. Captive
              </h5>
              <SourceBreakdown sources={filtered.topSources} />
            </div>
          )}

          {/* Commodities — table with quantities and units (kept separate since kg ≠ pieces) */}
          {filtered.topTerms.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                Commodities
              </h5>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400 dark:text-zinc-500">
                    <th className="font-medium pb-1 pr-2">Term</th>
                    <th className="font-medium pb-1 pr-1 text-right">Records</th>
                    <th className="font-medium pb-1 pr-1 text-right">Qty</th>
                    <th className="font-medium pb-1 text-left text-zinc-300 dark:text-zinc-600">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.topTerms.slice(0, 8).map((t) => (
                    <tr
                      key={`${t.term}\0${t.unit ?? ""}`}
                      className="border-t border-zinc-100 dark:border-zinc-800/50"
                    >
                      <td className="py-1 pr-2 text-zinc-700 dark:text-zinc-300 capitalize">
                        {t.term}
                      </td>
                      <td className="py-1 pr-1 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {t.records.toLocaleString()}
                      </td>
                      <td className="py-1 pr-1 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {t.quantity > 0 ? fmtQty(t.quantity) : "—"}
                      </td>
                      <td className="py-1 text-zinc-400 dark:text-zinc-500">
                        {t.unit || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Purpose */}
          {filtered.topPurposes.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Purpose
              </h5>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                {filtered.topPurposes.map((p) => (
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
