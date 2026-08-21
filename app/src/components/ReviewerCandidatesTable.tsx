"use client";

import { useState, useEffect, useMemo } from "react";
import { countriesToRegions, regionColor, countryToRegion } from "@/lib/regions";
import { ALPHA2_TO_NAME } from "@/lib/countries";
import { getViewRootForNode } from "@/lib/taxonomy-utils";

interface ReviewerCountryCandidate {
  name: string;
  regionCounts: Record<string, number>;
  countryCounts: Record<string, number>;
  totalInRegion: number;
  totalAll: number;
  latestDate: string;
}

interface ReviewerCandidatesTableProps {
  taxaId: string;
  taxaName: string;
  countries: string[];
}

type SortField = "totalInRegion" | "totalAll";

const PAGE_SIZE = 10;

export default function ReviewerCandidatesTable({
  taxaId,
  taxaName,
  countries,
}: ReviewerCandidatesTableProps) {
  const [candidates, setCandidates] = useState<ReviewerCountryCandidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortField>("totalInRegion");

  const countriesKey = countries.join(";");
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
      taxaId,
      countries: countries.join(";"),
    });

    fetch(`/api/redlist/reviewer-candidates-by-country?${params}`, { signal: controller.signal })
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
  }, [taxaId, countriesKey]);

  const sorted = useMemo(() => {
    if (!candidates) return [];
    return [...candidates].sort((a, b) => {
      const diff = b[sortBy] - a[sortBy];
      if (diff !== 0) return diff;
      return b.latestDate.localeCompare(a.latestDate);
    });
  }, [candidates, sortBy]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = useMemo(
    () => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [sorted, page]
  );

  const handleSort = (field: SortField) => {
    setSortBy(field);
    setPage(0);
  };

  const sortIndicator = (field: SortField) => sortBy === field ? " ▼" : "";

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
        Failed to load reviewer candidates
      </div>
    );
  }

  if (!candidates || candidates.length === 0) {
    return (
      <div className="text-sm text-zinc-400 italic p-4">
        No reviewer candidates found
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 pt-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
            <th className="py-2 pr-3 font-medium">Reviewer</th>
            <th
              className="py-2 px-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              onClick={() => handleSort("totalAll")}
            >
              Total {taxaName} Reviewed{sortIndicator("totalAll")}
            </th>
            <th
              className="py-2 px-3 font-medium text-right cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              onClick={() => handleSort("totalInRegion")}
            >
              {taxaName} Reviewed in Region{sortIndicator("totalInRegion")}
            </th>
            <th className="py-2 px-3 font-medium">Regions</th>
            <th className="py-2 pl-3 font-medium text-right">Last Assessment</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((c) => {
            const coveredRegions = regions.filter((r) => (c.regionCounts[r] ?? 0) > 0);

            // Group country counts by region for tooltips
            const countriesByRegion: Record<string, string[]> = {};
            for (const [code, count] of Object.entries(c.countryCounts)) {
              const region = countryToRegion(code);
              if (!countriesByRegion[region]) countriesByRegion[region] = [];
              const name = ALPHA2_TO_NAME[code] ?? code;
              countriesByRegion[region].push(`${name} (${count})`);
            }
            const year = c.latestDate
              ? new Date(c.latestDate).getFullYear().toString()
              : "—";

            return (
              <tr
                key={c.name}
                className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                onClick={() => {
                  const viewRoot = getViewRootForNode(taxaId);
                  const taxaParam = viewRoot ?? taxaId;
                  const subgroupParam = viewRoot && viewRoot !== taxaId ? `&subgroups=${encodeURIComponent(taxaId)}` : "";
                  window.open(
                    `/?taxa=${encodeURIComponent(taxaParam)}${subgroupParam}&reviewers=${encodeURIComponent(c.name).replace(/%2C/g, ",")}`,
                    "_blank"
                  );
                }}
              >
                <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200 truncate max-w-[200px]" title={c.name}>
                  {c.name}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {c.totalAll}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {c.totalInRegion}
                </td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {coveredRegions.map((r) => (
                      <span
                        key={r}
                        className="group/tip relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-600 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800"
                      >
                        <span
                          className="w-2 h-2 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: regionColor(r) }}
                        />
                        {r}
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-200 shadow-lg z-50">
                          {countriesByRegion[r]?.join(", ") ?? r}
                        </span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 pl-3 text-right tabular-nums text-zinc-400">
                  {year}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
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
