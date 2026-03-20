"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import TaxaSummary from "./TaxaSummary";
import NewLiteratureSinceAssessment from "../LiteratureSearch";
import RedListAssessments from "../RedListAssessments";
import CitesSummary from "../CitesSummary";
import WikipediaSummary from "../WikipediaSummary";
import TaxaIcon from "../TaxaIcon";
import { ALPHA2_TO_NAME } from "../WorldMap";
import { CATEGORY_COLORS, TAXA_BY_ID } from "@/config/taxa";
import { speciesMatchesNode, getNodeDef, getViewRootForNode, findNode } from "@/lib/taxonomy-utils";
import ReviewerChart from "./ReviewerChart";
import { parseAssessors } from "@/lib/parseAssessors";
import { useFilterParams } from "@/hooks/useFilterParams";
import { type RedListSpecies } from "@/hooks/useRedListSpeciesQuery";
import AssessmentAssistant from "../AssessmentAssistant";
import AssessorCandidatesTable from "../AssessorCandidatesTable";

// Dynamically import OccurrenceMapRow to avoid SSR issues with Leaflet
const OccurrenceMapRow = dynamic(
  () => import("../OccurrenceMapRow"),
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


// Debounced search input - manages own state for instant typing, debounces parent updates
function DebouncedSearchInput({
  onSearch,
  initialValue = "",
  placeholder = "Search species...",
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
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">PRESERVED_SPECIMEN</code> <span className="text-zinc-400">(e.g. herbaria, museums)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MATERIAL_SAMPLE</code> <span className="text-zinc-400">(e.g. eDNA)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OCCURRENCE</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OBSERVATION</code></li>
          </ul>
          <div className="font-medium text-zinc-100 mt-1">Excluded:</div>
          <ul className="text-zinc-300 list-disc list-inside">
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">PRESERVED_SPECIMEN</code> <span className="text-zinc-400">(historical ranges)</span></li>
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
  sharedTaxa?: Set<string>;
  sharedSubgroups?: Set<string>;
  onTaxaChange?: (taxa: Set<string>) => void;
  onSubgroupsChange?: (subgroups: Set<string>) => void;
}

export default function RedListView({ viewMode = "reassessments", sharedTaxa, sharedSubgroups, onTaxaChange, onSubgroupsChange }: RedListViewProps = {}) {
  const isNewAssessments = viewMode === "new-assessments";
  // Filters synced with URL search params for shareable links
  const {
    selectedTaxa, setSelectedTaxa,
    selectedSubgroups, setSelectedSubgroups,
    selectedCategories, setSelectedCategories,
    selectedYearRanges, setSelectedYearRanges,
    selectedCountries, setSelectedCountries,
    selectedObsRanges, setSelectedObsRanges,
    selectedAssessors, setSelectedAssessors,
    selectedReviewers, setSelectedReviewers,
    searchFilter, setSearchFilter,
    sortField, sortDirection, setSort,
    clearAllFilters,
    setViewMode: setUrlViewMode,
    species: urlSpecies, tab: urlTab,
    setSpeciesParam, setTabParam,
  } = useFilterParams();

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

  // Clear mode-specific caches when switching between reassessments and new-assessments
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    if (prevViewModeRef.current === viewMode) return;
    prevViewModeRef.current = viewMode;
    // Same taxon key maps to different data per mode — clear cache
    setSpeciesByTaxon({});
    setNeSpecies([]);
    setNeSpeciesFetched(false);
    // Clear assessment-specific filters
    clearAllFilters();
    setShowOnlyStarred(false);
    // Clear "all" taxa selection when switching to new-assessments (NE dataset too large for "all")
    if (viewMode === "new-assessments") {
      setSelectedTaxa(prev => prev.has("all") ? new Set<string>() : prev);
    }
  }, [viewMode, clearAllFilters, setSelectedTaxa]);

  // Taxon toggle handler (used by TaxaSummary)
  // Regular click: select only that taxon (or deselect if already sole selection)
  // Cmd/Ctrl+Click on taxon row: multi-select toggle (expands taxa summary to show all rows)
  const handleToggleTaxon = useCallback((taxonId: string, event: React.MouseEvent) => {
    const isMulti = event.metaKey || event.ctrlKey;

    // "all" row behavior:
    // - If anything is selected (nested view), return to landing page
    // - Only select "all" when clicking from the landing page itself (nothing selected)
    // Disabled in new-assessments mode (NE dataset too large for "all")
    if (taxonId === "all") {
      if (selectedTaxa.size > 0 || selectedSubgroups.size > 0) {
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
      // Single click on already-sole-selected taxon: keep selected (TaxaSummary
      // handles expand/collapse toggle). Only "All Species" returns to landing.
      if (prev.size === 1 && prev.has(taxonId)) {
        return prev;
      }
      // Switching to a different taxon — clear subgroups
      setSelectedSubgroups(new Set());
      return new Set([taxonId]);
    });
  }, [setSelectedTaxa, setSelectedSubgroups, selectedTaxa, selectedSubgroups, isNewAssessments]);

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
    // Skip clearing when going from no taxa to some taxa — this happens during
    // URL hydration (useFilterParams starts empty then populates from URL) and
    // there are no taxa-specific filters to reset when nothing was selected before.
    if (prev.size === 0) return;
    clearAllFilters();
    setShowOnlyStarred(false);
  }, [selectedTaxa, clearAllFilters]);

  const [showOnlyStarred, setShowOnlyStarred] = useState(false);

  // Stable callback for debounced search input
  const handleSearch = useCallback((value: string) => {
    setSearchFilter(value);
  }, [setSearchFilter]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // ── Data fetching ────────────────────────────────────────────────────
  // Cache of fetched species per taxon ID. When "all" is fetched, it supersedes
  // individual taxa caches. Each taxon is fetched at most once.
  const [speciesByTaxon, setSpeciesByTaxon] = useState<Record<string, RedListSpecies[]>>({});
  const [loadingTaxa, setLoadingTaxa] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const abortRefs = useRef<Record<string, AbortController>>({});
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);

  // Determine which taxa need fetching
  useEffect(() => {
    if (selectedTaxa.size === 0) return;

    // In new-assessments mode, skip "all" — NE dataset too large for serverless
    const taxaToFetch = [...selectedTaxa].filter(t => {
      if (isNewAssessments && t === "all") return false;
      return !speciesByTaxon[t] && !loadingTaxa.has(t);
    });
    // If "all" is already cached, no individual fetches needed
    if (speciesByTaxon["all"] && !selectedTaxa.has("all")) {
      // "all" data covers everything — no new fetches needed
      return;
    }
    if (taxaToFetch.length === 0) return;

    for (const taxonId of taxaToFetch) {
      // Reuse the in-flight background prefetch instead of duplicating the request
      if (taxonId === "all" && prefetchPromiseRef.current) {
        setLoadingTaxa(prev => new Set(prev).add("all"));
        prefetchPromiseRef.current.then(() => {
          setLoadingTaxa(prev => { const next = new Set(prev); next.delete("all"); return next; });
        });
        continue;
      }

      // If fetching "all", abort any in-flight individual taxon fetches
      if (taxonId === "all") {
        Object.entries(abortRefs.current).forEach(([id, ctrl]) => {
          if (id !== "all") ctrl.abort();
        });
      }

      const controller = new AbortController();
      abortRefs.current[taxonId] = controller;

      setLoadingTaxa(prev => new Set(prev).add(taxonId));

      const categoryParam = isNewAssessments ? "&category=NE" : "";
      fetch(`/api/redlist/species?taxon=${encodeURIComponent(taxonId)}${categoryParam}`, { signal: controller.signal })
        .then(async res => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Species API returned ${res.status}`);
          }
          return res.json();
        })
        .then(data => {
          if (!controller.signal.aborted) {
            setSpeciesByTaxon(prev => ({ ...prev, [taxonId]: data.species }));
          }
        })
        .catch(err => {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "Unknown error");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoadingTaxa(prev => { const next = new Set(prev); next.delete(taxonId); return next; });
          }
          delete abortRefs.current[taxonId];
        });
    }
  }, [selectedTaxa, speciesByTaxon, loadingTaxa, isNewAssessments]);

  // Prefetch all species on mount so taxa clicks feel instant (skip for new-assessments — NE dataset too large)
  useEffect(() => {
    if (isNewAssessments) return;
    const controller = new AbortController();
    const promise = fetch("/api/redlist/species?taxon=all", { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && !controller.signal.aborted) {
          setSpeciesByTaxon(prev => prev["all"] ? prev : { ...prev, all: data.species });
        }
      })
      .catch(() => {})
      .finally(() => { prefetchPromiseRef.current = null; });
    prefetchPromiseRef.current = promise;
    return () => { controller.abort(); prefetchPromiseRef.current = null; };
  }, [isNewAssessments]);

  const speciesLoading = loadingTaxa.size > 0;

  // Merge species from all fetched taxa relevant to current selection
  const assessedSpecies = useMemo(() => {
    if (selectedTaxa.size === 0) return [];
    // If "all" is cached, use it directly
    if (speciesByTaxon["all"]) return speciesByTaxon["all"];
    // Otherwise merge per-taxon caches
    let merged: RedListSpecies[] = [];
    for (const taxonId of selectedTaxa) {
      if (speciesByTaxon[taxonId]) merged = merged.concat(speciesByTaxon[taxonId]);
    }
    return merged;
  }, [selectedTaxa, speciesByTaxon]);

  // NE species lazy loading (only fetched when NE category is selected)
  const [neSpecies, setNeSpecies] = useState<RedListSpecies[]>([]);
  const [neSpeciesFetched, setNeSpeciesFetched] = useState(false);
  // Determine taxon for NE fetch: "all" if selected or multi-taxa, otherwise the single taxon
  const neFetchTaxon = useMemo(() => {
    if (selectedTaxa.size === 0) return null;
    if (selectedTaxa.has("all")) return "all";
    if (selectedTaxa.size === 1) return [...selectedTaxa][0];
    return "all";
  }, [selectedTaxa]);

  useEffect(() => {
    // Skip NE lazy-load in new-assessments mode — main path already fetches NE species
    if (isNewAssessments) return;
    if (!selectedCategories.has("NE") || neSpeciesFetched || neFetchTaxon === null) return;
    fetch(`/api/redlist/species?taxon=${encodeURIComponent(neFetchTaxon)}&category=NE`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.species) setNeSpecies(data.species); setNeSpeciesFetched(true); })
      .catch(() => {});
  }, [selectedCategories, neSpeciesFetched, neFetchTaxon]);

  // Reset NE fetch when taxon selection changes
  useEffect(() => { setNeSpecies([]); setNeSpeciesFetched(false); }, [neFetchTaxon]);

  // All species = assessed + NE (in new-assessments mode, assessedSpecies already contains NE species)
  const species = useMemo(() => isNewAssessments ? assessedSpecies : [...assessedSpecies, ...neSpecies], [assessedSpecies, neSpecies, isNewAssessments]);
  const neCount = neSpecies.length;

  // Filter by selected taxa + subgroup
  const taxaFilteredSpecies = useMemo(() => {
    let filtered = species;
    if (selectedTaxa.size > 0 && !selectedTaxa.has("all")) {
      filtered = filtered.filter(s => s.taxon_id && selectedTaxa.has(s.taxon_id));
    }
    if (selectedSubgroups.size > 0) {
      filtered = filtered.filter(s =>
        Array.from(selectedSubgroups).some(sg => speciesMatchesNode(s, sg))
      );
    }
    return filtered;
  }, [species, selectedTaxa, selectedSubgroups]);

  // Helper to check if species matches year range filter
  const matchesYearRangeFilter = (assessmentDate: string | null, yearRanges: Set<string> = selectedYearRanges): boolean => {
    if (yearRanges.size === 0) return true;
    if (!assessmentDate) return false;
    const currentYr = new Date().getFullYear();
    const yearsSince = currentYr - new Date(assessmentDate).getFullYear();
    for (const range of yearRanges) {
      switch (range) {
        case "0-1 years": if (yearsSince <= 1) return true; break;
        case "2-5 years": if (yearsSince >= 2 && yearsSince <= 5) return true; break;
        case "6-10 years": if (yearsSince >= 6 && yearsSince <= 10) return true; break;
        case "11-20 years": if (yearsSince >= 11 && yearsSince <= 20) return true; break;
        case "20+ years": if (yearsSince > 20) return true; break;
      }
    }
    return false;
  };

  // Helper to check if species matches GBIF observation range filter
  const matchesObsRangeFilter = (obsCount: number | null | undefined, obsRanges: Set<string> = selectedObsRanges): boolean => {
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
  };

  // Helper to get assessors from a species' most recent previous assessment
  const getSpeciesAssessors = useCallback((s: Species): string[] => {
    if (s.previous_assessments.length === 0) return [];
    // Use the most recent assessment (first in array)
    const latest = s.previous_assessments[0];
    return parseAssessors(latest.assessors);
  }, []);

  // Helper to get reviewers from a species' most recent previous assessment
  const getSpeciesReviewers = useCallback((s: Species): string[] => {
    if (s.previous_assessments.length === 0) return [];
    const latest = s.previous_assessments[0];
    return parseAssessors(latest.reviewers);
  }, []);

  // Track which tab is active in the assessors/reviewers chart
  const [reviewerFilterMode, setReviewerFilterMode] = useState<"assessors" | "reviewers">("assessors");

  // Helper to check if species matches the assessors filter
  const matchesAssessorsFilter = useCallback((s: Species): boolean => {
    if (selectedAssessors.size === 0) return true;
    return getSpeciesAssessors(s).some(a => selectedAssessors.has(a));
  }, [selectedAssessors, getSpeciesAssessors]);

  // Helper to check if species matches the reviewers filter
  const matchesReviewersFilter = useCallback((s: Species): boolean => {
    if (selectedReviewers.size === 0) return true;
    return getSpeciesReviewers(s).some(r => selectedReviewers.has(r));
  }, [selectedReviewers, getSpeciesReviewers]);

  // Species details cache (images, criteria, common names)
  const [speciesDetails, setSpeciesDetails] = useState<Record<number, SpeciesDetails>>({});

  // Row expansion state (initialized from URL params if present)
  const [selectedSpeciesKey, setSelectedSpeciesKeyRaw] = useState<number | null>(urlSpecies);
  const [activeDetailTab, setActiveDetailTabRaw] = useState<"gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors">(urlTab ?? "gbif");

  // Wrap setters to sync with URL
  const setSelectedSpeciesKey = useCallback((key: number | null) => {
    setSelectedSpeciesKeyRaw(key);
    setSpeciesParam(key, key != null ? "gbif" : "gbif");
    if (key != null) {
      setActiveDetailTabRaw("gbif");
    }
  }, [setSpeciesParam]);

  const setActiveDetailTab = useCallback((tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors") => {
    setActiveDetailTabRaw(tab);
    setTabParam(tab);
  }, [setTabParam]);
  // Hydrate species/tab from URL after useFilterParams reads the URL in its effect
  const hydratedUrlSpeciesRef = useRef(false);
  useEffect(() => {
    if (hydratedUrlSpeciesRef.current) return;
    if (urlSpecies != null) {
      hydratedUrlSpeciesRef.current = true;
      setSelectedSpeciesKeyRaw(urlSpecies);
      setActiveDetailTabRaw(urlTab ?? "gbif");
    }
  }, [urlSpecies, urlTab]);

  const [stackedDetailView, setStackedDetailView] = useState(false);
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
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
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
  }, [taxaFilteredSpecies, selectedCountries, selectedYearRanges, selectedObsRanges, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter]);

  // Year chart: apply all filters EXCEPT year range
  const assessmentYearData = useMemo(() => {
    const currentYr = new Date().getFullYear();
    const ranges = [
      { range: "0-1 years", shortRange: "0-1y", count: 0, minYear: 0 },
      { range: "2-5 years", shortRange: "2-5y", count: 0, minYear: 2 },
      { range: "6-10 years", shortRange: "6-10y", count: 0, minYear: 6 },
      { range: "11-20 years", shortRange: "11-20y", count: 0, minYear: 11 },
      { range: "20+ years", shortRange: ">20y", count: 0, minYear: 21 },
    ];
    taxaFilteredSpecies.forEach(s => {
      if (!s.assessment_date || s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const diff = currentYr - new Date(s.assessment_date).getFullYear();
      if (diff <= 1) ranges[0].count++;
      else if (diff <= 5) ranges[1].count++;
      else if (diff <= 10) ranges[2].count++;
      else if (diff <= 20) ranges[3].count++;
      else ranges[4].count++;
    });
    const total = ranges.reduce((sum, r) => sum + r.count, 0);
    return ranges.map(r => ({
      ...r,
      label: `${r.count.toLocaleString()} (${total > 0 ? ((r.count / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedObsRanges, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter]);

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
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter]);

  // Country chart: apply all filters EXCEPT country
  const { countryCounts, uniqueCountries, countryStatsForMap } = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      s.countries.forEach(code => {
        counts[code] = (counts[code] || 0) + 1;
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
        { occurrences: 0, species: count }
      ])
    );
    return { countryCounts: counts, uniqueCountries: sorted, countryStatsForMap: statsForMap };
  }, [taxaFilteredSpecies, selectedCategories, selectedYearRanges, selectedObsRanges, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter]);

  // Assessor chart: apply all filters EXCEPT assessors (include reviewers)
  const assessorChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
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
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, matchesSearch, matchesReviewersFilter, getSpeciesAssessors]);

  // Reviewer chart: apply all filters EXCEPT reviewers (include assessors)
  const reviewerChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
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
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, matchesSearch, matchesAssessorsFilter, getSpeciesReviewers]);

  // ── Client-side filtering and sorting ──────────────────────────────
  const CATEGORY_ORDER: Record<string, number> = {
    EX: 0, EW: 1, CR: 2, EN: 3, VU: 4, NT: 5, LC: 6, DD: 7, NE: 8,
  };

  const { filteredSpecies, sortedSpecies } = useMemo(() => {
    const filtered = taxaFilteredSpecies.filter((s) => {
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(s.category);
      const matchesYear = s.category === "NE" || matchesYearRangeFilter(s.assessment_date);
      const matchesObs = matchesObsRangeFilter(s.gbif_occurrence_count);
      const matchesCountry = selectedCountries.size === 0 || s.countries.some(c => selectedCountries.has(c));
      const matchesSearch =
        !searchFilter ||
        s.scientific_name.toLowerCase().includes(searchFilter) ||
        s.common_name?.toLowerCase().includes(searchFilter);
      const matchesAssessor = matchesAssessorsFilter(s);
      const matchesReviewer = matchesReviewersFilter(s);
      const pinnedKey = isNewAssessments ? Math.abs(s.id) : s.sis_taxon_id;
      const matchesStarred = !showOnlyStarred || (pinnedKey != null && pinnedSet.has(pinnedKey));
      return matchesCategory && matchesYear && matchesObs && matchesCountry && matchesSearch && matchesAssessor && matchesReviewer && matchesStarred;
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
  }, [taxaFilteredSpecies, selectedCategories, selectedYearRanges, selectedObsRanges, selectedCountries, searchFilter, showOnlyStarred, pinnedSet, pinnedSpecies, sortField, sortDirection, matchesAssessorsFilter, matchesReviewersFilter, isNewAssessments]);

  // ── Client-side pagination ─────────────────────────────────────────
  const totalFiltered = filteredSpecies.length;
  const totalPages = Math.ceil(sortedSpecies.length / PAGE_SIZE);
  const paginatedSpecies = sortedSpecies.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

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

  const handleClearCountry = () => {
    setSelectedCountries(new Set());
  };

  // Handle sort toggle
  const handleSort = (field: "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif") => {
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
  }, [selectedTaxa, selectedCategories, selectedYearRanges, selectedObsRanges, selectedAssessors, selectedReviewers, searchFilter, selectedCountries, showOnlyStarred]);

  // Auto-navigate to the page containing the URL-selected species
  const urlSpeciesHandledRef = useRef(false);
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

  // Toggle a single assessor/reviewer in/out of selection (used by search list)
  const handleAssessorToggle = useCallback((code: string) => {
    const setter = reviewerFilterMode === "assessors" ? setSelectedAssessors : setSelectedReviewers;
    setter(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, [reviewerFilterMode, setSelectedAssessors, setSelectedReviewers]);

  // Handle assessor/reviewer bar click
  const handleAssessorClick = (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
    const code = data.payload?.code;
    if (!code) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    const setter = reviewerFilterMode === "assessors" ? setSelectedAssessors : setSelectedReviewers;
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
  };

  const currentYear = new Date().getFullYear();
  const GBIF_FILTERS = "has_coordinate=true&has_geospatial_issue=false&basis_of_record=HUMAN_OBSERVATION&basis_of_record=MACHINE_OBSERVATION&basis_of_record=OCCURRENCE&basis_of_record=MATERIAL_SAMPLE&basis_of_record=OBSERVATION";
  const isNE = (s: Species) => s.category === "NE";

  return (
    <div className="space-y-4">
      {/* Always show Taxa Summary table */}
      <TaxaSummary
        onToggleTaxon={handleToggleTaxon}
        selectedTaxa={selectedTaxa}
        selectedSubgroups={selectedSubgroups}
        disableAllSpecies={isNewAssessments}
        viewMode={viewMode}
        onToggleSubgroup={(sgId) => {
          // Clicking a view root ancestor → clear subgroups to show its children
          if (selectedTaxa.has(sgId)) {
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
          // Navigate directly to a taxon + subgroup atomically (avoids clearAllFilters race)
          skipClearOnTaxaChangeRef.current = true;
          setSelectedTaxa(new Set([taxonId]));
          setSelectedSubgroups(new Set([subgroupId]));
        }}
      />

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-6 py-4 rounded-lg">
          <p className="font-medium">Failed to load {isNewAssessments ? "" : "Red List "}data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Charts, search, and species table - only visible after a taxon is selected */}
      {selectedTaxa.size > 0 && (
      <div className="space-y-3">

          {/* Charts row 1: bar charts (new-assessments mode only shows GBIF Observations) */}
          {!isNewAssessments && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Risk Category */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Risk Category</span>
                              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
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

            {/* GBIF Observations */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">GBIF Observations <GbifInfoTooltip /></span>
                              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : gbifObsData.length > 0 ? (
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

            {/* Years Since Assessed */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Years Since Assessed</span>
                              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : assessmentYearData.length > 0 ? (
                  <FilterBarChart
                    data={assessmentYearData}
                    dataKey="shortRange"
                    selectedItems={selectedYearRanges}
                    onBarClick={handleYearClick}
                    barColor="#3b82f6"
                    yAxisWidth={36}
                    rightMargin={85}
                  />
                ) : null}
              </div>
            </div>
          </div>
          )}

          {/* Charts row 2: Country map + (Reviewers or GBIF Observations for new-assessments) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  onClearSelection={handleClearCountry}
                  precomputedStats={countryStatsForMap}
                  selectedTaxa={selectedTaxa}
                  speciesLabel={isNewAssessments ? "# Unassessed" : undefined}
                />
              )}
            </div>

            {/* Reviewers (reassessments) or GBIF Observations chart (new-assessments) */}
            {isNewAssessments ? (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">GBIF Observations <GbifInfoTooltip /></span>
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
            ) : (
              <ReviewerChart
                allAssessors={assessorChartData}
                allReviewers={reviewerChartData}
                selectedItems={reviewerFilterMode === "assessors" ? selectedAssessors : selectedReviewers}
                onBarClick={handleAssessorClick}
                onItemToggle={handleAssessorToggle}
                loading={speciesLoading && assessedSpecies.length === 0}
                viewMode={reviewerFilterMode}
                onViewModeChange={setReviewerFilterMode}
              />
            )}
          </div>

      {/* Search and Species Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
        {/* Search bar */}
        <div className="p-3 md:p-4 border-b border-zinc-200 dark:border-zinc-800 rounded-t-xl">
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <div className="relative flex-1 min-w-[140px] max-w-md">
              <DebouncedSearchInput
                onSearch={handleSearch}
                initialValue={searchFilter}
                placeholder="Search species..."
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
            {pinnedSpecies.length > 0 && (
              <>
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
              </>
            )}
            {Array.from(selectedTaxa).map(taxonId => (
              <button
                key={taxonId}
                onClick={() => setSelectedTaxa(prev => { const next = new Set(prev); next.delete(taxonId); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full flex items-center gap-1 hover:opacity-80"
                style={{ backgroundColor: (TAXA_BY_ID[taxonId]?.color || "#666") + "20", color: TAXA_BY_ID[taxonId]?.color || "#666" }}
              >
                {TAXA_BY_ID[taxonId]?.name || taxonId}
                <span className="text-xs">×</span>
              </button>
            ))}
            {Array.from(selectedSubgroups).map(sgId => {
              const sgInfo = getNodeDef(sgId);
              return (
                <button
                  key={sgId}
                  onClick={() => setSelectedSubgroups(prev => { const next = new Set(prev); next.delete(sgId); return next; })}
                  className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
                >
                  {sgInfo?.node.name ?? sgId}
                  <span className="text-xs">×</span>
                </button>
              );
            })}
            {!isNewAssessments && Array.from(selectedCategories).filter(cat => cat !== "NE").map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategories(prev => { const next = new Set(prev); next.delete(cat); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full flex items-center gap-1 hover:opacity-80"
                style={{ backgroundColor: CATEGORY_COLORS[cat] + "20", color: CATEGORY_COLORS[cat] }}
              >
                {cat}
                <span className="text-xs">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedYearRanges).map(range => (
              <button
                key={range}
                onClick={() => setSelectedYearRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-1 hover:opacity-80"
              >
                {range}
                <span className="text-xs">×</span>
              </button>
            ))}
            {Array.from(selectedObsRanges).map(range => (
              <button
                key={range}
                onClick={() => setSelectedObsRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 flex items-center gap-1 hover:opacity-80"
              >
                {range} obs
                <span className="text-xs">×</span>
              </button>
            ))}
            {Array.from(selectedCountries).map(code => (
              <button
                key={code}
                onClick={() => setSelectedCountries(prev => { const next = new Set(prev); next.delete(code); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 flex items-center gap-1 hover:opacity-80"
              >
                {getCountryName(code)}
                <span className="text-xs">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedAssessors).map(name => (
              <button
                key={`a-${name}`}
                onClick={() => setSelectedAssessors(prev => { const next = new Set(prev); next.delete(name); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                {name} <span className="text-[10px] opacity-60">(assessor)</span>
                <span className="text-xs">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedReviewers).map(name => (
              <button
                key={`r-${name}`}
                onClick={() => setSelectedReviewers(prev => { const next = new Set(prev); next.delete(name); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-400 flex items-center gap-1 hover:opacity-80"
              >
                {name} <span className="text-[10px] opacity-60">(reviewer)</span>
                <span className="text-xs">×</span>
              </button>
            ))}
            {(selectedTaxa.size > 0 || selectedSubgroups.size > 0 || selectedCategories.size > 0 || selectedYearRanges.size > 0 || selectedObsRanges.size > 0 || selectedCountries.size > 0 || selectedAssessors.size > 0 || selectedReviewers.size > 0 || showOnlyStarred) && (
              <button
                onClick={() => { clearAllFilters(); setSelectedTaxa(new Set()); setSelectedSubgroups(new Set()); setSelectedObsRanges(new Set()); setSelectedAssessors(new Set()); setSelectedReviewers(new Set()); setShowOnlyStarred(false); }}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline"
              >
                Clear all
              </button>
            )}
            <span className="ml-auto text-sm md:text-base font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">
              {totalFiltered.toLocaleString()} species
            </span>
            {!isNewAssessments && neCount > 0 && (
              <button
                onClick={() => {
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
                  selectedCategories.has("NE")
                    ? "bg-zinc-500 text-white"
                    : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                }`}
                title="Show Not Evaluated species from GBIF"
              >
                Not Evaluated
                <span className="text-[10px] opacity-70">({neCount.toLocaleString()})</span>
              </button>
            )}
          </div>
        </div>

        {/* Species table */}
        {speciesLoading && assessedSpecies.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
        <>
        <div className="relative">
          {speciesLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          )}
        <div
          className={`bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-x-auto transition-opacity duration-150 ${speciesLoading ? "opacity-50 pointer-events-none" : ""}`}
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
                <th
                  className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                  onClick={() => handleSort("totalGbif")}
                >
                  <span className="flex items-center justify-end gap-1">
                    {isNewAssessments ? "GBIF Observations" : "Total GBIF"}
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
                    New GBIF
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
                    % New GBIF
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
                const yearsSinceAssessment = assessmentYear ? currentYear - assessmentYear : null;
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
                                preview.style.top = `${rect.top - 192 - 8}px`;
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
                      {details?.criteria && !["DD", "LC", "NT", "EX", "EW", "NE"].includes(s.category) ? (
                        <HoverTooltip text={`${details.criteria}${explainCriteria(details.criteria)}`}>
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
                      )}
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
                          {yearsSinceAssessment !== null && yearsSinceAssessment > 10 && (
                            <span className="ml-1 text-xs text-amber-600">({yearsSinceAssessment}y ago)</span>
                          )}
                        </>
                      )}
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
                      <td colSpan={isNewAssessments ? 3 : 8} className="p-0 bg-zinc-50 dark:bg-zinc-800/30">
                        <div style={{ maxWidth: 'calc(100vw - 2rem)', transform: 'translateX(var(--scroll-left, 0px))' }}>
                          {/* Tab bar */}
                          <div className="flex items-center border-b border-zinc-200 dark:border-zinc-700" onClick={(e) => e.stopPropagation()}>
                            {!stackedDetailView && (
                              <>
                                <button
                                  className={`px-4 py-2 text-sm font-medium transition-colors ${activeDetailTab === "gbif" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"} ${!gbifSpeciesKey ? "opacity-50 cursor-default" : ""}`}
                                  onClick={() => gbifSpeciesKey && setActiveDetailTab("gbif")}
                                >
                                  GBIF + iNaturalist{!gbifSpeciesKey && <span className="ml-1 text-xs text-zinc-400">(no match)</span>}
                                </button>
                                {(assessmentYear || s.category === "NE") && (
                                  <button
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${activeDetailTab === "literature" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("literature")}
                                  >
                                    OpenAlex Papers
                                  </button>
                                )}
                                {s.category !== "NE" && (
                                  <button
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${activeDetailTab === "redlist" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("redlist")}
                                  >
                                    IUCN Red List Assessments
                                  </button>
                                )}
                                <button
                                  className={`px-4 py-2 text-sm font-medium transition-colors ${activeDetailTab === "wikipedia" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("wikipedia")}
                                >
                                  Wikipedia
                                </button>
                                <button
                                  className={`px-4 py-2 text-sm font-medium transition-colors ${activeDetailTab === "cites" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("cites")}
                                >
                                  CITES
                                </button>
                                {s.category === "NE" && (
                                  <button
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${activeDetailTab === "assessors" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("assessors")}
                                  >
                                    Suggested Assessors
                                  </button>
                                )}
                              </>
                            )}
                            {stackedDetailView && (
                              <span className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">All Sections</span>
                            )}
                            <button
                              className="ml-auto px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1"
                              onClick={() => setStackedDetailView(!stackedDetailView)}
                              title={stackedDetailView ? "Switch to tabbed view" : "Switch to stacked view"}
                            >
                              {stackedDetailView ? (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/><path d="M9 3v18" strokeWidth="2"/></svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/><path d="M3 12h18" strokeWidth="2"/></svg>
                              )}
                              {stackedDetailView ? "Tabbed" : "Stacked"}
                            </button>
                          </div>
                          {/* Content */}
                          {gbifSpeciesKey ? (
                            <div style={{ display: stackedDetailView || activeDetailTab === "gbif" ? undefined : "none" }}>
                              <OccurrenceMapRow
                                speciesKey={gbifSpeciesKey}
                                mounted={mounted}
                                assessmentYear={assessmentYear}
                                assessmentDate={s.assessment_date}
                              />
                            </div>
                          ) : (stackedDetailView || activeDetailTab === "gbif") && (
                            <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
                              No GBIF match found for <span className="italic">{s.scientific_name}</span>. Occurrence data is unavailable.
                            </div>
                          )}
                          {(assessmentYear || s.category === "NE") && (
                            <div className="p-4" style={{ display: stackedDetailView || activeDetailTab === "literature" ? undefined : "none" }}>
                              <NewLiteratureSinceAssessment
                                scientificName={s.scientific_name}
                                assessmentYear={assessmentYear ?? 0}
                              />
                            </div>
                          )}
                          {s.category !== "NE" && (
                            <div style={{ display: stackedDetailView || activeDetailTab === "redlist" ? undefined : "none" }}>
                              <RedListAssessments
                                sisTaxonId={s.sis_taxon_id ?? undefined}
                                currentAssessmentId={s.assessment_id ?? 0}
                                currentCategory={s.category}
                                currentAssessmentDate={s.assessment_date}
                                previousAssessments={(s.previous_assessments ?? []).map((a) => ({ year: a.year, assessment_id: a.id, category: a.category, assessors: a.assessors, reviewers: a.reviewers }))}
                                speciesUrl={`https://www.iucnredlist.org/species/${s.sis_taxon_id}/${s.assessment_id}`}
                              />
                            </div>
                          )}
                          <div style={{ display: stackedDetailView || activeDetailTab === "wikipedia" ? undefined : "none" }}>
                            <WikipediaSummary scientificName={s.scientific_name} />
                          </div>
                          <div style={{ display: stackedDetailView || activeDetailTab === "cites" ? undefined : "none" }}>
                            <CitesSummary scientificName={s.scientific_name} />
                          </div>
                          {s.category === "NE" && (
                            <div style={{ display: stackedDetailView || activeDetailTab === "assessors" ? undefined : "none" }}>
                              <AssessorCandidatesTable
                                taxaId={[...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group}
                                taxaName={findNode([...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group)?.name ?? TAXA_BY_ID[[...selectedTaxa][0] ?? s.taxon_group]?.name ?? "Species"}
                                countries={s.countries}
                              />
                            </div>
                          )}
                        </div>
                          <div className="border-t border-zinc-200 dark:border-zinc-700">
                            <AssessmentAssistant
                              speciesKey={gbifSpeciesKey ?? 0}
                              assessmentYear={assessmentYear}
                            />
                          </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {totalFiltered === 0 && !speciesLoading && (
                <tr>
                  <td colSpan={isNewAssessments ? 3 : 8} className="px-4 py-8 text-center text-zinc-500">
                    No species found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-3 md:px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 gap-2">
            <div className="text-xs md:text-sm text-zinc-500">
              {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, totalFiltered)} of {totalFiltered}
            </div>
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
          </div>
        )}
        </>
        )}
      </div>
      </div>
      )}

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
