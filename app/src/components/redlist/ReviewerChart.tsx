"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";

const FilterBarChart = dynamic(
  () => import("./FilterBarChart"),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" /> }
);

type ChartEntry = { code: string; count: number; label: string };
type ViewMode = "assessors" | "reviewers";

interface AssessorChartProps {
  allAssessors: ChartEntry[];
  allReviewers: ChartEntry[];
  /** The selected items for the currently active tab */
  selectedItems: Set<string>;
  onBarClick: (data: { payload?: { code?: string } }, event: React.MouseEvent) => void;
  onItemToggle: (code: string) => void;
  loading?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const PAGE_SIZE = 10;

export default function AssessorChart({
  allAssessors,
  allReviewers,
  selectedItems,
  onBarClick,
  onItemToggle,
  loading,
  viewMode,
  onViewModeChange,
}: AssessorChartProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [searchPage, setSearchPage] = useState(0);

  const activeData = viewMode === "assessors" ? allAssessors : allReviewers;
  const activeLabel = viewMode === "assessors" ? "assessors" : "reviewers";

  // Global max for consistent bar scaling across pages
  const globalMax = activeData.length > 0 ? activeData[0].count : 0;

  const totalPages = Math.ceil(activeData.length / PAGE_SIZE);
  const paginated = activeData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Search results: filtered + sorted desc by count
  const searchResults = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return activeData.filter(r => r.code.toLowerCase().includes(q));
  }, [activeData, search]);

  const searchTotalPages = Math.ceil(searchResults.length / PAGE_SIZE);
  const paginatedSearchResults = searchResults.slice(searchPage * PAGE_SIZE, (searchPage + 1) * PAGE_SIZE);

  // Reset pages when search changes
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setSearchPage(0);
    if (!value) setPage(0);
  };

  // Reset search and pages when toggling view mode
  const handleViewModeChange = (mode: ViewMode) => {
    onViewModeChange(mode);
    setSearch("");
    setPage(0);
    setSearchPage(0);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        {/* Toggle between Assessors and Reviewers */}
        <div className="inline-flex rounded-md bg-zinc-100 dark:bg-zinc-800 p-0.5">
          <button
            onClick={() => handleViewModeChange("assessors")}
            className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
              viewMode === "assessors"
                ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Assessors
          </button>
          <button
            onClick={() => handleViewModeChange("reviewers")}
            className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
              viewMode === "reviewers"
                ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Reviewers
          </button>
        </div>
        <span className="text-[10px] text-zinc-400 hidden xl:inline">(cmd/ctrl+click to multiselect)</span>
      </div>

      {/* Search input */}
      <div className="relative mb-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={`Search ${activeLabel}...`}
          className="w-full px-2.5 py-1 pl-7 pr-14 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-red-500 text-xs"
        />
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {search && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] text-zinc-400">
            <span>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</span>
            <button
              onClick={() => handleSearchChange("")}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
              title="Clear search"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-[160px] sm:min-h-[225px] flex items-center justify-center">
        {loading ? (
          <svg
            className="animate-spin h-5 w-5 text-zinc-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : search ? (
          // Search results: simple list view
          <div className="w-full h-full">
            {paginatedSearchResults.length > 0 ? (
              <div className="space-y-0.5">
                {paginatedSearchResults.map((entry) => {
                  const isSelected = selectedItems.has(entry.code);
                  return (
                    <button
                      key={entry.code}
                      onClick={() => onItemToggle(entry.code)}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                        isSelected
                          ? "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300"
                          : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <span className="truncate mr-2">{entry.code}</span>
                      <span className="text-zinc-400 tabular-nums flex-shrink-0">{entry.count.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-xs text-zinc-400">No matching {activeLabel}</span>
            )}
          </div>
        ) : paginated.length > 0 ? (
          <FilterBarChart
            data={paginated}
            dataKey="code"
            selectedItems={selectedItems}
            onBarClick={onBarClick}
            barColor="#8b5cf6"
            yAxisWidth={150}
            leftMargin={-30}
            rightMargin={55}
            xAxisMax={globalMax}
            labelFormatter={(name) => name}
            yAxisTickMaxLength={22}
          />
        ) : (
          <span className="text-xs text-zinc-400">No {activeLabel} data</span>
        )}
      </div>

      {/* Pagination */}
      {(() => {
        const activePage = search ? searchPage : page;
        const activeTotal = search ? searchResults.length : activeData.length;
        const activePages = search ? searchTotalPages : totalPages;
        const setActivePage = search ? setSearchPage : setPage;
        if (activePages <= 1) return null;
        return (
          <div className="flex items-center justify-between mt-1 text-[10px] text-zinc-400">
            <button
              onClick={() => setActivePage(p => Math.max(0, p - 1))}
              disabled={activePage === 0}
              className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span>
              {activePage * PAGE_SIZE + 1}-{Math.min((activePage + 1) * PAGE_SIZE, activeTotal)} of {activeTotal}
            </span>
            <button
              onClick={() => setActivePage(p => Math.min(activePages - 1, p + 1))}
              disabled={activePage >= activePages - 1}
              className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        );
      })()}
    </div>
  );
}
