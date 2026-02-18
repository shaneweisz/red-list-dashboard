"use client";

import { useState, useEffect } from "react";
import { ALPHA2_TO_NAME } from "./WorldMap";

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
  topTerms: TermData[];
  topPurposes: CodedData[];
  topSources: CodedData[];
  topExporters: CountryData[];
  topImporters: CountryData[];
}

// Sources that indicate wild take — key concern for assessors
const WILD_SOURCE_CODES = new Set(["W", "X", "R", "U"]);

function countryName(code: string): string {
  return ALPHA2_TO_NAME[code] || code;
}

function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function TrendArrow({ data }: { data: YearData[] }) {
  if (data.length < 4) return null;
  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid);
  const secondHalf = data.slice(mid);
  const avgFirst =
    firstHalf.reduce((s, d) => s + d.records, 0) / firstHalf.length;
  const avgSecond =
    secondHalf.reduce((s, d) => s + d.records, 0) / secondHalf.length;
  if (avgFirst === 0 && avgSecond === 0) return null;
  const pctChange =
    avgFirst === 0 ? 100 : ((avgSecond - avgFirst) / avgFirst) * 100;
  if (Math.abs(pctChange) < 15) {
    return (
      <span
        className="text-zinc-400 dark:text-zinc-500 text-[11px]"
        title="Stable trend"
      >
        stable
      </span>
    );
  }
  if (pctChange > 0) {
    return (
      <span
        className="text-red-500 dark:text-red-400 text-[11px] font-medium"
        title={`Trade volume increased ~${Math.round(pctChange)}%`}
      >
        &#9650; increasing
      </span>
    );
  }
  return (
    <span
      className="text-emerald-500 dark:text-emerald-400 text-[11px] font-medium"
      title={`Trade volume decreased ~${Math.round(Math.abs(pctChange))}%`}
    >
      &#9660; decreasing
    </span>
  );
}

function BarChart({ data }: { data: YearData[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length === 0) return null;
  const maxRecords = Math.max(...data.map((d) => d.records));
  if (maxRecords === 0) return null;

  const BAR_HEIGHT = 80;
  // Pick nice round tick values for y-axis
  const rawStep = maxRecords / 3;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step =
    rawStep <= magnitude * 1 ? magnitude :
    rawStep <= magnitude * 2 ? magnitude * 2 :
    rawStep <= magnitude * 5 ? magnitude * 5 :
    magnitude * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= maxRecords; v += step) {
    ticks.push(v);
  }
  if (ticks[ticks.length - 1] < maxRecords) {
    ticks.push(ticks[ticks.length - 1] + step);
  }
  const yMax = ticks[ticks.length - 1];

  return (
    <div className="relative">
      {/* Hover tooltip */}
      {hovered !== null && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-zinc-800 dark:bg-zinc-700 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-10 pointer-events-none">
          {data[hovered].year}: {data[hovered].records.toLocaleString()} records, {fmtQty(data[hovered].quantity)} items
        </div>
      )}
      <div className="flex">
        {/* Y-axis labels */}
        <div className="relative shrink-0 w-8 mr-1" style={{ height: BAR_HEIGHT }}>
          {ticks.map((v) => {
            const bottom = yMax > 0 ? (v / yMax) * BAR_HEIGHT : 0;
            return (
              <span
                key={v}
                className="absolute right-0 text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums leading-none -translate-y-1/2"
                style={{ bottom }}
              >
                {fmtQty(v)}
              </span>
            );
          })}
        </div>
        {/* Bar area */}
        <div className="flex items-end gap-[3px] flex-1" style={{ height: BAR_HEIGHT }}>
          {data.map((d, i) => {
            const barH = Math.max(Math.round((d.records / yMax) * BAR_HEIGHT), 2);
            return (
              <div
                key={d.year}
                className="flex-1 cursor-default"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <div
                  className={`w-full rounded-t transition-colors ${
                    hovered === i
                      ? "bg-blue-500 dark:bg-blue-400"
                      : "bg-blue-300 dark:bg-blue-600"
                  }`}
                  style={{ height: barH }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* Year labels */}
      <div className="flex gap-[3px] mt-1 ml-9">
        {data.map((d) => (
          <div key={d.year} className="flex-1 text-center">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums leading-none">
              {d.year}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
    <div className="space-y-2">
      {/* Two-bar comparison */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-20 text-zinc-600 dark:text-zinc-300 shrink-0">Wild</span>
          <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
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
          <span className="w-20 text-zinc-600 dark:text-zinc-300 shrink-0">Captive</span>
          <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
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
      {/* Detail breakdown */}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
        {sources.map((s) => (
          <span key={s.code}>
            {s.label}: {s.records.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}

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

export default function CitesTradeSummary({
  citesId,
}: {
  citesId: number;
}) {
  const [data, setData] = useState<TradeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrade() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/cites/trade?taxon_id=${citesId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTrade();
    return () => {
      cancelled = true;
    };
  }, [citesId]);

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

  const totalQty = data.byYear.reduce((s, d) => s + d.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Headline + trend */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-sm text-zinc-700 dark:text-zinc-200">
          <span className="font-semibold tabular-nums">
            {data.totalRecords.toLocaleString()}
          </span>{" "}
          shipments
          <span className="text-zinc-400 dark:text-zinc-500 mx-1">/</span>
          <span className="font-semibold tabular-nums">{fmtQty(totalQty)}</span>{" "}
          reported items
          <span className="text-zinc-400 dark:text-zinc-500 ml-1">
            {data.yearRange[0]}–{data.yearRange[1]}
          </span>
        </span>
        <TrendArrow data={data.byYear} />
      </div>

      {/* Bar chart */}
      <BarChart data={data.byYear} />

      {/* Source breakdown — most important for assessors */}
      {data.topSources.length > 0 && (
        <div>
          <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Source
          </h5>
          <SourceBreakdown sources={data.topSources} />
        </div>
      )}

      {/* Commodities — table with quantities */}
      {data.topTerms.length > 0 && (
        <div>
          <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
            Commodities
          </h5>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-400 dark:text-zinc-500">
                <th className="font-medium pb-1 pr-2">Term</th>
                <th className="font-medium pb-1 pr-2 text-right">Records</th>
                <th className="font-medium pb-1 text-right">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {data.topTerms.slice(0, 6).map((t) => (
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
      {data.topPurposes.length > 0 && (
        <div>
          <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Purpose
          </h5>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
            {data.topPurposes.map((p) => (
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

      {/* Exporters & Importers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CountryTable data={data.topExporters} label="Top exporters" />
        <CountryTable data={data.topImporters} label="Top importers" />
      </div>
    </div>
  );
}
