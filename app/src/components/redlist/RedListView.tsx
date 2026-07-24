"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import TaxaSummary from "./TaxaSummary";
import NewLiteratureSinceAssessment from "../LiteratureSearch";
import RedListAssessments from "../RedListAssessments";
import CitesSummary from "../CitesSummary";
import WikipediaSummary from "../WikipediaSummary";
import EolSummary from "../EolSummary";
import TaxaIcon from "../TaxaIcon";
import { ALPHA2_TO_NAME, type CountryStats } from "../WorldMap";
import { CATEGORY_COLORS, TAXA_BY_ID, THREATENED_CATEGORIES } from "@/config/taxa";
import { speciesMatchesNode, getNodeDef, getViewRootForNode, findNode, matchesBreakdownName, breakdownDisplayName, primaryFilterRank } from "@/lib/taxonomy-utils";
import { dynamicNodeDisplayName, isDynamicNodeId, dynamicNodeRankInfo } from "@/lib/dynamic-taxon";
import ReviewerChart from "./ReviewerChart";
import { parseAssessors } from "@/lib/parseAssessors";
import { iucnRegionCountries, countryToIucnRegion } from "@/lib/regions";
import { useFilterParams } from "@/hooks/useFilterParams";
import { type RedListSpecies } from "@/hooks/useRedListSpeciesQuery";
import { useSpeciesCache } from "@/contexts/SpeciesCacheContext";
import { isOutdated, outdatedCutoffDate } from "@/lib/outdated";

import AssessorCandidatesTable from "../AssessorCandidatesTable";
import ReviewerCandidatesTable from "../ReviewerCandidatesTable";
import { getLastSearchResult, clearLastSearchResult } from "../SpeciesSearchBar";

// Species list is served by the DuckDB/Parquet-backed /api/redlist/species route.
const SPECIES_API = "/api/redlist/species";

// Dynamically import OccurrenceMapRow to avoid SSR issues with Leaflet
const OccurrenceMapRow = dynamic(
  () => import("../OccurrenceMapRow"),
  { ssr: false }
);

// iNat-only observations panel, shown when a species has no GBIF backbone match
const InatObservationsPanel = dynamic(
  () => import("../InatObservationsPanel"),
  { ssr: false }
);

// Dynamically import WorldMap to avoid SSR issues
const WorldMap = dynamic(
  () => import("../WorldMap"),
  { ssr: false }
);

// Dynamically import FilterBarChart to reduce initial bundle size (recharts is ~200KB)
const FilterBarChart = dynamic(
  () => import("./FilterBarChart"),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" /> }
);

// Dedicated vertical bar chart for "Year of Latest Assessment" view
const YearBarChart = dynamic(
  () => import("./YearBarChart"),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" /> }
);

// Simple spinner component for loading states
function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-5 w-5 text-zinc-400 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

// Use RedListSpecies from the hook; alias for convenience
type Species = RedListSpecies;

/** IUCN threat classification hierarchy */
const THREAT_CATEGORIES: { code: string; label: string; children: { code: string; label: string }[] }[] = [
  { code: "1", label: "Development", children: [
    { code: "1.1", label: "Housing & urban areas" }, { code: "1.2", label: "Commercial & industrial areas" }, { code: "1.3", label: "Tourism & recreation areas" },
  ]},
  { code: "2", label: "Agriculture", children: [
    { code: "2.1", label: "Crops" }, { code: "2.2", label: "Wood & pulp plantations" }, { code: "2.3", label: "Livestock farming & ranching" }, { code: "2.4", label: "Aquaculture" },
  ]},
  { code: "3", label: "Energy & Mining", children: [
    { code: "3.1", label: "Oil & gas drilling" }, { code: "3.2", label: "Mining & quarrying" }, { code: "3.3", label: "Renewable energy" },
  ]},
  { code: "4", label: "Transport", children: [
    { code: "4.1", label: "Roads & railroads" }, { code: "4.2", label: "Utility & service lines" }, { code: "4.3", label: "Shipping lanes" }, { code: "4.4", label: "Flight paths" },
  ]},
  { code: "5", label: "Harvesting", children: [
    { code: "5.1", label: "Hunting & trapping" }, { code: "5.2", label: "Gathering plants" }, { code: "5.3", label: "Logging & wood harvesting" }, { code: "5.4", label: "Fishing & harvesting" },
  ]},
  { code: "6", label: "Disturbance", children: [
    { code: "6.1", label: "Recreational activities" }, { code: "6.2", label: "War & military" }, { code: "6.3", label: "Work & other activities" },
  ]},
  { code: "7", label: "System modifications", children: [
    { code: "7.1", label: "Fire & fire suppression" }, { code: "7.2", label: "Dams & water management" }, { code: "7.3", label: "Other modifications" },
  ]},
  { code: "8", label: "Invasive species", children: [
    { code: "8.1", label: "Invasive non-native species" }, { code: "8.2", label: "Problematic native species" }, { code: "8.3", label: "Introduced genetic material" }, { code: "8.4", label: "Unknown origin species" }, { code: "8.5", label: "Viral/prion diseases" }, { code: "8.6", label: "Diseases of unknown cause" },
  ]},
  { code: "9", label: "Pollution", children: [
    { code: "9.1", label: "Domestic & urban waste water" }, { code: "9.2", label: "Industrial & military effluents" }, { code: "9.3", label: "Agricultural & forestry effluents" },
    { code: "9.4", label: "Garbage & solid waste" }, { code: "9.5", label: "Air-borne pollutants" }, { code: "9.6", label: "Excess energy (light, thermal, noise)" },
  ]},
  { code: "10", label: "Geological events", children: [
    { code: "10.1", label: "Volcanoes" }, { code: "10.2", label: "Earthquakes/tsunamis" }, { code: "10.3", label: "Avalanches/landslides" },
  ]},
  { code: "11", label: "Climate change", children: [
    { code: "11.1", label: "Habitat shifting & alteration" }, { code: "11.2", label: "Droughts" }, { code: "11.3", label: "Temperature extremes" }, { code: "11.4", label: "Storms & flooding" }, { code: "11.5", label: "Other impacts" },
  ]},
  { code: "12", label: "Other", children: [
    { code: "12.1", label: "Other threat" },
  ]},
];

interface InatDefaultImage {
  squareUrl: string | null;
  mediumUrl: string | null;
}

interface GbifMatchStatus {
  matchType: string;
  matchedName?: string;
  matchedRank?: string;
}

interface SpeciesDetails {
  criteria: string | null;
  commonName: string | null;
  gbifUrl: string | null;
  gbifOccurrences: number | null;
  gbifOccurrencesSinceAssessment: number | null;
  gbifMatchStatus: GbifMatchStatus | null;
  // undefined = still loading (show spinner), null = fetched, no image
  inatDefaultImage: InatDefaultImage | null | undefined;
  // Whether criteria/gbifMatchStatus have been fetched (to avoid re-fetching on null)
  criteriaFetched?: boolean;
  gbifMatchFetched?: boolean;
}


// Debounced search input — manages own state for instant typing, debounces parent updates.
// Filters the currently-visible species table by name in place, composing with whatever
// pill filters are already active (e.g. Mammals + EN + Mexico, then narrow to "mouse") —
// distinct from the page header's SpeciesSearchBar, which navigates to a taxon/species
// instead of narrowing the current view. Placeholder text keeps the two from reading as
// duplicates of each other.
function DebouncedSearchInput({
  onSearch,
  initialValue = "",
  placeholder = "Filter by name...",
  className,
}: {
  onSearch: (value: string) => void;
  initialValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(initialValue);

  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(localValue.toLowerCase());
    }, 200);
    return () => clearTimeout(timer);
  }, [localValue, onSearch]);

  return (
    <input
      type="text"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

// Explain IUCN Red List criteria codes
// See: https://www.iucnredlist.org/resources/categories-and-criteria
function explainCriteria(criteria: string): string {
  if (!criteria) return "";

  const explanations: string[] = [];

  // Criterion A: Population size reduction
  if (criteria.includes("A1")) explanations.push("past population reduction, reversible");
  else if (criteria.includes("A2")) explanations.push("past population reduction, may not be reversible");
  else if (criteria.includes("A3")) explanations.push("future population reduction projected");
  else if (criteria.includes("A4")) explanations.push("population reduction past & future");
  else if (criteria.startsWith("A")) explanations.push("population reduction");

  // Criterion B: Geographic range (small range + fragmented/declining/fluctuating)
  if (criteria.includes("B1")) explanations.push("restricted extent of occurrence");
  if (criteria.includes("B2")) explanations.push("restricted area of occupancy");

  // Criterion C: Small population size and decline
  if (criteria.startsWith("C") || criteria.includes("+C")) explanations.push("small declining population");

  // Criterion D: Very small or restricted population
  if (criteria.startsWith("D") || criteria.includes("+D")) explanations.push("very small/restricted population");

  // Criterion E: Quantitative analysis
  if (criteria.startsWith("E") || criteria.includes("+E")) explanations.push("extinction probability analysis");

  return explanations.length > 0 ? ` (${explanations.join("; ")})` : "";
}

// Quick hover tooltip using portal
function HoverTooltip({ children, text }: { children: React.ReactNode; text: string }) {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [isHovered]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
      {isHovered && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999] px-2 py-1 text-xs bg-zinc-800 text-zinc-200 rounded shadow-lg max-w-[250px] text-center"
          style={{
            top: position.top,
            left: position.left,
            transform: 'translateX(-50%) translateY(-100%)',
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}


function GbifInfoTooltip() {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [isHovered]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <svg className="w-3 h-3 text-zinc-400 dark:text-zinc-500 cursor-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      {isHovered && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999] bg-zinc-900 dark:bg-zinc-800 text-white text-[9px] leading-snug rounded px-2 py-1.5 shadow-lg w-64"
          style={{
            top: position.top,
            left: position.left,
            transform: 'translateX(-50%) translateY(-100%)',
          }}
        >
          <div className="font-medium text-[10px] mb-0.5">Georeferenced GBIF records only:</div>
          <div className="text-zinc-400"><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">hasCoordinate=true</code> · <code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">hasGeospatialIssue=false</code></div>
          <div className="font-medium text-zinc-100 mt-1">Included:</div>
          <ul className="text-zinc-300 list-disc list-inside">
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">HUMAN_OBSERVATION</code> <span className="text-zinc-400">(e.g. iNat, eBird)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MACHINE_OBSERVATION</code> <span className="text-zinc-400">(e.g. camera traps)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MATERIAL_SAMPLE</code> <span className="text-zinc-400">(e.g. eDNA)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OCCURRENCE</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OBSERVATION</code></li>
          </ul>
          <div className="font-medium text-zinc-100 mt-1">Excluded:</div>
          <ul className="text-zinc-300 list-disc list-inside">
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">PRESERVED_SPECIMEN</code> <span className="text-zinc-400">(e.g. herbaria, museums)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MATERIAL_CITATION</code> <span className="text-zinc-400">(may include fossils)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">FOSSIL_SPECIMEN</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">LIVING_SPECIMEN</code> <span className="text-zinc-400">(e.g. zoos)</span></li>
          </ul>
        </div>,
        document.body
      )}
    </span>
  );
}

interface RedListViewProps {
  viewMode?: "reassessments" | "new-assessments";
  onViewModeChange?: (mode: "reassessments" | "new-assessments") => void;
  sharedTaxa?: Set<string>;
  sharedSubgroups?: Set<string>;
  onTaxaChange?: (taxa: Set<string>) => void;
  onSubgroupsChange?: (subgroups: Set<string>) => void;
  // Namespaces this instance's URL params (e.g. "_b" turns `taxa` into `taxa_b`) so
  // two instances can share one URL without clobbering each other — compare mode's
  // second panel. Defaults to "" (today's single-dashboard behavior).
  paramSuffix?: string;
}

