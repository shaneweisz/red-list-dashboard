"use client";

import { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { countriesToRegions, regionColor } from "@/lib/regions";

interface AssessorCountryCandidate {
  name: string;
  regionCounts: Record<string, number>;
  total: number;
  latestDate: string;
}

interface AssessorCandidatesByCountryChartProps {
  taxonGroup: string;
  countries: string[];
}

const PAGE_SIZE = 10;

export default function AssessorCandidatesByCountryChart({
  taxonGroup,
  countries,
}: AssessorCandidatesByCountryChartProps) {
  const [candidates, setCandidates] = useState<AssessorCountryCandidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const countriesKey = countries.join(";");

  // Derive the regions for this species' countries (stable across renders)
  const regions = useMemo(() => countriesToRegions(countries), [countriesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (countries.length === 0) {
      setCandidates([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPage(0);

    const params = new URLSearchParams({
      taxonGroup,
      countries: countries.join(";"),
    });

    fetch(`/api/redlist/assessor-candidates-by-country?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setCandidates(data.candidates);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxonGroup, countriesKey]);

  // Build chart data with per-region keys
  const chartData = useMemo(() => {
    if (!candidates || candidates.length === 0) return [];

    return candidates.map((c) => {
      const row: Record<string, string | number> = { name: c.name, total: c.total, latestDate: c.latestDate };
      for (const region of regions) {
        row[region] = c.regionCounts[region] ?? 0;
      }
      return row;
    });
  }, [candidates, regions]);

  const legendItems = useMemo(
    () => regions.map((r) => ({ key: r, label: r, color: regionColor(r) })),
    [regions]
  );

  const totalPages = Math.ceil(chartData.length / PAGE_SIZE);
  const paginated = useMemo(
    () => chartData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [chartData, page]
  );
  const globalMax = chartData.length > 0 ? (chartData[0].total as number) : 0;

  const openAssessor = (barData: { payload?: { name?: string } }) => {
    const name = barData?.payload?.name;
    if (name) {
      window.open(`/?taxa=${encodeURIComponent(taxonGroup)}&assessors=${encodeURIComponent(name)}`, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <svg className="w-5 h-5 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-500 p-4">
        Failed to load regional assessor candidates
      </div>
    );
  }

  if (!candidates || candidates.length === 0) {
    return (
      <div className="text-sm text-zinc-400 italic p-4">
        No regional assessor candidates found
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 pt-1">
      {/* Chart */}
      <div style={{ height: paginated.length * 32 + 40, minHeight: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={paginated}
            layout="vertical"
            margin={{ top: 5, right: 55, left: -30, bottom: 20 }}
            barCategoryGap={4}
          >
            <XAxis
              type="number"
              domain={[0, globalMax || 1]}
              tick={{ fontSize: 10, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={{ stroke: "#3f3f46" }}
              label={{ value: "Species assessed", position: "insideBottom", offset: -12, fontSize: 10, fill: "#71717a" }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={false}
              width={150}
              interval={0}
              tickFormatter={(value: string) =>
                value.length > 22 ? value.slice(0, 22) + "…" : value
              }
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0]?.payload;
                if (!data) return null;
                const dateStr = data.latestDate
                  ? new Date(data.latestDate).getFullYear().toString()
                  : "—";
                return (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg">
                    <div className="font-medium mb-1">{data.name}</div>
                    {legendItems.map((item) => {
                      const count = data[item.key] as number;
                      if (!count) return null;
                      return (
                        <div key={item.key} className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: item.color }} />
                          <span>{item.label}: {count} species</span>
                        </div>
                      );
                    })}
                    <div className="mt-1 text-zinc-400">
                      {legendItems.filter((item) => (data[item.key] as number) > 0).length}/{regions.length} regions covered
                    </div>
                    <div className="text-zinc-400">Latest assessment: {dateStr}</div>
                  </div>
                );
              }}
            />
            {regions.map((region, i) => {
              const isLast = i === regions.length - 1;
              return (
                <Bar
                  key={region}
                  dataKey={region}
                  stackId="a"
                  fill={regionColor(region)}
                  radius={isLast ? [0, 4, 4, 0] : 0}
                  cursor="pointer"
                  onClick={openAssessor}
                >
                  {isLast && (
                    <LabelList
                      dataKey="total"
                      position="right"
                      style={{ fontSize: 11, fill: "#a1a1aa" }}
                    />
                  )}
                </Bar>
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-1 text-[10px] text-zinc-400">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span>
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, candidates.length)} of {candidates.length}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* Legend — below chart so both columns align */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2 border-t border-zinc-200 dark:border-zinc-700 text-[10px]">
        {legendItems.map((item) => (
          <div key={item.key} className="flex items-center gap-1">
            <span
              className="w-2.5 h-2.5 rounded-sm inline-block"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-zinc-500 dark:text-zinc-400">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
