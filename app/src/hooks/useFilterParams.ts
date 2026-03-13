"use client";

import { useState, useCallback, useEffect } from "react";

// --- URL parsing helpers ---

export function parseParams(search: string) {
  const p = new URLSearchParams(search);
  const sortParam = p.get("sort");
  return {
    taxa: p.get("taxa")
      ? new Set(p.get("taxa")!.split(",").filter(Boolean))
      : new Set<string>(),
    categories: p.get("categories")
      ? new Set(p.get("categories")!.split(",").filter(Boolean))
      : new Set<string>(),
    yearRanges: p.get("years")
      ? new Set(p.get("years")!.split(",").filter(Boolean))
      : new Set<string>(),
    countries: p.get("countries")
      ? new Set(p.get("countries")!.split(",").filter(Boolean))
      : new Set<string>(),
    obsRanges: p.get("obsRanges")
      ? new Set(p.get("obsRanges")!.split(",").filter(Boolean))
      : new Set<string>(),
    search: p.get("search") || "",
    sortField: (
      sortParam === "category" ? "category" :
      sortParam === "year" ? "year" :
      sortParam === "newGbif" ? "newGbif" :
      sortParam === "pctNewGbif" ? "pctNewGbif" :
      null
    ) as "year" | "category" | "newGbif" | "pctNewGbif" | null,
    sortDirection: (p.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
}

export function buildQs(state: {
  taxa: Set<string>;
  categories: Set<string>;
  yearRanges: Set<string>;
  countries: Set<string>;
  obsRanges: Set<string>;
  search: string;
  sortField: "year" | "category" | "newGbif" | "pctNewGbif" | null;
  sortDirection: "asc" | "desc";
}): string {
  const p = new URLSearchParams();
  if (state.taxa.size > 0) p.set("taxa", [...state.taxa].join(","));
  if (state.categories.size > 0) p.set("categories", [...state.categories].join(","));
  if (state.yearRanges.size > 0) p.set("years", [...state.yearRanges].join(","));
  if (state.countries.size > 0) p.set("countries", [...state.countries].join(","));
  if (state.obsRanges.size > 0) p.set("obsRanges", [...state.obsRanges].join(","));
  if (state.search) p.set("search", state.search);
  // null / "year" desc is the default — only write non-default sort to URL
  const isDefaultSort = state.sortField === null || state.sortField === "year";
  if (!isDefaultSort) {
    p.set("sort", state.sortField!);
    if (state.sortDirection !== "desc") p.set("dir", state.sortDirection);
  } else if (state.sortDirection !== "desc") {
    p.set("dir", state.sortDirection);
  }
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Hook that syncs filter state with URL search parameters,
 * enabling shareable/bookmarkable filtered views.
 *
 * Uses local useState for instant UI updates and native
 * history.replaceState/pushState to sync the URL — no Next.js
 * router overhead.
 *
 * Example URL: /?taxa=mammalia&categories=CR,EN&years=11-20+years&search=shrew
 */
export function useFilterParams() {
  // Initialize with empty state (SSR-safe), hydrate from URL in effect
  const [state, setState] = useState(() => parseParams(""));

  // Hydrate from URL on mount + sync on popstate (back/forward button)
  useEffect(() => {
    setState(parseParams(window.location.search));
    const onPopState = () => {
      setState(parseParams(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Write URL silently (no Next.js navigation, no re-render loop)
  const syncUrl = useCallback((newState: typeof state, push: boolean) => {
    const url = window.location.pathname + buildQs(newState);
    if (push) {
      window.history.pushState(null, "", url);
    } else {
      window.history.replaceState(null, "", url);
    }
  }, []);

  // --- Setters: update local state instantly, sync URL in background ---

  const setSelectedTaxa = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextTaxa = typeof updater === "function" ? updater(prev.taxa) : updater;
        const next = { ...prev, taxa: nextTaxa };
        queueMicrotask(() => syncUrl(next, true)); // push so back button works
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedCategories = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextCats = typeof updater === "function" ? updater(prev.categories) : updater;
        const next = { ...prev, categories: nextCats };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedYearRanges = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextYears = typeof updater === "function" ? updater(prev.yearRanges) : updater;
        const next = { ...prev, yearRanges: nextYears };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedCountries = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextCountries = typeof updater === "function" ? updater(prev.countries) : updater;
        const next = { ...prev, countries: nextCountries };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedObsRanges = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextObsRanges = typeof updater === "function" ? updater(prev.obsRanges) : updater;
        const next = { ...prev, obsRanges: nextObsRanges };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSearchFilter = useCallback(
    (value: string) => {
      setState(prev => {
        const next = { ...prev, search: value };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSort = useCallback(
    (field: "year" | "category" | "newGbif" | "pctNewGbif" | null, direction: "asc" | "desc") => {
      setState(prev => {
        const next = { ...prev, sortField: field, sortDirection: direction };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const clearAllFilters = useCallback(() => {
    setState(prev => {
      const next = {
        ...prev,
        categories: new Set<string>(),
        yearRanges: new Set<string>(),
        countries: new Set<string>(),
        obsRanges: new Set<string>(),
        search: "",
        sortField: null,
        sortDirection: "desc" as const,
      };
      queueMicrotask(() => syncUrl(next, false));
      return next;
    });
  }, [syncUrl]);

  const clearAllFiltersAndTaxa = useCallback(() => {
    setState(prev => {
      const next = {
        ...prev,
        taxa: new Set<string>(),
        categories: new Set<string>(),
        yearRanges: new Set<string>(),
        countries: new Set<string>(),
        obsRanges: new Set<string>(),
        search: "",
        sortField: null,
        sortDirection: "desc" as const,
      };
      queueMicrotask(() => syncUrl(next, true));
      return next;
    });
  }, [syncUrl]);

  return {
    selectedTaxa: state.taxa,
    selectedCategories: state.categories,
    selectedYearRanges: state.yearRanges,
    selectedCountries: state.countries,
    selectedObsRanges: state.obsRanges,
    searchFilter: state.search,
    sortField: state.sortField,
    sortDirection: state.sortDirection,

    setSelectedTaxa,
    setSelectedCategories,
    setSelectedYearRanges,
    setSelectedCountries,
    setSelectedObsRanges,
    setSearchFilter,
    setSort,
    clearAllFilters,
    clearAllFiltersAndTaxa,
  };
}
