"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";

/**
 * Hook that syncs filter state with URL search parameters,
 * enabling shareable/bookmarkable filtered views.
 *
 * Reads initial values from URL on mount and provides setters
 * that update both React state and URL simultaneously.
 *
 * Example URL: /?taxa=mammalia&categories=CR,EN&years=11-20+years&search=shrew
 */
export function useFilterParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Keep a ref to the latest params so rapid updates don't read stale state.
  // After each URL update we write the new params here immediately, so the
  // next update within the same render cycle sees the correct baseline.
  const pendingParamsRef = useRef<URLSearchParams | null>(null);

  // --- Read current URL params into filter state ---

  const taxa = searchParams.get("taxa") || null;

  const categories = useMemo(() => {
    const val = searchParams.get("categories");
    return val ? new Set(val.split(",").filter(Boolean)) : new Set<string>();
  }, [searchParams]);

  const yearRanges = useMemo(() => {
    const val = searchParams.get("years");
    return val ? new Set(val.split(",").map(decodeURIComponent).filter(Boolean)) : new Set<string>();
  }, [searchParams]);

  const countries = useMemo(() => {
    const val = searchParams.get("countries");
    return val ? new Set(val.split(",").filter(Boolean)) : new Set<string>();
  }, [searchParams]);

  const search = searchParams.get("search") || "";

  // Default sort is by year descending (matching original behavior).
  // "none" in URL means explicitly no sort; absent param means default (year).
  const sortParam = searchParams.get("sort");
  const sort: "year" | "category" | null =
    sortParam === "none" ? null :
    sortParam === "category" ? "category" :
    "year"; // default when absent or "year"
  const dir = (searchParams.get("dir") as "asc" | "desc") || "desc";

  // --- URL update helpers ---

  // Get the current baseline params — either from a pending (not yet reflected)
  // update, or from the actual current URL.
  const getCurrentParams = useCallback(() => {
    if (pendingParamsRef.current) {
      return new URLSearchParams(pendingParamsRef.current.toString());
    }
    // Read from window.location for freshness (searchParams from the hook
    // may lag behind after router.replace).
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search);
    }
    return new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  const applyUpdates = useCallback(
    (updates: Record<string, string | null>, push = false) => {
      const params = getCurrentParams();
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      // Store as pending so subsequent calls in the same tick see this state
      pendingParamsRef.current = params;

      const qs = params.toString();
      const url = `${pathname}${qs ? `?${qs}` : ""}`;

      if (push) {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }

      // Clear pending ref after React has a chance to re-render with new searchParams
      requestAnimationFrame(() => {
        pendingParamsRef.current = null;
      });
    },
    [getCurrentParams, pathname, router]
  );

  // --- Setters ---

  const setTaxa = useCallback(
    (value: string | null) => {
      // Use push for taxon changes so the back button works
      applyUpdates({ taxa: value }, true);
    },
    [applyUpdates]
  );

  const setCategories = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === "function" ? updater(categories) : updater;
      const val = [...next].join(",");
      applyUpdates({ categories: val || null });
    },
    [categories, applyUpdates]
  );

  const setYearRanges = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === "function" ? updater(yearRanges) : updater;
      const val = [...next].join(",");
      applyUpdates({ years: val || null });
    },
    [yearRanges, applyUpdates]
  );

  const setCountries = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === "function" ? updater(countries) : updater;
      const val = [...next].join(",");
      applyUpdates({ countries: val || null });
    },
    [countries, applyUpdates]
  );

  const setSearch = useCallback(
    (value: string) => {
      applyUpdates({ search: value || null });
    },
    [applyUpdates]
  );

  const setSort = useCallback(
    (field: "year" | "category" | null, direction: "asc" | "desc") => {
      applyUpdates({
        // "year" is the default so we can omit it to keep URLs clean.
        // "none" means explicitly no sort.
        sort: field === null ? "none" : field === "year" ? null : field,
        dir: field ? direction : null,
      });
    },
    [applyUpdates]
  );

  const clearAllFilters = useCallback(() => {
    applyUpdates({
      categories: null,
      years: null,
      countries: null,
      search: null,
      sort: null,
      dir: null,
    });
  }, [applyUpdates]);

  return {
    // Current values (derived from URL)
    selectedTaxon: taxa,
    selectedCategories: categories,
    selectedYearRanges: yearRanges,
    selectedCountries: countries,
    searchFilter: search,
    sortField: sort,
    sortDirection: dir,

    // Setters (update URL)
    setSelectedTaxon: setTaxa,
    setSelectedCategories: setCategories,
    setSelectedYearRanges: setYearRanges,
    setSelectedCountries: setCountries,
    setSearchFilter: setSearch,
    setSort,
    clearAllFilters,
  };
}
