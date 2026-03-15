"use client";

import { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface Contributor {
  login: string;
  name: string | null;
  count: number;
  iconUrl: string | null;
}

interface InatContributorsChartProps {
  speciesKey: number;
}

type ViewMode = "observers" | "identifiers";

const PAGE_SIZE = 10;

// Custom Y-axis tick that renders as a clickable link to iNat profile
function ClickableYAxisTick({
  x,
  y,
  payload,
  contributors,
}: {
  x: number;
  y: number;
  payload: { value: string };
  contributors: Contributor[];
}) {
  const c = contributors.find((o) => o.login === payload.value);
  const displayName = c?.name || c?.login || payload.value;
  const truncated =
    displayName.length > 20 ? displayName.slice(0, 20) + "…" : displayName;

  return (
    <a
      href={`https://www.inaturalist.org/people/${payload.value}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <text
        x={x}
        y={y}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={11}
        fill="#71717a"
        className="hover:fill-green-500 cursor-pointer transition-colors"
      >
        {truncated}
      </text>
    </a>
  );
}

export default function InatContributorsChart({
  speciesKey,
}: InatContributorsChartProps) {
  const [observers, setObservers] = useState<Contributor[]>([]);
  const [identifiers, setIdentifiers] = useState<Contributor[]>([]);
  const [totalObservers, setTotalObservers] = useState(0);
  const [totalIdentifiers, setTotalIdentifiers] = useState(0);
  const [inatTaxonId, setInatTaxonId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("observers");
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/species/${speciesKey}/inat-top-observers`)
      .then((res) => res.json())
      .then((data) => {
        if (data.observers) setObservers(data.observers);
        if (data.identifiers) setIdentifiers(data.identifiers);
        setTotalObservers(data.totalObservers || 0);
        setTotalIdentifiers(data.totalIdentifiers || 0);
        setInatTaxonId(data.inatTaxonId || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [speciesKey]);

  const activeData = viewMode === "observers" ? observers : identifiers;
  const activeTotal = viewMode === "observers" ? totalObservers : totalIdentifiers;
  const activeLabel = viewMode === "observers" ? "observers" : "identifiers";
  const countLabel = viewMode === "observers" ? "Observations" : "Identifications";

  const globalMax = activeData.length > 0 ? activeData[0].count : 0;
  const totalPages = Math.ceil(activeData.length / PAGE_SIZE);
  const paginated = activeData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const chartData = useMemo(
    () =>
      paginated.map((c) => ({
        code: c.login,
        count: c.count,
        label: c.count.toLocaleString(),
      })),
    [paginated]
  );

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setPage(0);
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
          </svg>
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Top iNaturalist Contributors
          </span>
        </div>
        <div className="h-[250px] flex items-center justify-center">
          <svg
            className="animate-spin h-5 w-5 text-zinc-400"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </div>
    );
  }

  if (observers.length === 0 && identifiers.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {/* Toggle between Observers and Identifiers */}
          <div className="inline-flex rounded-md bg-zinc-100 dark:bg-zinc-800 p-0.5">
            <button
              onClick={() => handleViewModeChange("observers")}
              className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                viewMode === "observers"
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              Observers
            </button>
            <button
              onClick={() => handleViewModeChange("identifiers")}
              className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                viewMode === "identifiers"
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              Identifiers
            </button>
          </div>
          {activeTotal > 0 && (
            <span className="text-[10px] text-zinc-400 tabular-nums">
              ({activeTotal.toLocaleString()} total)
            </span>
          )}
        </div>
        {inatTaxonId && (
          <a
            href={`https://www.inaturalist.org/observations?taxon_id=${inatTaxonId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-green-600 hover:text-green-500 transition-colors"
          >
            View on iNaturalist →
          </a>
        )}
      </div>

      <div className="min-h-[250px] flex items-center justify-center">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 55, left: -30, bottom: 5 }}
              barCategoryGap={4}
            >
              <XAxis type="number" hide domain={[0, globalMax]} />
              <YAxis
                type="category"
                dataKey="code"
                tickLine={false}
                axisLine={false}
                width={150}
                interval={0}
                tick={(props: Record<string, unknown>) => (
                  <ClickableYAxisTick
                    x={props.x as number}
                    y={props.y as number}
                    payload={props.payload as { value: string }}
                    contributors={activeData}
                  />
                )}
              />
              <Tooltip
                formatter={(value: number) => [
                  value.toLocaleString(),
                  countLabel,
                ]}
                labelFormatter={(login: string) => {
                  const c = activeData.find((o) => o.login === login);
                  return c?.name || login;
                }}
                contentStyle={{
                  backgroundColor: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: "8px",
                }}
                itemStyle={{ color: "#fff" }}
                labelStyle={{ color: "#a1a1aa" }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer">
                {chartData.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill="#22c55e" />
                ))}
                <LabelList
                  dataKey="label"
                  position="right"
                  style={{ fontSize: 11, fill: "#a1a1aa" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <span className="text-xs text-zinc-400">No {activeLabel} data</span>
        )}
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
            {page * PAGE_SIZE + 1}-
            {Math.min((page + 1) * PAGE_SIZE, activeData.length)} of{" "}
            {activeData.length}
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
