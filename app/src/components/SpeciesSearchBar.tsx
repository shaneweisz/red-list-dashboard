"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { buildQs, type ViewMode } from "../hooks/useFilterParams";
import { CATEGORY_COLORS } from "../config/taxa";
import { findNode } from "../lib/taxonomy-utils";

interface SearchResult {
  id: number;
  scientific_name: string;
  common_name: string | null;
  taxon_id: string;
  taxon_group: string;
  category: string;
  gbif_species_key: number | null;
  assessment_id: number | null;
  assessment_date: string | null;
  countries: string[];
  matched_synonym?: string | null;
}

// A higher-rank taxon (class/order/family) the query matched — pinned above the
// species hits. Selecting it browses the whole taxon via ?taxa=<taxon>.
interface TaxonSuggestion {
  name: string;
  rank: "class" | "order" | "family";
  taxon: string;
}

/**
 * Module-level cache of the last selected search result.
 * RedListView reads this to construct the preview without an API call.
 */
let lastSelectedResult: SearchResult | null = null;
export function getLastSearchResult(): SearchResult | null {
  return lastSelectedResult;
}
export function clearLastSearchResult(): void {
  lastSelectedResult = null;
}

export function SpeciesSearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [taxaResults, setTaxaResults] = useState<TaxonSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Warm-start: pre-load the search index on mount so first search is fast
  useEffect(() => {
    fetch("/api/search/warm").catch(() => {});
  }, []);

  // Debounced fetch
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setTaxaResults([]);
      setIsOpen(false);
      return;
    }

    const timeout = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=10`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setResults(data.results);
        setTaxaResults(data.taxa ?? []);
        setIsOpen(true);
        setHighlightIndex(-1);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setResults([]);
        setTaxaResults([]);
        setIsOpen(false);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      abortRef.current?.abort();
    };
  }, [query]);

  // Click outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectResult = useCallback(
    (result: SearchResult) => {
      lastSelectedResult = result;
      const viewMode: ViewMode = result.category === "NE" ? "new-assessments" : "reassessments";

      // Build URL with species selected — all filter state is driven from the URL
      const qs = buildQs({
        viewMode,
        taxa: new Set([result.taxon_id]),
        subgroups: new Set(),
        categories: new Set(),
        yearRanges: new Set(),
        assessmentYears: new Set(),
        describedYears: new Set(),
        countries: new Set(),
        obsRanges: new Set(),
        systems: new Set(),
        populationTrends: new Set(),
        movementPatterns: new Set(),
        threats: new Set(),
        endemicsOnly: false,
        growthForms: new Set(),
        assessors: new Set(),
        reviewers: new Set(),
        search: result.scientific_name,
        sortField: null,
        sortDirection: "desc",
        species: result.id,
        tab: "gbif",
      });

      window.history.pushState(null, "", "/" + qs);
      window.dispatchEvent(new PopStateEvent("popstate"));

      setQuery("");
      setResults([]);
      setTaxaResults([]);
      setIsOpen(false);
    },
    []
  );

  // Browse a whole higher-rank taxon (e.g. Felidae): navigate to ?taxa=<taxon> in the
  // arbitrary-rank taxon flows through resolveWhere → querySpecies just like a
  // curated node; no species is preselected. Preserve the current view: from the
  // new-assessments view, browsing a taxon shows its not-evaluated species (charts
  // come from the assessed/reassessments view).
  const selectTaxon = useCallback((t: TaxonSuggestion) => {
    const currentView: ViewMode =
      new URLSearchParams(window.location.search).get("view") === "new-assessments"
        ? "new-assessments"
        : "reassessments";
    const qs = buildQs({
      viewMode: currentView,
      taxa: new Set([t.taxon]),
      subgroups: new Set(),
      categories: new Set(),
      yearRanges: new Set(),
      assessmentYears: new Set(),
      describedYears: new Set(),
      countries: new Set(),
      obsRanges: new Set(),
      systems: new Set(),
      populationTrends: new Set(),
      movementPatterns: new Set(),
      threats: new Set(),
      endemicsOnly: false,
      growthForms: new Set(),
      assessors: new Set(),
      reviewers: new Set(),
      search: "",
      sortField: null,
      sortDirection: "desc",
      species: null,
      tab: null,
    });
    window.history.pushState(null, "", "/" + qs);
    window.dispatchEvent(new PopStateEvent("popstate"));

    setQuery("");
    setResults([]);
    setTaxaResults([]);
    setIsOpen(false);
  }, []);

  // Keyboard navigation runs over a single combined list: taxon suggestions first,
  // then species. An index < taxaResults.length picks a taxon; the rest pick species.
  const totalItems = taxaResults.length + results.length;
  const activateIndex = (i: number) => {
    if (i < taxaResults.length) selectTaxon(taxaResults[i]);
    else selectResult(results[i - taxaResults.length]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || totalItems === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i < totalItems - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : totalItems - 1));
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      activateIndex(highlightIndex);
    } else if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  function getTaxonLabel(taxonId: string): string {
    const node = findNode(taxonId);
    return node?.name ?? taxonId;
  }

  return (
    <div ref={containerRef} className="relative w-full sm:w-[18.23rem] md:w-[21.87rem]">
      <div className="relative">
        {/* Magnifying glass icon */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search for a species or taxon..."
          className="w-full pl-10 pr-8 py-1.5 text-base rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500"
        />
        {/* Clear button */}
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setTaxaResults([]);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {/* Loading spinner */}
        {loading && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 rounded-full animate-spin border-2 border-zinc-300 dark:border-zinc-600" style={{ borderTopColor: 'transparent' }} />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg">
          {/* Higher-rank taxon suggestions, pinned above species hits */}
          {taxaResults.map((t, i) => (
            <button
              key={`taxon-${t.rank}-${t.taxon}`}
              onClick={() => selectTaxon(t)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-700/60 ${
                i === highlightIndex
                  ? "bg-zinc-100 dark:bg-zinc-700"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
              }`}
            >
              <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h6" />
              </svg>
              <span className="flex-1 min-w-0 text-zinc-900 dark:text-zinc-100">
                Browse <span className="font-medium">{t.name}</span>
              </span>
              <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {t.rank}
              </span>
            </button>
          ))}
          {results.length === 0 && taxaResults.length === 0 && !loading ? (
            <div className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
              No species found
            </div>
          ) : (
            results.map((result, ri) => {
              const i = taxaResults.length + ri;
              return (
              <button
                key={`${result.id}-${result.taxon_group}`}
                onClick={() => selectResult(result)}
                onMouseEnter={() => setHighlightIndex(i)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  i === highlightIndex
                    ? "bg-zinc-100 dark:bg-zinc-700"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <span className="italic text-zinc-900 dark:text-zinc-100">
                    {result.scientific_name}
                  </span>
                  {result.common_name && (
                    <span className="text-zinc-500 dark:text-zinc-400 ml-1">
                      ({result.common_name})
                    </span>
                  )}
                  {result.matched_synonym && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-1">
                      syn. <span className="italic">{result.matched_synonym}</span>
                    </span>
                  )}
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-2">
                    {getTaxonLabel(result.taxon_id)}
                  </span>
                </div>
                {/* Category badge */}
                <span
                  className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: CATEGORY_COLORS[result.category] ?? "#6b7280",
                    color: ["VU", "NT", "LC", "NE"].includes(result.category) ? "#18181b" : "#ffffff",
                  }}
                >
                  {result.category}
                </span>
              </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
