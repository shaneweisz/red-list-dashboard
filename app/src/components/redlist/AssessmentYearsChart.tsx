"use client";

import { memo, useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import type { RedListSpecies } from "@/hooks/useRedListSpeciesQuery";

// Dynamically import charts to reduce initial bundle size (recharts is ~200KB)
const FilterBarChart = dynamic(() => import("./FilterBarChart"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" />,
});

const YearBarChart = dynamic(() => import("./YearBarChart"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" />,
});

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-5 w-5 text-zinc-400 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

const YEARS_PAGE_SIZE = 10;

export interface AssessmentYearRangeDatum {
  range: string;
  shortRange: string;
  count: number;
  label: string;
  minYear: number;
}

export interface AssessmentYearDatum {
  code: string;
  count: number;
  label: string;
}

interface AssessmentYearsChartProps {
  loading: boolean;
  isSingleSpecies: boolean;
  singleSpecies: RedListSpecies | null;
  rangeData: AssessmentYearRangeDatum[];
  yearData: AssessmentYearDatum[];
  selectedYearRanges: Set<string>;
  selectedAssessmentYears: Set<string>;
  onYearRangeClick: (data: { payload?: { range?: string } }, event: React.MouseEvent) => void;
  onAssessmentYearClick: (data: { payload?: { code?: string } }, event: React.MouseEvent) => void;
}

/**
 * Years Since Assessed / Assessments by Year chart card.
 *
 * Owns its own pagination + view-mode state so that clicking the page
 * chevrons or toggling Range ↔ Year doesn't force the parent dashboard
 * (and every sibling chart) to re-render.
 */
function AssessmentYearsChart({
  loading,
  isSingleSpecies,
  singleSpecies,
  rangeData,
  yearData,
  selectedYearRanges,
  selectedAssessmentYears,
  onYearRangeClick,
  onAssessmentYearClick,
}: AssessmentYearsChartProps) {
  // Capture "now" once at mount — this chart doesn't need a live ticker, and
  // reading Date.now() inside render trips the react-hooks/purity rule.
  const [nowMs] = useState(() => Date.now());
  // Track which view is active ("range" buckets vs specific year).
  // Defaults to "year" when a specific-year filter is already active (e.g. from URL).
  const [yearsChartMode, setYearsChartMode] = useState<"range" | "year">(
    () => (selectedAssessmentYears.size > 0 ? "year" : "range")
  );
  // If the URL hydrates with specific years selected after mount, surface the year view.
  useEffect(() => {
    if (selectedAssessmentYears.size > 0) {
      setYearsChartMode("year"); // eslint-disable-line react-hooks/set-state-in-effect -- react to late-hydrating URL params
    }
  }, [selectedAssessmentYears]);

  // Paginate the by-year chart: show 10 years at a time, defaulting to the most recent.
  // Initialized to the last page so the first render already shows the most recent years.
  const yearsTotalPages = Math.max(1, Math.ceil(yearData.length / YEARS_PAGE_SIZE));
  const [yearsPage, setYearsPage] = useState(() => yearsTotalPages - 1);
  const paginatedYearData = useMemo(
    () => yearData.slice(yearsPage * YEARS_PAGE_SIZE, (yearsPage + 1) * YEARS_PAGE_SIZE),
    [yearData, yearsPage]
  );
  // Global max across all years so the Y-axis scale stays fixed as users page
  const yearsGlobalMax = useMemo(
    () => yearData.reduce((m, d) => Math.max(m, d.count), 0),
    [yearData]
  );
  // When Year view is (re)activated or the data reshapes, jump to the most recent page.
  // User-driven page clicks don't trigger this because yearsTotalPages is stable under those.
  useEffect(() => {
    if (yearsChartMode === "year") {
      setYearsPage(Math.max(0, yearsTotalPages - 1)); // eslint-disable-line react-hooks/set-state-in-effect -- intentional reset on mode/data change
    }
  }, [yearsChartMode, yearsTotalPages]);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {yearsChartMode === "range" ? "Years Since Assessed" : "Assessments by Year"}
        </span>
        <div className="flex items-center gap-2">
          {/* Pagination controls (year view only, and only when multiple pages) */}
          {!(isSingleSpecies && singleSpecies) && yearsChartMode === "year" && yearsTotalPages > 1 && (() => {
            const firstYear = paginatedYearData[0]?.code;
            const lastYear = paginatedYearData[paginatedYearData.length - 1]?.code;
            const label = firstYear && lastYear
              ? (firstYear === lastYear ? firstYear : `${firstYear}–${lastYear}`)
              : "";
            const canPrev = yearsPage > 0;
            const canNext = yearsPage < yearsTotalPages - 1;
            return (
              <div className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                <button
                  type="button"
                  onClick={() => canPrev && setYearsPage(p => Math.max(0, p - 1))}
                  disabled={!canPrev}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Previous years"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="tabular-nums min-w-[64px] text-center">{label}</span>
                <button
                  type="button"
                  onClick={() => canNext && setYearsPage(p => Math.min(yearsTotalPages - 1, p + 1))}
                  disabled={!canNext}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Next years"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            );
          })()}
          {!(isSingleSpecies && singleSpecies) && (
            <div className="inline-flex rounded-md bg-zinc-100 dark:bg-zinc-800 p-0.5" role="group" aria-label="Year chart view">
              <button
                type="button"
                onClick={() => setYearsChartMode("range")}
                className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                  yearsChartMode === "range"
                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
                aria-pressed={yearsChartMode === "range"}
              >
                Range
              </button>
              <button
                type="button"
                onClick={() => setYearsChartMode("year")}
                className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                  yearsChartMode === "year"
                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
                aria-pressed={yearsChartMode === "year"}
              >
                Year
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-[150px] flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center"><Spinner /></div>
        ) : isSingleSpecies && singleSpecies ? (
          <div className="flex-1 flex items-center justify-center">
            {(() => {
              if (!singleSpecies.assessment_date) return (
                <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">N/A</span>
              );
              const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
              const elapsed = nowMs - new Date(singleSpecies.assessment_date).getTime();
              const yearsSince = Math.floor(elapsed / msPerYear);
              const range = yearsSince < 1 ? "<1y" : yearsSince <= 5 ? "1-5y" : yearsSince <= 10 ? "6-10y" : yearsSince <= 20 ? "11-20y" : ">20y";
              return (
                <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">
                  {range}
                </span>
              );
            })()}
          </div>
        ) : yearsChartMode === "range" ? (
          rangeData.length > 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <FilterBarChart
                data={rangeData}
                dataKey="shortRange"
                selectedItems={selectedYearRanges}
                onBarClick={onYearRangeClick}
                barColor="#3b82f6"
                yAxisWidth={36}
                rightMargin={85}
              />
            </div>
          ) : null
        ) : paginatedYearData.length > 0 ? (
          <div className="flex-1">
            <YearBarChart
              data={paginatedYearData}
              selectedItems={selectedAssessmentYears}
              onBarClick={onAssessmentYearClick}
              barColor="#3b82f6"
              yMax={yearsGlobalMax}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-zinc-400 dark:text-zinc-500">No assessments</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(AssessmentYearsChart);
