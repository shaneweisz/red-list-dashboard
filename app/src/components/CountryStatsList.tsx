"use client";

import React, { useState, useMemo } from "react";
import { ALPHA2_TO_NAME, type CountryStats } from "./WorldMap";
import { iucnRegionCountries } from "@/lib/regions";

type SortKey = "name" | "species" | "outdated" | "percentOutdated";
type SortDir = "asc" | "desc";

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
  // Narrows rows to one IUCN region's countries — same scope the map already
  // implies via its blue region highlight (see WorldMap's activeRegion).
  regionFilter?: string | null;
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
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  widthClass?: string;
  onClick: () => void;
}) {
  return (
    <th
      className={`text-xs font-medium text-zinc-500 dark:text-zinc-400 px-1.5 py-0.5 cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 whitespace-nowrap overflow-hidden text-ellipsis ${align === "left" ? "text-left" : "text-right"} ${widthClass ?? ""}`}
      onClick={onClick}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      {label}
      <span className="inline-block w-3 text-zinc-400">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>
    </th>
  );
}

// Min/max inputs for one numeric column, in their own header row below the
// sort headers. stopPropagation on click/keydown so typing a filter (or just
// clicking into the field) doesn't trigger the row-level onClick a click on
// the table would otherwise bubble into elsewhere in this component.
function RangeFilterCell({
  value,
  onChange,
}: {
  value: RangeFilter;
  onChange: (next: RangeFilter) => void;
}) {
  return (
    <th className="px-1 py-0.5 font-normal">
      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          inputMode="decimal"
          value={value.min}
          onChange={(e) => onChange({ ...value, min: e.target.value })}
          placeholder="min"
          aria-label="Minimum"
          className="w-0 min-w-0 flex-1 text-[10px] px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <input
          type="number"
          inputMode="decimal"
          value={value.max}
          onChange={(e) => onChange({ ...value, max: e.target.value })}
          placeholder="max"
          aria-label="Maximum"
          className="w-0 min-w-0 flex-1 text-[10px] px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    </th>
  );
}

/**
 * Sortable table alternative to WorldMap's choropleth — same data (CountryStats),
 * same onCountrySelect click-through behavior, for users who'd rather scan/sort a
 * list than read a map (requested alongside the country-view landing page, but
 * useful independently of it — see WorldMap.tsx's Map/List toggle).
 */
export default function CountryStatsList({
  stats,
  selectedCountries,
  onCountrySelect,
  speciesLabel = "# Assessed",
  showOutdatedMode = true,
  regionFilter = null,
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

  const regionCodes = useMemo(
    () => (regionFilter ? new Set(iucnRegionCountries(regionFilter)) : null),
    [regionFilter]
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
  const resetKey = `${sortKey}|${sortDir}|${regionFilter ?? ""}|${filteredRows.length}|${speciesFilter.min}|${speciesFilter.max}|${outdatedFilter.min}|${outdatedFilter.max}|${percentOutdatedFilter.min}|${percentOutdatedFilter.max}`;
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

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex-1 min-h-0 overflow-auto">
        {/* table-fixed + explicit column-width shares (rather than auto/content-based
            sizing) so the Country column truncates instead of wrapping long names
            ("United States of America") across multiple lines — needed now that
            this list has to fit the map's narrower 1/3-width column. Rows use
            text-xs + py-0.5 (down from text-sm/py-1) so PAGE_SIZE rows + header +
            footer land close to the Map view's own natural height — with align-
            items: stretch on the paired grid, taller List content used to drag
            the whole row (map card AND table) up to match, which meant just
            toggling Map/List visibly resized the page. */}
        <table className="w-full table-fixed text-xs border-collapse">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-10">
            <tr>
              <SortHeader label="Country" active={sortKey === "name"} dir={sortDir} align="left" widthClass={showOutdatedMode ? "w-[34%]" : "w-2/3"} onClick={() => toggleSort("name")} />
              <SortHeader label={speciesLabel} active={sortKey === "species"} dir={sortDir} widthClass={showOutdatedMode ? "w-[22%]" : "w-1/3"} onClick={() => toggleSort("species")} />
              {showOutdatedMode && (
                <SortHeader label="# Outdated" active={sortKey === "outdated"} dir={sortDir} widthClass="w-[22%]" onClick={() => toggleSort("outdated")} />
              )}
              {showOutdatedMode && (
                <SortHeader label="% Outdated" active={sortKey === "percentOutdated"} dir={sortDir} widthClass="w-[22%]" onClick={() => toggleSort("percentOutdated")} />
              )}
            </tr>
            <tr className="border-t border-zinc-200 dark:border-zinc-800">
              <th className="px-1.5 py-0.5" />
              <RangeFilterCell value={speciesFilter} onChange={setSpeciesFilter} />
              {showOutdatedMode && <RangeFilterCell value={outdatedFilter} onChange={setOutdatedFilter} />}
              {showOutdatedMode && <RangeFilterCell value={percentOutdatedFilter} onChange={setPercentOutdatedFilter} />}
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
                  <td className="px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 max-w-0">
                    <span className="block truncate" title={row.name}>{row.name}</span>
                  </td>
                  <td className="px-1.5 py-0.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{row.species.toLocaleString()}</td>
                  {showOutdatedMode && (
                    <td className="px-1.5 py-0.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{row.outdated.toLocaleString()}</td>
                  )}
                  {showOutdatedMode && (
                    <td className="px-1.5 py-0.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{row.percentOutdated.toFixed(1)}%</td>
                  )}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={showOutdatedMode ? 4 : 2} className="px-2 py-6 text-center text-zinc-400 text-xs">
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 && (
        <div className="flex items-center justify-between px-2 py-0.5 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
          <span>
            {clampedPage * PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              Prev
            </button>
            <span className="tabular-nums">{clampedPage + 1} / {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={clampedPage >= pageCount - 1}
              className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
