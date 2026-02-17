"use client";

import { useState, useEffect } from "react";

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

function MiniBarChart({ data }: { data: YearData[] }) {
  if (data.length === 0) return null;
  const maxRecords = Math.max(...data.map((d) => d.records));
  if (maxRecords === 0) return null;

  return (
    <div className="flex items-end gap-px h-16">
      {data.map((d) => (
        <div key={d.year} className="flex-1 flex flex-col items-center gap-0.5">
          <div
            className="w-full bg-blue-400 dark:bg-blue-500 rounded-t-sm min-h-[2px]"
            style={{ height: `${(d.records / maxRecords) * 100}%` }}
            title={`${d.year}: ${d.records} records, ${d.quantity.toLocaleString()} items`}
          />
          <span className="text-[9px] text-zinc-400 dark:text-zinc-500 tabular-nums leading-none">
            {String(d.year).slice(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TagList({
  items,
}: {
  items: { label: string; count: number; title?: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.label}
          title={item.title || `${item.count} records`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
        >
          {item.label}
          <span className="text-zinc-400 dark:text-zinc-500 tabular-nums">
            {item.count}
          </span>
        </span>
      ))}
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
      <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 py-2">
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
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
    return null; // Silently hide if no trade data
  }

  return (
    <div className="space-y-3">
      {/* Year chart + headline */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-xs text-zinc-600 dark:text-zinc-300">
            <span className="font-semibold tabular-nums">
              {data.totalRecords.toLocaleString()}
            </span>{" "}
            trade records ({data.yearRange[0]}–{data.yearRange[1]})
          </span>
        </div>
        <MiniBarChart data={data.byYear} />
      </div>

      {/* What is traded */}
      {data.topTerms.length > 0 && (
        <div>
          <h5 className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
            What is traded
          </h5>
          <TagList
            items={data.topTerms.map((t) => ({
              label: t.term,
              count: t.records,
              title: `${t.term}: ${t.records} records, ${t.quantity.toLocaleString()} items`,
            }))}
          />
        </div>
      )}

      {/* Purpose & Source side by side */}
      <div className="grid grid-cols-2 gap-3">
        {data.topPurposes.length > 0 && (
          <div>
            <h5 className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
              Purpose
            </h5>
            <TagList
              items={data.topPurposes.map((p) => ({
                label: p.label,
                count: p.records,
              }))}
            />
          </div>
        )}
        {data.topSources.length > 0 && (
          <div>
            <h5 className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
              Source
            </h5>
            <TagList
              items={data.topSources.map((s) => ({
                label: s.label,
                count: s.records,
              }))}
            />
          </div>
        )}
      </div>

      {/* Top exporters & importers side by side */}
      <div className="grid grid-cols-2 gap-3">
        {data.topExporters.length > 0 && (
          <div>
            <h5 className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
              Top exporters
            </h5>
            <TagList
              items={data.topExporters.slice(0, 6).map((e) => ({
                label: e.code,
                count: e.records,
                title: `${e.code}: ${e.records} records, ${e.quantity.toLocaleString()} items`,
              }))}
            />
          </div>
        )}
        {data.topImporters.length > 0 && (
          <div>
            <h5 className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
              Top importers
            </h5>
            <TagList
              items={data.topImporters.slice(0, 6).map((im) => ({
                label: im.code,
                count: im.records,
                title: `${im.code}: ${im.records} records, ${im.quantity.toLocaleString()} items`,
              }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
