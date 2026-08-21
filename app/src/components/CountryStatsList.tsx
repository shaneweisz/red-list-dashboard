"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { FaFilter } from "react-icons/fa";
import { ALPHA2_TO_NAME, type CountryStats } from "./WorldMap";
import { iucnRegionCountries } from "@/lib/regions";

type SortKey = "name" | "species" | "outdated" | "percentOutdated";
type SortDir = "asc" | "desc";
type FilterKey = "species" | "outdated" | "percentOutdated";

// Per-column min/max filter — kept as strings (not numbers) so a field can sit
// empty (no bound) or mid-edit without fighting a parsed/reformatted value.
interface RangeFilter {
  min: string;
  max: string;
}
const EMPTY_RANGE: RangeFilter = { min: "", max: "" };

// Blank bound = unbounded on that side; a non-numeric bound (still being
// typed, e.g. "-" or "") doesn't filter anything out rather than hiding
// every row while the input is mid-edit.
function inRange(value: number, filter: RangeFilter): boolean {
  if (filter.min !== "") {
    const min = Number(filter.min);
    if (!Number.isNaN(min) && value < min) return false;
  }
  if (filter.max !== "") {
    const max = Number(filter.max);
    if (!Number.isNaN(max) && value > max) return false;
  }
  return true;
}

interface CountryStatsListProps {
  stats: CountryStats;
  selectedCountries: Set<string>;
  onCountrySelect: (countryCode: string, countryName: string, event: React.MouseEvent) => void;
  speciesLabel?: string;
  showOutdatedMode?: boolean;
  // Narrows rows to the selected IUCN regions' countries — same scope the map
  // already implies via its blue region highlight (see WorldMap's activeRegions).
  // Empty means no region narrowing.
  regionsFilter?: string[];
  // Controlled sort (falls back to local state when omitted) so a sorted list
  // view is a shareable URL — see WorldMap's mapSortKey/mapSortDirection.
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSortChange?: (key: SortKey, dir: SortDir) => void;
}

const PAGE_SIZE = 10;

function percentOutdatedOf(species: number, outdated: number): number {
  return species > 0 ? (outdated / species) * 100 : 0;
}

function SortHeader({
  label,
  active,
  dir,
  align = "right",
  widthClass,
  onClick,
  filterButton,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  widthClass?: string;
  onClick: () => void;
  filterButton?: React.ReactNode;
}) {
  return (
    <th
      className={`text-sm font-medium text-zinc-500 dark:text-zinc-400 px-3 py-2 cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 whitespace-nowrap overflow-hidden text-ellipsis ${align === "left" ? "text-left" : "text-right"} ${widthClass ?? ""}`}
      onClick={onClick}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      {label}
      <span className="inline-block w-3 text-zinc-400">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>
      {filterButton}
    </th>
  );
}

// Filter icon for one numeric column — the convention most data-grid libraries
// use (AG Grid, Material-UI DataGrid, Ant Design's Table) for keeping a
// column's own controls out of a permanent row: an icon in the header that's
// tinted when a filter's actually active, opening a small min/max popover on
// click instead of taking up space at rest. stopPropagation so clicking it
// doesn't also trigger the header's onClick (sort).
function FilterIconButton({
  active,
  isOpen,
  onClick,
}: {
  active: boolean;
  isOpen: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`ml-1 p-0.5 rounded align-middle transition-colors ${
        active
          ? "text-blue-600 dark:text-blue-400"
          : isOpen
          ? "text-zinc-600 dark:text-zinc-300"
          : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      }`}
      title="Filter"
      aria-label="Filter this column"
    >
      <FaFilter size={11} />
    </button>
  );
}

/**
 * Sortable table alternative to WorldMap's choropleth — same data (CountryStats),
 * same onCountrySelect click-through behavior, for users who'd rather scan/sort a
 * list than read a map (requested alongside the country-view landing page, but
 * useful independently of it — see WorldMap.tsx's Map/List toggle).
 */
// Stable empty default: an inline [] would be a fresh array every render and
// would bust the regionCodes memo below on each one.
const EMPTY_REGIONS: string[] = [];

