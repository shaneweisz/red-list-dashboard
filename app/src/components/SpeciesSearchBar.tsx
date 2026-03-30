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
  order_name: string | null;
  class_name: string | null;
  family: string | null;
}

export function SpeciesSearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
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
        setIsOpen(true);
        setHighlightIndex(-1);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setResults([]);
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
      const viewMode: ViewMode = result.category === "NE" ? "new-assessments" : "reassessments";

      // Build URL with species selected — all filter state is driven from the URL
      const qs = buildQs({
        viewMode,
        taxa: new Set([result.taxon_id]),
        subgroups: new Set(),
        categories: new Set(),
        yearRanges: new Set(),
        countries: new Set(),
        obsRanges: new Set(),
        systems: new Set(),
        populationTrends: new Set(),
        movementPatterns: new Set(),
        threats: new Set(),
        hasMap: null,
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
      setIsOpen(false);
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      selectResult(results[highlightIndex]);
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
    <div ref={containerRef} className="relative w-full sm:w-[26rem]">
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
          placeholder="Search for any species..."
          className="w-full pl-10 pr-8 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500"
        />
        {/* Clear button */}
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
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
            <div className="h-4 w-4 border-2 border-zinc-300 dark:border-zinc-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg">
          {results.length === 0 && !loading ? (
            <div className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
              No species found
            </div>
          ) : (
            results.map((result, i) => (
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
