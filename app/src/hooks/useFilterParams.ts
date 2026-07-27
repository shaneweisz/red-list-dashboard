"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { canonicalizeTaxonId } from "@/lib/data/taxonomy-constants";
import { resolveRegions } from "@/lib/regions";
import { expandTaxaToken, collapseTaxaToTokens, getViewRootForNode, type FilterRank } from "@/lib/taxonomy-utils";

// --- URL parsing helpers ---

export type ViewMode = "reassessments" | "new-assessments";

// Flat-table layout ("Table 1a mode" / "SSC groups mode") plus the country-view
// landing page ("country") — URL-synced so it survives reload/share and so the
// browser back button can return to it after drilling into a group (see
// navigateToTaxonSubgroup below) or a country (see enterCountryDrilldown).
export type LayoutMode = "table1a" | "ssc" | "country" | null;

// WorldMap's own Map/List toggle and the list view's column sort — URL-synced
// (distinct from sortField/sortDirection above, which sort the species table)
// so a list-view sort like "most outdated plants" is a shareable link.
export type MapViewMode = "map" | "list";
export type MapSortKey = "name" | "species" | "outdated" | "percentOutdated";

// Exact, URL-only base filters (no on-screen control — the charts use coarse
// buckets). They let an agent/MCP dashboard link reproduce the exact /browse
// query; each feeds the same predicate the dashboard already runs.
export interface ExactFilters {
  outdated: "yes" | "no" | null;
  minObs: number | null;
  maxObs: number | null;
  minAssessmentYear: number | null;
  maxAssessmentYear: number | null;
  minDescribedYear: number | null;
  maxDescribedYear: number | null;
}

export const EMPTY_EXACT_FILTERS: ExactFilters = {
  outdated: null, minObs: null, maxObs: null,
  minAssessmentYear: null, maxAssessmentYear: null,
  minDescribedYear: null, maxDescribedYear: null,
};