export default function RedListView({ viewMode = "reassessments", onViewModeChange, sharedTaxa, sharedSubgroups, onTaxaChange, onSubgroupsChange, paramSuffix = "" }: RedListViewProps = {}) {
  const isNewAssessments = viewMode === "new-assessments";

  // The species table scrolls horizontally on narrow screens, so an expanded
  // detail row's `<td colSpan>` is as wide as the (often off-screen) table, not
  // the viewport. Expose the scroll container's *visible* width as a CSS var so
  // the detail panel can size itself to fit the screen instead of overflowing.
  const tableScrollCleanupRef = useRef<(() => void) | null>(null);
  const tableScrollRef = useCallback((el: HTMLDivElement | null) => {
    tableScrollCleanupRef.current?.();
    tableScrollCleanupRef.current = null;
    if (!el) return;
    const update = () => el.style.setProperty("--view-width", `${el.clientWidth}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    tableScrollCleanupRef.current = () => ro.disconnect();
  }, []);
  // Filters synced with URL search params for shareable links
  const {
    layoutMode, setLayoutMode,
    originLayout,
    navigateToTaxonSubgroup,
    exitCountryModeForTaxon,
    returnToLayoutMode,
    enterCountryDrilldown,
    selectedTaxa, setSelectedTaxa,
    selectedSubgroups, setSelectedSubgroups,
    selectedCategories, setSelectedCategories,
    selectedYearRanges, setSelectedYearRanges,
    selectedAssessmentYears, setSelectedAssessmentYears,
    selectedDescribedYears, setSelectedDescribedYears,
    selectedCountries, setSelectedCountries,
    selectedObsRanges, setSelectedObsRanges,
    selectedSystems, setSelectedSystems,
    selectedPopulationTrends, setSelectedPopulationTrends,
    selectedMovementPatterns, setSelectedMovementPatterns,
    selectedThreats, setSelectedThreats,
    breakdownFilter, setBreakdownFilter,
    endemicsOnly, setEndemicsOnly,
    selectedGrowthForms, setSelectedGrowthForms,
    selectedAssessors, setSelectedAssessors,
    selectedReviewers, setSelectedReviewers,
    searchFilter, setSearchFilter,
    exactFilters, setExactFilters,
    sortField, sortDirection, setSort,
    mapViewMode, mapSortKey, mapSortDirection, setMapViewMode, setMapSort,
    clearAllFilters,
    clearAllFiltersAndTaxa,
    setViewMode: setUrlViewMode,
    species: urlSpecies, tab: urlTab,
    setSpeciesParam, setTabParam,
    fromPopstateRef,
  } = useFilterParams(paramSuffix);

  const cache = useSpeciesCache();
  const speciesApiUrl = useCallback(
    (taxonId: string, categoryParam: string) => `${SPECIES_API}?taxon=${encodeURIComponent(taxonId)}${categoryParam}`,
    []
  );

  // Country view needs real per-country location data, which Not Evaluated
  // species don't have (no assessment means no assessment_locations row) — see
  // the matching disabled-option guard in TaxaSummary's layoutModeSelect. Exit
  // back to the taxonomic default if New Assessments is switched on while
  // already in country view, rather than leaving an unreachable-but-still-active
  // mode selected.
  useEffect(() => {
    if (isNewAssessments && layoutMode === "country") setLayoutMode(null);
  }, [isNewAssessments, layoutMode, setLayoutMode]);

  // Initialize from shared state on mount (when switching from another view)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (sharedTaxa && sharedTaxa.size > 0 && selectedTaxa.size === 0) {
      setSelectedTaxa(sharedTaxa);
    }
    if (sharedSubgroups && sharedSubgroups.size > 0 && selectedSubgroups.size === 0) {
      setSelectedSubgroups(sharedSubgroups);
    }
  }, [sharedTaxa, sharedSubgroups, selectedTaxa, selectedSubgroups, setSelectedTaxa, setSelectedSubgroups]);

  // Sync taxa/subgroup changes up to parent
  useEffect(() => {
    onTaxaChange?.(selectedTaxa);
  }, [selectedTaxa, onTaxaChange]);

  useEffect(() => {
    onSubgroupsChange?.(selectedSubgroups);
  }, [selectedSubgroups, onSubgroupsChange]);

  // Sync viewMode prop to URL params (skip initial mount to avoid overwriting URL before page hydrates)
  const viewModeInitializedRef = useRef(false);
  useEffect(() => {
    if (!viewModeInitializedRef.current) {
      viewModeInitializedRef.current = true;
      return;
    }
    setUrlViewMode(viewMode);
  }, [viewMode, setUrlViewMode]);

  // Reset to Assessed whenever the taxon/sub-group selection changes — Not
  // Evaluated is something to opt into per-taxon, not a mode that should
  // silently follow you from one taxon to the next (you'd otherwise land on a
  // brand-new taxon already in NE mode from browsing a previous one, with no
  // visual cue you're not seeing its Assessed data). Skips the very first
  // render so a shared link's own ?view=new-assessments still works.
  const prevSelectionRef = useRef<{ taxa: Set<string>; subgroups: Set<string> } | null>(null);
  useEffect(() => {
    const prev = prevSelectionRef.current;
    prevSelectionRef.current = { taxa: selectedTaxa, subgroups: selectedSubgroups };
    if (prev === null) return;
    // Skip going from no taxa to some taxa too — this is URL hydration
    // (useFilterParams starts empty then populates from URL on mount), not a
    // user browsing to a new taxon. Without this, a shared link combining
    // ?view=new-assessments&taxa=X hydrates its taxa a render after this
    // effect's first (skipped, prev === null) run, so that second run sees
    // an empty→populated transition, misreads it as a real taxon change, and
    // immediately resets straight back to Assessed — the exact case the
    // "very first render" skip above was meant to protect (see the same
    // hydration guard on the "reset all other filters" effect below).
    if (prev.taxa.size === 0 && prev.subgroups.size === 0) return;
    const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((v) => b.has(v));
    const changed = !setsEqual(prev.taxa, selectedTaxa) || !setsEqual(prev.subgroups, selectedSubgroups);
    if (changed && isNewAssessments) onViewModeChange?.("reassessments");
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, onViewModeChange]);

  // Reset mode-specific filter state when switching between reassessments and
  // new-assessments. The shared species cache (SpeciesCacheContext) is NOT cleared
  // here — it's keyed by the exact request URL, which already differs between modes
  // (`?taxon=X` vs `?taxon=X&category=NE`), so each mode's data survives the switch
  // independently and toggling back to a mode already loaded for the current taxon
  // is instant instead of re-fetching from scratch every time.
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    if (prevViewModeRef.current === viewMode) return;
    prevViewModeRef.current = viewMode;
    // Clear assessment-specific filters (preserve search + species so search-bar navigation survives mode
    // switch; also preserve selectedSubgroups — new-assessments mode fetches a selected sub-group directly
    // (see the fetch effect below), so e.g. toggling Unassessed while viewing an SSC group should stay
    // scoped to that group, not fall back to all of Mammals)
    setSelectedCategories(new Set());
    setSelectedYearRanges(new Set());
    setSelectedAssessmentYears(new Set());
    setSelectedDescribedYears(new Set());
    setSelectedCountries(new Set());
    setSelectedObsRanges(new Set());
    setSelectedSystems(new Set());
    setSelectedPopulationTrends(new Set());
    setSelectedMovementPatterns(new Set());
    setSelectedThreats(new Set());
    setExpandedThreat(null);
    setEndemicsOnly(false);
    setSelectedGrowthForms(new Set());
    setSelectedAssessors(new Set());
    setSelectedReviewers(new Set());
    setSort(null, "desc");
    setShowOnlyStarred(false);
    // Clear "all" taxa selection when switching to new-assessments (NE dataset too large for "all")
    if (viewMode === "new-assessments") {
      setSelectedTaxa(prev => prev.has("all") ? new Set<string>() : prev);
    }
  }, [viewMode, setSelectedTaxa, setSelectedCategories, setSelectedYearRanges, setSelectedAssessmentYears, setSelectedDescribedYears, setSelectedCountries, setSelectedObsRanges, setSelectedSystems, setSelectedPopulationTrends, setSelectedMovementPatterns, setSelectedThreats, setEndemicsOnly, setSelectedGrowthForms, setSelectedAssessors, setSelectedReviewers, setSort]);

  // Taxon toggle handler (used by TaxaSummary)
  // Regular click: select only that taxon (or deselect if already sole selection)
  // Cmd/Ctrl+Click on taxon row: multi-select toggle (expands taxa summary to show all rows)
  const handleToggleTaxon = useCallback((taxonId: string, event: React.MouseEvent) => {
    const isMulti = event.metaKey || event.ctrlKey;

    // Clicking a specific taxon row while browsing a country-scoped bare
    // summary table (Country view, one country selected, no taxon picked yet
    // — see TaxaSummary's countryMode rendering) exits to the full charts+
    // species-table view, still scoped to that country (selectedCountries
    // untouched). Atomic (one history push) via exitCountryModeForTaxon, so
    // a single "back" press cleanly restores the Country View landing page
    // instead of layoutMode and taxa unwinding as separate history entries.
    // The "all" row and multi-select (ctrl/cmd-click) cases fall through to
    // the general path below instead — rarer, and "all" isn't a real taxon
    // drill-down (see its own branch just below).
    if (layoutMode === "country" && taxonId !== "all" && !isMulti) {
      exitCountryModeForTaxon(taxonId);
      return;
    }
    if (layoutMode === "country") setLayoutMode(null);

    // "all" row behavior:
    // - If anything is selected (nested view), return to landing page
    // - Only select "all" when clicking from the landing page itself (nothing selected)
    // Disabled in new-assessments mode (NE dataset too large for "all")
    if (taxonId === "all") {
      if (selectedTaxa.size > 0 || selectedSubgroups.size > 0) {
        if (originLayout === "country") {
          // Came from Country View's landing page via a taxon drill-down
          // (exitCountryModeForTaxon) — return there instead of the generic
          // default view. See originLayout's own doc in useFilterParams.ts.
          // fromPopstateRef first: this taxa non-empty→empty transition is
          // part of one atomic, fully-specified navigation (countries stays
          // as-is), not a generic "taxon deselected" — without the ref, the
          // "reset filters on taxa change" effect below would immediately
          // clear the very countries this navigation means to keep (see its
          // own comment on enterCountryDrilldown for the same escape hatch).
          fromPopstateRef.current = true;
          returnToLayoutMode("country");
          return;
        }
        // Return to landing page
        setSelectedSubgroups(new Set());
        setSelectedTaxa(new Set());
        return;
      }
      // On landing page: toggle "all" on/off (disabled in new-assessments — NE dataset too large)
      if (isNewAssessments) return;
      setSelectedTaxa(prev => {
        if (prev.has("all")) return new Set<string>();
        return new Set(["all"]);
      });
      return;
    }

    // Single click on already-sole-selected taxon: keep selected (TaxaSummary
    // handles expand/collapse toggle). Clear search/species if active.
    if (!isMulti && selectedTaxa.size === 1 && selectedTaxa.has(taxonId)) {
      if (searchFilter || urlSpecies != null) {
        clearAllFilters();
      }
      return;
    }

    setSelectedTaxa(prev => {
      if (isMulti) {
        // Remove "all" if present when multi-selecting specific taxa
        const next = new Set(prev);
        next.delete("all");
        if (next.has(taxonId)) {
          next.delete(taxonId);
        } else {
          next.add(taxonId);
        }
        return next;
      }
      // Switching to a different taxon — clear subgroups
      setSelectedSubgroups(new Set());
      return new Set([taxonId]);
    });
  }, [setSelectedTaxa, setSelectedSubgroups, selectedTaxa, selectedSubgroups, isNewAssessments, searchFilter, urlSpecies, clearAllFilters, layoutMode, setLayoutMode, exitCountryModeForTaxon, originLayout, returnToLayoutMode, fromPopstateRef]);

  // Reset all other filters when taxa selection changes
  const prevTaxaRef = useRef(selectedTaxa);
  const skipClearOnTaxaChangeRef = useRef(false);
  useEffect(() => {
    const prev = prevTaxaRef.current;
    prevTaxaRef.current = selectedTaxa;
    // Skip if taxa haven't actually changed (same reference or same contents)
    if (prev === selectedTaxa) return;
    if (prev.size === selectedTaxa.size && [...selectedTaxa].every(t => prev.has(t))) return;
    // Skip clearing when taxa changed as a side-effect of subgroup selection
    if (skipClearOnTaxaChangeRef.current) {
      skipClearOnTaxaChangeRef.current = false;
      return;
    }
    // Skip clearing when the taxa change came from URL navigation (popstate) —
    // the URL already contains the complete state (e.g. from search bar navigation).
    if (fromPopstateRef.current) {
      fromPopstateRef.current = false;
      return;
    }
    // Skip clearing when going from no taxa to some taxa — this happens during
    // URL hydration (useFilterParams starts empty then populates from URL) and
    // there are no taxa-specific filters to reset when nothing was selected before.
    if (prev.size === 0) return;
    clearAllFilters();
    setShowOnlyStarred(false);
  }, [selectedTaxa, clearAllFilters, fromPopstateRef]);

  const [showOnlyStarred, setShowOnlyStarred] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [expandedThreat, setExpandedThreat] = useState<string | null>(null);

  // Keep the threats drill-down in sync with the selection. Whenever the expanded
  // top-level category is no longer represented in the selection — because the
  // threats were cleared (Clear all / chip ×), a child was deselected, or the view
  // was reset — collapse the sub-category pane so no stale nested level lingers.
  useEffect(() => {
    if (!expandedThreat) return;
    const stillSelected = Array.from(selectedThreats).some(
      c => c === expandedThreat || c.startsWith(expandedThreat + ".")
    );
    if (!stillSelected) setExpandedThreat(null);
  }, [selectedThreats, expandedThreat]);

  // Stable callback for debounced search input
  const handleSearch = useCallback((value: string) => {
    setSearchFilter(value);
  }, [setSearchFilter]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const PAGE_SIZE = pageSize;

  // ── Data fetching ────────────────────────────────────────────────────
  // Species are fetched and cached in the shared SpeciesCacheContext (keyed by
  // the exact request URL, e.g. `/api/redlist/species?taxon=birds`), not local
  // component state — this is what lets compare mode's two panels share a
  // fetch when they pick the same taxon, and it naturally keeps Assessed vs Not
  // Evaluated data for the same taxon separate too, since their URLs differ
  // (`?taxon=birds` vs `?taxon=birds&category=NE`) without needing an explicit
  // mode-prefixed cache key.
  const error = useMemo(() => {
    if (selectedTaxa.size === 0) return null;
    const fetchSet = isNewAssessments && selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    const categoryParam = isNewAssessments ? "&category=NE" : "";
    for (const t of fetchSet) {
      if (isNewAssessments && t === "all") continue;
      const err = cache.errors[speciesApiUrl(t, categoryParam)];
      if (err) return err;
    }
    return null;
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, cache.errors, speciesApiUrl]);

  // Prefetch all species on mount so taxa clicks feel instant (skip for new-assessments — NE
  // dataset too large). Idempotent via the shared cache's request() — a no-op once
  // `?taxon=all` is cached or already in flight (e.g. requested by another compare-mode panel,
  // or by the per-taxon effect below reaching "all" first).
  useEffect(() => {
    if (isNewAssessments) return;
    cache.request(`${SPECIES_API}?taxon=all`);
  // Depends on cache.request specifically, not the whole cache object: the
  // linter conservatively wants the whole object for any method call off a
  // hook-returned value, but cache.request's identity only ever changes
  // together with cache.entries (see SpeciesCacheContext) — depending on the
  // whole object here would additionally re-run this effect on every
  // loadingUrls/errors-only update, e.g. another compare-mode panel's fetch
  // completing or failing, which has nothing to do with this taxon.
  }, [isNewAssessments, cache.request]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine which taxa need fetching, and request them from the shared cache
  useEffect(() => {
    if (selectedTaxa.size === 0) return;

    // In new-assessments mode, a drill-down fetches the SUB-GROUP directly so a sub-group of
    // a too-large aggregate (e.g. crustaceans under invertebrates, beetles under insects)
    // loads on its own instead of being filtered out of the parent's empty (tooLarge) result.
    const fetchSet = isNewAssessments && selectedSubgroups.size > 0
      ? [...selectedSubgroups]
      : [...selectedTaxa];
    const categoryParam = isNewAssessments ? "&category=NE" : "";

    // If "all" is already cached, no individual fetches needed — "all" data covers everything.
    if (cache.entries[speciesApiUrl("all", categoryParam)] && !selectedTaxa.has("all")) return;

    for (const taxonId of fetchSet) {
      if (isNewAssessments && taxonId === "all") continue; // NE dataset too large for "all"
      cache.request(speciesApiUrl(taxonId, categoryParam));
    }
  // cache.entries (for the "all" fast-path check above) + cache.request
  // specifically, not the whole cache object — see the prefetch effect
  // above for why depending on the whole object over-triggers this.
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, cache.entries, cache.request, speciesApiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Loading" means one of THIS panel's currently-relevant URLs is still in flight —
  // deliberately not "is anything in the shared cache loading", since in compare mode
  // that set can include requests belonging to the other panel entirely.
  const speciesLoading = useMemo(() => {
    if (selectedTaxa.size === 0) return false;
    const fetchSet = isNewAssessments && selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    const categoryParam = isNewAssessments ? "&category=NE" : "";
    return fetchSet.some(t => !(isNewAssessments && t === "all") && cache.loadingUrls.has(speciesApiUrl(t, categoryParam)));
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, cache.loadingUrls, speciesApiUrl]);

  // Merge species from all fetched taxa relevant to current selection
  const assessedSpecies = useMemo(() => {
    if (selectedTaxa.size === 0) return [];
    const categoryParam = isNewAssessments ? "&category=NE" : "";
    // If "all" is cached for this mode, use it directly
    const allEntry = cache.entries[speciesApiUrl("all", categoryParam)];
    if (allEntry) return allEntry.species;
    // In new-assessments mode a drill-down is fetched per sub-group, so merge those caches
    // when sub-groups are selected; otherwise merge the per-taxon caches.
    const sourceIds = isNewAssessments && selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    let merged: RedListSpecies[] = [];
    for (const taxonId of sourceIds) {
      const entry = cache.entries[speciesApiUrl(taxonId, categoryParam)];
      if (entry) merged = merged.concat(entry.species);
    }
    return merged;
  }, [selectedTaxa, selectedSubgroups, cache.entries, isNewAssessments, speciesApiUrl]);

  // Determine taxon for NE fetch: "all" if selected or multi-taxa, otherwise the single taxon
  const neFetchTaxon = useMemo(() => {
    if (selectedTaxa.size === 0) return null;
    if (selectedTaxa.has("all")) return "all";
    if (selectedTaxa.size === 1) return [...selectedTaxa][0];
    return "all";
  }, [selectedTaxa]);

  // NE species lazy loading (only fetched when NE category is selected in Assessed mode —
  // in new-assessments mode the main path above already fetches NE species). Shares the same
  // shared-cache URL as the new-assessments-mode fetch for the same taxon, so switching
  // between "Assessed + NE filter" and New Assessments for one taxon only ever fetches once.
  useEffect(() => {
    if (isNewAssessments) return;
    if (!selectedCategories.has("NE") || neFetchTaxon === null) return;
    cache.request(speciesApiUrl(neFetchTaxon, "&category=NE"));
    // cache.request specifically, not the whole cache object — same reasoning
    // as the prefetch effect above.
  }, [selectedCategories, neFetchTaxon, isNewAssessments, cache.request, speciesApiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const neSpecies = useMemo(() => {
    if (isNewAssessments || !selectedCategories.has("NE") || neFetchTaxon === null) return [];
    return cache.entries[speciesApiUrl(neFetchTaxon, "&category=NE")]?.species ?? [];
  }, [isNewAssessments, selectedCategories, neFetchTaxon, cache.entries, speciesApiUrl]);

  // "All Species" (or any multi-taxon selection, which also resolves neFetchTaxon to
  // "all") has ~1.8M not-evaluated species — far past querySpecies's NE_CAP, so the
  // fetch above would return tooLarge with an empty species list. Previously this just
  // made the pill silently disappear (neCount fell back to 0) while any already-active
  // "NE" filter stayed selected but matched nothing, showing "0 species" with no
  // explanation. Block it instead: keep the pill visible but disabled, and drop "NE"
  // from selectedCategories if a prior taxon-scoped selection is carried into this state.
  const neBlockedForAll = neFetchTaxon === "all";
  useEffect(() => {
    if (!neBlockedForAll) return;
    setSelectedCategories(prev => {
      if (!prev.has("NE")) return prev;
      const next = new Set(prev);
      next.delete("NE");
      return next;
    });
  }, [neBlockedForAll, setSelectedCategories]);

  // All species = assessed + NE (in new-assessments mode, assessedSpecies already contains NE species)
  const species = useMemo(() => isNewAssessments ? assessedSpecies : [...assessedSpecies, ...neSpecies], [assessedSpecies, neSpecies, isNewAssessments]);
  const neCount = neSpecies.length;

  // Filter by selected taxa + subgroup only — no other filters applied. This is
  // the "true total" baseline the Country map tooltip shows alongside its fully
  // filtered count (see countryStatsForMapTotal below), since every memo past
  // this point narrows further.
  const taxaFilteredSpeciesBase = useMemo(() => {
    let filtered = species;
    // In new-assessments mode with a sub-group selected, species were fetched per sub-group
    // (taxon_id = the sub-group), so the speciesMatchesNode filter below is authoritative —
    // skip the parent taxon_id filter, which would otherwise drop them.
    if (selectedTaxa.size > 0 && !selectedTaxa.has("all") && !(isNewAssessments && selectedSubgroups.size > 0)) {
      // Display-root entries (the 8 taxa) match by taxon_id. Any selected taxon
      // that isn't a taxonomy node — an arbitrary rank like ?taxa=turdidae — is
      // matched against the species' own class/order/family (#261).
      const arbitrary = [...selectedTaxa].filter((t) => t !== "all" && !findNode(t)).map((t) => t.toLowerCase());
      filtered = filtered.filter((s) =>
        (s.taxon_id != null && selectedTaxa.has(s.taxon_id)) ||
        (arbitrary.length > 0 && arbitrary.some((v) =>
          (s.class_name ?? "").toLowerCase() === v ||
          (s.order_name ?? "").toLowerCase() === v ||
          (s.family ?? "").toLowerCase() === v)),
      );
    }
    if (selectedSubgroups.size > 0) {
      filtered = filtered.filter(s =>
        Array.from(selectedSubgroups).some(sg => speciesMatchesNode(s, sg))
      );
    }
    // Narrow to one breakdown row from a described-species popover (bd= URL param —
    // see TaxaSummary.tsx's BreakdownList). Gated on the filter's own nodeId still
    // being selected: a stale bd= surviving a later, unrelated navigation (any
    // setSelectedSubgroups/setSelectedTaxa call resets it, but this is a second,
    // cheap line of defense) becomes inert instead of silently hiding every species.
    if (breakdownFilter && selectedSubgroups.has(breakdownFilter.nodeId)) {
      filtered = filtered.filter(s => matchesBreakdownName(s, breakdownFilter.rank, breakdownFilter.name, breakdownFilter.nodeId));
      // CoL Match / No CoL Match split within this name's Assessed count (only
      // meaningful for assessed species, which is all `species` is in reassessments
      // mode — the id lists are only ever sent alongside view=reassessments).
      if (breakdownFilter.onlyIds?.length) {
        const ids = new Set(breakdownFilter.onlyIds);
        filtered = filtered.filter(s => s.sis_taxon_id != null && ids.has(s.sis_taxon_id));
      } else if (breakdownFilter.excludeIds?.length) {
        const ids = new Set(breakdownFilter.excludeIds);
        filtered = filtered.filter(s => s.sis_taxon_id == null || !ids.has(s.sis_taxon_id));
      }
    }
    return filtered;
  }, [species, selectedTaxa, selectedSubgroups, isNewAssessments, breakdownFilter]);

  // Exact URL-only base filters (obs / assessment-year / described-year bounds —
  // outdated is applied separately below, not here). Applied here on the base set
  // so every chart AND the table inherit them — and identically to the bucket-free
  // /browse + MCP query, which is what makes an agent's dashboard link reproduce
  // the same species set. Mirrors species-filter numeric bounds.
  const taxaFilteredSpeciesExceptOutdated = useMemo(() => {
    let filtered = taxaFilteredSpeciesBase;
    const { minObs, maxObs, minAssessmentYear, maxAssessmentYear, minDescribedYear, maxDescribedYear } = exactFilters;
    if (minObs != null || maxObs != null) {
      filtered = filtered.filter(s => {
        const obs = s.gbif_occurrence_count ?? 0;
        return (minObs == null || obs >= minObs) && (maxObs == null || obs <= maxObs);
      });
    }
    if (minAssessmentYear != null || maxAssessmentYear != null) {
      filtered = filtered.filter(s => {
        const y = s.assessment_date ? parseInt(s.assessment_date.slice(0, 4), 10) : NaN;
        if (Number.isNaN(y)) return false;
        return (minAssessmentYear == null || y >= minAssessmentYear) && (maxAssessmentYear == null || y <= maxAssessmentYear);
      });
    }
    if (minDescribedYear != null || maxDescribedYear != null) {
      filtered = filtered.filter(s =>
        s.described_year != null
        && (minDescribedYear == null || s.described_year >= minDescribedYear)
        && (maxDescribedYear == null || s.described_year <= maxDescribedYear));
    }
    return filtered;
  }, [taxaFilteredSpeciesBase, exactFilters]);

  // Outdated is excluded from taxaFilteredSpeciesExceptOutdated (above) so the
  // Range/Year chart (which shares this same "when was this species assessed"
  // dimension) can show the full distribution and mute — not remove — bars that
  // don't match the Outdated toggle, mirroring how the Conservation Status chart
  // mutes bars for selectedCategories rather than dropping them. Every other
  // memo/the table uses this outdated-filtered version, so the Outdated button
  // behaves like a real, dashboard-wide filter everywhere except its own chart.
  const taxaFilteredSpecies = useMemo(() => {
    if (!exactFilters.outdated) return taxaFilteredSpeciesExceptOutdated;
    const wantOutdated = exactFilters.outdated === "yes";
    return taxaFilteredSpeciesExceptOutdated.filter(s => isOutdated(s.assessment_date) === wantOutdated);
  }, [taxaFilteredSpeciesExceptOutdated, exactFilters.outdated]);

  // Helper to check if species matches year range filter
  const matchesYearRangeFilter = useCallback((assessmentDate: string | null, yearRanges: Set<string> = selectedYearRanges): boolean => {
    if (yearRanges.size === 0) return true;
    if (!assessmentDate) return false;
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const yearsSince = (Date.now() - new Date(assessmentDate).getTime()) / msPerYear;
    for (const range of yearRanges) {
      switch (range) {
        case "<1 year": if (yearsSince < 1) return true; break;
        case "1-5 years": if (yearsSince >= 1 && yearsSince < 5) return true; break;
        case "5-10 years": if (yearsSince >= 5 && yearsSince < 10) return true; break;
        case "10-20 years": if (yearsSince >= 10 && yearsSince < 20) return true; break;
        case "20+ years": if (yearsSince >= 20) return true; break;
      }
    }
    return false;
  }, [selectedYearRanges]);

  // Helper to check if species matches specific assessment year(s) filter
  const matchesAssessmentYearFilter = useCallback((assessmentDate: string | null, years: Set<string> = selectedAssessmentYears): boolean => {
    if (years.size === 0) return true;
    if (!assessmentDate) return false;
    const year = String(new Date(assessmentDate).getFullYear());
    return years.has(year);
  }, [selectedAssessmentYears]);

  // Helper to check if species matches GBIF observation range filter
  const matchesObsRangeFilter = useCallback((obsCount: number | null | undefined, obsRanges: Set<string> = selectedObsRanges): boolean => {
    if (obsRanges.size === 0) return true;
    const obs = obsCount ?? 0;
    for (const range of obsRanges) {
      switch (range) {
        case "0": if (obs === 0) return true; break;
        case "1-10": if (obs >= 1 && obs <= 10) return true; break;
        case "11-100": if (obs >= 11 && obs <= 100) return true; break;
        case "101-1K": if (obs >= 101 && obs <= 1000) return true; break;
        case "1K-10K": if (obs >= 1001 && obs <= 10000) return true; break;
        case "10K+": if (obs > 10000) return true; break;
      }
    }
    return false;
  }, [selectedObsRanges]);

  // CoL description-year range bucket for a species (NE/new-assessments only).
  // "Unknown" covers names CoL has no datable source for (chiefly plants/fungi,
  // whose author citations omit the year and lack a dated reference).
  const describedYearBucket = useCallback((year: number | null | undefined): string => {
    if (year == null) return "Unknown";
    if (year < 1900) return "pre-1900";
    if (year < 1950) return "1900-1949";
    if (year < 2000) return "1950-1999";
    if (year < 2010) return "2000-2009";
    if (year < 2020) return "2010-2019";
    return "2020+";
  }, []);

  // Helper to check if species matches the described-year bucket filter
  const matchesDescribedYearFilter = useCallback((year: number | null | undefined, buckets: Set<string> = selectedDescribedYears): boolean => {
    if (buckets.size === 0) return true;
    return buckets.has(describedYearBucket(year));
  }, [selectedDescribedYears, describedYearBucket]);

  // Assessors/reviewers from the latest assessment. These are denormalized inline
  // on the species list (latest_assessors/latest_reviewers) so the filter works
  // without the full history array (which is fetched lazily for the detail panel).
  const getSpeciesAssessors = useCallback((s: Species): string[] => {
    return parseAssessors(s.latest_assessors);
  }, []);

  const getSpeciesReviewers = useCallback((s: Species): string[] => {
    return parseAssessors(s.latest_reviewers);
  }, []);

  // Track which view is active in the years-since-assessed chart ("range" buckets vs specific year).
  // Defaults to "year" when a specific-year filter is already active (e.g. from URL).
  const [yearsChartMode, setYearsChartMode] = useState<"range" | "year">(
    () => (selectedAssessmentYears.size > 0 ? "year" : "range")
  );
  // If the URL hydrates with specific years selected after mount, surface the year view.
  useEffect(() => {
    if (selectedAssessmentYears.size > 0) {
      setYearsChartMode("year");
    }
  }, [selectedAssessmentYears]);
  // Paginate the by-year chart: show 10 years at a time, defaulting to the most recent
  const YEARS_PAGE_SIZE = 10;
  const [yearsPage, setYearsPage] = useState(0);

  // Helper to check if species matches the assessors filter.
  // Case-insensitive SUBSTRING match — same semantics as the /browse + MCP
  // `assessors` filter, so an agent's dashboard link reproduces the same set.
  // (A chart click adds a full name, which substring-matches itself; the only
  // difference is the rare case where one full name is a substring of another.)
  const matchesAssessorsFilter = useCallback((s: Species): boolean => {
    if (selectedAssessors.size === 0) return true;
    const sels = [...selectedAssessors].map(x => x.toLowerCase());
    return getSpeciesAssessors(s).some(a => { const al = a.toLowerCase(); return sels.some(x => al.includes(x)); });
  }, [selectedAssessors, getSpeciesAssessors]);

  // Helper to check if species matches the reviewers filter (substring, as above).
  const matchesReviewersFilter = useCallback((s: Species): boolean => {
    if (selectedReviewers.size === 0) return true;
    const sels = [...selectedReviewers].map(x => x.toLowerCase());
    return getSpeciesReviewers(s).some(r => { const rl = r.toLowerCase(); return sels.some(x => rl.includes(x)); });
  }, [selectedReviewers, getSpeciesReviewers]);

  // Species details cache (images, criteria, common names)
  const [speciesDetails, setSpeciesDetails] = useState<Record<number, SpeciesDetails>>({});
  // Lazy assessment-history cache, keyed by sis_taxon_id. The species list no
  // longer carries the full history array; it's fetched when a detail row opens.
  const [assessmentHistory, setAssessmentHistory] = useState<Record<number, Species["previous_assessments"]>>({});
  // Catalogue of Life synonyms for the open species (detail panel's CoL tab), fetched lazily.
  type SynInfo = { col_id: string | null; accepted_name: string | null; accepted_authorship: string | null; synonyms: { name: string; authorship: string | null; status: string }[] };
  const [synonymsBySpecies, setSynonymsBySpecies] = useState<Record<string, SynInfo>>({});

  // Row expansion state (initialized from URL params if present)
  const [selectedSpeciesKey, setSelectedSpeciesKeyRaw] = useState<number | null>(urlSpecies != null && isNewAssessments ? Math.abs(urlSpecies) : urlSpecies);
  const [activeDetailTab, setActiveDetailTabRaw] = useState<"gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol">(urlTab ?? "gbif");
  // Track which tabs have been visited so we only mount (and fetch data for) a tab on first click
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([urlTab ?? "gbif"]));
  const urlSpeciesHandledRef = useRef(false);
  // Track whether a tab change was initiated programmatically (click) vs URL navigation (popstate)
  const programmaticTabChangeRef = useRef(false);
  // Whether the user has explicitly picked a tab for the currently open species.
  // When the occurrence tab turns up no records for a not-evaluated species we
  // auto-switch to Catalogue of Life — but only while the user hasn't chosen a tab.
  const manualTabSelectionRef = useRef(false);
  // Guards the auto-switch so it fires at most once per opened species.
  const autoColSwitchedRef = useRef(false);

  // Wrap setters to sync with URL
  const setSelectedSpeciesKey = useCallback((key: number | null) => {
    setSelectedSpeciesKeyRaw(key);
    setSpeciesParam(key, key != null ? "gbif" : "gbif");
    if (key != null) {
      setActiveDetailTabRaw("gbif");
      setVisitedTabs(new Set(["gbif"]));
      manualTabSelectionRef.current = false;
      autoColSwitchedRef.current = false;
    }
  }, [setSpeciesParam]);

  const setActiveDetailTab = useCallback((tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol", isManual = true) => {
    setActiveDetailTabRaw(tab);
    programmaticTabChangeRef.current = true;
    if (isManual) manualTabSelectionRef.current = true;
    setTabParam(tab);
    setVisitedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [setTabParam]);

  // When the occurrence tab (GBIF + iNat) reports no records for a not-evaluated
  // species, fall back to the Catalogue of Life tab — unless the user has already
  // navigated to a tab themselves.
  const handleOccurrenceEmpty = useCallback(() => {
    if (manualTabSelectionRef.current || autoColSwitchedRef.current) return;
    autoColSwitchedRef.current = true;
    setActiveDetailTab("col", false);
  }, [setActiveDetailTab]);
  // Sync species/tab from URL params (fires on popstate, e.g. back/forward or search bar navigation)
  // In new-assessments mode, row keys use Math.abs(id) so selectedSpeciesKey must match.
  useEffect(() => {
    if (urlSpecies != null) {
      // Skip visitedTabs reset for programmatic (click) tab changes – only reset on URL navigation
      if (programmaticTabChangeRef.current) {
        programmaticTabChangeRef.current = false;
        return;
      }
      setSelectedSpeciesKeyRaw(isNewAssessments ? Math.abs(urlSpecies) : urlSpecies);
      setActiveDetailTabRaw(urlTab ?? "gbif");
      setVisitedTabs(new Set([urlTab ?? "gbif"]));
      // A tab pinned in the URL counts as an explicit choice, so don't auto-switch.
      manualTabSelectionRef.current = urlTab != null && urlTab !== "gbif";
      autoColSwitchedRef.current = false;
      urlSpeciesHandledRef.current = false; // allow auto-page-navigate for new species
    }
  }, [urlSpecies, urlTab, isNewAssessments]);

  // Single-species fast path: use cached search result to render the detail panel
  // immediately without waiting for the bulk table to load.
  const [singleSpeciesPreview, setSingleSpeciesPreview] = useState<RedListSpecies | null>(null);
  useEffect(() => {
    if (urlSpecies == null) {
      setSingleSpeciesPreview(null);
      return;
    }
    // Skip if species is already in bulk-loaded data
    const bulkTaxon = selectedTaxa.size === 1 ? [...selectedTaxa][0] : "all";
    const bulkUrl = speciesApiUrl(bulkTaxon, isNewAssessments ? "&category=NE" : "");
    const allSpecies = [...(cache.entries[bulkUrl]?.species ?? []), ...neSpecies];
    if (allSpecies.some(s => s.id === urlSpecies)) {
      setSingleSpeciesPreview(null);
      return;
    }

    // Use cached search result to construct preview (no API call needed)
    const cached = getLastSearchResult();
    if (cached && cached.id === urlSpecies) {
      clearLastSearchResult();
      setSingleSpeciesPreview({
        id: cached.id,
        sis_taxon_id: cached.id > 0 ? cached.id : null,
        assessment_id: cached.assessment_id,
        scientific_name: cached.scientific_name,
        common_name: cached.common_name,
        family: null,
        category: cached.category,
        assessment_date: cached.assessment_date,
        year_published: null,
        population_trend: null,
        countries: cached.countries,
        class_name: null,
        order_name: null,
        taxon_group: cached.taxon_group,
        taxon_id: cached.taxon_id,
        described_year: null,
        gbif_species_key: cached.gbif_species_key,
        gbif_occurrence_count: null,
        gbif_observations_after_assessment_year: null,
        latest_assessors: null,
        latest_reviewers: null,
        previous_assessments: [],
        systems: [],
        growth_forms: [],
        movement_pattern: null,
        possibly_extinct: false,
        possibly_extinct_in_the_wild: false,
        criteria: null,
        threat_codes: [],
      });
      urlSpeciesHandledRef.current = true;
    }
  }, [urlSpecies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear preview once the species appears in bulk-loaded data
  useEffect(() => {
    if (!singleSpeciesPreview) return;
    const allSpecies = [...assessedSpecies, ...neSpecies];
    if (allSpecies.some(s => s.id === singleSpeciesPreview.id)) {
      setSingleSpeciesPreview(null);
    }
  }, [assessedSpecies, neSpecies, singleSpeciesPreview]);

  const [mounted, setMounted] = useState(false);


  // Pinned species as ordered array (persisted to localStorage)
  const [pinnedSpecies, setPinnedSpecies] = useState<number[]>([]);
  const pinnedSet = useMemo(() => new Set(pinnedSpecies), [pinnedSpecies]); // For O(1) lookup

  // Drag state for reordering pinned species
  const [draggedSpecies, setDraggedSpecies] = useState<number | null>(null);
  const [dragOverSpecies, setDragOverSpecies] = useState<number | null>(null);

  const pinnedStorageKey = isNewAssessments ? "new-assessments-pinned-species" : "redlist-pinned-species";

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load pinned species from localStorage (re-load when viewMode changes)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(pinnedStorageKey);
      setPinnedSpecies(stored ? JSON.parse(stored) : []);
    } catch {
      setPinnedSpecies([]);
    }
  }, [pinnedStorageKey]);

  // Save pinned species to localStorage
  const savePinnedSpecies = (newPinned: number[]) => {
    setPinnedSpecies(newPinned);
    try {
      localStorage.setItem(pinnedStorageKey, JSON.stringify(newPinned));
    } catch {
      // Ignore localStorage errors
    }
  };

  // Toggle pin status
  const togglePinned = (speciesId: number) => {
    if (pinnedSet.has(speciesId)) {
      savePinnedSpecies(pinnedSpecies.filter(id => id !== speciesId));
    } else {
      savePinnedSpecies([...pinnedSpecies, speciesId]);
    }
  };

  // Drag handlers for reordering
  const handleDragStart = (e: React.DragEvent, speciesId: number) => {
    if (!pinnedSet.has(speciesId)) return;
    setDraggedSpecies(speciesId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, speciesId: number) => {
    e.preventDefault();
    if (!draggedSpecies || !pinnedSet.has(speciesId)) return;
    setDragOverSpecies(speciesId);
  };

  const handleDragLeave = () => {
    setDragOverSpecies(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (!draggedSpecies || draggedSpecies === targetId) {
      setDraggedSpecies(null);
      setDragOverSpecies(null);
      return;
    }

    const draggedIdx = pinnedSpecies.indexOf(draggedSpecies);
    const targetIdx = pinnedSpecies.indexOf(targetId);

    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedSpecies(null);
      setDragOverSpecies(null);
      return;
    }

    // Reorder the array
    const newPinned = [...pinnedSpecies];
    newPinned.splice(draggedIdx, 1);
    newPinned.splice(targetIdx, 0, draggedSpecies);
    savePinnedSpecies(newPinned);

    setDraggedSpecies(null);
    setDragOverSpecies(null);
  };

  const handleDragEnd = () => {
    setDraggedSpecies(null);
    setDragOverSpecies(null);
  };

  // ── Cross-filter chart data (client-computed) ────────────────────────

  const matchesSearch = useCallback((s: Species) => {
    if (!searchFilter) return true;
    return s.scientific_name.toLowerCase().includes(searchFilter) ||
      !!s.common_name?.toLowerCase().includes(searchFilter);
  }, [searchFilter]);

  // Category chart: apply all filters EXCEPT category
  const categoryDataWithPercent = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      counts[s.category] = (counts[s.category] || 0) + 1;
    });
    const DISPLAY_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD"];
    const total = DISPLAY_ORDER.reduce((sum, code) => sum + (counts[code] || 0), 0);
    return DISPLAY_ORDER.map(code => ({
      code,
      name: code,
      count: counts[code] || 0,
      color: CATEGORY_COLORS[code] || "#999",
      percent: total > 0 ? (((counts[code] || 0) / total) * 100).toFixed(1) : "0",
      label: `${(counts[code] || 0).toLocaleString()} (${total > 0 ? (((counts[code] || 0) / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpecies, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Year chart: apply all filters EXCEPT year range AND outdated (see
  // taxaFilteredSpeciesExceptOutdated above) — buckets align exactly with the
  // isOutdated() threshold (>10 years) so the Outdated toggle mutes rather than
  // zeroes out the buckets that don't match.
  const assessmentYearData = useMemo(() => {
    const now = Date.now();
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const ranges = [
      { range: "<1 year", shortRange: "<1y", count: 0, minYear: 0 },
      { range: "1-5 years", shortRange: "1-5y", count: 0, minYear: 1 },
      { range: "5-10 years", shortRange: "5-10y", count: 0, minYear: 5 },
      { range: "10-20 years", shortRange: "10-20y", count: 0, minYear: 10 },
      { range: "20+ years", shortRange: ">20y", count: 0, minYear: 20 },
    ];
    taxaFilteredSpeciesExceptOutdated.forEach(s => {
      if (!s.assessment_date || s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const yearsSince = (now - new Date(s.assessment_date).getTime()) / msPerYear;
      if (yearsSince < 1) ranges[0].count++;
      else if (yearsSince < 5) ranges[1].count++;
      else if (yearsSince < 10) ranges[2].count++;
      else if (yearsSince < 20) ranges[3].count++;
      else ranges[4].count++;
    });
    const total = ranges.reduce((sum, r) => sum + r.count, 0);
    return ranges.map(r => ({
      ...r,
      label: `${r.count.toLocaleString()} (${total > 0 ? ((r.count / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpeciesExceptOutdated, selectedCategories, selectedCountries, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter]);

  // Assessments-by-year chart: apply all filters EXCEPT the year-based ones
  // (selectedYearRanges, selectedAssessmentYears) AND outdated. The Range bucket
  // chart and the Year chart share a single cross-filter facet ("when was this
  // species assessed"), so we exclude selectedYearRanges/selectedAssessmentYears
  // here — the by-year chart should always show the full timeline so users can
  // switch/expand their year selection regardless of what they picked in the
  // range view, and vice-versa — and we exclude outdated for the same reason
  // isOutdated is excluded from assessmentYearData above.
  const assessmentYearsByYearData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpeciesExceptOutdated.forEach(s => {
      if (!s.assessment_date || s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const year = String(new Date(s.assessment_date).getFullYear());
      counts[year] = (counts[year] || 0) + 1;
    });
    const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
    // Sort years ascending so the horizontal chart reads chronologically (oldest → newest)
    return Object.entries(counts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, count]) => ({
        code: year,
        count,
        label: `${count.toLocaleString()} (${total > 0 ? ((count / total) * 100).toFixed(1) : 0}%)`,
      }));
  }, [taxaFilteredSpeciesExceptOutdated, selectedCategories, selectedCountries, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter]);

  const yearsTotalPages = Math.max(1, Math.ceil(assessmentYearsByYearData.length / YEARS_PAGE_SIZE));
  const paginatedAssessmentYearsData = useMemo(
    () => assessmentYearsByYearData.slice(yearsPage * YEARS_PAGE_SIZE, (yearsPage + 1) * YEARS_PAGE_SIZE),
    [assessmentYearsByYearData, yearsPage]
  );
  // Global max across all years so the Y-axis scale stays fixed as users page
  const yearsGlobalMax = useMemo(
    () => assessmentYearsByYearData.reduce((m, d) => Math.max(m, d.count), 0),
    [assessmentYearsByYearData]
  );

  // Jump to the most recent page when Year view is first entered — either on
  // the initial mount (when the URL already selects a specific year) or on the
  // Range → Year toggle. A ref initialized to `null` detects "never been in
  // year view before". Unrelated cross-filter changes that reshape
  // yearsTotalPages don't teleport the user, because this effect only fires
  // its body on the transition, not on every dataset update.
  const prevYearsChartModeRef = useRef<"range" | "year" | null>(null);
  useEffect(() => {
    if (yearsChartMode === "year" && prevYearsChartModeRef.current !== "year") {
      setYearsPage(Math.max(0, yearsTotalPages - 1));
    }
    prevYearsChartModeRef.current = yearsChartMode;
  }, [yearsChartMode, yearsTotalPages]);
  // Clamp yearsPage into the valid range when the dataset shrinks beneath it,
  // but preserve the user's current page otherwise so cross-filter tweaks
  // don't bounce them away from the years they were browsing.
  useEffect(() => {
    if (yearsPage > yearsTotalPages - 1) {
      setYearsPage(Math.max(0, yearsTotalPages - 1));
    }
  }, [yearsPage, yearsTotalPages]);

  // GBIF observations chart: apply all filters EXCEPT obs range
  const gbifObsData = useMemo(() => {
    const ranges = [
      { range: "0", shortRange: "0", count: 0 },
      { range: "1-10", shortRange: "1-10", count: 0 },
      { range: "11-100", shortRange: "11-100", count: 0 },
      { range: "101-1K", shortRange: "101-1K", count: 0 },
      { range: "1K-10K", shortRange: "1K-10K", count: 0 },
      { range: "10K+", shortRange: "10K+", count: 0 },
    ];
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const obs = s.gbif_occurrence_count ?? 0;
      if (obs === 0) ranges[0].count++;
      else if (obs <= 10) ranges[1].count++;
      else if (obs <= 100) ranges[2].count++;
      else if (obs <= 1000) ranges[3].count++;
      else if (obs <= 10000) ranges[4].count++;
      else ranges[5].count++;
    });
    const total = ranges.reduce((sum, r) => sum + r.count, 0);
    return ranges.map(r => ({
      ...r,
      label: `${r.count.toLocaleString()} (${total > 0 ? ((r.count / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Year Described chart (NE / new-assessments only): per-bucket counts, cross-filtered
  // by every OTHER active filter (search, country, GBIF obs) but NOT the described-year
  // selection itself. Only NE rows carry described_year; in new-assessments all rows are NE.
  const describedYearData = useMemo(() => {
    const buckets = ["pre-1900", "1900-1949", "1950-1999", "2000-2009", "2010-2019", "2020+", "Unknown"];
    const counts: Record<string, number> = Object.fromEntries(buckets.map(b => [b, 0]));
    taxaFilteredSpecies.forEach(s => {
      if (s.category !== "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (!matchesObsRangeFilter(s.gbif_occurrence_count)) return;
      counts[describedYearBucket(s.described_year)]++;
    });
    const total = buckets.reduce((sum, b) => sum + counts[b], 0);
    return buckets
      .map(b => ({
        range: b,
        shortRange: b,
        count: counts[b],
        label: `${counts[b].toLocaleString()} (${total > 0 ? ((counts[b] / total) * 100).toFixed(1) : 0}%)`,
      }))
      .filter(d => d.count > 0);
  }, [taxaFilteredSpecies, selectedCountries, matchesSearch, matchesObsRangeFilter, describedYearBucket]);

  // Country chart: apply all filters EXCEPT country
  const { countryStatsForMap } = useMemo(() => {
    const counts: Record<string, number> = {};
    const outdatedCounts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      // Gated on NE the same way the assessment-year filters above are, since NE species have no assessment.
      const outdated = s.category !== "NE" && isOutdated(s.assessment_date);
      s.countries.forEach(code => {
        counts[code] = (counts[code] || 0) + 1;
        if (outdated) outdatedCounts[code] = (outdatedCounts[code] || 0) + 1;
      });
    });
    const sorted = Object.entries(counts)
      .sort((a, b) => {
        const nameA = ALPHA2_TO_NAME[a[0]] || a[0];
        const nameB = ALPHA2_TO_NAME[b[0]] || b[0];
        return nameA.localeCompare(nameB);
      })
      .map(([code]) => code);
    const statsForMap = Object.fromEntries(
      Object.entries(counts).map(([code, count]) => [
        code,
        { occurrences: 0, species: count, outdated: outdatedCounts[code] || 0 }
      ])
    );
    return { countryCounts: counts, uniqueCountries: sorted, countryStatsForMap: statsForMap };
  }, [taxaFilteredSpecies, selectedCategories, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // True per-country totals — taxon/subgroup selection only, no other filters —
  // so the Country map tooltip can show "142 of 3,847 total" instead of just
  // "142" when a filter (e.g. Outdated, a category) narrows the country's
  // species count. Without this, e.g. "% Outdated: 100%" while the Outdated
  // toggle is on reads as a fact about the country instead of a tautology.
  const countryStatsForMapTotal = useMemo(() => {
    const counts: Record<string, number> = {};
    const outdatedCounts: Record<string, number> = {};
    taxaFilteredSpeciesBase.forEach(s => {
      const outdated = s.category !== "NE" && isOutdated(s.assessment_date);
      s.countries.forEach(code => {
        counts[code] = (counts[code] || 0) + 1;
        if (outdated) outdatedCounts[code] = (outdatedCounts[code] || 0) + 1;
      });
    });
    return Object.fromEntries(
      Object.entries(counts).map(([code, count]) => [
        code,
        { occurrences: 0, species: count, outdated: outdatedCounts[code] || 0 }
      ])
    );
  }, [taxaFilteredSpeciesBase]);

  // Realm counts: apply all filters EXCEPT systems (for realm button tooltips)
  const realmCounts = useMemo(() => {
    const counts: Record<string, number> = { Terrestrial: 0, Freshwater: 0, Marine: 0 };
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      for (const sys of s.systems ?? []) {
        if (sys in counts) counts[sys]++;
      }
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, endemicsOnly, matchesObsRangeFilter, matchesYearRangeFilter, selectedGrowthForms, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Population trend counts: apply all filters EXCEPT population trend
  const populationTrendCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!s.population_trend) return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      counts[s.population_trend] = (counts[s.population_trend] || 0) + 1;
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedMovementPatterns, selectedThreats, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, endemicsOnly, matchesObsRangeFilter, matchesYearRangeFilter, selectedGrowthForms, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Movement pattern counts: apply all filters EXCEPT movement pattern
  const movementPatternCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!s.movement_pattern) return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      counts[s.movement_pattern] = (counts[s.movement_pattern] || 0) + 1;
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedThreats, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, endemicsOnly, matchesObsRangeFilter, matchesYearRangeFilter, selectedGrowthForms, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Threat counts: apply all filters EXCEPT threats (count species per prefix, deduplicated)
  // Threat counts per code, plus the denominator (`threatTotal`) for percentages:
  // every in-view species that passes the same filters, with or without a threat
  // coded. The threat *selection* is intentionally excluded here, so both the
  // counts and the percentage stay stable as threats are clicked.
  const { threatCounts, threatTotal } = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      total++;
      if (!s.threat_codes?.length) return;
      // Deduplicate: count each prefix at most once per species
      const counted = new Set<string>();
      for (const tc of s.threat_codes) {
        const parts = tc.split(".");
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join(".");
          if (!counted.has(prefix)) {
            counted.add(prefix);
            counts[prefix] = (counts[prefix] || 0) + 1;
          }
        }
      }
    });
    return { threatCounts: counts, threatTotal: total };
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Handle region filter — select all countries in the chosen region
  const handleRegionFilter = useCallback((region: string) => {
    if (!region) {
      setSelectedCountries(new Set());
      return;
    }
    setSelectedCountries(new Set(iucnRegionCountries(region)));
  }, [setSelectedCountries]);

  // Assessor chart: apply all filters EXCEPT assessors (include reviewers)
  const assessorChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (!matchesReviewersFilter(s)) return;
      const assessors = getSpeciesAssessors(s);
      for (const a of assessors) {
        counts[a] = (counts[a] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        code: name,
        count,
        label: count.toLocaleString(),
      }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, matchesSearch, matchesReviewersFilter, getSpeciesAssessors, matchesObsRangeFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Reviewer chart: apply all filters EXCEPT reviewers (include assessors)
  const reviewerChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (!matchesAssessorsFilter(s)) return;
      const reviewers = getSpeciesReviewers(s);
      for (const r of reviewers) {
        counts[r] = (counts[r] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        code: name,
        count,
        label: count.toLocaleString(),
      }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, matchesSearch, matchesAssessorsFilter, getSpeciesReviewers, matchesObsRangeFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // ── Client-side filtering and sorting ──────────────────────────────
  const { filteredSpecies, sortedSpecies } = useMemo(() => {
    const CATEGORY_ORDER: Record<string, number> = {
      EX: 0, EW: 1, CR: 2, EN: 3, VU: 4, NT: 5, LC: 6, DD: 7, NE: 8,
    };
    const filtered = taxaFilteredSpecies.filter((s) => {
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(s.category);
      const matchesYear = s.category === "NE" || (matchesYearRangeFilter(s.assessment_date) && matchesAssessmentYearFilter(s.assessment_date));
      // Described-year applies to NE rows only (the only ones carrying described_year).
      const matchesDescribed = s.category !== "NE" || matchesDescribedYearFilter(s.described_year);
      const matchesObs = matchesObsRangeFilter(s.gbif_occurrence_count);
      const matchesCountry = selectedCountries.size === 0 || s.countries.some(c => selectedCountries.has(c));
      const matchesSystem = selectedSystems.size === 0 || s.systems?.some(sys => selectedSystems.has(sys));
      const matchesTrend = selectedPopulationTrends.size === 0 || (s.population_trend != null && selectedPopulationTrends.has(s.population_trend));
      const matchesMovement = selectedMovementPatterns.size === 0 || (s.movement_pattern != null && selectedMovementPatterns.has(s.movement_pattern));
      const matchesThreat = selectedThreats.size === 0 || s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")));
      const matchesEndemic = !endemicsOnly || s.countries.length === 1;
      const matchesGrowth = selectedGrowthForms.size === 0 || s.growth_forms?.some(gf => selectedGrowthForms.has(gf));
      const matchesSearch =
        !searchFilter ||
        s.scientific_name.toLowerCase().includes(searchFilter) ||
        s.common_name?.toLowerCase().includes(searchFilter);
      const matchesAssessor = matchesAssessorsFilter(s);
      const matchesReviewer = matchesReviewersFilter(s);
      const pinnedKey = isNewAssessments ? Math.abs(s.id) : s.sis_taxon_id;
      const matchesStarred = !showOnlyStarred || (pinnedKey != null && pinnedSet.has(pinnedKey));
      return matchesCategory && matchesYear && matchesDescribed && matchesObs && matchesCountry && matchesSystem && matchesTrend && matchesMovement && matchesThreat && matchesEndemic && matchesGrowth && matchesSearch && matchesAssessor && matchesReviewer && matchesStarred;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (showOnlyStarred) {
        const aKey = isNewAssessments ? Math.abs(a.id) : a.sis_taxon_id;
        const bKey = isNewAssessments ? Math.abs(b.id) : b.sis_taxon_id;
        if (aKey != null && bKey != null) {
          const aIdx = pinnedSpecies.indexOf(aKey);
          const bIdx = pinnedSpecies.indexOf(bKey);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        }
      }

      let comparison = 0;
      if (isNewAssessments && !sortField) {
        // Default sort for new-assessments: by total GBIF desc
        comparison = (a.gbif_occurrence_count ?? -1) - (b.gbif_occurrence_count ?? -1);
      } else if (!sortField || sortField === "year") {
        const dateA = a.assessment_date ? new Date(a.assessment_date).getTime() : 0;
        const dateB = b.assessment_date ? new Date(b.assessment_date).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortField === "category") {
        comparison = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
      } else if (sortField === "totalGbif") {
        comparison = (a.gbif_occurrence_count ?? -1) - (b.gbif_occurrence_count ?? -1);
      } else if (sortField === "newGbif") {
        comparison = (a.gbif_observations_after_assessment_year ?? -1) - (b.gbif_observations_after_assessment_year ?? -1);
      } else if (sortField === "pctNewGbif") {
        const pctA = (a.gbif_occurrence_count && a.gbif_occurrence_count > 0 && a.gbif_observations_after_assessment_year != null)
          ? a.gbif_observations_after_assessment_year / a.gbif_occurrence_count : -1;
        const pctB = (b.gbif_occurrence_count && b.gbif_occurrence_count > 0 && b.gbif_observations_after_assessment_year != null)
          ? b.gbif_observations_after_assessment_year / b.gbif_occurrence_count : -1;
        comparison = pctA - pctB;
      } else if (sortField === "describedYear") {
        // Nulls (no known year) sort to the bottom regardless of direction below.
        comparison = (a.described_year ?? -1) - (b.described_year ?? -1);
      }

      // Apply primary sort direction
      const primary = sortDirection === "asc" ? comparison : -comparison;
      if (primary !== 0) return primary;

      // Secondary sort: total GBIF desc (always, regardless of primary direction)
      const gbifCmp = (b.gbif_occurrence_count ?? -1) - (a.gbif_occurrence_count ?? -1);
      if (gbifCmp !== 0) return gbifCmp;

      // Tertiary tiebreaker: stable ID order
      return (a.sis_taxon_id ?? a.id) - (b.sis_taxon_id ?? b.id);
    });

    return { filteredSpecies: filtered, sortedSpecies: sorted };
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, endemicsOnly, selectedGrowthForms, searchFilter, showOnlyStarred, pinnedSet, pinnedSpecies, sortField, sortDirection, matchesAssessorsFilter, matchesReviewersFilter, isNewAssessments, matchesObsRangeFilter, matchesYearRangeFilter, matchesAssessmentYearFilter, matchesDescribedYearFilter]);

  // Giant aggregates (insects, invertebrates…) are capped at 400k server-side; surface
  // a banner so the list reads as "showing N of M — drill into a sub-group for the rest".
  const neTruncation = useMemo(() => {
    if (!isNewAssessments) return null;
    let truncated = false; let neTotal = 0; let shown = 0;
    for (const t of selectedTaxa) {
      const info = cache.entries[speciesApiUrl(t, "&category=NE")];
      if (info?.truncated) { truncated = true; neTotal += info.neTotal ?? 0; shown += info.species.length; }
    }
    return truncated ? { neTotal, shown } : null;
  }, [isNewAssessments, selectedTaxa, cache.entries, speciesApiUrl]);

  // A giant aggregate (insects, invertebrates) exceeds the cap — the API returns no rows
  // and flags tooLarge. Don't render the charts/list; prompt a drill-down into a sub-group.
  // Only applies with no sub-group selected (sub-groups are always under the cap).
  const neTooLarge = useMemo(() => {
    if (!isNewAssessments) return null;
    // Reflect the actually-fetched target: a selected sub-group (e.g. insects under
    // invertebrates) if any, otherwise the top-level taxon. So a too-large sub-group shows
    // the drill-down prompt while a manageable sibling (crustaceans, beetles) loads.
    const targets = selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    const names: string[] = [];
    let neTotal = 0;
    for (const t of targets) {
      const info = cache.entries[speciesApiUrl(t, "&category=NE")];
      if (info?.tooLarge) { names.push(findNode(t)?.name ?? t); neTotal += info.neTotal ?? 0; }
    }
    return names.length > 0 ? { names, neTotal } : null;
  }, [isNewAssessments, selectedTaxa, selectedSubgroups, cache.entries, speciesApiUrl]);

  // ── Client-side pagination ─────────────────────────────────────────
  const totalFiltered = filteredSpecies.length;
  const totalPages = Math.ceil(sortedSpecies.length / PAGE_SIZE);
  const paginatedSpeciesBase = sortedSpecies.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Include single-species preview at the top of the page when bulk data hasn't loaded yet
  const paginatedSpecies = useMemo(() => {
    if (!singleSpeciesPreview) return paginatedSpeciesBase;
    // De-dupe by id, and (for NE search results, whose cached-preview id differs from the
    // loaded NE row's synthetic id) also by scientific name — so a searched CoL species
    // shows the loaded row once the list arrives, not a duplicate alongside the preview.
    if (paginatedSpeciesBase.some(s =>
      s.id === singleSpeciesPreview.id ||
      (singleSpeciesPreview.category === "NE" && s.scientific_name === singleSpeciesPreview.scientific_name)
    )) return paginatedSpeciesBase;
    return [singleSpeciesPreview, ...paginatedSpeciesBase];
  }, [paginatedSpeciesBase, singleSpeciesPreview]);

  // ── Single species mode: show info card instead of charts ──────────
  // Only activate when arrived via the main search bar (which sets the
  // `species` URL param). Filters that incidentally narrow results to one
  // species should keep showing the regular charts view.
  const isSingleSpecies = filteredSpecies.length === 1 && urlSpecies != null;
  const singleSpecies = isSingleSpecies ? filteredSpecies[0] : null;
  const singleSpeciesAssessors = useMemo(() => singleSpecies ? getSpeciesAssessors(singleSpecies) : [], [singleSpecies, getSpeciesAssessors]);
  const singleSpeciesReviewers = useMemo(() => singleSpecies ? getSpeciesReviewers(singleSpecies) : [], [singleSpecies, getSpeciesReviewers]);

  // Helper to get country display name
  const getCountryName = (code: string) => ALPHA2_TO_NAME[code] || code;

  // Map selection handlers (Cmd/Ctrl+click for multi-select, regular click replaces)
  const handleCountrySelect = (countryCode: string, _countryName: string, event: React.MouseEvent) => {
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedCountries(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(countryCode)) next.delete(countryCode);
        else next.add(countryCode);
        return next;
      } else {
        if (prev.size === 1 && prev.has(countryCode)) return new Set();
        return new Set([countryCode]);
      }
    });
  };



  // Handle sort toggle
  const handleSort = (field: "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif" | "describedYear") => {
    const currentField = sortField === null ? "year" : sortField;
    if (currentField === field) {
      if (sortDirection === "desc") {
        setSort(field, "asc");
      } else {
        setSort(null, "desc");
      }
    } else {
      setSort(field, "desc");
    }
    setCurrentPage(1);
  };

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedTaxa, selectedCategories, selectedYearRanges, selectedAssessmentYears, selectedDescribedYears, selectedObsRanges, selectedAssessors, selectedReviewers, searchFilter, selectedCountries, showOnlyStarred]);

  // Auto-navigate to the page containing the URL-selected species
  useEffect(() => {
    if (urlSpeciesHandledRef.current || selectedSpeciesKey == null || sortedSpecies.length === 0) return;
    const idx = sortedSpecies.findIndex(s => {
      const key = isNewAssessments ? Math.abs(s.id) : (s.sis_taxon_id ?? s.gbif_species_key ?? s.id);
      return key === selectedSpeciesKey;
    });
    if (idx >= 0) {
      const page = Math.floor(idx / PAGE_SIZE) + 1;
      setCurrentPage(page);
      urlSpeciesHandledRef.current = true;
    }
  }, [sortedSpecies, selectedSpeciesKey, isNewAssessments, PAGE_SIZE]);

  // Populate basic speciesDetails from DB data (GBIF counts instant, no API calls)
  // inatDefaultImage / openAlexPaperCount / papersAtAssessment are left as undefined → spinner
  useEffect(() => {
    const newDetails: Record<number, SpeciesDetails> = {};
    for (const s of paginatedSpecies) {
      if (speciesDetails[s.id]) continue; // Already have details

      if (s.gbif_species_key) {
        newDetails[s.id] = {
          criteria: null,
          commonName: s.common_name || null,
          gbifUrl: `https://www.gbif.org/species/${s.gbif_species_key}`,
          gbifOccurrences: s.gbif_occurrence_count ?? null,
          gbifOccurrencesSinceAssessment: s.gbif_observations_after_assessment_year ?? null,
          gbifMatchStatus: { matchType: 'EXACT' },
          inatDefaultImage: undefined, // Loading — fetched per-page below
        };
      } else {
        newDetails[s.id] = {
          criteria: null,
          commonName: s.common_name || null,
          gbifUrl: null,
          gbifOccurrences: null,
          gbifOccurrencesSinceAssessment: null,
          gbifMatchStatus: { matchType: 'NONE' },
          inatDefaultImage: undefined, // Loading
        };
      }
    }
    if (Object.keys(newDetails).length > 0) {
      setSpeciesDetails((prev) => ({ ...prev, ...newDetails }));
    }
  }, [paginatedSpecies, speciesDetails]);

  // Fetch iNat profile pic for visible species (lightweight per-page calls)
  // Also resolve GBIF match status for species not found in CSV (HIGHERRANK vs NONE)
  useEffect(() => {
    const speciesToFetch = paginatedSpecies.filter(
      (s) => {
        const d = speciesDetails[s.id];
        // Fetch if we have basic details but inatDefaultImage is still undefined (not yet fetched)
        return d && d.inatDefaultImage === undefined;
      }
    );
    if (speciesToFetch.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;

    async function fetchLightweightDetails() {
      const promises = speciesToFetch.map(async (s) => {
        try {
          // Build parallel fetch list: iNat image + GBIF match check for species not in CSV
          const fetchPromises: [Promise<Response>, Promise<Response | null>] = [
            fetch(
              `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(s.scientific_name)}&rank=species&per_page=1`,
              { signal }
            ),
            // Check GBIF match status for species missing from CSV
            !s.gbif_species_key
              ? fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(s.scientific_name)}`, { signal })
              : Promise.resolve(null),
          ];

          const [inatRes, gbifMatchRes] = await Promise.all(fetchPromises);

          let inatDefaultImage: InatDefaultImage | null = null;
          if (inatRes.ok) {
            const inatData = await inatRes.json();
            const defaultPhoto = inatData.results?.[0]?.default_photo;
            if (defaultPhoto) {
              inatDefaultImage = {
                squareUrl: defaultPhoto.square_url || defaultPhoto.url || null,
                mediumUrl: defaultPhoto.medium_url || defaultPhoto.url || null,
              };
            }
          }

          let gbifMatchStatus: GbifMatchStatus | null = null;
          if (gbifMatchRes?.ok) {
            const gbifMatch = await gbifMatchRes.json();
            gbifMatchStatus = {
              matchType: gbifMatch.matchType || 'NONE',
              matchedName: gbifMatch.scientificName,
              matchedRank: gbifMatch.rank,
            };
          }

          return { id: s.id, inatDefaultImage, gbifMatchStatus };
        } catch {
          return { id: s.id, inatDefaultImage: null, gbifMatchStatus: null };
        }
      });

      const results = await Promise.all(promises);
      if (signal.aborted) return;

      const updates: Record<number, Partial<SpeciesDetails>> = {};
      for (const r of results) {
        updates[r.id] = {
          inatDefaultImage: r.inatDefaultImage,
          gbifMatchFetched: true,
          ...(r.gbifMatchStatus ? { gbifMatchStatus: r.gbifMatchStatus } : {}),
        };
      }
      setSpeciesDetails((prev) => {
        const next = { ...prev };
        for (const [id, update] of Object.entries(updates)) {
          const numId = Number(id);
          if (next[numId]) {
            next[numId] = { ...next[numId], ...update };
          }
        }
        return next;
      });
    }

    fetchLightweightDetails();
    return () => controller.abort("cleanup");
  }, [paginatedSpecies, speciesDetails]);

  // Fetch IUCN criteria on row expansion (lightweight — no GBIF calls; the map handles those)
  useEffect(() => {
    if (!selectedSpeciesKey) return;
    const s = paginatedSpecies.find((sp) => sp.id === selectedSpeciesKey);
    if (!s || s.category === "NE") return;
    const existing = speciesDetails[s.id];
    if (!existing || existing.criteriaFetched) return;

    async function fetchCriteria() {
      if (!s || !s.assessment_id) return;
      try {
        const res = await fetch(
          `/api/redlist/assessment/${s.assessment_id}`
        );
        if (res.ok) {
          const data = await res.json();
          setSpeciesDetails((prev) => ({
            ...prev,
            [s.id]: {
              ...prev[s.id],
              criteria: data.criteria || null,
              criteriaFetched: true,
            },
          }));
        }
      } catch {
        // Ignore errors
      }
    }

    fetchCriteria();
  }, [selectedSpeciesKey, paginatedSpecies, speciesDetails]);

  // Lazily fetch the full assessment history for the open species (the list
  // carries only the latest assessors/reviewers; the history array is fetched
  // here on demand for the Red List Assessments tab).
  useEffect(() => {
    if (!selectedSpeciesKey) return;
    const s = paginatedSpecies.find((sp) => sp.id === selectedSpeciesKey);
    const sis = s?.sis_taxon_id;
    if (!s || s.category === "NE" || !sis || assessmentHistory[sis]) return;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(`/api/redlist/species/history?id=${sis}`);
        if (res.ok) {
          const data = await res.json();
          if (!aborted) setAssessmentHistory((prev) => ({ ...prev, [sis]: data.previous_assessments ?? [] }));
        }
      } catch {
        // Ignore — the panel falls back to an empty history.
      }
    })();
    return () => { aborted = true; };
  }, [selectedSpeciesKey, paginatedSpecies, assessmentHistory]);

  // Lazily fetch CoL synonyms for the open species — only once the CoL tab is opened.
  // Keyed by col_id (NE rows carry it) or sis_taxon_id (assessed, resolved server-side).
  const synKey = useCallback((s: Species | undefined): string | null =>
    s?.col_id ? `col:${s.col_id}` : (s?.sis_taxon_id != null ? `sis:${s.sis_taxon_id}` : null), []);
  useEffect(() => {
    if (selectedSpeciesKey == null || !visitedTabs.has("col")) return;
    const s = paginatedSpecies.find((sp) => (isNewAssessments ? Math.abs(sp.id) : sp.id) === selectedSpeciesKey);
    const key = synKey(s);
    if (!s || !key || synonymsBySpecies[key]) return;
    const qs = s.col_id ? `col=${encodeURIComponent(s.col_id)}` : `sis=${s.sis_taxon_id}`;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(`/api/redlist/synonyms?${qs}`);
        if (res.ok) { const data = await res.json(); if (!aborted) setSynonymsBySpecies((prev) => ({ ...prev, [key]: data })); }
      } catch { /* panel falls back to empty */ }
    })();
    return () => { aborted = true; };
  }, [selectedSpeciesKey, visitedTabs, paginatedSpecies, isNewAssessments, synonymsBySpecies, synKey]);

  // Handle category bar click (Cmd/Ctrl+click for multi-select, regular click replaces)
  const handleCategoryClick = (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
    const code = data.payload?.code;
    if (!code) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedCategories(prev => {
      if (isMultiSelect) {
        // Toggle in/out of set
        const next = new Set(prev);
        if (next.has(code)) {
          next.delete(code);
        } else {
          next.add(code);
        }
        return next;
      } else {
        // Single select: toggle off if already selected, otherwise replace
        if (prev.size === 1 && prev.has(code)) {
          return new Set();
        }
        return new Set([code]);
      }
    });
  };

  // Whether the current selection is exactly the "Threatened" set (CR, EN, VU)
  const isThreatenedSelected =
    selectedCategories.size === THREATENED_CATEGORIES.length &&
    THREATENED_CATEGORIES.every((c) => selectedCategories.has(c));

  // "Threatened" shortcut: select CR, EN and VU at once (toggle off if already exactly that set)
  const handleThreatenedClick = () => {
    setSelectedCategories(isThreatenedSelected ? new Set() : new Set<string>(THREATENED_CATEGORIES));
  };

  // "Outdated" shortcut: filter to species assessed >10 years ago (mirrors isOutdated in species-store.ts)
  const isOutdatedSelected = exactFilters.outdated === "yes";
  const handleOutdatedClick = () => {
    setExactFilters({ outdated: isOutdatedSelected ? null : "yes" });
  };

  // Mutes (doesn't remove) the Range/Year chart bars that don't match the Outdated
  // toggle — mirrors how selectedCategories mutes bars in the Conservation Status
  // chart rather than dropping them. An actual bar click (selectedYearRanges) takes
  // priority if present, since that's a more specific user choice.
  const yearRangeSelectedItems = useMemo(() => {
    if (selectedYearRanges.size > 0) return selectedYearRanges;
    if (!exactFilters.outdated) return selectedYearRanges;
    return new Set(
      exactFilters.outdated === "yes"
        ? ["10-20 years", "20+ years"]
        : ["<1 year", "1-5 years", "5-10 years"]
    );
  }, [selectedYearRanges, exactFilters.outdated]);

  // Same idea for the by-year chart — a whole calendar year is treated as
  // "outdated" if it's on or before the cutoff year (coarser than the precise
  // isOutdated() threshold, since this chart only has year-level granularity).
  const assessmentYearSelectedItems = useMemo(() => {
    if (selectedAssessmentYears.size > 0) return selectedAssessmentYears;
    if (!exactFilters.outdated) return selectedAssessmentYears;
    const cutoffYear = outdatedCutoffDate().getFullYear();
    const wantOutdated = exactFilters.outdated === "yes";
    const matching = new Set<string>();
    assessmentYearsByYearData.forEach(d => {
      const isYearOutdated = Number(d.code) <= cutoffYear;
      if (isYearOutdated === wantOutdated) matching.add(d.code);
    });
    return matching;
  }, [selectedAssessmentYears, exactFilters.outdated, assessmentYearsByYearData]);

  // Handle year range bar click (Cmd/Ctrl+click for multi-select, regular click replaces)
  const handleYearClick = (data: { payload?: { range?: string } }, event: React.MouseEvent) => {
    const range = data.payload?.range;
    if (!range) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedYearRanges(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(range)) {
          next.delete(range);
        } else {
          next.add(range);
        }
        return next;
      } else {
        if (prev.size === 1 && prev.has(range)) {
          return new Set();
        }
        return new Set([range]);
      }
    });
  };

  // Handle specific assessment year bar click (Cmd/Ctrl+click for multi-select)
  const handleAssessmentYearClick = (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
    const year = data.payload?.code;
    if (!year) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedAssessmentYears(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(year)) next.delete(year);
        else next.add(year);
        return next;
      } else {
        if (prev.size === 1 && prev.has(year)) return new Set();
        return new Set([year]);
      }
    });
  };
  // Handle GBIF observation range bar click
  const handleObsClick = (data: { payload?: { range?: string } }, event: React.MouseEvent) => {
    const range = data.payload?.range;
    if (!range) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedObsRanges(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(range)) next.delete(range);
        else next.add(range);
        return next;
      } else {
        if (prev.size === 1 && prev.has(range)) return new Set();
        return new Set([range]);
      }
    });
  };

  // Handle Year Described bucket bar click
  const handleDescribedYearClick = (data: { payload?: { range?: string } }, event: React.MouseEvent) => {
    const range = data.payload?.range;
    if (!range) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedDescribedYears(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(range)) next.delete(range);
        else next.add(range);
        return next;
      } else {
        if (prev.size === 1 && prev.has(range)) return new Set();
        return new Set([range]);
      }
    });
  };

  // Assessors and reviewers each get their own chart, so the click/toggle
  // handlers are parameterised by which selection setter they target.
  type SetSelection = React.Dispatch<React.SetStateAction<Set<string>>>;

  // Toggle a single assessor/reviewer in/out of selection (used by search list)
  const makeAssessorToggle = useCallback((setter: SetSelection) => (code: string) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  // Handle assessor/reviewer bar click
  const makeAssessorClick = useCallback((setter: SetSelection) => (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
    const code = data.payload?.code;
    if (!code) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setter(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(code)) next.delete(code);
        else next.add(code);
        return next;
      } else {
        if (prev.size === 1 && prev.has(code)) return new Set();
        return new Set([code]);
      }
    });
  }, []);

  const currentYear = new Date().getFullYear();
  const GBIF_FILTERS = "has_coordinate=true&has_geospatial_issue=false&basis_of_record=HUMAN_OBSERVATION&basis_of_record=MACHINE_OBSERVATION&basis_of_record=OCCURRENCE&basis_of_record=MATERIAL_SAMPLE&basis_of_record=OBSERVATION";
  const isNE = (s: Species) => s.category === "NE";

  // A single selected taxon that isn't a curated tree node — an arbitrary rank
  // (e.g. ?taxa=felidae) reached via search. TaxaSummary can't label it (it only
  // knows curated nodes), so the results block shows a thin header instead. The
  // matched rank is read off the loaded species (all matched class/order/family
  // = the token; the first row's matching field is that rank).
  const arbitraryTaxon = useMemo(() => {
    if (selectedTaxa.size !== 1) return null;
    const id = [...selectedTaxa][0];
    if (id === "all" || findNode(id)) return null;
    const v = id.toLowerCase();
    let rank: "family" | "order" | "class" | null = null;
    for (const s of species) {
      if ((s.family ?? "").toLowerCase() === v) { rank = "family"; break; }
      if ((s.order_name ?? "").toLowerCase() === v) { rank = "order"; break; }
      if ((s.class_name ?? "").toLowerCase() === v) { rank = "class"; break; }
    }
    return { name: id.charAt(0).toUpperCase() + id.slice(1), rank };
  }, [selectedTaxa, species]);

  // A single selected sub-group — a dynamic taxonomic-drilldown node (e.g. an
  // order/family/genus reached via TaxaSummary's own tree) or a static SSC
  // group/subgroup node — gets the exact same stat-card treatment as
  // arbitraryTaxon above, even though it's reached through a completely
  // different mechanism (selectedSubgroups, not a raw ?taxa= search token: see
  // TaxaSummary.tsx's ancestor-breadcrumb rendering, which keeps its own tree
  // branch — Mammals → Rodentia → Heteromyidae → ... — visible in the table
  // above this regardless). A dynamic node has no NODE_INDEX entry (findNode
  // fails), so it's resolved via dynamicNodeRankInfo/dynamicNodeDisplayName
  // instead — the same distinction DescribedInfoIcon already draws.
  const selectedSubgroupTaxon = useMemo(() => {
    if (selectedSubgroups.size !== 1) return null;
    const id = [...selectedSubgroups][0];
    const node = findNode(id);
    if (node) return { name: node.name, rank: primaryFilterRank(node.filter)?.label ?? null };
    if (isDynamicNodeId(id)) return { name: dynamicNodeDisplayName(id), rank: dynamicNodeRankInfo(id)?.label ?? null };
    return null;
  }, [selectedSubgroups]);

  // A single selected top-level taxon (Mammals, or the "All Species" root
  // itself) with no sub-group drilled into — the same stat-card treatment as
  // above, so the card (and the view-mode toggle it now carries — see below)
  // is reachable at every level, not just once you're already several rows
  // deep. primaryFilterRank returns null for "All Species" (no positive
  // dimension in its filter), which is fine — the card falls back to the
  // generic "Taxon" label for it, same as for a remainder/catch-all node.
  const selectedTopLevelTaxon = useMemo(() => {
    if (selectedSubgroups.size !== 0 || selectedTaxa.size !== 1) return null;
    const node = findNode([...selectedTaxa][0]);
    if (!node) return null; // arbitraryTaxon handles the non-tree-node case
    return { name: node.name, rank: primaryFilterRank(node.filter)?.label ?? null };
  }, [selectedTaxa, selectedSubgroups]);

  // Whichever of the three applies — a selected sub-group takes priority
  // (most specific), then a selected top-level taxon, then an arbitrary
  // search-reached rank.
  const focusedTaxonCard = selectedSubgroupTaxon ?? selectedTopLevelTaxon ?? arbitraryTaxon;

  // GBIF occurrence counts aren't filterable per-country/category/etc. — only show
  // that color/list column when no filter narrower than "a whole top-level taxon"
  // is active. Shared by both WorldMap instances (the always-visible Country chart
  // and the promoted country-view landing page) so they never disagree.
  const showGbifToggle =
    selectedSubgroups.size === 0
    && [...selectedTaxa].every(id => id in TAXA_BY_ID)
    && selectedCategories.size === 0
    && selectedYearRanges.size === 0
    && selectedAssessmentYears.size === 0
    && selectedObsRanges.size === 0
    && selectedCountries.size === 0
    && selectedSystems.size === 0
    && selectedPopulationTrends.size === 0
    && selectedMovementPatterns.size === 0
    && selectedThreats.size === 0
    && selectedGrowthForms.size === 0
    && selectedAssessors.size === 0
    && selectedReviewers.size === 0
    && !endemicsOnly
    && !searchFilter
    && !showOnlyStarred;

  // Any countries selected anywhere (not just via the Country view landing
  // page) scope TaxaSummary's own fetches too — clicking a country on the
  // normal "Charts row 2" map already narrowed every other chart/table; this
  // closes the one remaining inconsistency (the taxa tree staying global). One
  // country, a whole region, or an arbitrary multi-select are all just "the
  // set of currently selected countries" — the live per-country query counts
  // each species once regardless of how many of these codes it matches (see
  // country-taxa-summary-duckdb.ts's countriesWhere), so there's no reason to
  // special-case region vs. multi-select here.
  // Hover preview — separate from selectedCountries (the real, locked
  // selection) so scanning the map with the mouse never itself writes to
  // URL-synced state. Only consulted as a countryScope fallback below when
  // nothing's actually locked yet; once selectedCountries is non-empty this
  // is ignored entirely, matching "hover only works if no country is
  // selected" (see handleCountryDrilldown/selectOnHover).
  const [hoverPreviewCountry, setHoverPreviewCountry] = useState<string | null>(null);

  const countryScope = selectedCountries.size > 0 ? [...selectedCountries]
    : hoverPreviewCountry ? [hoverPreviewCountry]
    : null;

  // Country view's own map/list select. Before anything's picked, hovering
  // previews the table (see WorldMap's selectOnHover, gated below on
  // selectedCountries.size === 0 so it stops once a country's locked in).
  // The first click locks in a single country and switches off hover; every
  // click after that toggles a country in/out of the selection, so you can
  // build up a multi-select by clicking (no ctrl/cmd needed) — clicking the
  // already-sole-selected country again clears back to the empty/hover state.
  // ctrl/cmd-click still toggles directly even before anything's locked, for
  // building a multi-select from scratch without an initial single pick.
  // Routed through enterCountryDrilldown so the country change stays atomic
  // with clearing taxa/subgroups (see its own comment).
  const handleCountryDrilldown = useCallback(
    (code: string, _name: string, event: React.MouseEvent) => {
      const isMultiSelect = event.metaKey || event.ctrlKey;
      // A real click always supersedes any leftover hover preview — without
      // this, clearing a locked selection back to empty (self-toggle-off)
      // would leave the table reading a stale hoverPreviewCountry from
      // before the lock, since countryScope falls back to it whenever
      // selectedCountries is empty (see its definition above).
      setHoverPreviewCountry(null);
      enterCountryDrilldown(prev => {
        if (prev.size === 0 && !isMultiSelect) {
          return new Set([code]);
        }
        const next = new Set(prev);
        if (next.has(code)) next.delete(code);
        else next.add(code);
        return next;
      });
    },
    [enterCountryDrilldown]
  );

  // Country view's own per-country stats — a small precomputed, all-species
  // aggregate (see data/country-stats.json), fetched once and cached for the
  // session, NOT the client-side countryStatsForMap used elsewhere (that one
  // requires the currently-browsed taxon's full species array to already be
  // loaded, which is fine when you're already browsing e.g. Mammals for other
  // reasons, but would mean downloading the entire "All Species" dataset just
  // to show the landing map — multi-second blank-map delay for no reason,
  // since this data never varies by taxon selection on the landing page).
  const [countryLandingStats, setCountryLandingStats] = useState<CountryStats | null>(null);
  useEffect(() => {
    if (layoutMode !== "country" || countryLandingStats) return;
    fetch("/api/redlist/country-stats")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.stats) return;
        const shaped: CountryStats = {};
        for (const [code, s] of Object.entries(data.stats as Record<string, { species: number; outdated: number }>)) {
          shaped[code] = { occurrences: 0, species: s.species, outdated: s.outdated };
        }
        setCountryLandingStats(shaped);
      })
      .catch(() => {});
  }, [layoutMode, countryLandingStats]);

  // Country view landing page content — a promoted WorldMap (its own Map/List
  // toggle applies here too), passed into TaxaSummary rather than duplicating a
  // second dynamic-import + prop-wiring of WorldMap there. Region-select
  // behaves the same as the normal "Charts row 2" map below: a region just
  // selects all its countries at once (handleRegionFilter), same as any other
  // multi-country selection. No endemics toggle here — the country-scoped
  // taxa summary is a live per-country DuckDB query that doesn't take an
  // endemics parameter, so the button would have nothing to actually filter.
  const countryModeContent = (
    <WorldMap
      selectedCountries={selectedCountries}
      onCountrySelect={handleCountryDrilldown}
      selectOnHover={selectedCountries.size === 0}
      onCountryHover={setHoverPreviewCountry}
      precomputedStats={countryLandingStats ?? {}}
      selectedTaxa={selectedTaxa}
      speciesLabel={isNewAssessments ? "# Unassessed" : undefined}
      showOutdatedMode={!isNewAssessments}
      showGbifToggle={false}
      onRegionFilter={handleRegionFilter}
      mapViewMode={mapViewMode}
      onMapViewModeChange={setMapViewMode}
      mapSortKey={mapSortKey}
      mapSortDirection={mapSortDirection}
      onMapSortChange={setMapSort}
    />
  );

  // Selection chips — rendered by TaxaSummary in a dedicated row of its own
  // above BOTH the map and the table (aligned under the table's half via a
  // matching grid template, with the map's half left blank), not inside
  // either component, so neither one's own height is ever affected by how
  // many chips are showing or whether they've wrapped to a second line.
  // One chip per selected country (not collapsed into a region name,
  // unlike the atop-table "France ×" chip elsewhere), each individually
  // removable, plus "Clear all" once there's more than one.
  // Before anything's locked, hovering shows its own preview chip (dashed,
  // non-removable — there's nothing to remove yet, moving the mouse away
  // already clears it) so the table's live hover-preview has a visual
  // anchor. Reuses handleCountryDrilldown for removal — clicking a chip's ✕
  // for a country that's already selected always toggles it off, whichever
  // branch handleCountryDrilldown takes.
  const countryPillsContent = (selectedCountries.size > 0 || hoverPreviewCountry) && (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedCountries.size > 0 ? (
        <>
          {[...selectedCountries]
            .map(code => ({ code, name: ALPHA2_TO_NAME[code] ?? code }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ code, name }) => (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300 max-w-full"
              >
                <span className="truncate">{name}</span>
                <button
                  onClick={(e) => handleCountryDrilldown(code, name, e)}
                  className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  title={`Remove ${name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          {selectedCountries.size > 1 && (
            <button
              onClick={() => { enterCountryDrilldown(new Set()); setHoverPreviewCountry(null); }}
              className="text-sm text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 underline transition-colors"
            >
              Clear all
            </button>
          )}
        </>
      ) : (
        <span className="inline-flex items-center pl-3 pr-3 py-1 rounded-full bg-white dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 text-sm text-zinc-500 dark:text-zinc-400 max-w-full">
          <span className="truncate">{ALPHA2_TO_NAME[hoverPreviewCountry!] ?? hoverPreviewCountry}</span>
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-4 min-w-0">
      {/* Always show Taxa Summary table */}
      <TaxaSummary
        onToggleTaxon={handleToggleTaxon}
        selectedTaxa={selectedTaxa}
        selectedSubgroups={selectedSubgroups}
        disableAllSpecies={isNewAssessments}
        viewMode={viewMode}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        countryModeContent={countryModeContent}
        countryPillsContent={countryPillsContent}
        countryScope={countryScope}
        onToggleSubgroup={(sgId) => {
          // Clicking a view root ancestor → clear subgroups to show its children.
          // If the currently-selected subgroup is an SSC group, we got here by
          // drilling out of SSC groups mode — return to that flat table instead
          // of falling through to the plain taxon tree view.
          if (selectedTaxa.has(sgId)) {
            if ([...selectedSubgroups].some(id => id.startsWith("ssc-"))) {
              returnToLayoutMode("ssc");
              return;
            }
            setSelectedSubgroups(new Set());
            return;
          }
          const wasSelected = selectedSubgroups.has(sgId);
          if (wasSelected) {
            // Already selected — no-op (TaxaSummary handles expand/collapse,
            // ancestors handle navigation)
            return;
          } else {
            // Selecting: set exactly this one subgroup
            setSelectedSubgroups(new Set([sgId]));
            // Ensure the correct view root is selected for species fetching
            const viewRoot = getViewRootForNode(sgId);
            if (viewRoot && (!selectedTaxa.has(viewRoot) || selectedTaxa.size !== 1)) {
              skipClearOnTaxaChangeRef.current = true;
              setSelectedTaxa(new Set([viewRoot]));
            }
          }
        }}
        onNavigateToSubgroup={(taxonId, subgroupId) => {
          // Navigate directly to a taxon + subgroup atomically (avoids clearAllFilters race,
          // and pushes a single history entry so one back-press undoes the whole navigation —
          // including exiting Table 1a/SSC groups mode, which this also clears)
          skipClearOnTaxaChangeRef.current = true;
          navigateToTaxonSubgroup(taxonId, subgroupId);
        }}
      />

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-6 py-4 rounded-lg">
          <p className="font-medium">Failed to load {isNewAssessments ? "" : "Red List "}data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Charts, search, and species table - only visible after a taxon is selected.
          Hidden in country mode too: TaxaSummary's own countryModeContent (the
          promoted WorldMap) is the entire page there, and selectedTaxa is only
          "all" in that mode as a side effect of loading species for the map's own
          stats (see setLayoutMode), not a real drill-down into All Species. */}
      {selectedTaxa.size > 0 && layoutMode !== "country" && (
      neTooLarge ? (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-amber-200 dark:border-amber-900/40 px-6 py-10 text-center">
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-200">
            {neTooLarge.names.join(" & ")} has {neTooLarge.neTotal.toLocaleString()} not-evaluated species — too many to load at once.
          </p>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            Open a sub-group (a class or order — e.g. Beetles, Crustaceans) above to view its charts and species list.
          </p>
        </div>
      ) : (
      <div className="space-y-3">

          {/* Taxon-focus header — any single selected taxon: a top-level taxon
              (selectedTopLevelTaxon, e.g. Mammals, or "All Species" itself), a
              sub-group row drilled into via TaxaSummary's own tree
              (selectedSubgroupTaxon: dynamic order/family/genus, or a static SSC
              group), or a non-curated arbitrary rank reached via search
              (arbitraryTaxon). Two fixed stat cards — the taxon (name + rank)
              and its total species count (taxaFilteredSpeciesBase) — neither
              reacts to pill filters, so this row never grows/changes as
              filters are added; the applied-filters row below (right above
              the species table) is what shows the live, filtered picture.
              The Species card's Assessed/Not Evaluated toggle sits to the
              right of its label, vertically centered against the whole card;
              it lives here (not the landing-only row with the View selector)
              so it's usable at any drill-down depth. TaxaSummary's own
              breadcrumb table above already shows the tree branch that led
              here (Mammals → Rodentia → Heteromyidae → ...) when applicable —
              this is purely an additional, more prominent summary, not a
              replacement for it. */}
          {focusedTaxonCard && !isSingleSpecies && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {focusedTaxonCard.rank ?? "Taxon"}
                </div>
                <div className="mt-0.5 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {focusedTaxonCard.name}
                </div>
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {isNewAssessments ? "Not Evaluated Species" : "Assessed Species"}
                  </div>
                  <div className="mt-0.5 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    {speciesLoading && assessedSpecies.length === 0
                      ? <Spinner className="h-6 w-6" />
                      : taxaFilteredSpeciesBase.length.toLocaleString()}
                  </div>
                </div>
                {onViewModeChange && (
                  <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs shrink-0">
                    <button
                      type="button"
                      onClick={() => onViewModeChange("reassessments")}
                      className={`px-2 py-1 font-medium transition-colors ${
                        !isNewAssessments
                          ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                          : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Assessed
                    </button>
                    <button
                      type="button"
                      onClick={() => onViewModeChange("new-assessments")}
                      className={`px-2 py-1 font-medium transition-colors ${
                        isNewAssessments
                          ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                          : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Not Evaluated
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Single species header — skeleton while loading */}
          {!isSingleSpecies && urlSpecies != null && speciesLoading && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-4 animate-pulse">
              <div className="w-24 h-24 bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
                <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-32" />
              </div>
            </div>
          )}
          {/* Single species header */}
          {isSingleSpecies && singleSpecies && (() => {
            const details = speciesDetails[singleSpecies.id];
            return (
              <div
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-4"
              >
                {details?.inatDefaultImage === undefined ? (
                  <div className="w-24 h-24 bg-zinc-100 dark:bg-zinc-800 rounded flex-shrink-0 flex items-center justify-center">
                    <span className="inline-block animate-spin h-5 w-5 border-2 border-zinc-400 border-t-transparent rounded-full" />
                  </div>
                ) : details?.inatDefaultImage?.squareUrl ? (
                  <img
                    src={details.inatDefaultImage.mediumUrl || details.inatDefaultImage.squareUrl}
                    alt=""
                    className="w-24 h-24 object-cover rounded flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-red-400"
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const preview = document.getElementById('image-preview');
                      if (preview) {
                        (preview as HTMLImageElement).src = details.inatDefaultImage?.mediumUrl || details.inatDefaultImage?.squareUrl || '';
                        preview.style.display = 'block';
                        preview.style.top = `${rect.top - 192 - 8}px`;
                        preview.style.left = `${rect.left}px`;
                      }
                    }}
                    onMouseLeave={() => {
                      const preview = document.getElementById('image-preview');
                      if (preview) preview.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-24 h-24 bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 flex-shrink-0">
                    <TaxaIcon taxonId={singleSpecies.taxon_id || "all"} size={40} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="italic font-semibold text-zinc-900 dark:text-zinc-100 text-lg">
                    {singleSpecies.scientific_name}
                  </div>
                  {singleSpecies.common_name && (
                    <div className="text-zinc-500 dark:text-zinc-400 text-sm">
                      {singleSpecies.common_name}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Charts row 1: bar charts (new-assessments mode only shows GBIF Observations) */}
          {!isNewAssessments && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Conservation Status */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Conservation Status</span>
                {!(isSingleSpecies && singleSpecies) && (
                  <button
                    type="button"
                    onClick={handleThreatenedClick}
                    className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                      isThreatenedSelected
                        ? "bg-red-600 text-white shadow-sm"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                    aria-pressed={isThreatenedSelected}
                    title="Select Critically Endangered, Endangered and Vulnerable"
                  >
                    Threatened
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : isSingleSpecies && singleSpecies ? (
                  <span
                    className="px-5 py-2.5 text-2xl font-bold rounded text-center"
                    style={{
                      backgroundColor: (CATEGORY_COLORS[singleSpecies.category] || "#999") + "20",
                      color: singleSpecies.category === "EX" || singleSpecies.category === "EW" ? "#fff" : CATEGORY_COLORS[singleSpecies.category] || "#999",
                      ...(singleSpecies.category === "EX" || singleSpecies.category === "EW" ? { backgroundColor: CATEGORY_COLORS[singleSpecies.category] } : {}),
                    }}
                  >
                    {{ EX: "Extinct", EW: "Extinct in the Wild", CR: "Critically Endangered", EN: "Endangered", VU: "Vulnerable", NT: "Near Threatened", LC: "Least Concern", DD: "Data Deficient", NE: "Not Evaluated" }[singleSpecies.category] || singleSpecies.category}
                  </span>
                ) : categoryDataWithPercent.length > 0 ? (
                  <FilterBarChart
                    data={categoryDataWithPercent}
                    dataKey="code"
                    selectedItems={selectedCategories}
                    onBarClick={handleCategoryClick}
                    yAxisWidth={26}
                    rightMargin={55}
                    labelFormatter={(code) => ({
                      EX: "Extinct",
                      EW: "Extinct in the Wild",
                      CR: "Critically Endangered",
                      EN: "Endangered",
                      VU: "Vulnerable",
                      NT: "Near Threatened",
                      LC: "Least Concern",
                      DD: "Data Deficient",
                    }[code] || code)}
                  />
                ) : null}
              </div>
            </div>

            {/* Years Since Assessed / Year of Latest Assessment */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex flex-wrap items-center justify-between mb-1 gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                  {yearsChartMode === "range" ? "Years Since Assessed" : "Year of Latest Assessment"}
                </span>
                <div className="flex items-center gap-2">
                  {/* Outdated shortcut: filter to species assessed >10 years ago (mirrors the Threatened button).
                      Range-view only — the Year view's muting is only year-granular, so the button's precise
                      cutoff date doesn't line up as cleanly there. */}
                  {!(isSingleSpecies && singleSpecies) && yearsChartMode === "range" && (
                    <button
                      type="button"
                      onClick={handleOutdatedClick}
                      className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                        isOutdatedSelected
                          ? "bg-red-600 text-white shadow-sm"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                      }`}
                      aria-pressed={isOutdatedSelected}
                      title={`Filter to species last assessed before ${outdatedCutoffDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                    >
                      Outdated
                    </button>
                  )}
                  {/* Pagination controls (year view only, and only when multiple pages) */}
                  {!(isSingleSpecies && singleSpecies) && yearsChartMode === "year" && yearsTotalPages > 1 && (() => {
                    const firstYear = paginatedAssessmentYearsData[0]?.code;
                    const lastYear = paginatedAssessmentYearsData[paginatedAssessmentYearsData.length - 1]?.code;
                    const label = firstYear && lastYear
                      ? (firstYear === lastYear ? firstYear : `${firstYear}–${lastYear}`)
                      : "";
                    const canPrev = yearsPage > 0;
                    const canNext = yearsPage < yearsTotalPages - 1;
                    return (
                      <div className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <button
                          type="button"
                          onClick={() => canPrev && setYearsPage(p => Math.max(0, p - 1))}
                          disabled={!canPrev}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Previous years"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                          </svg>
                        </button>
                        <span className="tabular-nums min-w-[64px] text-center" aria-live="polite" aria-atomic="true">{label}</span>
                        <button
                          type="button"
                          onClick={() => canNext && setYearsPage(p => Math.min(yearsTotalPages - 1, p + 1))}
                          disabled={!canNext}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Next years"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      </div>
                    );
                  })()}
                  {!(isSingleSpecies && singleSpecies) && (
                    <select
                      value={yearsChartMode}
                      onChange={(e) => setYearsChartMode(e.target.value as "range" | "year")}
                      aria-label="Year chart view"
                      className="text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="range">Range</option>
                      <option value="year">Year</option>
                    </select>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-[150px] flex flex-col">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center"><Spinner /></div>
                ) : isSingleSpecies && singleSpecies ? (
                  <div className="flex-1 flex items-center justify-center">
                    {(() => {
                      if (!singleSpecies.assessment_date) return (
                        <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">N/A</span>
                      );
                      const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
                      const elapsed = Date.now() - new Date(singleSpecies.assessment_date).getTime();
                      const yearsSince = elapsed / msPerYear;
                      const range = yearsSince < 1 ? "<1y" : yearsSince < 5 ? "1-5y" : yearsSince < 10 ? "5-10y" : yearsSince < 20 ? "10-20y" : ">20y";
                      return (
                        <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">
                          {range}
                        </span>
                      );
                    })()}
                  </div>
                ) : yearsChartMode === "range" ? (
                  assessmentYearData.length > 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <FilterBarChart
                        data={assessmentYearData}
                        dataKey="shortRange"
                        selectedItems={yearRangeSelectedItems}
                        onBarClick={handleYearClick}
                        barColor="#3b82f6"
                        yAxisWidth={36}
                        rightMargin={85}
                      />
                    </div>
                  ) : null
                ) : paginatedAssessmentYearsData.length > 0 ? (
                  <div className="flex-1">
                    <YearBarChart
                      data={paginatedAssessmentYearsData}
                      selectedItems={assessmentYearSelectedItems}
                      onBarClick={handleAssessmentYearClick}
                      barColor="#3b82f6"
                      yMax={yearsGlobalMax}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-sm text-zinc-400 dark:text-zinc-500">No assessments</span>
                  </div>
                )}
              </div>
            </div>

            {/* Geospatial GBIF Records */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">Geospatial GBIF Records <GbifInfoTooltip /></span>
                              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : isSingleSpecies && singleSpecies ? (() => {
                  const obs = singleSpecies.gbif_occurrence_count ?? 0;
                  const range = obs === 0 ? "0" : obs <= 10 ? "1-10" : obs <= 100 ? "11-100" : obs <= 1000 ? "101-1K" : obs <= 10000 ? "1K-10K" : "10K+";
                  return (
                    <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">
                      {range}
                    </span>
                  );
                })() : gbifObsData.length > 0 ? (
                  <FilterBarChart
                    data={gbifObsData}
                    dataKey="shortRange"
                    selectedItems={selectedObsRanges}
                    onBarClick={handleObsClick}
                    barColor="#10b981"
                    yAxisWidth={42}
                    rightMargin={85}
                  />
                ) : null}
              </div>
            </div>
          </div>
          )}

          {/* Charts row 2: Country map + (Threats, 2-col) for reassessments; Country
              map + Year Described + Geospatial GBIF Records (3-col, 1/3 each) for
              new-assessments — Year Described used to sit alone in its own row
              below (a half-width chart with empty space beside it, since that row
              was also grid-cols-2), now folded into this one instead. */}
          <div className={`grid grid-cols-1 gap-4 ${isNewAssessments ? "sm:grid-cols-3" : "md:grid-cols-2"}`}>
            {/* Country Map */}
            <div>
              {speciesLoading && assessedSpecies.length === 0 ? (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 min-h-[320px] flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Country
                    </h2>
                  </div>
                  <div className="flex-1 flex items-center justify-center">
                    <Spinner />
                  </div>
                </div>
              ) : (
                <WorldMap
                  selectedCountries={selectedCountries}
                  onCountrySelect={handleCountrySelect}
                  precomputedStats={countryStatsForMap}
                  precomputedStatsTotal={countryStatsForMapTotal}
                  selectedTaxa={selectedTaxa}
                  speciesLabel={isNewAssessments ? "# Unassessed" : undefined}
                  showOutdatedMode={!isNewAssessments}
                  showColorModeDropdown={!isNewAssessments}
                  onRegionFilter={handleRegionFilter}
                  endemicsOnly={endemicsOnly}
                  onEndemicsToggle={isNewAssessments ? undefined : () => setEndemicsOnly(!endemicsOnly)}
                  showGbifToggle={showGbifToggle}
                  mapViewMode={mapViewMode}
                  onMapViewModeChange={setMapViewMode}
                  mapSortKey={mapSortKey}
                  mapSortDirection={mapSortDirection}
                  onMapSortChange={setMapSort}
                />
              )}
            </div>

            {/* Year Described (new-assessments only) — second column of this row. */}
            {isNewAssessments && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                    Year Described
                    <HoverTooltip text="Year the species was scientifically described, from the Catalogue of Life. Available for ~99% of animals; many plants, fungi and algae have no datable record in CoL and fall under 'Unknown'.">
                      <svg className="w-3 h-3 text-zinc-400 dark:text-zinc-500 cursor-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4M12 8h.01" />
                      </svg>
                    </HoverTooltip>
                  </span>
                </div>
                <div style={{ height: 180 }} className="flex items-center justify-center">
                  {speciesLoading && assessedSpecies.length === 0 ? (
                    <Spinner />
                  ) : describedYearData.length > 0 ? (
                    <FilterBarChart
                      data={describedYearData}
                      dataKey="shortRange"
                      selectedItems={selectedDescribedYears}
                      onBarClick={handleDescribedYearClick}
                      barColor="#3b82f6"
                      yAxisWidth={64}
                      rightMargin={85}
                    />
                  ) : (
                    <span className="text-sm text-zinc-400 dark:text-zinc-500">No description-year data</span>
                  )}
                </div>
              </div>
            )}

            {/* Threats (reassessments) or GBIF Observations chart (new-assessments) */}
            {isNewAssessments ? (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">Geospatial GBIF Records <GbifInfoTooltip /></span>
                </div>
                <div style={{ height: 180 }} className="flex items-center justify-center">
                  {speciesLoading && assessedSpecies.length === 0 ? (
                    <Spinner />
                  ) : (
                    <FilterBarChart
                      data={gbifObsData}
                      dataKey="shortRange"
                      selectedItems={selectedObsRanges}
                      onBarClick={handleObsClick}
                      barColor="#10b981"
                      yAxisWidth={42}
                      rightMargin={85}
                    />
                  )}
                </div>
              </div>
            ) : (() => {
              // Map label→code for reverse lookup from chart clicks
              const threatLabelToCode = new Map(THREAT_CATEGORIES.map(c => [c.label, c.code]));
              // Bar label: count + share of all in-view species (see threatTotal).
              const threatBarLabel = (count: number) =>
                `${count.toLocaleString()} (${threatTotal > 0 ? Math.round((count / threatTotal) * 100) : 0}%)`;
              // Use label as `code` field so it displays on y-axis, sorted by count desc
              const threatBarData = THREAT_CATEGORIES
                .map(({ code, label }) => ({ code: label, threatCode: code, count: threatCounts[code] ?? 0, label: threatBarLabel(threatCounts[code] ?? 0) }))
                .filter(d => d.count > 0)
                .sort((a, b) => b.count - a.count);
              // selectedItems needs to use labels too for dimming
              const selectedThreatLabels = new Set(
                Array.from(selectedThreats).map(code => THREAT_CATEGORIES.find(c => c.code === code)?.label).filter(Boolean) as string[]
              );
              // Drill-down: when a top-level category is expanded, its sub-categories
              // appear in a split pane below the main chart (rather than expanding the
              // card downward) so the card height stays constant — both charts share a
              // fixed-height area and scroll internally.
              const drillCat = expandedThreat ? THREAT_CATEGORIES.find(c => c.code === expandedThreat) ?? null : null;
              const drillSubData = drillCat
                ? drillCat.children
                    .map(child => ({ code: child.label, threatCode: child.code, count: threatCounts[child.code] ?? 0, label: threatBarLabel(threatCounts[child.code] ?? 0) }))
                    .filter(d => d.count > 0)
                    .sort((a, b) => b.count - a.count)
                : [];
              const isDrilled = drillCat !== null && drillSubData.length > 0;
              const drillSelectedSubLabels = drillCat ? new Set(
                Array.from(selectedThreats).map(code => drillCat.children.find(c => c.code === code)?.label).filter(Boolean) as string[]
              ) : new Set<string>();
              // The card content area is a constant height (independent of how many
              // categories are present) so the card never resizes — neither when the
              // filter changes the category count nor when drilling in — which would
              // otherwise bump the country map sharing this grid row. The base chart
              // keeps its natural per-bar height and scrolls within the fixed area.
              // 266 = the country map card's 320px height minus this card's header +
              // padding (~54px), so both cards (and their loading skeletons) match.
              const THREATS_AREA_HEIGHT = 266;
              const chartHeight = Math.max(200, threatBarData.length * 18 + 30);
              const loading = speciesLoading && assessedSpecies.length === 0;
              return (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
                  <div className="flex items-center justify-between mb-1 min-h-[24px]">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Threats</span>
                  </div>
                  <div style={{ height: THREATS_AREA_HEIGHT }} className="flex flex-col overflow-hidden">
                    {loading ? (
                      <div className="h-full flex items-center justify-center"><Spinner /></div>
                    ) : threatBarData.length > 0 ? (
                      <>
                        {/* Top-level categories — always visible; scrolls if it overflows the shared height */}
                        <div className="flex-1 min-h-0 overflow-y-auto">
                          <div style={{ height: chartHeight }}>
                            <FilterBarChart
                              data={threatBarData}
                              dataKey="code"
                              selectedItems={selectedThreatLabels}
                              onBarClick={(data: { payload?: { code?: string; threatCode?: string } }, event: React.MouseEvent) => {
                                const label = data.payload?.code;
                                const code = label ? threatLabelToCode.get(label) : undefined;
                                if (!code) return;
                                const isMulti = event.metaKey || event.ctrlKey;
                                setSelectedThreats(prev => {
                                  if (isMulti) { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; }
                                  if (prev.size === 1 && prev.has(code)) return new Set();
                                  return new Set([code]);
                                });
                                setExpandedThreat(prev => prev === code ? null : code);
                              }}
                              barColor="#8b5cf6"
                              yAxisWidth={155}
                              rightMargin={80}
                              yAxisTickMaxLength={22}
                            />
                          </div>
                        </div>
                        {/* Sub-categories of the drilled-into category — shares the fixed height */}
                        {isDrilled && (
                          <div className="shrink-0 mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-col" style={{ maxHeight: "50%" }}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 truncate">{drillCat!.label}</span>
                              <button
                                onClick={() => setExpandedThreat(null)}
                                className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                aria-label="Close sub-categories"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                            <div className="min-h-0 overflow-y-auto">
                              <div style={{ height: Math.max(80, drillSubData.length * 18 + 30) }}>
                                <FilterBarChart
                                  data={drillSubData}
                                  dataKey="code"
                                  selectedItems={drillSelectedSubLabels}
                                  onBarClick={(data: { payload?: { code?: string } }, event: React.MouseEvent) => {
                                    const label = data.payload?.code;
                                    const child = drillCat!.children.find(c => c.label === label);
                                    if (!child) return;
                                    const isMulti = event.metaKey || event.ctrlKey;
                                    setSelectedThreats(prev => {
                                      if (isMulti) { const next = new Set(prev); if (next.has(child.code)) next.delete(child.code); else next.add(child.code); return next; }
                                      if (prev.size === 1 && prev.has(child.code)) return new Set();
                                      return new Set([child.code]);
                                    });
                                  }}
                                  barColor="#a78bfa"
                                  yAxisWidth={170}
                                  rightMargin={80}
                                  yAxisTickMaxLength={24}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="h-full flex items-center justify-center"><span className="text-sm text-zinc-400 dark:text-zinc-500">No threat data</span></div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* More Filters — a full-width collapsible card row, consistent with
              the other cards on the page (hidden for New Assessments) */}
          {!isNewAssessments && <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <button
              onClick={() => setMoreFiltersOpen(prev => !prev)}
              className="w-full flex items-center gap-1.5 px-3 md:px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-t-xl transition-colors"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${moreFiltersOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              More Filters
              {(selectedSystems.size + selectedGrowthForms.size + selectedPopulationTrends.size + selectedMovementPatterns.size + selectedThreats.size > 0) && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                  {selectedSystems.size + selectedGrowthForms.size + selectedPopulationTrends.size + selectedMovementPatterns.size + selectedThreats.size} active
                </span>
              )}
            </button>
            {moreFiltersOpen && (
              <div className="px-3 md:px-4 pb-3 md:pb-4 pt-3 md:pt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-3">
                {/* Realm */}
                <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20">Realm</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(["Terrestrial", "Freshwater", "Marine"] as const).map(system => {
                      const isSelected = selectedSystems.has(system);
                      const count = realmCounts[system] ?? 0;
                      return (
                        <button
                          key={system}
                          onClick={(e) => {
                            const isMulti = e.metaKey || e.ctrlKey;
                            setSelectedSystems(prev => {
                              if (isMulti) { const next = new Set(prev); if (next.has(system)) next.delete(system); else next.add(system); return next; }
                              if (prev.size === 1 && prev.has(system)) return new Set();
                              return new Set([system]);
                            });
                          }}
                          className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                            isSelected
                              ? system === "Terrestrial" ? "bg-amber-500 text-white"
                              : system === "Freshwater" ? "bg-cyan-500 text-white"
                              : "bg-blue-600 text-white"
                              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                          }`}
                        >
                          {system} ({count.toLocaleString()})
                        </button>
                      );
                    })}
                  </div>
                </div>


                {/* Growth Form (plants/fungi only) */}
                {(() => {
                  // Compute growth form counts cross-filtered (exclude own filter)
                  const gfCounts: Record<string, number> = {};
                  taxaFilteredSpecies.forEach(s => {
                    if (!s.growth_forms?.length) return;
                    if (!matchesSearch(s)) return;
                    if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
                    if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
                    if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
                    if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
                    if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
                    if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
                    if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
                    if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
                    if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
                    if (endemicsOnly && s.countries.length !== 1) return;
                    if (!matchesAssessorsFilter(s)) return;
                    if (!matchesReviewersFilter(s)) return;
                    for (const gf of s.growth_forms) {
                      gfCounts[gf] = (gfCounts[gf] || 0) + 1;
                    }
                  });
                  const sorted = Object.entries(gfCounts).sort((a, b) => b[1] - a[1]);
                  if (sorted.length === 0) return null;
                  return (
                    <div className="flex items-start gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20 pt-1">Growth</span>
                      <div className="flex flex-wrap gap-1.5">
                        {sorted.map(([gf, count]) => {
                          const isSelected = selectedGrowthForms.has(gf);
                          return (
                            <button
                              key={gf}
                              onClick={(e) => {
                                const isMulti = e.metaKey || e.ctrlKey;
                                setSelectedGrowthForms(prev => {
                                  if (isMulti) { const next = new Set(prev); if (next.has(gf)) next.delete(gf); else next.add(gf); return next; }
                                  if (prev.size === 1 && prev.has(gf)) return new Set();
                                  return new Set([gf]);
                                });
                              }}
                              className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                                isSelected
                                  ? "bg-lime-500 text-white"
                                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                              }`}
                            >
                              {gf} ({count.toLocaleString()})
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Trend */}
                <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20">Trend</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(["Increasing", "Stable", "Decreasing", "Unknown"] as const).map(trend => {
                        const isSelected = selectedPopulationTrends.has(trend);
                        const count = populationTrendCounts[trend] ?? 0;
                        return (
                          <button
                            key={trend}
                            onClick={(e) => {
                              const isMulti = e.metaKey || e.ctrlKey;
                              setSelectedPopulationTrends(prev => {
                                if (isMulti) { const next = new Set(prev); if (next.has(trend)) next.delete(trend); else next.add(trend); return next; }
                                if (prev.size === 1 && prev.has(trend)) return new Set();
                                return new Set([trend]);
                              });
                            }}
                            className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-orange-500 text-white"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {trend === "Increasing" ? "↑" : trend === "Decreasing" ? "↓" : trend === "Stable" ? "→" : "?"} {trend} ({count.toLocaleString()})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                {/* Movement Patterns */}
                {!isNewAssessments && (
                  <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20">Movement</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(["Full Migrant", "Altitudinal Migrant", "Nomadic", "Not a Migrant", "Unknown"] as const).map(pattern => {
                          const isSelected = selectedMovementPatterns.has(pattern);
                          const count = movementPatternCounts[pattern] ?? 0;
                          if (count === 0) return null;
                          return (
                            <button
                              key={pattern}
                              onClick={(e) => {
                                const isMulti = e.metaKey || e.ctrlKey;
                                setSelectedMovementPatterns(prev => {
                                  if (isMulti) { const next = new Set(prev); if (next.has(pattern)) next.delete(pattern); else next.add(pattern); return next; }
                                  if (prev.size === 1 && prev.has(pattern)) return new Set();
                                  return new Set([pattern]);
                                });
                              }}
                              className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                                isSelected
                                  ? "bg-teal-500 text-white"
                                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                              }`}
                            >
                              {pattern} ({count.toLocaleString()})
                            </button>
                          );
                        })}
                      </div>
                  </div>
                )}

                {/* Assessors and Reviewers, shown side by side */}
                {isSingleSpecies && singleSpecies ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {([
                      { title: "Assessors", names: singleSpeciesAssessors },
                      { title: "Reviewers", names: singleSpeciesReviewers },
                    ] as const).map(({ title, names }) => (
                      <div key={title} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
                        </div>
                        <div className="overflow-y-auto mt-2" style={{ maxHeight: 260 }}>
                          {names.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {names.map((name) => (
                                <span key={name} className="inline-block px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">{name}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-zinc-400 dark:text-zinc-500">None listed</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <ReviewerChart
                      allAssessors={assessorChartData}
                      allReviewers={reviewerChartData}
                      viewMode="assessors"
                      showToggle={false}
                      title="Assessors"
                      selectedItems={selectedAssessors}
                      onBarClick={makeAssessorClick(setSelectedAssessors)}
                      onItemToggle={makeAssessorToggle(setSelectedAssessors)}
                      loading={speciesLoading && assessedSpecies.length === 0}
                    />
                    <ReviewerChart
                      allAssessors={assessorChartData}
                      allReviewers={reviewerChartData}
                      viewMode="reviewers"
                      showToggle={false}
                      title="Reviewers"
                      selectedItems={selectedReviewers}
                      onBarClick={makeAssessorClick(setSelectedReviewers)}
                      onItemToggle={makeAssessorToggle(setSelectedReviewers)}
                      loading={speciesLoading && assessedSpecies.length === 0}
                    />
                  </div>
                )}
              </div>
            )}
          </div>}

      {/* Species Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
        {/* Applied filters — every currently-active filter (including the
            selected taxon/subgroup/breakdown-name) as a removable pill,
            directly above the table they filter. Clear all resets everything
            here, taxon/subgroup included — Home is for the "go back to
            nothing selected at all" case; this is for "same taxon, different
            filters". The free-text box narrows the visible table by name in
            place, composing with the pills beside it — distinct from the page
            header's SpeciesSearchBar, which navigates elsewhere instead of
            narrowing here (see DebouncedSearchInput's own doc comment). */}
        <div className="p-3 md:p-4 border-b border-zinc-200 dark:border-zinc-800 rounded-t-xl">
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <div className="relative flex-1 min-w-[140px] max-w-md">
              <DebouncedSearchInput
                onSearch={handleSearch}
                initialValue={searchFilter}
                className="w-full px-3 md:px-4 py-2 pl-9 md:pl-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
              />
              <svg
                className="absolute left-2.5 md:left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            {(selectedTaxa.size > 0 || selectedSubgroups.size > 0 || selectedCategories.size > 0 || selectedYearRanges.size > 0 || selectedAssessmentYears.size > 0 || selectedDescribedYears.size > 0 || selectedObsRanges.size > 0 || selectedCountries.size > 0 || selectedSystems.size > 0 || endemicsOnly || selectedGrowthForms.size > 0 || selectedPopulationTrends.size > 0 || selectedMovementPatterns.size > 0 || selectedThreats.size > 0 || selectedAssessors.size > 0 || selectedReviewers.size > 0 || showOnlyStarred || exactFilters.outdated || exactFilters.minObs != null || exactFilters.maxObs != null || exactFilters.minAssessmentYear != null || exactFilters.maxAssessmentYear != null || exactFilters.minDescribedYear != null || exactFilters.maxDescribedYear != null) && (
              <button
                onClick={() => {
                  clearAllFiltersAndTaxa();
                  setShowOnlyStarred(false);
                  setExpandedThreat(null);
                }}
                title="Reset all filters and the selected taxon"
                className="px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors flex items-center gap-1 md:gap-1.5 bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 shrink-0"
              >
                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="hidden sm:inline">Clear all</span>
              </button>
            )}
            {pinnedSpecies.length > 0 && (
              <button
                onClick={() => setShowOnlyStarred(!showOnlyStarred)}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors flex items-center gap-1 md:gap-1.5 ${
                  showOnlyStarred
                    ? "bg-amber-500 text-white"
                    : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                }`}
              >
                <svg className="w-4 h-4" fill={showOnlyStarred ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                <span className="hidden sm:inline">Starred</span> ({pinnedSpecies.length})
              </button>
            )}
            {Array.from(selectedTaxa).map(taxonId => (
              <button
                key={taxonId}
                onClick={() => setSelectedTaxa(prev => { const next = new Set(prev); next.delete(taxonId); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full flex items-center gap-1 hover:opacity-80"
                style={{ backgroundColor: (TAXA_BY_ID[taxonId]?.color || "#666") + "20", color: TAXA_BY_ID[taxonId]?.color || "#666" }}
              >
                {TAXA_BY_ID[taxonId]?.name || taxonId}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedSubgroups).map(sgId => {
              const sgInfo = getNodeDef(sgId);
              return (
                <button
                  key={sgId}
                  onClick={() => setSelectedSubgroups(prev => { const next = new Set(prev); next.delete(sgId); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
                >
                  {sgInfo?.node.name ?? dynamicNodeDisplayName(sgId)}
                  <span className="text-sm">×</span>
                </button>
              );
            })}
            {breakdownFilter && selectedSubgroups.has(breakdownFilter.nodeId) && (
              <button
                onClick={() => setBreakdownFilter(null)}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                {breakdownDisplayName(breakdownFilter.rank, breakdownFilter.name)}
                {breakdownFilter.onlyIds?.length ? " — No CoL Match" : breakdownFilter.excludeIds?.length ? " — CoL Match" : ""}
                <span className="text-sm">×</span>
              </button>
            )}
            {!isNewAssessments && Array.from(selectedCategories).filter(cat => cat !== "NE").map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategories(prev => { const next = new Set(prev); next.delete(cat); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full flex items-center gap-1 hover:opacity-80"
                style={{ backgroundColor: CATEGORY_COLORS[cat] + "20", color: CATEGORY_COLORS[cat] }}
              >
                {cat}
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedYearRanges).map(range => (
              <button
                key={range}
                onClick={() => setSelectedYearRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-1 hover:opacity-80"
              >
                {range}
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedAssessmentYears).sort((a, b) => Number(b) - Number(a)).map(year => (
              <button
                key={`ay-${year}`}
                onClick={() => setSelectedAssessmentYears(prev => { const next = new Set(prev); next.delete(year); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-1 hover:opacity-80"
              >
                Assessed {year}
                <span className="text-sm">×</span>
              </button>
            ))}
            {isNewAssessments && Array.from(selectedDescribedYears).map(range => (
              <button
                key={`dy-${range}`}
                onClick={() => setSelectedDescribedYears(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                Described {range}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedObsRanges).map(range => (
              <button
                key={range}
                onClick={() => setSelectedObsRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 flex items-center gap-1 hover:opacity-80"
              >
                {range} obs
                <span className="text-sm">×</span>
              </button>
            ))}
            {(() => {
              if (selectedCountries.size === 0) return null;
              // Check if selected countries exactly match a single IUCN region
              const regions = new Set<string>();
              selectedCountries.forEach(c => regions.add(countryToIucnRegion(c)));
              if (regions.size === 1) {
                const region = [...regions][0];
                if (region !== "Other") {
                  const regionCodes = iucnRegionCountries(region);
                  if (regionCodes.length === selectedCountries.size && regionCodes.every(c => selectedCountries.has(c))) {
                    return (
                      <button
                        onClick={() => setSelectedCountries(new Set())}
                        className="px-3 py-1.5 text-sm font-medium rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 flex items-center gap-1 hover:opacity-80"
                      >
                        {region}
                        <span className="text-sm">×</span>
                      </button>
                    );
                  }
                }
              }
              // Otherwise show individual country pills
              return Array.from(selectedCountries).map(code => (
                <button
                  key={code}
                  onClick={() => setSelectedCountries(prev => { const next = new Set(prev); next.delete(code); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 flex items-center gap-1 hover:opacity-80"
                >
                  {getCountryName(code)}
                  <span className="text-sm">×</span>
                </button>
              ));
            })()}
            {Array.from(selectedGrowthForms).map(gf => (
              <button
                key={`gf-${gf}`}
                onClick={() => setSelectedGrowthForms(prev => { const next = new Set(prev); next.delete(gf); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-lime-100 text-lime-600 dark:bg-lime-900/30 dark:text-lime-400 flex items-center gap-1 hover:opacity-80"
              >
                {gf}
                <span className="text-sm">×</span>
              </button>
            ))}
            {endemicsOnly && (
              <button
                onClick={() => setEndemicsOnly(false)}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                Endemics only
                <span className="text-sm">×</span>
              </button>
            )}
            {Array.from(selectedPopulationTrends).map(trend => (
              <button
                key={`trend-${trend}`}
                onClick={() => setSelectedPopulationTrends(prev => { const next = new Set(prev); next.delete(trend); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 flex items-center gap-1 hover:opacity-80"
              >
                {trend}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedMovementPatterns).map(pattern => (
              <button
                key={`mov-${pattern}`}
                onClick={() => setSelectedMovementPatterns(prev => { const next = new Set(prev); next.delete(pattern); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                {pattern}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedThreats).map(code => {
              const cat = THREAT_CATEGORIES.find(c => c.code === code);
              const sub = !cat ? THREAT_CATEGORIES.flatMap(c => c.children).find(c => c.code === code) : null;
              const label = cat?.label || sub?.label || code;
              return (
                <button
                  key={`threat-${code}`}
                  onClick={() => setSelectedThreats(prev => { const next = new Set(prev); next.delete(code); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 flex items-center gap-1 hover:opacity-80"
                >
                  {label}
                  <span className="text-sm">×</span>
                </button>
              );
            })}
            {Array.from(selectedSystems).map(system => (
              <button
                key={system}
                onClick={() => setSelectedSystems(prev => { const next = new Set(prev); next.delete(system); return next; })}
                className={`px-3 py-1.5 text-sm font-medium rounded-full flex items-center gap-1 hover:opacity-80 ${
                  system === "Terrestrial" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                  : system === "Freshwater" ? "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400"
                  : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                }`}
              >
                {system}
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedAssessors).map(name => (
              <button
                key={`a-${name}`}
                onClick={() => setSelectedAssessors(prev => { const next = new Set(prev); next.delete(name); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                {name} <span className="text-[10px] opacity-60">(assessor)</span>
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedReviewers).map(name => (
              <button
                key={`r-${name}`}
                onClick={() => setSelectedReviewers(prev => { const next = new Set(prev); next.delete(name); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-400 flex items-center gap-1 hover:opacity-80"
              >
                {name} <span className="text-[10px] opacity-60">(reviewer)</span>
                <span className="text-sm">×</span>
              </button>
            ))}
            {/* Exact URL-only filters (typically arrive via an agent/MCP dashboard
                link). Shown as chips so a human can see and clear them. */}
            {(() => {
              const ef = exactFilters;
              const chips: { key: keyof typeof ef; label: string }[] = [];
              if (ef.outdated) chips.push({ key: "outdated", label: ef.outdated === "yes" ? "Outdated (>10 yrs)" : "Current (≤10 yrs)" });
              if (ef.minObs != null) chips.push({ key: "minObs", label: `≥ ${ef.minObs.toLocaleString()} obs` });
              if (ef.maxObs != null) chips.push({ key: "maxObs", label: `≤ ${ef.maxObs.toLocaleString()} obs` });
              if (ef.minAssessmentYear != null) chips.push({ key: "minAssessmentYear", label: `Assessed ≥ ${ef.minAssessmentYear}` });
              if (ef.maxAssessmentYear != null) chips.push({ key: "maxAssessmentYear", label: `Assessed ≤ ${ef.maxAssessmentYear}` });
              if (ef.minDescribedYear != null) chips.push({ key: "minDescribedYear", label: `Described ≥ ${ef.minDescribedYear}` });
              if (ef.maxDescribedYear != null) chips.push({ key: "maxDescribedYear", label: `Described ≤ ${ef.maxDescribedYear}` });
              return chips.map(c => (
                <button
                  key={`ef-${c.key}`}
                  onClick={() => setExactFilters({ [c.key]: null })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 flex items-center gap-1 hover:opacity-80"
                >
                  {c.label}
                  <span className="text-sm">×</span>
                </button>
              ));
            })()}
            <span className="ml-auto text-sm md:text-base font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums flex items-center gap-2">
              {speciesLoading && totalFiltered === 0 && !singleSpeciesPreview ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <>{totalFiltered.toLocaleString()} species</>
              )}
            </span>
            {!isNewAssessments && (neCount > 0 || neBlockedForAll) && (
              <button
                disabled={neBlockedForAll}
                onClick={() => {
                  if (neBlockedForAll) return;
                  setSelectedCategories(prev => {
                    const next = new Set(prev);
                    if (next.has("NE")) {
                      next.delete("NE");
                    } else {
                      next.add("NE");
                    }
                    return next;
                  });
                }}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors flex items-center gap-1 md:gap-1.5 ${
                  neBlockedForAll
                    ? "bg-white text-zinc-400 border border-zinc-200 opacity-60 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500 dark:border-zinc-700"
                    : selectedCategories.has("NE")
                    ? "bg-zinc-500 text-white"
                    : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                }`}
                title={neBlockedForAll ? "Not Evaluated species must be loaded per taxon group — too many to load for All Species at once" : "Show Not Evaluated species from GBIF"}
              >
                Not Evaluated
                {!neBlockedForAll && <span className="text-[10px] opacity-70">({neCount.toLocaleString()})</span>}
              </button>
            )}
          </div>
        </div>

        {/* Species table */}
        {speciesLoading && assessedSpecies.length === 0 && !singleSpeciesPreview ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
        <>
        <div className="relative">
          {speciesLoading && !singleSpeciesPreview && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          )}
        {neTruncation && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
            This group is very large — showing the first <strong>{neTruncation.shown.toLocaleString()}</strong>
            {neTruncation.neTotal > neTruncation.shown ? <> of {neTruncation.neTotal.toLocaleString()}</> : null} not-evaluated species. Open a sub-group (e.g. a class or order) to browse the rest.
          </div>
        )}
        <div
          ref={tableScrollRef}
          className={`bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-x-auto transition-opacity duration-150 ${speciesLoading && !singleSpeciesPreview ? "opacity-50 pointer-events-none" : ""}`}
          onScroll={(e) => {
            e.currentTarget.style.setProperty('--scroll-left', `${e.currentTarget.scrollLeft}px`);
          }}
        >
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-800 px-2 py-3 text-center text-xs font-medium text-zinc-500 uppercase tracking-wider w-10">
                  <svg className="w-4 h-4 mx-auto text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </th>
                <th className="sticky left-[40px] z-10 bg-zinc-50 dark:bg-zinc-800 px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Species
                </th>
                {!isNewAssessments && (
                <th
                  className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none whitespace-nowrap"
                  onClick={() => handleSort("category")}
                >
                  <span className="flex items-center gap-1">
                    Category
                    {sortField === "category" && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                {!isNewAssessments && (
                <th
                  className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none whitespace-nowrap"
                  onClick={() => handleSort("year")}
                >
                  <span className="flex items-center gap-1">
                    Assess. Date
                    {(sortField === "year" || sortField === null) && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                {isNewAssessments && (
                <th
                  className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none whitespace-nowrap"
                  onClick={() => handleSort("describedYear")}
                >
                  <span className="flex items-center gap-1">
                    Year Described
                    {sortField === "describedYear" && (
                      <span className="text-emerald-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                <th
                  className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                  onClick={() => handleSort("totalGbif")}
                >
                  <span className="flex items-center justify-end gap-1">
                    {isNewAssessments ? "GBIF Observations" : "GBIF Total"}
                    <GbifInfoTooltip />
                    {(sortField === "totalGbif" || (isNewAssessments && sortField === null)) && (
                      <span className={isNewAssessments ? "text-emerald-500" : "text-red-500"}>{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                {!isNewAssessments && (
                <th
                  className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                  onClick={() => handleSort("newGbif")}
                >
                  <span className="flex items-center justify-end gap-1">
                    GBIF Since Assess.
                    <HoverTooltip text="Records added after the assessment year (not the exact date). Uses the year following the assessment as the start of the range.">
                      <svg className="w-3 h-3 text-zinc-400 dark:text-zinc-500 cursor-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4M12 8h.01" />
                      </svg>
                    </HoverTooltip>
                    {sortField === "newGbif" && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                {!isNewAssessments && (
                <th
                  className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                  onClick={() => handleSort("pctNewGbif")}
                >
                  <span className="flex items-center justify-end gap-1">
                    % GBIF Since Assess.
                    {sortField === "pctNewGbif" && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {paginatedSpecies.map((s) => {
                const speciesKey = isNewAssessments ? Math.abs(s.id) : (s.sis_taxon_id ?? s.gbif_species_key ?? s.id);
                const assessmentDateObj = s.assessment_date ? new Date(s.assessment_date) : null;
                const assessmentYear = assessmentDateObj ? assessmentDateObj.getFullYear() : null;
                const yearsSinceAssessment = assessmentDateObj
                  ? Math.floor((Date.now() - assessmentDateObj.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                  : null;
                const details = speciesDetails[s.id];
                const gbifSpeciesKey = s.gbif_species_key || (details?.gbifUrl ? parseInt(details.gbifUrl.split('/').pop() || '0') : null);
                const isPinned = pinnedSet.has(speciesKey);
                const isDragging = draggedSpecies === speciesKey;
                const isDragOver = dragOverSpecies === speciesKey && draggedSpecies !== speciesKey;
                return (
                  <React.Fragment key={s.id}>
                  <tr
                    className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer ${selectedSpeciesKey === speciesKey ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${isDragging ? "opacity-50" : ""} ${isDragOver ? "border-t-2 border-amber-500" : ""}`}
                    onClick={() => { setSelectedSpeciesKey(selectedSpeciesKey === speciesKey ? null : speciesKey); }}
                    draggable={isPinned && showOnlyStarred}
                    onDragStart={(e) => handleDragStart(e, speciesKey)}
                    onDragOver={(e) => handleDragOver(e, speciesKey)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, speciesKey)}
                    onDragEnd={handleDragEnd}
                  >
                    <td className={`sticky left-0 z-10 px-2 py-2 text-center ${selectedSpeciesKey === speciesKey ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
                      <div className="flex items-center justify-center gap-1">
                        {isPinned && showOnlyStarred && (
                          <span className="cursor-grab text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Drag to reorder">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
                            </svg>
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinned(speciesKey);
                          }}
                          className={`p-1 rounded transition-colors ${isPinned ? "text-amber-500 hover:text-amber-600" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600 dark:hover:text-amber-400"}`}
                          title={isPinned ? "Unpin species" : "Pin species"}
                        >
                          <svg className="w-4 h-4" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className={`sticky left-[40px] z-10 px-2 md:px-4 py-2 ${selectedSpeciesKey === speciesKey ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
                      <div className="flex items-center gap-2">
                        {/* iNat profile pic */}
                        {details?.inatDefaultImage === undefined ? (
                          <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-100 dark:bg-zinc-800 rounded flex-shrink-0 flex items-center justify-center">
                            <span className="inline-block animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
                          </div>
                        ) : details?.inatDefaultImage?.squareUrl ? (
                          <img
                            src={details.inatDefaultImage.squareUrl}
                            alt=""
                            className="w-8 h-8 md:w-10 md:h-10 object-cover rounded flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-red-400"
                            onMouseEnter={(e) => {
                              const img = e.currentTarget;
                              const rect = img.getBoundingClientRect();
                              const preview = document.getElementById('image-preview');
                              if (preview) {
                                (preview as HTMLImageElement).src = details.inatDefaultImage?.mediumUrl || details.inatDefaultImage?.squareUrl || '';
                                preview.style.display = 'block';
                                const showBelow = rect.bottom + 192 + 8 < window.innerHeight;
                                preview.style.top = showBelow ? `${rect.bottom + 8}px` : `${rect.top - 192 - 8}px`;
                                preview.style.left = `${rect.left}px`;
                              }
                            }}
                            onMouseLeave={() => {
                              const preview = document.getElementById('image-preview');
                              if (preview) {
                                preview.style.display = 'none';
                              }
                            }}
                          />
                        ) : (
                          <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 flex-shrink-0">
                            <TaxaIcon taxonId={s.taxon_id || "all"} size={18} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <span
                            className="italic font-medium text-zinc-900 dark:text-zinc-100 text-xs md:text-sm"
                          >
                            {s.scientific_name}
                          </span>
                          {s.common_name && (
                            <div className="text-zinc-500 dark:text-zinc-400 text-xs truncate max-w-[140px] md:max-w-none">
                              {s.common_name}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {!isNewAssessments && (
                    <td className="px-2 md:px-4 py-3 whitespace-nowrap">
                      {(() => {
                        const criteria = s.criteria ?? details?.criteria;
                        return criteria && !["DD", "LC", "NT", "EX", "EW", "NE"].includes(s.category) ? (
                        <HoverTooltip text={`${criteria}${explainCriteria(criteria)}`}>
                          <span
                            className="px-2 py-0.5 text-xs font-medium rounded cursor-help"
                            style={{
                              backgroundColor: CATEGORY_COLORS[s.category] + "20",
                              color: CATEGORY_COLORS[s.category],
                            }}
                          >
                            {s.category}
                          </span>
                        </HoverTooltip>
                      ) : (
                        <span
                          className="px-2 py-0.5 text-xs font-medium rounded"
                          style={{
                            backgroundColor: CATEGORY_COLORS[s.category] + "20",
                            color: s.category === "EX" || s.category === "EW" ? "#fff" : CATEGORY_COLORS[s.category],
                            ...(s.category === "EX" || s.category === "EW" ? { backgroundColor: CATEGORY_COLORS[s.category] } : {})
                          }}
                        >
                          {s.category}
                        </span>
                        );
                      })()}
                    </td>
                    )}
                    {!isNewAssessments && (
                    <td className="px-2 md:px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {isNE(s) ? <span className="text-zinc-400">N/A</span> : (
                        <>
                          <HoverTooltip
                            text={`Published: ${s.year_published || "N/A"}`}
                          >
                            <span
                              className="cursor-help"
                            >
                              {s.assessment_date
                                ? new Date(s.assessment_date).toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "—"}
                            </span>
                          </HoverTooltip>
                          {yearsSinceAssessment !== null && isOutdated(s.assessment_date) && (
                            <span className="ml-1 text-xs text-amber-600">({yearsSinceAssessment}y ago)</span>
                          )}
                        </>
                      )}
                    </td>
                    )}
                    {/* Year Described (CoL) */}
                    {isNewAssessments && (
                    <td className="px-2 md:px-4 py-3 text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {s.described_year ?? <span className="text-zinc-400">—</span>}
                    </td>
                    )}
                    {/* Total GBIF */}
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {details?.gbifOccurrences != null && details?.gbifUrl ? (
                        <a
                          href={`https://www.gbif.org/occurrence/search?taxon_key=${details.gbifUrl.split('/').pop()}&${GBIF_FILTERS}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {details.gbifOccurrences.toLocaleString()}
                        </a>
                      ) : s.gbif_occurrence_count != null && s.gbif_species_key ? (
                        <a
                          href={`https://www.gbif.org/occurrence/search?taxon_key=${s.gbif_species_key}&${GBIF_FILTERS}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.gbif_occurrence_count.toLocaleString()}
                        </a>
                      ) : details?.gbifMatchStatus?.matchType === 'HIGHERRANK' || details?.gbifMatchStatus?.matchType === 'NONE' ? (
                        <HoverTooltip
                          text={details.gbifMatchStatus.matchType === 'HIGHERRANK'
                            ? `Name not found in GBIF (matched to ${details.gbifMatchStatus.matchedRank?.toLowerCase() || 'higher rank'} instead). May be due to a taxonomic split, synonym, or naming difference.`
                            : "Species not found in GBIF. May be due to a taxonomic split, synonym, or naming difference."}
                        >
                          <span className="text-zinc-400 cursor-help">?</span>
                        </HoverTooltip>
                      ) : "—"}
                    </td>
                    {/* New GBIF */}
                    {!isNewAssessments && (
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {isNE(s) ? (
                        <span className="text-zinc-400">N/A</span>
                      ) : (() => {
                        const newObs = details?.gbifOccurrencesSinceAssessment ?? s.gbif_observations_after_assessment_year;
                        if (newObs == null) return "—";
                        const key = details?.gbifUrl?.split('/').pop() ?? s.gbif_species_key;
                        if (key && assessmentYear) {
                          return (
                            <a
                              href={`https://www.gbif.org/occurrence/search?taxon_key=${key}&year=${assessmentYear + 1},${currentYear}&${GBIF_FILTERS}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {newObs.toLocaleString()}
                            </a>
                          );
                        }
                        return newObs.toLocaleString();
                      })()}
                    </td>
                    )}
                    {/* % New GBIF */}
                    {!isNewAssessments && (
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {isNE(s) ? <span className="text-zinc-400">N/A</span> : (() => {
                        const total = details?.gbifOccurrences ?? s.gbif_occurrence_count;
                        const newObs = details?.gbifOccurrencesSinceAssessment ?? s.gbif_observations_after_assessment_year;
                        if (total == null || total === 0 || newObs == null) return "—";
                        const pct = (newObs / total) * 100;
                        return `${pct < 1 && pct > 0 ? "<1" : Math.round(pct)}%`;
                      })()}
                    </td>
                    )}
                  </tr>
                  {selectedSpeciesKey === speciesKey && (
                    <tr>
                      <td colSpan={isNewAssessments ? 4 : 8} className="p-0 bg-zinc-50 dark:bg-zinc-800/30" style={{ width: 0 }}>
                        <div style={{ width: 'var(--view-width, 100%)', maxWidth: '100%', transform: 'translateX(var(--scroll-left, 0px))' }}>
                          {/* Tab bar */}
                          <div className="flex flex-wrap items-center border-b border-zinc-200 dark:border-zinc-700" onClick={(e) => e.stopPropagation()}>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "gbif" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("gbif")}
                                >
                                  {gbifSpeciesKey ? "GBIF" : "iNaturalist"}
                                </button>
                                {(assessmentYear || s.category === "NE") && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "literature" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("literature")}
                                  >
                                    Literature
                                  </button>
                                )}
                                {s.category !== "NE" && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "redlist" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("redlist")}
                                  >
                                    IUCN Red List
                                  </button>
                                )}
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "cites" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("cites")}
                                >
                                  CITES
                                </button>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "col" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("col")}
                                >
                                  Catalogue of Life
                                </button>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "eol" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("eol")}
                                >
                                  Encyclopedia of Life
                                </button>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "wikipedia" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("wikipedia")}
                                >
                                  Wikipedia
                                </button>
                                {s.category === "NE" && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "assessors" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("assessors")}
                                  >
                                    Suggested Assessors
                                  </button>
                                )}
                                {s.category === "NE" && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "reviewers" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("reviewers")}
                                  >
                                    Suggested Reviewers
                                  </button>
                                )}
                          </div>
                          {/* Content — overflow-hidden so child components don't extend past viewport */}
                          <div style={{ overflow: 'hidden', width: '100%' }}>
                          {gbifSpeciesKey ? (
                            (visitedTabs.has("gbif")) && (
                            <div style={{ display: activeDetailTab === "gbif" ? undefined : "none" }}>
                              <OccurrenceMapRow
                                speciesKey={gbifSpeciesKey}
                                mounted={mounted}
                                assessmentYear={assessmentYear}
                                assessmentDate={s.assessment_date}
                                assessmentId={s.assessment_id}
                                sisTaxonId={s.sis_taxon_id}
                                category={s.category}
                                criteria={s.criteria}
                                taxonGroup={s.taxon_group}
                                scientificName={s.scientific_name}
                                nativeCountriesRedList={s.countries}
                                previousAssessments={(s.sis_taxon_id ? assessmentHistory[s.sis_taxon_id] : null) ?? s.previous_assessments}
                                onEmpty={s.category === "NE" ? handleOccurrenceEmpty : undefined}
                              />
                            </div>
                            )
                          ) : (visitedTabs.has("gbif")) && (
                            <div style={{ display: activeDetailTab === "gbif" ? undefined : "none" }}>
                              <InatObservationsPanel scientificName={s.scientific_name} mounted={mounted} onEmpty={s.category === "NE" ? handleOccurrenceEmpty : undefined} />
                            </div>
                          )}
                          {(assessmentYear || s.category === "NE") && (visitedTabs.has("literature")) && (
                            <div className="p-4" style={{ display: activeDetailTab === "literature" ? undefined : "none" }}>
                              <NewLiteratureSinceAssessment
                                scientificName={s.scientific_name}
                                assessmentYear={assessmentYear ?? 0}
                              />
                            </div>
                          )}
                          {(visitedTabs.has("col")) && (() => {
                            const syn = synonymsBySpecies[synKey(s) ?? ""];
                            return (
                            <div style={{ display: activeDetailTab === "col" ? undefined : "none" }}>
                              {!syn ? (
                                <div className="flex items-center justify-center p-8">
                                  <svg className="w-5 h-5 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                </div>
                              ) : !syn.col_id ? (
                                <div className="text-sm text-zinc-400 italic p-4">No Catalogue of Life match for <span className="italic">{s.scientific_name}</span>.</div>
                              ) : (
                                <div className="p-4 text-sm space-y-3">
                                  <div>
                                    <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Accepted name (CoL)</div>
                                    <span className="italic text-zinc-900 dark:text-zinc-100">{syn.accepted_name ?? s.scientific_name}</span>
                                    {syn.accepted_authorship && <span className="text-zinc-500 dark:text-zinc-400"> {syn.accepted_authorship}</span>}
                                  </div>
                                  <div>
                                    <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Synonyms ({syn.synonyms.length})</div>
                                    {syn.synonyms.length === 0 ? (
                                      <div className="text-zinc-500 dark:text-zinc-400">No synonyms recorded.</div>
                                    ) : (
                                      <ul className="space-y-0.5">
                                        {syn.synonyms.map((x, i) => (
                                          <li key={i}>
                                            <span className="italic text-zinc-700 dark:text-zinc-300">{x.name}</span>
                                            {x.authorship && <span className="text-zinc-500 dark:text-zinc-400"> {x.authorship}</span>}
                                            {x.status === "ambiguous synonym" && <span className="ml-1 text-xs text-amber-600 dark:text-amber-500">(ambiguous)</span>}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  <a
                                    href={`https://www.catalogueoflife.org/data/taxon/${syn.col_id}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    View on Catalogue of Life ↗
                                  </a>
                                </div>
                              )}
                            </div>
                            );
                          })()}
                          {(visitedTabs.has("eol")) && (
                            <div style={{ display: activeDetailTab === "eol" ? undefined : "none" }}>
                              <EolSummary scientificName={s.scientific_name} />
                            </div>
                          )}
                          {s.category !== "NE" && (visitedTabs.has("redlist")) && (
                            <div style={{ display: activeDetailTab === "redlist" ? undefined : "none" }}>
                              <RedListAssessments
                                sisTaxonId={s.sis_taxon_id ?? undefined}
                                currentAssessmentId={s.assessment_id ?? 0}
                                currentCategory={s.category}
                                currentAssessmentDate={s.assessment_date}
                                previousAssessments={((s.sis_taxon_id ? assessmentHistory[s.sis_taxon_id] : null) ?? s.previous_assessments ?? []).map((a) => ({ year: a.year, assessment_id: a.id, category: a.category, assessors: a.assessors, reviewers: a.reviewers }))}
                                speciesUrl={`https://www.iucnredlist.org/species/${s.sis_taxon_id}/${s.assessment_id}`}
                              />
                            </div>
                          )}
                          {(visitedTabs.has("wikipedia")) && (
                          <div style={{ display: activeDetailTab === "wikipedia" ? undefined : "none" }}>
                            <WikipediaSummary scientificName={s.scientific_name} />
                          </div>
                          )}
                          {(visitedTabs.has("cites")) && (
                          <div style={{ display: activeDetailTab === "cites" ? undefined : "none" }}>
                            <CitesSummary scientificName={s.scientific_name} />
                          </div>
                          )}
                          {s.category === "NE" && (visitedTabs.has("assessors")) && (
                            <div style={{ display: activeDetailTab === "assessors" ? undefined : "none" }}>
                              <AssessorCandidatesTable
                                taxaId={[...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group}
                                taxaName={findNode([...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group)?.name ?? (selectedSubgroups.size > 0 ? dynamicNodeDisplayName([...selectedSubgroups][0]) : undefined) ?? TAXA_BY_ID[[...selectedTaxa][0] ?? s.taxon_group]?.name ?? "Species"}
                                countries={s.countries}
                              />
                            </div>
                          )}
                          {s.category === "NE" && (visitedTabs.has("reviewers")) && (
                            <div style={{ display: activeDetailTab === "reviewers" ? undefined : "none" }}>
                              <ReviewerCandidatesTable
                                taxaId={[...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group}
                                taxaName={findNode([...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group)?.name ?? (selectedSubgroups.size > 0 ? dynamicNodeDisplayName([...selectedSubgroups][0]) : undefined) ?? TAXA_BY_ID[[...selectedTaxa][0] ?? s.taxon_group]?.name ?? "Species"}
                                countries={s.countries}
                              />
                            </div>
                          )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {totalFiltered === 0 && !speciesLoading && (
                <tr>
                  <td colSpan={isNewAssessments ? 4 : 8} className="px-4 py-8 text-center text-zinc-500">
                    No species found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        {/* Pagination */}
        {totalFiltered > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-3 md:px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 gap-2">
            <div className="flex items-center gap-3">
              <div className="text-xs md:text-sm text-zinc-500">
                {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, totalFiltered)} of {totalFiltered}
              </div>
              <label className="flex items-center gap-1.5 text-xs md:text-sm text-zinc-500">
                <span>Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs md:text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 focus:outline-none cursor-pointer"
                >
                  {[1, 2, 3, 5, 10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Prev
                </button>
                <span className="text-xs md:text-sm text-zinc-600 dark:text-zinc-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>
      </div>
      ))}

      {/* Fixed image preview portal */}
      <img
        id="image-preview"
        alt=""
        className="fixed z-[9999] w-48 h-48 object-cover rounded shadow-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pointer-events-none"
        style={{ display: 'none' }}
      />
    </div>
  );
}
