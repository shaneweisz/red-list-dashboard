"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { canonicalizeTaxonId } from "@/lib/data/taxonomy-constants";

// --- URL parsing helpers ---

export type ViewMode = "reassessments" | "new-assessments";

export function parseParams(search: string) {
  const p = new URLSearchParams(search);
  const sortParam = p.get("sort");
  const viewParam = p.get("view");
  return {
    viewMode: (viewParam === "new-assessments" ? "new-assessments" : "reassessments") as ViewMode,
    // Map legacy IDs (e.g. mammalia → mammals) so old shared/bookmarked URLs keep working.
    taxa: p.get("taxa")
      ? new Set(p.get("taxa")!.split(",").filter(Boolean).map(canonicalizeTaxonId))
      : new Set<string>(),
    subgroups: p.get("subgroups")
      ? new Set(p.get("subgroups")!.split(",").filter(Boolean).map(canonicalizeTaxonId))
      : new Set<string>(),
    categories: p.get("categories")
      ? new Set(p.get("categories")!.split(",").filter(Boolean))
      : new Set<string>(),
    yearRanges: p.get("years")
      ? new Set(p.get("years")!.split(",").filter(Boolean))
      : new Set<string>(),
    assessmentYears: p.get("assessmentYears")
      ? new Set(p.get("assessmentYears")!.split(",").filter(Boolean))
      : new Set<string>(),
    // CoL description-year range buckets (NE/new-assessments view only).
    describedYears: p.get("describedYears")
      ? new Set(p.get("describedYears")!.split(",").filter(Boolean))
      : new Set<string>(),
    countries: p.get("countries")
      ? new Set(p.get("countries")!.split(",").filter(Boolean))
      : new Set<string>(),
    obsRanges: p.get("obsRanges")
      ? new Set(p.get("obsRanges")!.split(",").filter(Boolean))
      : new Set<string>(),
    systems: p.get("systems")
      ? new Set(p.get("systems")!.split(",").filter(Boolean))
      : new Set<string>(),
    populationTrends: p.get("trends")
      ? new Set(p.get("trends")!.split(",").filter(Boolean))
      : new Set<string>(),
    movementPatterns: p.get("movement")
      ? new Set(p.get("movement")!.split(",").filter(Boolean))
      : new Set<string>(),
    threats: p.get("threats")
      ? new Set(p.get("threats")!.split(",").filter(Boolean))
      : new Set<string>(),
    hasMap: p.get("hasMap") as "yes" | "no" | null,
    growthForms: p.get("growthForms")
      ? new Set(p.get("growthForms")!.split(",").filter(Boolean))
      : new Set<string>(),
    assessors: p.get("assessors")
      ? new Set(p.get("assessors")!.split("|").filter(Boolean))
      : new Set<string>(),
    reviewers: p.get("reviewers")
      ? new Set(p.get("reviewers")!.split("|").filter(Boolean))
      : new Set<string>(),
    search: p.get("search") || "",
    sortField: (
      sortParam === "category" ? "category" :
      sortParam === "year" ? "year" :
      sortParam === "totalGbif" ? "totalGbif" :
      sortParam === "newGbif" ? "newGbif" :
      sortParam === "pctNewGbif" ? "pctNewGbif" :
      sortParam === "describedYear" ? "describedYear" :
      null
    ) as "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif" | "describedYear" | null,
    sortDirection: (p.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc",
    species: p.get("species") ? Number(p.get("species")) : null,
    tab: (p.get("tab") || null) as "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "col" | null,
  };
}

export function buildQs(state: {
  viewMode: ViewMode;
  taxa: Set<string>;
  subgroups: Set<string>;
  categories: Set<string>;
  yearRanges: Set<string>;
  assessmentYears: Set<string>;
  describedYears: Set<string>;
  countries: Set<string>;
  obsRanges: Set<string>;
  systems: Set<string>;
  populationTrends: Set<string>;
  movementPatterns: Set<string>;
  threats: Set<string>;
  hasMap: "yes" | "no" | null;
  growthForms: Set<string>;
  assessors: Set<string>;
  reviewers: Set<string>;
  search: string;
  sortField: "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif" | "describedYear" | null;
  sortDirection: "asc" | "desc";
  species: number | null;
  tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "col" | null;
}): string {
  const p = new URLSearchParams();
  if (state.viewMode === "new-assessments") p.set("view", "new-assessments");
  if (state.taxa.size > 0) p.set("taxa", [...state.taxa].join(","));
  if (state.subgroups.size > 0) p.set("subgroups", [...state.subgroups].join(","));
  if (state.categories.size > 0) p.set("categories", [...state.categories].join(","));
  if (state.yearRanges.size > 0) p.set("years", [...state.yearRanges].join(","));
  if (state.assessmentYears.size > 0) p.set("assessmentYears", [...state.assessmentYears].join(","));
  if (state.describedYears.size > 0) p.set("describedYears", [...state.describedYears].join(","));
  if (state.countries.size > 0) p.set("countries", [...state.countries].join(","));
  if (state.obsRanges.size > 0) p.set("obsRanges", [...state.obsRanges].join(","));
  if (state.systems.size > 0) p.set("systems", [...state.systems].join(","));
  if (state.populationTrends.size > 0) p.set("trends", [...state.populationTrends].join(","));
  if (state.movementPatterns.size > 0) p.set("movement", [...state.movementPatterns].join(","));
  if (state.threats.size > 0) p.set("threats", [...state.threats].join(","));
  if (state.hasMap) p.set("hasMap", state.hasMap);
  if (state.growthForms.size > 0) p.set("growthForms", [...state.growthForms].join(","));
  if (state.assessors.size > 0) p.set("assessors", [...state.assessors].join("|"));
  if (state.reviewers.size > 0) p.set("reviewers", [...state.reviewers].join("|"));
  if (state.search) p.set("search", state.search);
  if (state.species != null) p.set("species", String(state.species));
  if (state.species != null && state.tab && state.tab !== "gbif") p.set("tab", state.tab);
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
 * Example URL: /?taxa=mammals&categories=CR,EN&years=11-20+years&search=shrew
 */
export function useFilterParams() {
  // Initialize with empty state (SSR-safe), hydrate from URL in effect
  const [state, setState] = useState(() => parseParams(""));

  // Tracks whether the most recent state update came from a popstate (URL navigation).
  // Consumers can check this to avoid clearing URL-driven state.
  const fromPopstateRef = useRef(false);

  // Hydrate from URL on mount + sync on popstate (back/forward button)
  useEffect(() => {
    fromPopstateRef.current = true;
    setState(parseParams(window.location.search)); // eslint-disable-line react-hooks/set-state-in-effect -- hydrate from URL on mount
    const onPopState = () => {
      fromPopstateRef.current = true;
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

  const setSelectedAssessmentYears = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextYears = typeof updater === "function" ? updater(prev.assessmentYears) : updater;
        const next = { ...prev, assessmentYears: nextYears };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedDescribedYears = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextYears = typeof updater === "function" ? updater(prev.describedYears) : updater;
        const next = { ...prev, describedYears: nextYears };
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

  const setSelectedSubgroups = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextSubgroups = typeof updater === "function" ? updater(prev.subgroups) : updater;
        const next = { ...prev, subgroups: nextSubgroups };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedSystems = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextSystems = typeof updater === "function" ? updater(prev.systems) : updater;
        const next = { ...prev, systems: nextSystems };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedPopulationTrends = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextVal = typeof updater === "function" ? updater(prev.populationTrends) : updater;
        const next = { ...prev, populationTrends: nextVal };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedMovementPatterns = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextVal = typeof updater === "function" ? updater(prev.movementPatterns) : updater;
        const next = { ...prev, movementPatterns: nextVal };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedThreats = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextVal = typeof updater === "function" ? updater(prev.threats) : updater;
        const next = { ...prev, threats: nextVal };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedGrowthForms = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextVal = typeof updater === "function" ? updater(prev.growthForms) : updater;
        const next = { ...prev, growthForms: nextVal };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setHasMapFilter = useCallback(
    (value: "yes" | "no" | null) => {
      setState(prev => {
        const next = { ...prev, hasMap: value };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedAssessors = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextAssessors = typeof updater === "function" ? updater(prev.assessors) : updater;
        const next = { ...prev, assessors: nextAssessors };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedReviewers = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextReviewers = typeof updater === "function" ? updater(prev.reviewers) : updater;
        const next = { ...prev, reviewers: nextReviewers };
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

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setState(prev => {
        const next = { ...prev, viewMode: mode };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  const setSort = useCallback(
    (field: "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif" | "describedYear" | null, direction: "asc" | "desc") => {
      setState(prev => {
        const next = { ...prev, sortField: field, sortDirection: direction };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSpeciesParam = useCallback(
    (species: number | null, tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "col" = "gbif") => {
      setState(prev => {
        const next = { ...prev, species, tab: species != null ? tab : null };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  const setTabParam = useCallback(
    (tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "col") => {
      setState(prev => {
        if (prev.species == null) return prev; // no species selected, nothing to update
        const next = { ...prev, tab };
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
        subgroups: new Set<string>(),
        categories: new Set<string>(),
        yearRanges: new Set<string>(),
        assessmentYears: new Set<string>(),
        describedYears: new Set<string>(),
        countries: new Set<string>(),
        obsRanges: new Set<string>(),
        systems: new Set<string>(),
        populationTrends: new Set<string>(),
        movementPatterns: new Set<string>(),
        threats: new Set<string>(),
        hasMap: null,
        growthForms: new Set<string>(),
        assessors: new Set<string>(),
        reviewers: new Set<string>(),
        search: "",
        sortField: null,
        sortDirection: "desc" as const,
        species: null,
        tab: null,
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
        subgroups: new Set<string>(),
        categories: new Set<string>(),
        yearRanges: new Set<string>(),
        assessmentYears: new Set<string>(),
        describedYears: new Set<string>(),
        countries: new Set<string>(),
        obsRanges: new Set<string>(),
        systems: new Set<string>(),
        populationTrends: new Set<string>(),
        movementPatterns: new Set<string>(),
        threats: new Set<string>(),
        hasMap: null,
        growthForms: new Set<string>(),
        assessors: new Set<string>(),
        reviewers: new Set<string>(),
        search: "",
        sortField: null,
        sortDirection: "desc" as const,
        species: null,
        tab: null,
      };
      queueMicrotask(() => syncUrl(next, true));
      return next;
    });
  }, [syncUrl]);

  return {
    viewMode: state.viewMode,
    selectedTaxa: state.taxa,
    selectedSubgroups: state.subgroups,
    selectedCategories: state.categories,
    selectedYearRanges: state.yearRanges,
    selectedAssessmentYears: state.assessmentYears,
    selectedDescribedYears: state.describedYears,
    selectedCountries: state.countries,
    selectedObsRanges: state.obsRanges,
    selectedSystems: state.systems,
    selectedPopulationTrends: state.populationTrends,
    selectedMovementPatterns: state.movementPatterns,
    selectedThreats: state.threats,
    hasMapFilter: state.hasMap,
    selectedGrowthForms: state.growthForms,
    selectedAssessors: state.assessors,
    selectedReviewers: state.reviewers,
    searchFilter: state.search,
    sortField: state.sortField,
    sortDirection: state.sortDirection,

    setViewMode,
    setSelectedTaxa,
    setSelectedSubgroups,
    setSelectedCategories,
    setSelectedYearRanges,
    setSelectedAssessmentYears,
    setSelectedDescribedYears,
    setSelectedCountries,
    setSelectedObsRanges,
    setSelectedSystems,
    setSelectedPopulationTrends,
    setSelectedMovementPatterns,
    setSelectedThreats,
    setHasMapFilter,
    setSelectedGrowthForms,
    setSelectedAssessors,
    setSelectedReviewers,
    setSearchFilter,
    setSort,
    fromPopstateRef,
    clearAllFilters,
    clearAllFiltersAndTaxa,
    species: state.species,
    tab: state.tab,
    setSpeciesParam,
    setTabParam,
  };
}
