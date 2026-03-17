"use client";

import { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface AssessorCandidate {
  name: string;
  genus: number;
  family: number;
  order: number;
  class: number;
  latestDate: string;
}

interface AssessorCandidatesChartProps {
  scientificName: string;
  taxonGroup: string;
  family?: string | null;
  orderName?: string | null;
  className?: string | null;
}

const LEVEL_COLORS = {
  genus: "#10b981",
  family: "#3b82f6",
  order: "#8b5cf6",
  class: "#f59e0b",
};

const PAGE_SIZE = 10;

export default function AssessorCandidatesChart({
  scientificName,
  taxonGroup,
  family,
  orderName,
  className,
}: AssessorCandidatesChartProps) {
  const [candidates, setCandidates] = useState<AssessorCandidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const genusName = scientificName.split(" ")[0] || null;

  // Build legend labels with actual taxonomy names
  const legendItems = useMemo(() => {
    const items: { key: string; label: string; color: string }[] = [];
    if (genusName) items.push({ key: "genus", label: `Genus: ${genusName}`, color: LEVEL_COLORS.genus });
    if (family) items.push({ key: "family", label: `Family: ${family}`, color: LEVEL_COLORS.family });
    if (orderName) items.push({ key: "order", label: `Order: ${orderName}`, color: LEVEL_COLORS.order });
    if (className) items.push({ key: "class", label: `Class: ${className}`, color: LEVEL_COLORS.class });
    return items;
  }, [genusName, family, orderName, className]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPage(0);

    const params = new URLSearchParams({ scientificName, taxonGroup });
    if (family) params.set("family", family);
    if (orderName) params.set("order", orderName);
    if (className) params.set("class", className);

    fetch(`/api/redlist/assessor-candidates?${params}`, { signal: controller.signal })
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
  }, [scientificName, taxonGroup, family, orderName, className]);

  // For the stacked chart, we need exclusive counts (family-only, not including genus)
  const chartData = useMemo(() => {
    if (!candidates) return [];
    return candidates.map((c) => ({
      name: c.name,
      genus: c.genus,
      familyOnly: c.family - c.genus,
      orderOnly: c.order - c.family,
      classOnly: c.class - c.order,
      total: c.class,
      latestDate: c.latestDate,
    }));
  }, [candidates]);

  const totalPages = Math.ceil(chartData.length / PAGE_SIZE);
  const paginated = chartData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const globalMax = chartData.length > 0 ? chartData[0].total : 0;

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
        Failed to load assessor candidates
      </div>
    );
  }

  if (!candidates || candidates.length === 0) {
    return (
      <div className="text-sm text-zinc-400 italic p-4">
        No assessor candidates found
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs">
        {legendItems.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm inline-block"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-zinc-500 dark:text-zinc-400">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ height: paginated.length * 32 + 20, minHeight: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={paginated}
            layout="vertical"
            margin={{ top: 5, right: 55, left: -30, bottom: 5 }}
            barCategoryGap={4}
            onClick={(state: any) => {
              const name = state?.activePayload?.[0]?.payload?.name;
              if (name) {
                window.open(`/?assessors=${encodeURIComponent(name)}`, "_blank");
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <XAxis type="number" hide domain={[0, globalMax || 1]} />
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
                      const inclusive = item.key === "genus" ? data.genus
                        : item.key === "family" ? data.genus + data.familyOnly
                        : item.key === "order" ? data.genus + data.familyOnly + data.orderOnly
                        : data.total;
                      if (inclusive === 0) return null;
                      return (
                        <div key={item.key} className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: item.color }} />
                          <span>{item.label}: {inclusive} species</span>
                        </div>
                      );
                    })}
                    <div className="mt-1 text-zinc-400">Latest assessment: {dateStr}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="genus" stackId="a" fill={LEVEL_COLORS.genus} radius={0} />
            <Bar dataKey="familyOnly" stackId="a" fill={LEVEL_COLORS.family} radius={0} />
            <Bar dataKey="orderOnly" stackId="a" fill={LEVEL_COLORS.order} radius={0} />
            <Bar dataKey="classOnly" stackId="a" fill={LEVEL_COLORS.class} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-400">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span>
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, chartData.length)} of {chartData.length}
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
    </div>
  );
}
