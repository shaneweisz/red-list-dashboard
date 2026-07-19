"use client";

import React, { useState, useMemo } from "react";
import { ALPHA2_TO_NAME, type CountryStats } from "./WorldMap";

interface CountryStatsListProps {
  stats: CountryStats;
  selectedCountries: Set<string>;
  onCountrySelect: (countryCode: string, countryName: string, event: React.MouseEvent) => void;
  speciesLabel?: string;
  showOutdatedMode?: boolean;
}

type SortKey = "name" | "species" | "outdated" | "percentOutdated";
type SortDir = "asc" | "desc";

function percentOutdatedOf(species: number, outdated: number): number {
  return species > 0 ? (outdated / species) * 100 : 0;
}

function SortHeader({
  label,
  active,
  dir,
  align = "right",
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <th
      className={`text-xs font-medium text-zinc-500 dark:text-zinc-400 px-2 py-1.5 cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 whitespace-nowrap ${align === "left" ? "text-left" : "text-right"}`}
      onClick={onClick}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      {label}
      <span className="inline-block w-3 text-zinc-400">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>
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
}: CountryStatsListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("species");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    return Object.entries(stats)
      .filter(([, s]) => s.species > 0)
      .map(([code, s]) => ({
        code,
        name: ALPHA2_TO_NAME[code] ?? code,
        species: s.species,
        outdated: s.outdated ?? 0,
        percentOutdated: percentOutdatedOf(s.species, s.outdated ?? 0),
      }));
  }, [stats]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) =>
      sortKey === "name" ? dir * a.name.localeCompare(b.name) : dir * (a[sortKey] - b[sortKey])
    );
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <div className="flex-1 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-10">
          <tr>
            <SortHeader label="Country" active={sortKey === "name"} dir={sortDir} align="left" onClick={() => toggleSort("name")} />
            <SortHeader label={speciesLabel} active={sortKey === "species"} dir={sortDir} onClick={() => toggleSort("species")} />
            {showOutdatedMode && (
              <SortHeader label="# Outdated" active={sortKey === "outdated"} dir={sortDir} onClick={() => toggleSort("outdated")} />
            )}
            {showOutdatedMode && (
              <SortHeader label="% Outdated" active={sortKey === "percentOutdated"} dir={sortDir} onClick={() => toggleSort("percentOutdated")} />
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const isSelected = selectedCountries.has(row.code);
            return (
              <tr
                key={row.code}
                onClick={(e) => onCountrySelect(row.code, row.name, e)}
                className={`cursor-pointer border-b border-zinc-100 dark:border-zinc-800/50 last:border-0 ${
                  isSelected ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                <td className="px-2 py-1 text-zinc-700 dark:text-zinc-300">{row.name}</td>
                <td className="px-2 py-1 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{row.species.toLocaleString()}</td>
                {showOutdatedMode && (
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{row.outdated.toLocaleString()}</td>
                )}
                {showOutdatedMode && (
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{row.percentOutdated.toFixed(1)}%</td>
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
  );
}