const numParam = (p: URLSearchParams, key: string): number | null => {
  const v = p.get(key);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

const FILTER_RANKS: FilterRank[] = ["class", "order", "family", "genus", "species"];

// Compare mode support: every param name this hook owns can be namespaced with a
// suffix (e.g. "_b") so two independent panels can each keep their own filter
// state in one shared URL without colliding (?taxa=birds&taxa_b=reptiles). A
// bare "" suffix (the default / single-dashboard case) is identical to no
// namespacing at all.
const paramKey = (name: string, suffix: string): string => (suffix ? `${name}${suffix}` : name);

// The full set of base (unsuffixed) param names this hook reads/writes — used by
// syncUrl to know which keys in the URL "belong to" a given hook instance (so it
// can merge its own writes into the URL without clobbering another instance's
// differently-suffixed params). Keep in sync with parseParams/buildQs below.
// Exported so tests can assert this list actually tracks every key
// parseParams/buildQs read or write — otherwise a future param added to one
// but not the other would silently leak across compare-mode panels with
// nothing catching it (see filterParams.test.ts's "OWN_PARAM_NAMES stays in
// sync" test).
export const OWN_PARAM_NAMES = [
  "view", "layout", "origin", "countries", "region", "taxa", "subgroups",
  "categories", "years", "assessmentYears", "describedYears", "obsRanges",
  "systems", "trends", "movement", "threats", "criteria", "habitat", "habitatBreadth",
  "habitatExclMinor", "habitatSeasons", "bd", "endemics", "growthForms",
  "assessors", "reviewers", "search", "outdated", "minObs", "maxObs",
  "minAssessmentYear", "maxAssessmentYear", "minDescribedYear", "maxDescribedYear",
  "species", "tab", "sort", "dir", "mapview", "mapsort", "mapdir",
];

// `bd=ssc-small-mammal:order:rodentia` — narrows a node's species list to one
// breakdown row (see TaxaSummary.tsx's BreakdownList). nodeId:rank:name, colon-joined
// like the rest of the URL scheme. Carries its own nodeId (rather than always
// implicitly meaning "the selected subgroup") so RedListView can gate the filter on
// selectedSubgroups still containing that exact node — a stale bd= surviving into an
// unrelated group's view becomes inert instead of silently hiding all its species.
// An optional `:only:id1,id2` or `:excl:id1,id2` suffix further narrows to/away-from
// an explicit sis_taxon_id list (the "No CoL Match" / "CoL Match" split within one
// breakdown name's Assessed count).
export interface BreakdownParam {
  nodeId: string;
  rank: FilterRank;
  name: string;
  onlyIds?: number[];
  excludeIds?: number[];
}
const parseBreakdownParam = (p: URLSearchParams, key: string): BreakdownParam | null => {
  const raw = p.get(key);
  if (!raw) return null;
  const [nodeId, rank, name, mode, idsCsv] = raw.split(":");
  if (!nodeId || !name || !FILTER_RANKS.includes(rank as FilterRank)) return null;
  const result: BreakdownParam = { nodeId, rank: rank as FilterRank, name };
  if ((mode === "only" || mode === "excl") && idsCsv) {
    const ids = idsCsv.split(",").map(Number).filter((n) => !Number.isNaN(n));
    if (ids.length > 0) {
      if (mode === "only") result.onlyIds = ids;
      else result.excludeIds = ids;
    }
  }
  return result;
};

export function parseParams(search: string, suffix: string = "") {
  const p = new URLSearchParams(search);
  const k = (name: string) => paramKey(name, suffix);
  const sortParam = p.get(k("sort"));
  const viewParam = p.get(k("view"));
  const layoutParam = p.get(k("layout"));
  // A `region` param expands to its country codes (the dashboard has no separate
  // region state — it stores a region AS its countries and re-derives the chip).
  const countryCodes = new Set<string>(
    p.get(k("countries")) ? p.get(k("countries"))!.split(",").filter(Boolean) : []
  );
  if (p.get(k("region"))) {
    resolveRegions(p.get(k("region"))!.split(",").filter(Boolean)).codes.forEach((c) => countryCodes.add(c));
  }
  // Taxa: the URL carries a single flat `taxa` token list; expand each into the
  // internal display-root + (optional) sub-group. Legacy `subgroups=` links still
  // parse (their values are added directly, with the parent root ensured present).
  const taxaSet = new Set<string>();
  const subgroupSet = new Set<string>();
  for (const tok of p.get(k("taxa"))?.split(",").filter(Boolean) ?? []) {
    const { taxa, subgroup } = expandTaxaToken(tok);
    taxaSet.add(taxa);
    if (subgroup) subgroupSet.add(subgroup);
  }
  for (const sg of p.get(k("subgroups"))?.split(",").filter(Boolean) ?? []) {
    const id = canonicalizeTaxonId(sg);
    subgroupSet.add(id);
    const root = getViewRootForNode(id);
    if (root) taxaSet.add(root);
  }
  return {
    viewMode: (viewParam === "new-assessments" ? "new-assessments" : "reassessments") as ViewMode,
    layoutMode: (layoutParam === "table1a" || layoutParam === "ssc" || layoutParam === "country" ? layoutParam : null) as LayoutMode,
    // Remembers the layout mode a taxon drill-down exited FROM (see
    // exitCountryModeForTaxon) — survives even while layoutMode itself is
    // null/something-else, so "All Species" and the site logo's Home button
    // can jump back to Country View's landing page rather than the generic
    // default, and so that memory itself survives a reload/shared link
    // (page.tsx's Home handler reads this directly off the URL, outside this
    // hook entirely). Cleared wherever a new layoutMode is deliberately set
    // (setLayoutMode/navigateToTaxonSubgroup/returnToLayoutMode) — a fresh,
    // explicit mode choice overrides whatever "return to X" memory it held.
    originLayout: (p.get(k("origin")) === "table1a" || p.get(k("origin")) === "ssc" || p.get(k("origin")) === "country" ? p.get(k("origin")) : null) as LayoutMode,
    // Expanded from the flat `taxa` token list (+ legacy `subgroups=`) above.
    taxa: taxaSet,
    subgroups: subgroupSet,
    categories: p.get(k("categories"))
      ? new Set(p.get(k("categories"))!.split(",").filter(Boolean))
      : new Set<string>(),
    yearRanges: p.get(k("years"))
      ? new Set(p.get(k("years"))!.split(",").filter(Boolean))
      : new Set<string>(),
    assessmentYears: p.get(k("assessmentYears"))
      ? new Set(p.get(k("assessmentYears"))!.split(",").filter(Boolean))
      : new Set<string>(),
    // CoL description-year range buckets (NE/new-assessments view only).
    describedYears: p.get(k("describedYears"))
      ? new Set(p.get(k("describedYears"))!.split(",").filter(Boolean))
      : new Set<string>(),
    countries: countryCodes,
    obsRanges: p.get(k("obsRanges"))
      ? new Set(p.get(k("obsRanges"))!.split(",").filter(Boolean))
      : new Set<string>(),
    systems: p.get(k("systems"))
      ? new Set(p.get(k("systems"))!.split(",").filter(Boolean))
      : new Set<string>(),
    populationTrends: p.get(k("trends"))
      ? new Set(p.get(k("trends"))!.split(",").filter(Boolean))
      : new Set<string>(),
    movementPatterns: p.get(k("movement"))
      ? new Set(p.get(k("movement"))!.split(",").filter(Boolean))
      : new Set<string>(),
    threats: p.get(k("threats"))
      ? new Set(p.get(k("threats"))!.split(",").filter(Boolean))
      : new Set<string>(),
    criteria: p.get(k("criteria"))
      ? new Set(p.get(k("criteria"))!.split(",").filter(Boolean))
      : new Set<string>(),
    habitat: p.get(k("habitat"))
      ? new Set(p.get(k("habitat"))!.split(",").filter(Boolean))
      : new Set<string>(),
    // Habitat breadth: "specialist" = exactly one known coarse habitat category,
    // "generalist" = two or more. Any other/missing value means no filter.
    habitatBreadth: (
      p.get(k("habitatBreadth")) === "specialist" ? "specialist"
      : p.get(k("habitatBreadth")) === "generalist" ? "generalist"
      : null
    ) as "specialist" | "generalist" | null,
    // Exclude-minor: drop matches where the relevant habitat entry (the one matching
    // the selected habitat, or any entry if none selected) is confirmed NOT of major
    // importance. Entries with unrecorded importance are kept, not treated as minor.
    habitatExcludeMinor: p.get(k("habitatExclMinor")) === "1",
    // Habitat seasons: restrict to species with a matching habitat entry recorded in
    // any of the selected seasons (Resident/Breeding/Non-Breeding/Passage/Unknown).
    habitatSeasons: p.get(k("habitatSeasons"))
      ? new Set(p.get(k("habitatSeasons"))!.split(",").filter(Boolean))
      : new Set<string>(),
    breakdown: parseBreakdownParam(p, k("bd")),
    // Endemics-only: restrict to species occurring in exactly one country.
    endemicsOnly: p.get(k("endemics")) === "1",
    growthForms: p.get(k("growthForms"))
      ? new Set(p.get(k("growthForms"))!.split(",").filter(Boolean))
      : new Set<string>(),
    assessors: p.get(k("assessors"))
      ? new Set(p.get(k("assessors"))!.split("|").filter(Boolean))
      : new Set<string>(),
    reviewers: p.get(k("reviewers"))
      ? new Set(p.get(k("reviewers"))!.split("|").filter(Boolean))
      : new Set<string>(),
    search: p.get(k("search")) || "",
    // Exact URL-only base filters (see ExactFilters).
    outdated: (p.get(k("outdated")) === "yes" ? "yes" : p.get(k("outdated")) === "no" ? "no" : null) as "yes" | "no" | null,
    minObs: numParam(p, k("minObs")),
    maxObs: numParam(p, k("maxObs")),
    minAssessmentYear: numParam(p, k("minAssessmentYear")),
    maxAssessmentYear: numParam(p, k("maxAssessmentYear")),
    minDescribedYear: numParam(p, k("minDescribedYear")),
    maxDescribedYear: numParam(p, k("maxDescribedYear")),
    sortField: (
      sortParam === "category" ? "category" :
      sortParam === "year" ? "year" :
      sortParam === "totalGbif" ? "totalGbif" :
      sortParam === "newGbif" ? "newGbif" :
      sortParam === "pctNewGbif" ? "pctNewGbif" :
      sortParam === "describedYear" ? "describedYear" :
      null
    ) as "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif" | "describedYear" | null,
    sortDirection: (p.get(k("dir")) === "asc" ? "asc" : "desc") as "asc" | "desc",
    mapViewMode: (p.get(k("mapview")) === "list" ? "list" : "map") as MapViewMode,
    mapSortKey: (
      p.get(k("mapsort")) === "name" ? "name" :
      p.get(k("mapsort")) === "outdated" ? "outdated" :
      p.get(k("mapsort")) === "percentOutdated" ? "percentOutdated" :
      "species"
    ) as MapSortKey,
    mapSortDirection: (p.get(k("mapdir")) === "asc" ? "asc" : "desc") as "asc" | "desc",
    species: p.get(k("species")) ? Number(p.get(k("species"))) : null,
    tab: (p.get(k("tab")) || null) as "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol" | null,
  };
}

export function buildQs(state: {
  viewMode: ViewMode;
  layoutMode?: LayoutMode;
  originLayout?: LayoutMode;
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
  criteria: Set<string>;
  habitat: Set<string>;
  habitatBreadth: "specialist" | "generalist" | null;
  habitatExcludeMinor: boolean;
  habitatSeasons: Set<string>;
  breakdown?: BreakdownParam | null;
  endemicsOnly: boolean;
  growthForms: Set<string>;
  assessors: Set<string>;
  reviewers: Set<string>;
  search: string;
  outdated?: "yes" | "no" | null;
  minObs?: number | null;
  maxObs?: number | null;
  minAssessmentYear?: number | null;
  maxAssessmentYear?: number | null;
  minDescribedYear?: number | null;
  maxDescribedYear?: number | null;
  sortField: "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif" | "describedYear" | null;
  sortDirection: "asc" | "desc";
  mapViewMode?: MapViewMode;
  mapSortKey?: MapSortKey;
  mapSortDirection?: "asc" | "desc";
  species: number | null;
  tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol" | null;
}, suffix: string = ""): string {
  const p = new URLSearchParams();
  const k = (name: string) => paramKey(name, suffix);
  if (state.viewMode === "new-assessments") p.set(k("view"), "new-assessments");
  if (state.layoutMode) p.set(k("layout"), state.layoutMode);
  if (state.originLayout) p.set(k("origin"), state.originLayout);
  // taxa + subgroups collapse to a single flat `taxa` token list (e.g.
  // invertebrates + inv-corals → taxa=corals); no separate subgroups param.
  const taxaTokens = collapseTaxaToTokens(state.taxa, state.subgroups);
  if (taxaTokens.length > 0) p.set(k("taxa"), taxaTokens.join(","));
  if (state.categories.size > 0) p.set(k("categories"), [...state.categories].join(","));
  if (state.yearRanges.size > 0) p.set(k("years"), [...state.yearRanges].join(","));
  if (state.assessmentYears.size > 0) p.set(k("assessmentYears"), [...state.assessmentYears].join(","));
  if (state.describedYears.size > 0) p.set(k("describedYears"), [...state.describedYears].join(","));
  if (state.countries.size > 0) p.set(k("countries"), [...state.countries].join(","));
  if (state.obsRanges.size > 0) p.set(k("obsRanges"), [...state.obsRanges].join(","));
  if (state.systems.size > 0) p.set(k("systems"), [...state.systems].join(","));
  if (state.populationTrends.size > 0) p.set(k("trends"), [...state.populationTrends].join(","));
  if (state.movementPatterns.size > 0) p.set(k("movement"), [...state.movementPatterns].join(","));
  if (state.threats.size > 0) p.set(k("threats"), [...state.threats].join(","));
  if (state.criteria.size > 0) p.set(k("criteria"), [...state.criteria].join(","));
  if (state.habitat.size > 0) p.set(k("habitat"), [...state.habitat].join(","));
  if (state.habitatBreadth) p.set(k("habitatBreadth"), state.habitatBreadth);
  if (state.habitatExcludeMinor) p.set(k("habitatExclMinor"), "1");
  if (state.habitatSeasons.size > 0) p.set(k("habitatSeasons"), [...state.habitatSeasons].join(","));
  if (state.breakdown) {
    let bd = `${state.breakdown.nodeId}:${state.breakdown.rank}:${state.breakdown.name}`;
    if (state.breakdown.onlyIds?.length) bd += `:only:${state.breakdown.onlyIds.join(",")}`;
    else if (state.breakdown.excludeIds?.length) bd += `:excl:${state.breakdown.excludeIds.join(",")}`;
    p.set(k("bd"), bd);
  }
  if (state.endemicsOnly) p.set(k("endemics"), "1");
  if (state.growthForms.size > 0) p.set(k("growthForms"), [...state.growthForms].join(","));
  if (state.assessors.size > 0) p.set(k("assessors"), [...state.assessors].join("|"));
  if (state.reviewers.size > 0) p.set(k("reviewers"), [...state.reviewers].join("|"));
  if (state.search) p.set(k("search"), state.search);
  if (state.outdated) p.set(k("outdated"), state.outdated);
  if (state.minObs != null) p.set(k("minObs"), String(state.minObs));
  if (state.maxObs != null) p.set(k("maxObs"), String(state.maxObs));
  if (state.minAssessmentYear != null) p.set(k("minAssessmentYear"), String(state.minAssessmentYear));
  if (state.maxAssessmentYear != null) p.set(k("maxAssessmentYear"), String(state.maxAssessmentYear));
  if (state.minDescribedYear != null) p.set(k("minDescribedYear"), String(state.minDescribedYear));
  if (state.maxDescribedYear != null) p.set(k("maxDescribedYear"), String(state.maxDescribedYear));
  if (state.species != null) p.set(k("species"), String(state.species));
  if (state.species != null && state.tab && state.tab !== "gbif") p.set(k("tab"), state.tab);
  // null / "year" desc is the default — only write non-default sort to URL
  const isDefaultSort = state.sortField === null || state.sortField === "year";
  if (!isDefaultSort) {
    p.set(k("sort"), state.sortField!);
    if (state.sortDirection !== "desc") p.set(k("dir"), state.sortDirection);
  } else if (state.sortDirection !== "desc") {
    p.set(k("dir"), state.sortDirection);
  }
  if (state.mapViewMode === "list") p.set(k("mapview"), "list");
  if (state.mapSortKey && state.mapSortKey !== "species") p.set(k("mapsort"), state.mapSortKey);
  if (state.mapSortDirection === "asc") p.set(k("mapdir"), "asc");
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

// Pure merge: combines this instance's (suffixed) params into whatever's
// already present in `currentSearch`, rather than replacing the whole query
// string — so a second useFilterParams instance with a different paramSuffix
// (compare mode) can co-exist in the same URL, each only ever touching its
// own suffixed keys. Exported (and used by syncUrl below, its only caller)
// so this merge behavior — the actual novel logic here — is directly
// unit-testable rather than only reachable through the hook itself.
export function mergeParamsIntoSearch(
  currentSearch: string,
  newState: Parameters<typeof buildQs>[0],
  suffix: string
): string {
  const current = new URLSearchParams(currentSearch);
  for (const name of OWN_PARAM_NAMES) current.delete(paramKey(name, suffix));
  for (const [ownKey, value] of new URLSearchParams(buildQs(newState, suffix))) {
    current.set(ownKey, value);
  }
  const qs = current.toString();
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
 *
 * `paramSuffix` namespaces every URL param this hook reads/writes (e.g. "_b" turns
 * `taxa` into `taxa_b`), so a second, independently-filtered instance of this hook
 * can share one URL with the first (compare mode) without either clobbering the
 * other's params. Defaults to "" — identical to the single-dashboard behavior.
 */
export function useFilterParams(paramSuffix: string = "") {
  // Initialize with empty state (SSR-safe), hydrate from URL in effect
  const [state, setState] = useState(() => parseParams("", paramSuffix));

  // Tracks whether the most recent state update came from a popstate (URL navigation).
  // Consumers can check this to avoid clearing URL-driven state.
  const fromPopstateRef = useRef(false);

  // Hydrate from URL on mount + sync on popstate (back/forward button)
  useEffect(() => {
    fromPopstateRef.current = true;
    setState(parseParams(window.location.search, paramSuffix)); // eslint-disable-line react-hooks/set-state-in-effect -- hydrate from URL on mount
    const onPopState = () => {
      fromPopstateRef.current = true;
      setState(parseParams(window.location.search, paramSuffix));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [paramSuffix]);

  // Write URL silently (no Next.js navigation, no re-render loop). Merges this
  // instance's (suffixed) params into whatever's currently in the URL rather than
  // replacing the whole query string, so a second useFilterParams instance with a
  // different paramSuffix (compare mode) can co-exist in the same URL — each
  // instance only ever touches its own suffixed keys.
  const syncUrl = useCallback((newState: typeof state, push: boolean) => {
    const qs = mergeParamsIntoSearch(window.location.search, newState, paramSuffix);
    const url = window.location.pathname + qs;
    if (push) {
      window.history.pushState(null, "", url);
    } else {
      window.history.replaceState(null, "", url);
    }
  }, [paramSuffix]);

  // --- Setters: update local state instantly, sync URL in background ---

  const setSelectedTaxa = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextTaxa = typeof updater === "function" ? updater(prev.taxa) : updater;
        // A breakdown-name filter (bd=) is only ever set via the atomic URL push in
        // TaxaSummary.tsx's navigateToNodeSpeciesList (which goes through parseParams
        // on popstate, not this setter) — an actual taxa change here is a fresh
        // selection, so drop a stale bd= rather than silently carrying it over. Guard
        // on reference inequality (not just "this setter ran"): some callers invoke
        // this as a conditional no-op (e.g. the view-mode-switch effect's `prev.has("all")
        // ? new Set() : prev`), which must NOT clobber a bd= a same-tick popstate just set.
        const next = nextTaxa === prev.taxa ? { ...prev, taxa: nextTaxa } : { ...prev, taxa: nextTaxa, breakdown: null };
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
        // See setSelectedTaxa above — drop a stale bd= on an actual subgroup change,
        // but not a same-reference no-op.
        const next = nextSubgroups === prev.subgroups ? { ...prev, subgroups: nextSubgroups } : { ...prev, subgroups: nextSubgroups, breakdown: null };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  const setLayoutMode = useCallback(
    (mode: LayoutMode) => {
      setState(prev => {
        // A deliberate, explicit mode choice overrides any "return to X"
        // memory exitCountryModeForTaxon left behind — see originLayout's doc.
        const next = { ...prev, layoutMode: mode, originLayout: null as LayoutMode };
        queueMicrotask(() => syncUrl(next, true)); // push so back button exits the mode
        return next;
      });
    },
    [syncUrl]
  );

  // Atomic taxon + sub-group navigation (used by Table 1a / SSC groups mode
  // click-through). A single setState + single history push, so one back-press
  // undoes the whole navigation instead of unwinding it one field at a time —
  // and clearing layoutMode in the same update means back lands on the flat
  // table the group was drilled into from, not a half-updated intermediate.
  const navigateToTaxonSubgroup = useCallback(
    (taxonId: string, subgroupId: string) => {
      setState(prev => {
        const next = { ...prev, taxa: new Set([taxonId]), subgroups: new Set([subgroupId]), layoutMode: null, originLayout: null as LayoutMode, breakdown: null };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  // Exits Country View to the full charts+species-table view when a taxon's
  // clicked from the country-scoped landing/list (see RedListView's
  // handleToggleTaxon) — atomic (one setState + one history push), same
  // reasoning as navigateToTaxonSubgroup above: without this, layoutMode and
  // taxa/subgroups would each get their own history entry, so a single
  // "back" press would land on some half-updated intermediate (e.g.
  // layoutMode cleared but taxa not yet set) instead of cleanly restoring
  // the Country View landing page. countries is deliberately left untouched
  // — the taxon drill-down stays scoped to whatever was selected. Also
  // records originLayout: "country" — layoutMode itself is about to go
  // null, so without this nothing durable remembers we came from Country
  // View. RedListView's "All Species" row (and the site logo's Home button,
  // reading straight off the URL) use this to jump back to that landing
  // page instead of the generic default view.
  const exitCountryModeForTaxon = useCallback(
    (taxonId: string) => {
      setState(prev => {
        const next = { ...prev, taxa: new Set([taxonId]), subgroups: new Set<string>(), layoutMode: null as LayoutMode, originLayout: "country" as LayoutMode, breakdown: null };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  // Reverse of navigateToTaxonSubgroup — clears taxa/subgroups back to the
  // landing page and re-enters a flat-table layout mode, atomically (one
  // history push). Used when clicking the "Mammals" ancestor row after
  // drilling out of SSC groups mode should return to that table instead of
  // falling through to the plain taxon tree view, and (passing "country")
  // by RedListView's "All Species" row to consume an originLayout memory
  // left by exitCountryModeForTaxon and land back on Country View properly.
  const returnToLayoutMode = useCallback(
    (mode: LayoutMode) => {
      setState(prev => {
        const next = { ...prev, taxa: new Set<string>(), subgroups: new Set<string>(), layoutMode: mode, originLayout: null as LayoutMode, breakdown: null };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  // Select country/countries from the Country view landing page — a single
  // setState + history push (see navigateToTaxonSubgroup above for why atomic
  // matters here too). Accepts either a plain Set (replace) or an updater
  // function (toggle-in-place), the same shape setSelectedCountries takes, so
  // RedListView's click handler can implement the normal plain-click-replaces/
  // ctrl-click-toggles gesture for a single country, a whole region, or an
  // arbitrary multi-select — this just guarantees the country change stays
  // atomic with clearing taxa/subgroups, whichever shape the update takes.
  // Deliberately leaves layoutMode untouched (stays "country"): the promoted
  // map and the bare taxa summary table (All Species, Mammals, ..., Fungi)
  // show together, scoped to however many countries are now selected, until
  // the user clicks an actual taxon row (handleToggleTaxon, in RedListView) —
  // that's what exits to the full charts+species-table view, still scoped the
  // same way.
  //
  // Sets fromPopstateRef true first: RedListView's own "reset all other filters
  // when taxa selection changes" effect (it watches selectedTaxa transitioning
  // non-empty→non-empty/empty to drop stale category/year/etc. filters from
  // whatever was previously browsed) would otherwise fire right after this
  // non-empty→empty taxa change and immediately clear the `countries` this very
  // call just set — the ref is the same "this is one atomic, fully-specified
  // state transition, don't run the generic per-field reset side effect"
  // escape hatch real popstate restores already rely on.
  const enterCountryDrilldown = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      fromPopstateRef.current = true;
      setState(prev => {
        const nextCountries = typeof updater === "function" ? updater(prev.countries) : updater;
        const next = { ...prev, countries: nextCountries, taxa: new Set<string>(), subgroups: new Set<string>(), breakdown: null };
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

  const setSelectedCriteria = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextVal = typeof updater === "function" ? updater(prev.criteria) : updater;
        const next = { ...prev, criteria: nextVal };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedHabitat = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextVal = typeof updater === "function" ? updater(prev.habitat) : updater;
        const next = { ...prev, habitat: nextVal };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setHabitatBreadth = useCallback(
    (value: "specialist" | "generalist" | null) => {
      setState(prev => {
        const next = { ...prev, habitatBreadth: value };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setHabitatExcludeMinor = useCallback(
    (value: boolean) => {
      setState(prev => {
        const next = { ...prev, habitatExcludeMinor: value };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSelectedHabitatSeasons = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setState(prev => {
        const nextVal = typeof updater === "function" ? updater(prev.habitatSeasons) : updater;
        const next = { ...prev, habitatSeasons: nextVal };
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

  const setBreakdownFilter = useCallback(
    (value: BreakdownParam | null) => {
      setState(prev => {
        const next = { ...prev, breakdown: value };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setEndemicsOnly = useCallback(
    (value: boolean) => {
      setState(prev => {
        const next = { ...prev, endemicsOnly: value };
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

  // Stable identity (keyed on the 7 primitive fields) so consumers can use it as a
  // memo/effect dep without recomputing every render.
  const exactFilters = useMemo<ExactFilters>(() => ({
    outdated: state.outdated,
    minObs: state.minObs,
    maxObs: state.maxObs,
    minAssessmentYear: state.minAssessmentYear,
    maxAssessmentYear: state.maxAssessmentYear,
    minDescribedYear: state.minDescribedYear,
    maxDescribedYear: state.maxDescribedYear,
  }), [state.outdated, state.minObs, state.maxObs, state.minAssessmentYear, state.maxAssessmentYear, state.minDescribedYear, state.maxDescribedYear]);

  // Patch one or more exact URL-only filters (outdated / obs / year bounds).
  const setExactFilters = useCallback(
    (patch: Partial<ExactFilters>) => {
      setState(prev => {
        const next = { ...prev, ...patch };
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

  const setMapViewMode = useCallback(
    (mode: MapViewMode) => {
      setState(prev => {
        const next = { ...prev, mapViewMode: mode };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setMapSort = useCallback(
    (key: MapSortKey, direction: "asc" | "desc") => {
      setState(prev => {
        const next = { ...prev, mapSortKey: key, mapSortDirection: direction };
        queueMicrotask(() => syncUrl(next, false));
        return next;
      });
    },
    [syncUrl]
  );

  const setSpeciesParam = useCallback(
    (species: number | null, tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol" = "gbif") => {
      setState(prev => {
        const next = { ...prev, species, tab: species != null ? tab : null };
        queueMicrotask(() => syncUrl(next, true));
        return next;
      });
    },
    [syncUrl]
  );

  const setTabParam = useCallback(
    (tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol") => {
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
        criteria: new Set<string>(),
        habitat: new Set<string>(),
        habitatBreadth: null,
        habitatExcludeMinor: false,
        habitatSeasons: new Set<string>(),
        breakdown: null,
        endemicsOnly: false,
        growthForms: new Set<string>(),
        assessors: new Set<string>(),
        reviewers: new Set<string>(),
        search: "",
        ...EMPTY_EXACT_FILTERS,
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
        criteria: new Set<string>(),
        habitat: new Set<string>(),
        habitatBreadth: null,
        habitatExcludeMinor: false,
        habitatSeasons: new Set<string>(),
        breakdown: null,
        endemicsOnly: false,
        growthForms: new Set<string>(),
        assessors: new Set<string>(),
        reviewers: new Set<string>(),
        search: "",
        ...EMPTY_EXACT_FILTERS,
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
    layoutMode: state.layoutMode,
    originLayout: state.originLayout,
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
    selectedCriteria: state.criteria,
    selectedHabitat: state.habitat,
    habitatBreadth: state.habitatBreadth,
    habitatExcludeMinor: state.habitatExcludeMinor,
    selectedHabitatSeasons: state.habitatSeasons,
    breakdownFilter: state.breakdown,
    endemicsOnly: state.endemicsOnly,
    selectedGrowthForms: state.growthForms,
    selectedAssessors: state.assessors,
    selectedReviewers: state.reviewers,
    searchFilter: state.search,
    exactFilters,
    setExactFilters,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
    mapViewMode: state.mapViewMode,
    mapSortKey: state.mapSortKey,
    mapSortDirection: state.mapSortDirection,

    setViewMode,
    setLayoutMode,
    navigateToTaxonSubgroup,
    exitCountryModeForTaxon,
    returnToLayoutMode,
    enterCountryDrilldown,
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
    setSelectedCriteria,
    setSelectedHabitat,
    setHabitatBreadth,
    setHabitatExcludeMinor,
    setSelectedHabitatSeasons,
    setBreakdownFilter,
    setEndemicsOnly,
    setSelectedGrowthForms,
    setSelectedAssessors,
    setSelectedReviewers,
    setSearchFilter,
    setSort,
    setMapViewMode,
    setMapSort,
    fromPopstateRef,
    clearAllFilters,
    clearAllFiltersAndTaxa,
    species: state.species,
    tab: state.tab,
    setSpeciesParam,
    setTabParam,
  };
}