export default function CountryStatsList({
  stats,
  selectedCountries,
  onCountrySelect,
  speciesLabel = "# Assessed",
  showOutdatedMode = true,
  regionsFilter = EMPTY_REGIONS,
  sortKey: controlledSortKey,
  sortDir: controlledSortDir,
  onSortChange,
}: CountryStatsListProps) {
  const [localSortKey, setLocalSortKey] = useState<SortKey>("species");
  const [localSortDir, setLocalSortDir] = useState<SortDir>("desc");
  const sortKey = controlledSortKey ?? localSortKey;
  const sortDir = controlledSortDir ?? localSortDir;
  const [page, setPage] = useState(0);

  // Per-column min/max — local only (not URL-synced like sort), same as the
  // map's own search/zoom state; narrowing the list this way is a scratch
  // exploration, not something worth making a shareable link out of.
  const [speciesFilter, setSpeciesFilter] = useState<RangeFilter>(EMPTY_RANGE);
  const [outdatedFilter, setOutdatedFilter] = useState<RangeFilter>(EMPTY_RANGE);
  const [percentOutdatedFilter, setPercentOutdatedFilter] = useState<RangeFilter>(EMPTY_RANGE);

  // Which column's filter popover is open (at most one at a time) + where to
  // portal it — computed from the clicked icon's own bounding rect, same
  // "fixed + getBoundingClientRect" pattern TaxaSummary's column-toggle menu
  // uses, so it escapes this table's own overflow-auto/table-fixed clipping.
  const [openFilterKey, setOpenFilterKey] = useState<FilterKey | null>(null);
  const [filterMenuPos, setFilterMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const filterConfigs: Record<FilterKey, { value: RangeFilter; onChange: (next: RangeFilter) => void }> = {
    species: { value: speciesFilter, onChange: setSpeciesFilter },
    outdated: { value: outdatedFilter, onChange: setOutdatedFilter },
    percentOutdated: { value: percentOutdatedFilter, onChange: setPercentOutdatedFilter },
  };

  function toggleFilterMenu(key: FilterKey, e: React.MouseEvent<HTMLButtonElement>) {
    if (openFilterKey === key) {
      setOpenFilterKey(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setFilterMenuPos({ top: rect.bottom + 4, left: Math.max(4, rect.right - 150) });
    setOpenFilterKey(key);
  }

  // Close the filter popover on outside click — same pattern as TaxaSummary's
  // column-toggle menu / WorldMap's search dropdown.
  useEffect(() => {
    if (!openFilterKey) return;
    const handler = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setOpenFilterKey(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openFilterKey]);

  const regionCodes = useMemo(
    () => (regionsFilter.length
      ? new Set(regionsFilter.flatMap((r) => iucnRegionCountries(r)))
      : null),
    [regionsFilter]
  );

  const rows = useMemo(() => {
    return Object.entries(stats)
      .filter(([code, s]) => s.species > 0 && (!regionCodes || regionCodes.has(code)))
      .map(([code, s]) => ({
        code,
        name: ALPHA2_TO_NAME[code] ?? code,
        species: s.species,
        outdated: s.outdated ?? 0,
        percentOutdated: percentOutdatedOf(s.species, s.outdated ?? 0),
      }));
  }, [stats, regionCodes]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) =>
      inRange(r.species, speciesFilter) &&
      (!showOutdatedMode || (inRange(r.outdated, outdatedFilter) && inRange(r.percentOutdated, percentOutdatedFilter)))
    );
  }, [rows, speciesFilter, outdatedFilter, percentOutdatedFilter, showOutdatedMode]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) =>
      sortKey === "name" ? dir * a.name.localeCompare(b.name) : dir * (a[sortKey] - b[sortKey])
    );
  }, [filteredRows, sortKey, sortDir]);

  // Back to page 1 whenever the sort, filters, or the underlying row set
  // changes — otherwise switching sort/region/filters could strand the view
  // on a now-empty page. Adjusted during render (React's documented
  // alternative to an effect that just resets state) via a second piece of
  // state, not a ref — this project's lint rules disallow mutating a ref
  // during render.
  const resetKey = `${sortKey}|${sortDir}|${regionsFilter.join(",")}|${filteredRows.length}|${speciesFilter.min}|${speciesFilter.max}|${outdatedFilter.min}|${outdatedFilter.max}|${percentOutdatedFilter.min}|${percentOutdatedFilter.max}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      const dir = sortDir === "asc" ? "desc" : "asc";
      if (onSortChange) onSortChange(key, dir);
      else setLocalSortDir(dir);
    } else {
      const dir = key === "name" ? "asc" : "desc";
      if (onSortChange) onSortChange(key, dir);
      else { setLocalSortKey(key); setLocalSortDir(dir); }
    }
  }

  const openFilterConfig = openFilterKey ? filterConfigs[openFilterKey] : null;

  return (
    // mb-9 reserves room for WorldMap's floating Map/List toggle, which
    // overlays bottom-left of whichever view is showing (absolutely
    // positioned against the shared card, not this component) — harmless
    // dead space when this list is short, but without it the pagination
    // footer collides with the toggle once the list is tall enough to fill
    // the card (e.g. Country View's now-full-height landing map/list).
    <div className="flex-1 min-h-0 flex flex-col mb-11 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex-1 min-h-0 overflow-auto">
        {/* table-fixed + explicit column-width shares (rather than auto/content-based
            sizing) so the Country column truncates instead of wrapping long names
            ("United States of America") across multiple lines, whatever width this
            ends up at. text-sm + more generous py (up from the text-xs/py-0.5 this
            used to run at) reads properly now that Country View's landing map (and
            this List alternative to it) is flex-1'd to fill the viewport instead of
            a small fixed-height card — cramped micro-text made sense in that small
            card, not in a full-height one. Once a country's picked, the map/list
            card sits in a half-width grid cell with align-items: stretch matching
            the taxa table's own height (see TaxaSummary), so this can still end up
            shorter there — same sizing either way, it just scrolls internally
            (flex-1 min-h-0 overflow-auto below) rather than changing text size to
            fit. Min/max filters live behind each numeric header's filter icon (see
            FilterIconButton) rather than a permanent row, to keep the header compact
            regardless of available height. */}
        <table className="w-full table-fixed text-sm border-collapse">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-10">
            <tr>
              <SortHeader label="Country" active={sortKey === "name"} dir={sortDir} align="left" widthClass={showOutdatedMode ? "w-[34%]" : "w-2/3"} onClick={() => toggleSort("name")} />
              <SortHeader
                label={speciesLabel}
                active={sortKey === "species"}
                dir={sortDir}
                widthClass={showOutdatedMode ? "w-[22%]" : "w-1/3"}
                onClick={() => toggleSort("species")}
                filterButton={
                  <FilterIconButton
                    active={speciesFilter.min !== "" || speciesFilter.max !== ""}
                    isOpen={openFilterKey === "species"}
                    onClick={(e) => toggleFilterMenu("species", e)}
                  />
                }
              />
              {showOutdatedMode && (
                <SortHeader
                  label="# Outdated"
                  active={sortKey === "outdated"}
                  dir={sortDir}
                  widthClass="w-[22%]"
                  onClick={() => toggleSort("outdated")}
                  filterButton={
                    <FilterIconButton
                      active={outdatedFilter.min !== "" || outdatedFilter.max !== ""}
                      isOpen={openFilterKey === "outdated"}
                      onClick={(e) => toggleFilterMenu("outdated", e)}
                    />
                  }
                />
              )}
              {showOutdatedMode && (
                <SortHeader
                  label="% Outdated"
                  active={sortKey === "percentOutdated"}
                  dir={sortDir}
                  widthClass="w-[22%]"
                  onClick={() => toggleSort("percentOutdated")}
                  filterButton={
                    <FilterIconButton
                      active={percentOutdatedFilter.min !== "" || percentOutdatedFilter.max !== ""}
                      isOpen={openFilterKey === "percentOutdated"}
                      onClick={(e) => toggleFilterMenu("percentOutdated", e)}
                    />
                  }
                />
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const isSelected = selectedCountries.has(row.code);
              return (
                <tr
                  key={row.code}
                  onClick={(e) => onCountrySelect(row.code, row.name, e)}
                  className={`cursor-pointer border-b border-zinc-100 dark:border-zinc-800/50 last:border-0 ${
                    isSelected ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 max-w-0">
                    <span className="block truncate" title={row.name}>{row.name}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{row.species.toLocaleString()}</td>
                  {showOutdatedMode && (
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{row.outdated.toLocaleString()}</td>
                  )}
                  {showOutdatedMode && (
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{row.percentOutdated.toFixed(1)}%</td>
                  )}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={showOutdatedMode ? 4 : 2} className="px-2 py-8 text-center text-zinc-400 text-sm">
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-800 text-sm text-zinc-500 dark:text-zinc-400 shrink-0">
          <span>
            {clampedPage * PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              className="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              Prev
            </button>
            <span className="tabular-nums">{clampedPage + 1} / {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={clampedPage >= pageCount - 1}
              className="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              Next
            </button>
          </div>
        </div>
      )}
      {openFilterKey && openFilterConfig && typeof document !== "undefined" && createPortal(
        <div
          ref={filterMenuRef}
          className="fixed z-[9999] flex items-center gap-1 p-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg"
          style={{ top: filterMenuPos.top, left: filterMenuPos.left }}
        >
          <input
            type="number"
            inputMode="decimal"
            value={openFilterConfig.value.min}
            onChange={(e) => openFilterConfig.onChange({ ...openFilterConfig.value, min: e.target.value })}
            placeholder="min"
            aria-label="Minimum"
            autoFocus
            className="w-16 text-xs px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="decimal"
            value={openFilterConfig.value.max}
            onChange={(e) => openFilterConfig.onChange({ ...openFilterConfig.value, max: e.target.value })}
            placeholder="max"
            aria-label="Maximum"
            className="w-16 text-xs px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>,
        document.body
      )}
    </div>
  );
}
