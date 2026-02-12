"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";

/**
 * Hook that syncs filter state with URL search parameters,
 * enabling shareable/bookmarkable filtered views.
 *
 * Reads initial values from URL on mount and provides setters
 * that update both React state and URL simultaneously.
 */
export function useFilterParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Track whether we're currently updating to avoid loops
  const isUpdatingRef = useRef(false);

  // Parse current URL params into filter state
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

  // Build new URL from params, preserving the hash
  const buildUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
    },
    [searchParams, pathname]
  );

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      if (isUpdatingRef.current) return;
      isUpdatingRef.current = true;
      // Use replace to avoid polluting browser history on every filter click
      router.replace(buildUrl(updates), { scroll: false });
      // Reset flag after a tick
      requestAnimationFrame(() => {
        isUpdatingRef.current = false;
      });
    },
    [router, buildUrl]
  );

  // Setters that update URL

  const setCategories = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === "function" ? updater(categories) : updater;
      const val = [...next].join(",");
      updateUrl({ categories: val || null });
    },
    [categories, updateUrl]
  );

  const setYearRanges = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === "function" ? updater(yearRanges) : updater;
      const val = [...next].join(",");
      updateUrl({ years: val || null });
    },
    [yearRanges, updateUrl]
  );

  const setCountries = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === "function" ? updater(countries) : updater;
      const val = [...next].join(",");
      updateUrl({ countries: val || null });
    },
    [countries, updateUrl]
  );

  const setSearch = useCallback(
    (value: string) => {
      updateUrl({ search: value || null });
    },
    [updateUrl]
  );

  const setSort = useCallback(
    (field: "year" | "category" | null, direction: "asc" | "desc") => {
      updateUrl({
        // "year" is the default so we can omit it to keep URLs clean.
        // "none" means explicitly no sort.
        sort: field === null ? "none" : field === "year" ? null : field,
        dir: field ? direction : null,
      });
    },
    [updateUrl]
  );

  const clearAllFilters = useCallback(() => {
    updateUrl({
      categories: null,
      years: null,
      countries: null,
      search: null,
      sort: null,
      dir: null,
    });
  }, [updateUrl]);

  return {
    // Current values (derived from URL)
    selectedCategories: categories,
    selectedYearRanges: yearRanges,
    selectedCountries: countries,
    searchFilter: search,
    sortField: sort,
    sortDirection: dir,

    // Setters (update URL)
    setSelectedCategories: setCategories,
    setSelectedYearRanges: setYearRanges,
    setSelectedCountries: setCountries,
    setSearchFilter: setSearch,
    setSort,
    clearAllFilters,
  };
}
