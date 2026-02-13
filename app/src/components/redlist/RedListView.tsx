"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import TaxaSummary from "./TaxaSummary";
import NewLiteratureSinceAssessment from "../LiteratureSearch";
import RedListAssessments from "../RedListAssessments";
import TaxaIcon from "../TaxaIcon";
import { ALPHA2_TO_NAME } from "../WorldMap";
import { CATEGORY_COLORS, TAXA_BY_ID } from "@/config/taxa";
import { useFilterParams } from "@/hooks/useFilterParams";

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

interface CategoryStats {
  code: string;
  name: string;
  count: number;
  color: string;
}

interface TaxonInfo {
  id: string;
  name: string;
  estimatedDescribed: number;
  estimatedSource: string;
  color: string;
}

interface StatsResponse {
  totalAssessed: number;
  byCategory: CategoryStats[];
  sampleSize: number;
  lastUpdated: string;
  cached: boolean;
  error?: string;
  taxon?: TaxonInfo;
}


interface PreviousAssessment {
  year: string;
  assessment_id: number;
  category: string;
}

interface Species {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  common_name?: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string;
  url: string;
  population_trend: string | null;
  countries: string[];
  assessment_count: number;
  previous_assessments: PreviousAssessment[];
  taxon_id?: string; // Present when viewing "all" taxa
  gbif_species_key?: number; // GBIF species key for NE species
  gbif_occurrence_count?: number; // Total GBIF occurrences for NE species
}

interface GbifByRecordType {
  humanObservation: number;
  preservedSpecimen: number;
  machineObservation: number;
  other: number;
  iNaturalist?: number;
}

interface InatObservation {
  url: string;
  date: string | null;
  imageUrl: string | null;
  location: string | null;
  observer: string | null;
}

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
  gbifByRecordType: GbifByRecordType | null;
  gbifNewByRecordType: GbifByRecordType | null;
  gbifMatchStatus: GbifMatchStatus | null;
  recentInatObservations: InatObservation[];
  inatTotalCount: number;
  inatDefaultImage: InatDefaultImage | null;
  // OpenAlex literature count
  openAlexPaperCount: number | null;
  // Papers at time of assessment
  papersAtAssessment: number | null;
}

interface SpeciesResponse {
  species: Species[];
  total: number;
  error?: string;
  taxon?: TaxonInfo;
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

// Component for iNaturalist observation preview with navigation
function InatObservationPreview({
  observations,
  currentIndex,
  onNavigate,
  totalCount,
}: {
  observations: InatObservation[];
  currentIndex: number;
  onNavigate: (delta: number) => void;
  totalCount: number;
}) {
  if (observations.length === 0) return null;
  const obs = observations[currentIndex] || observations[0];
  if (!obs?.imageUrl) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 w-56">
      {/* Navigation header */}
      {observations.length > 1 && (
        <div className="flex items-center justify-between mb-2 text-[10px] text-zinc-400">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onNavigate(-1); }}
            disabled={currentIndex === 0}
            className="p-1 hover:bg-zinc-800 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span>{currentIndex + 1} / {observations.length}{totalCount > observations.length ? ` of ${totalCount.toLocaleString()}` : ''}</span>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onNavigate(1); }}
            disabled={currentIndex >= observations.length - 1}
            className="p-1 hover:bg-zinc-800 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
      <a href={obs.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        <img
          src={obs.imageUrl.replace('/original.', '/medium.')}
          alt="iNaturalist observation"
          className="w-full h-40 object-cover rounded mb-2 hover:opacity-90"
        />
      </a>
      <div className="text-[10px] text-zinc-300 space-y-0.5">
        {obs.date && <div>{obs.date}</div>}
        {obs.observer && <div className="truncate">{obs.observer}</div>}
        {obs.location && <div className="truncate text-zinc-400">{obs.location}</div>}
      </div>
    </div>
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

// GBIF breakdown popup with portal and smart positioning
function GbifBreakdownPopup({
  children,
  trigger,
}: {
  children: React.ReactNode;
  trigger: React.ReactNode;
  speciesId?: number;
  inatIndex?: Record<number, number>;
  setInatIndex?: React.Dispatch<React.SetStateAction<Record<number, number>>>;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, showBelow: false });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150); // Small delay to allow moving to popup
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popupHeight = 200; // Approximate popup height
      const spaceAbove = rect.top;
      const showBelow = spaceAbove < popupHeight + 20;

      setPosition({
        top: showBelow ? rect.bottom : rect.top,
        left: rect.right,
        showBelow,
      });
    }
  }, [isHovered]);

  return (
    <span
      ref={triggerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {trigger}
      {isHovered && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999]"
          style={{
            top: position.top,
            left: position.left,
            transform: position.showBelow ? 'translateX(-100%)' : 'translateX(-100%) translateY(-100%)',
            paddingTop: position.showBelow ? '4px' : undefined,
            paddingBottom: position.showBelow ? undefined : '4px',
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </div>,
        document.body
      )}
    </span>
  );
}

export default function RedListView() {
  // Filters synced with URL search params for shareable links
  const {
    selectedTaxa, setSelectedTaxa,
    selectedCategories, setSelectedCategories,
    selectedYearRanges, setSelectedYearRanges,
    selectedCountries, setSelectedCountries,
    searchFilter, setSearchFilter,
    sortField, sortDirection, setSort,
    clearAllFilters,
  } = useFilterParams();

  // Taxon toggle handler (used by TaxaSummary for multi-select filtering)
  const handleToggleTaxon = useCallback((taxonId: string) => {
    setSelectedTaxa(prev => {
      const next = new Set(prev);
      if (next.has(taxonId)) {
        next.delete(taxonId);
      } else {
        next.add(taxonId);
      }
      return next;
    });
  }, [setSelectedTaxa]);

  const [species, setSpecies] = useState<Species[]>([]);
  const [speciesLoading, setSpeciesLoading] = useState(true);
  const [neCount, setNeCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [showOnlyStarred, setShowOnlyStarred] = useState(false);

  // Stable callback for debounced search input
  const handleSearch = useCallback((value: string) => {
    setSearchFilter(value);
  }, [setSearchFilter]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Species details cache (images, criteria, common names)
  const [speciesDetails, setSpeciesDetails] = useState<Record<number, SpeciesDetails>>({});

  // Track current iNat observation index per species (for navigation)
  const [inatIndex, setInatIndex] = useState<Record<number, number>>({});

  // Row expansion state
  const [selectedSpeciesKey, setSelectedSpeciesKey] = useState<number | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<"gbif" | "literature" | "redlist">("gbif");
  const [stackedDetailView, setStackedDetailView] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Pinned species as ordered array (persisted to localStorage)
  const [pinnedSpecies, setPinnedSpecies] = useState<number[]>([]);
  const pinnedSet = useMemo(() => new Set(pinnedSpecies), [pinnedSpecies]); // For O(1) lookup

  // Drag state for reordering pinned species
  const [draggedSpecies, setDraggedSpecies] = useState<number | null>(null);
  const [dragOverSpecies, setDragOverSpecies] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
    // Load pinned species from localStorage
    try {
      const stored = localStorage.getItem("redlist-pinned-species");
      if (stored) {
        setPinnedSpecies(JSON.parse(stored));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save pinned species to localStorage
  const savePinnedSpecies = (newPinned: number[]) => {
    setPinnedSpecies(newPinned);
    try {
      localStorage.setItem("redlist-pinned-species", JSON.stringify(newPinned));
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

  // Load all species on mount (taxon=all)
  useEffect(() => {
    setError(null);
    setSpeciesLoading(true);

    // Fetch all species and NE count in parallel
    Promise.all([
      fetch("/api/redlist/species?taxon=all")
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            let msg: string;
            try { msg = JSON.parse(text)?.error; } catch { msg = ""; }
            throw new Error(msg || `Species API returned ${res.status}`);
          }
          return res.json();
        }),
      fetch("/api/redlist/stats?taxon=all")
        .then(async (res) => {
          if (!res.ok) return null;
          return res.json();
        })
        .catch(() => null),
    ])
      .then(([speciesData, statsData]: [SpeciesResponse, StatsResponse | null]) => {
        if (speciesData.error) throw new Error(speciesData.error);
        setSpecies(speciesData.species);
        // Extract NE count from stats (computed server-side from GBIF CSVs)
        const ne = statsData?.byCategory?.find((c: CategoryStats) => c.code === "NE");
        if (ne) setNeCount(ne.count);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load species"))
      .finally(() => setSpeciesLoading(false));
  }, []);

  // Track whether NE species have been fetched
  const [neSpeciesFetched, setNeSpeciesFetched] = useState(false);
  const [neLoading, setNeLoading] = useState(false);

  // Fetch NE species when NE category is selected
  useEffect(() => {
    if (!selectedCategories.has("NE")) return;
    if (neSpeciesFetched) return;

    async function fetchNESpecies() {
      setNeLoading(true);
      try {
        const res = await fetch("/api/redlist/species?taxon=all&category=NE");
        if (res.ok) {
          const data = await res.json();
          if (data.species && data.species.length > 0) {
            setSpecies(prev => {
              const nonNE = prev.filter(s => s.category !== "NE");
              return [...nonNE, ...data.species];
            });
          }
          setNeSpeciesFetched(true);
        }
      } catch {
        // Ignore errors fetching NE species
      } finally {
        setNeLoading(false);
      }
    }

    fetchNESpecies();
  }, [selectedCategories, neSpeciesFetched]);

  // Helper to check if species matches year range filter (based on assessment date)
  const matchesYearRangeFilter = (assessmentDate: string | null): boolean => {
    if (selectedYearRanges.size === 0) return true;
    if (!assessmentDate) return false;
    const currentYear = new Date().getFullYear();
    const assessmentYear = new Date(assessmentDate).getFullYear();
    const yearsSince = currentYear - assessmentYear;

    // Check if matches ANY of the selected ranges
    for (const range of selectedYearRanges) {
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

  // Filter species by selected taxa (first level filter before charts)
  const taxaFilteredSpecies = useMemo(() => {
    if (selectedTaxa.size === 0) return species;
    return species.filter(s => s.taxon_id && selectedTaxa.has(s.taxon_id));
  }, [species, selectedTaxa]);

  // Compute category stats client-side from taxa-filtered species
  const categoryDataWithPercent = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (s.category !== "NE") {
        counts[s.category] = (counts[s.category] || 0) + 1;
      }
    });
    const total = taxaFilteredSpecies.filter(s => s.category !== "NE").length;
    const DISPLAY_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD"];
    return DISPLAY_ORDER
      .filter(code => (counts[code] || 0) > 0)
      .map(code => ({
        code,
        name: code,
        count: counts[code] || 0,
        color: CATEGORY_COLORS[code] || "#999",
        percent: total > 0 ? ((counts[code] / total) * 100).toFixed(1) : "0",
        label: `${(counts[code] || 0).toLocaleString()} (${total > 0 ? ((counts[code] / total) * 100).toFixed(1) : 0}%)`,
      }));
  }, [taxaFilteredSpecies]);

  // Compute years-since-assessment stats client-side from taxa-filtered species
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
      const yr = new Date(s.assessment_date).getFullYear();
      const diff = currentYr - yr;
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
  }, [taxaFilteredSpecies]);

  // Get unique countries from taxa-filtered species data, sorted alphabetically by name
  const { countryCounts, uniqueCountries, countryStatsForMap } = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
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
        { occurrences: count, species: count }
      ])
    );

    return { countryCounts: counts, uniqueCountries: sorted, countryStatsForMap: statsForMap };
  }, [taxaFilteredSpecies]);

  // Helper to get country display name
  const getCountryName = (code: string) => ALPHA2_TO_NAME[code] || code;

  // Map selection handlers (Cmd/Ctrl+click for multi-select, regular click replaces)
  const handleCountrySelect = (countryCode: string, _countryName: string, event: React.MouseEvent) => {
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedCountries(prev => {
      if (isMultiSelect) {
        // Toggle in/out of set
        const next = new Set(prev);
        if (next.has(countryCode)) {
          next.delete(countryCode);
        } else {
          next.add(countryCode);
        }
        return next;
      } else {
        // Single select: toggle off if already selected, otherwise replace
        if (prev.size === 1 && prev.has(countryCode)) {
          return new Set();
        }
        return new Set([countryCode]);
      }
    });
  };

  const handleClearCountry = () => {
    setSelectedCountries(new Set());
  };

  // Category order for sorting (most threatened first)
  const CATEGORY_ORDER: Record<string, number> = {
    EX: 0, EW: 1, CR: 2, EN: 3, VU: 4, NT: 5, LC: 6, DD: 7, NE: 8,
  };

  // Memoized filter and sort for performance with large datasets
  const { filteredSpecies, sortedSpecies } = useMemo(() => {
    // Filter taxa-filtered species based on category, year range, country, and search
    const filtered = taxaFilteredSpecies.filter((s) => {
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(s.category);
      // NE species have no assessment date, so skip year range filter for them
      const matchesYear = s.category === "NE" || matchesYearRangeFilter(s.assessment_date);
      const matchesCountry = selectedCountries.size === 0 || s.countries.some(c => selectedCountries.has(c));
      const matchesSearch =
        !searchFilter ||
        s.scientific_name.toLowerCase().includes(searchFilter) ||
        s.common_name?.toLowerCase().includes(searchFilter);
      const matchesStarred = !showOnlyStarred || pinnedSet.has(s.sis_taxon_id);
      return matchesCategory && matchesYear && matchesCountry && matchesSearch && matchesStarred;
    });

    // Sort filtered species
    const sorted = [...filtered].sort((a, b) => {
      // When showing only starred, sort by pinned order
      if (showOnlyStarred) {
        const aIdx = pinnedSpecies.indexOf(a.sis_taxon_id);
        const bIdx = pinnedSpecies.indexOf(b.sis_taxon_id);
        return aIdx - bIdx;
      }

      if (!sortField) return 0;

      let comparison = 0;
      if (sortField === "year") {
        // Sort by assessment date
        const dateA = a.assessment_date ? new Date(a.assessment_date).getTime() : 0;
        const dateB = b.assessment_date ? new Date(b.assessment_date).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortField === "category") {
        comparison = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
      }

      // Stable tiebreaker by ID to prevent sort instability between renders
      if (comparison === 0) {
        comparison = a.sis_taxon_id - b.sis_taxon_id;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return { filteredSpecies: filtered, sortedSpecies: sorted };
  }, [taxaFilteredSpecies, selectedCategories, selectedYearRanges, selectedCountries, searchFilter, showOnlyStarred, pinnedSet, pinnedSpecies, sortField, sortDirection]);

  // Pagination calculations
  const totalPages = Math.ceil(sortedSpecies.length / PAGE_SIZE);
  const paginatedSpecies = sortedSpecies.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Handle sort toggle
  const handleSort = (field: "year" | "category") => {
    if (sortField === field) {
      // Toggle direction or clear sort
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
  }, [selectedTaxa, selectedCategories, selectedYearRanges, searchFilter, selectedCountries, showOnlyStarred]);

  // Fetch details for visible species
  useEffect(() => {
    async function fetchDetails() {
      const speciesToFetch = paginatedSpecies.filter(
        (s) => !speciesDetails[s.sis_taxon_id]
      );

      if (speciesToFetch.length === 0) return;

      const detailPromises = speciesToFetch.map(async (s) => {
        try {
          // NE species: use GBIF species key directly, skip IUCN API
          if (s.category === "NE" && s.gbif_species_key) {
            // Fetch iNaturalist image and total paper count in parallel
            try {
              const [inatRes, litRes] = await Promise.all([
                fetch(
                  `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(s.scientific_name)}&rank=species&per_page=1`
                ),
                fetch(
                  `/api/literature?scientificName=${encodeURIComponent(s.scientific_name)}&assessmentYear=0&limit=1`
                ),
              ]);
              let inatDefaultImage: { squareUrl: string | null; mediumUrl: string | null } | null = null;
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
              let openAlexPaperCount: number | null = null;
              if (litRes.ok) {
                const litData = await litRes.json();
                openAlexPaperCount = litData.totalPapersSinceAssessment ?? null;
              }
              return {
                id: s.sis_taxon_id,
                data: {
                  criteria: null,
                  commonName: s.common_name || null,
                  gbifUrl: `https://www.gbif.org/species/${s.gbif_species_key}`,
                  gbifOccurrences: s.gbif_occurrence_count || null,
                  gbifOccurrencesSinceAssessment: null,
                  gbifByRecordType: null,
                  gbifNewByRecordType: null,
                  gbifMatchStatus: { matchType: 'EXACT' },
                  recentInatObservations: [],
                  inatTotalCount: 0,
                  inatDefaultImage,
                  openAlexPaperCount,
                  papersAtAssessment: null,
                },
              };
            } catch {
              return {
                id: s.sis_taxon_id,
                data: {
                  criteria: null, commonName: s.common_name || null, gbifUrl: `https://www.gbif.org/species/${s.gbif_species_key}`,
                  gbifOccurrences: s.gbif_occurrence_count || null, gbifOccurrencesSinceAssessment: null,
                  gbifByRecordType: null, gbifNewByRecordType: null, gbifMatchStatus: null,
                  recentInatObservations: [], inatTotalCount: 0, inatDefaultImage: null,
                  openAlexPaperCount: null, papersAtAssessment: null,
                },
              };
            }
          }

          // Extract assessment year and month for GBIF filtering
          const assessmentDate = s.assessment_date ? new Date(s.assessment_date) : null;
          const assessmentYear = assessmentDate ? assessmentDate.getFullYear().toString() : "";
          const assessmentMonth = assessmentDate ? (assessmentDate.getMonth() + 1).toString() : ""; // 1-12

          // Fetch IUCN details and OpenAlex paper count in parallel
          const [iucnRes, litRes] = await Promise.all([
            fetch(
              `/api/redlist/species/${s.sis_taxon_id}?assessmentId=${s.assessment_id}&name=${encodeURIComponent(s.scientific_name)}&assessmentYear=${assessmentYear}&assessmentMonth=${assessmentMonth}`
            ),
            assessmentYear ? fetch(
              `/api/literature?scientificName=${encodeURIComponent(s.scientific_name)}&assessmentYear=${assessmentYear}&limit=1`
            ) : Promise.resolve(null),
          ]);

          if (iucnRes.ok) {
            const data = await iucnRes.json();
            // Add paper counts from literature API
            let openAlexPaperCount: number | null = null;
            let papersAtAssessment: number | null = null;
            if (litRes?.ok) {
              const litData = await litRes.json();
              openAlexPaperCount = litData.totalPapersSinceAssessment ?? null;
              papersAtAssessment = litData.papersAtAssessment ?? null;
            }
            return { id: s.sis_taxon_id, data: { ...data, openAlexPaperCount, papersAtAssessment } };
          }
        } catch {
          // Ignore errors for individual species
        }
        return null;
      });

      const results = await Promise.all(detailPromises);
      const newDetails: Record<number, SpeciesDetails> = {};

      results.forEach((result) => {
        if (result) {
          newDetails[result.id] = {
            criteria: result.data.criteria,
            commonName: result.data.commonName,
            gbifUrl: result.data.gbifUrl,
            gbifOccurrences: result.data.gbifOccurrences,
            gbifOccurrencesSinceAssessment: result.data.gbifOccurrencesSinceAssessment,
            gbifByRecordType: result.data.gbifByRecordType,
            gbifNewByRecordType: result.data.gbifNewByRecordType,
            gbifMatchStatus: result.data.gbifMatchStatus || null,
            recentInatObservations: result.data.recentInatObservations || [],
            inatTotalCount: result.data.inatTotalCount || 0,
            inatDefaultImage: result.data.inatDefaultImage || null,
            openAlexPaperCount: result.data.openAlexPaperCount ?? null,
            papersAtAssessment: result.data.papersAtAssessment ?? null,
          };
        }
      });

      if (Object.keys(newDetails).length > 0) {
        setSpeciesDetails((prev) => ({ ...prev, ...newDetails }));
      }
    }

    if (paginatedSpecies.length > 0) {
      fetchDetails();
    }
  }, [paginatedSpecies, speciesDetails]);

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
  const currentYear = new Date().getFullYear();
  const showingOnlyNE = selectedCategories.size === 1 && selectedCategories.has("NE");

  return (
    <div className="space-y-4">
      {/* Always show Taxa Summary table */}
      <TaxaSummary
        onToggleTaxon={handleToggleTaxon}
        selectedTaxa={selectedTaxa}
      />

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-6 py-4 rounded-lg">
          <p className="font-medium">Failed to load Red List data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Charts, search, and species table - always visible below summary */}
      <div className="space-y-3">

          {/* Charts and map */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Category distribution - 1 column */}
            <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Risk Category (click to filter) <span className="font-normal text-[10px] text-zinc-400">cmd/ctrl+click to multiselect</span>
                </h3>
                {selectedCategories.size > 0 && (
                  <button
                    onClick={() => setSelectedCategories(new Set())}
                    className="text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-[225px] flex items-center justify-center">
                {speciesLoading ? (
                  <Spinner />
                ) : categoryDataWithPercent.length > 0 ? (
                  <FilterBarChart
                    data={categoryDataWithPercent}
                    dataKey="code"
                    selectedItems={selectedCategories}
                    onBarClick={handleCategoryClick}
                    yAxisWidth={26}
                    rightMargin={75}
                  />
                ) : null}
              </div>
            </div>

            {/* Years Since Assessment chart - 1 column */}
            <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Years Since Assessed (click to filter) <span className="font-normal text-[10px] text-zinc-400">cmd/ctrl+click to multiselect</span>
                </h3>
                {selectedYearRanges.size > 0 && (
                  <button
                    onClick={() => setSelectedYearRanges(new Set())}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading ? (
                  <Spinner />
                ) : assessmentYearData.some(y => y.count > 0) ? (
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

            {/* Country Map - 1 column */}
            <div className="lg:col-span-1">
              {speciesLoading ? (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 min-h-[280px] flex items-center justify-center">
                  <Spinner />
                </div>
              ) : (
                <WorldMap
                  selectedCountries={selectedCountries}
                  onCountrySelect={handleCountrySelect}
                  onClearSelection={handleClearCountry}
                  precomputedStats={countryStatsForMap}
                  statLabel="Species"
                />
              )}
            </div>
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
            {/* Country filter dropdown */}
            <div className="relative">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedCountries(prev => new Set([...prev, e.target.value]));
                  }
                }}
                className="px-2 md:px-3 py-2 pr-7 md:pr-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-red-500 appearance-none cursor-pointer"
              >
                <option value="">{selectedCountries.size > 0 ? `${selectedCountries.size} selected` : "All countries"}</option>
                {uniqueCountries.filter(code => !selectedCountries.has(code)).map(code => (
                  <option key={code} value={code}>
                    {getCountryName(code)} ({countryCounts[code]})
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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
                <button
                  onClick={() => {
                    const data = JSON.stringify(pinnedSpecies, null, 2);
                    const blob = new Blob([data], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "starred-species.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title="Export starred species"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
              </>
            )}
            <label className="px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer" title="Import starred species">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const imported = JSON.parse(event.target?.result as string);
                        if (Array.isArray(imported)) {
                          // Merge with existing, avoiding duplicates
                          const merged = [...new Set([...pinnedSpecies, ...imported])];
                          setPinnedSpecies(merged);
                        }
                      } catch {
                        alert("Invalid JSON file");
                      }
                    };
                    reader.readAsText(file);
                  }
                  e.target.value = ""; // Reset to allow re-importing same file
                }}
              />
            </label>
            {Array.from(selectedTaxa).map(taxonId => (
              <button
                key={taxonId}
                onClick={() => handleToggleTaxon(taxonId)}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full flex items-center gap-1 hover:opacity-80"
                style={{ backgroundColor: (TAXA_BY_ID[taxonId]?.color || "#666") + "20", color: TAXA_BY_ID[taxonId]?.color || "#666" }}
              >
                {TAXA_BY_ID[taxonId]?.name || taxonId}
                <span className="text-xs">×</span>
              </button>
            ))}
            {Array.from(selectedCategories).filter(cat => cat !== "NE").map(cat => (
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
            {Array.from(selectedYearRanges).map(range => (
              <button
                key={range}
                onClick={() => setSelectedYearRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-1 hover:opacity-80"
              >
                {range}
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
            {(selectedTaxa.size > 0 || selectedCategories.size > 0 || selectedYearRanges.size > 0 || selectedCountries.size > 0 || showOnlyStarred) && (
              <button
                onClick={() => { clearAllFilters(); setSelectedTaxa(new Set()); setShowOnlyStarred(false); }}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline"
              >
                Clear all
              </button>
            )}
            <span className="text-xs md:text-sm text-zinc-500">
              {filteredSpecies.length} species
            </span>
            {neCount > 0 && (
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
                className={`ml-auto px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors flex items-center gap-1 md:gap-1.5 ${
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
        {speciesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
        <>
        <div
          className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-x-auto"
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
                {!showingOnlyNE && (
                <th
                  className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none whitespace-nowrap"
                  onClick={() => handleSort("year")}
                >
                  <span className="flex items-center gap-1">
                    Assess. Date
                    {sortField === "year" && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                {!showingOnlyNE && (
                <th className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px]">
                  GBIF at Assess.
                </th>
                )}
                <th className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px]">
                  {showingOnlyNE ? "GBIF Records" : "New GBIF"}
                </th>
                {!showingOnlyNE && (
                <th className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px]">
                  Papers at Assess.
                </th>
                )}
                <th className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px]">
                  {showingOnlyNE ? "Papers" : "New Papers"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {paginatedSpecies.map((s) => {
                const assessmentDateObj = s.assessment_date ? new Date(s.assessment_date) : null;
                const assessmentYear = assessmentDateObj ? assessmentDateObj.getFullYear() : null;
                const assessmentMonth = assessmentDateObj ? assessmentDateObj.getMonth() + 1 : null; // 1-12
                const yearsSinceAssessment = assessmentYear ? currentYear - assessmentYear : null;
                const details = speciesDetails[s.sis_taxon_id];
                const gbifSpeciesKey = s.gbif_species_key || (details?.gbifUrl ? parseInt(details.gbifUrl.split('/').pop() || '0') : null);
                const isPinned = pinnedSet.has(s.sis_taxon_id);
                const isDragging = draggedSpecies === s.sis_taxon_id;
                const isDragOver = dragOverSpecies === s.sis_taxon_id && draggedSpecies !== s.sis_taxon_id;
                return (
                  <React.Fragment key={s.sis_taxon_id}>
                  <tr
                    className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer ${selectedSpeciesKey === s.sis_taxon_id ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${isDragging ? "opacity-50" : ""} ${isDragOver ? "border-t-2 border-amber-500" : ""}`}
                    onClick={() => { setSelectedSpeciesKey(selectedSpeciesKey === s.sis_taxon_id ? null : s.sis_taxon_id); setActiveDetailTab("gbif"); }}
                    draggable={isPinned && showOnlyStarred}
                    onDragStart={(e) => handleDragStart(e, s.sis_taxon_id)}
                    onDragOver={(e) => handleDragOver(e, s.sis_taxon_id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, s.sis_taxon_id)}
                    onDragEnd={handleDragEnd}
                  >
                    <td className={`sticky left-0 z-10 px-2 py-2 text-center ${selectedSpeciesKey === s.sis_taxon_id ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
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
                            togglePinned(s.sis_taxon_id);
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
                    <td className={`sticky left-[40px] z-10 px-2 md:px-4 py-2 ${selectedSpeciesKey === s.sis_taxon_id ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
                      <div className="flex items-center gap-2">
                        {/* iNat profile pic */}
                        {details === undefined ? (
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
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="italic font-medium text-zinc-900 dark:text-zinc-100 hover:text-red-600 dark:hover:text-red-400 hover:underline text-xs md:text-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {s.scientific_name}
                          </a>
                          {s.common_name && (
                            <div className="text-zinc-500 dark:text-zinc-400 text-xs truncate max-w-[140px] md:max-w-none">
                              {s.common_name}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
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
                    {!showingOnlyNE && (
                    <td className="px-2 md:px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {s.category === "NE" ? "—" : (
                        <>
                          <HoverTooltip
                            text={`Published: ${s.year_published}${s.previous_assessments.length > 0 ? ` | Previous: ${s.previous_assessments.slice().reverse().map(pa => `${pa.year} (${pa.category})`).join(", ")}` : ""}`}
                          >
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-red-500 hover:underline cursor-help"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {s.assessment_date
                                ? new Date(s.assessment_date).toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "—"}
                            </a>
                          </HoverTooltip>
                          {yearsSinceAssessment !== null && yearsSinceAssessment > 10 && (
                            <span className="ml-1 text-xs text-amber-600">({yearsSinceAssessment}y ago)</span>
                          )}
                        </>
                      )}
                    </td>
                    )}
                    {!showingOnlyNE && (
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {s.category === "NE" ? "—" : details === undefined ? (
                        <span className="inline-block animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
                      ) : details?.gbifOccurrences != null && details?.gbifUrl ? (() => {
                        const recordsAtAssessment = details.gbifOccurrences - (details.gbifOccurrencesSinceAssessment ?? 0);
                        // Calculate pre-assessment counts by subtracting new records
                        const newByType = details.gbifNewByRecordType || { humanObservation: 0, preservedSpecimen: 0, machineObservation: 0, other: 0, iNaturalist: 0 };
                        const preAssessmentHuman = details.gbifByRecordType ? details.gbifByRecordType.humanObservation - newByType.humanObservation : 0;
                        const preAssessmentSpecimen = details.gbifByRecordType ? details.gbifByRecordType.preservedSpecimen - newByType.preservedSpecimen : 0;
                        const preAssessmentMachine = details.gbifByRecordType ? details.gbifByRecordType.machineObservation - newByType.machineObservation : 0;
                        const preAssessmentOther = details.gbifByRecordType ? details.gbifByRecordType.other - newByType.other : 0;
                        const preAssessmentInat = details.gbifByRecordType ? (details.gbifByRecordType.iNaturalist || 0) - (newByType.iNaturalist || 0) : 0;
                        // Exclude preserved specimens from the displayed count
                        const recordsAtAssessmentExclSpecimens = recordsAtAssessment - preAssessmentSpecimen;
                        return (
                        <GbifBreakdownPopup
                          speciesId={s.sis_taxon_id}
                          inatIndex={inatIndex}
                          setInatIndex={setInatIndex}
                          trigger={
                            <a
                              href={assessmentYear ? `https://www.gbif.org/occurrence/search?taxon_key=${details.gbifUrl.split('/').pop()}&year=*,${assessmentYear}` : `https://www.gbif.org/occurrence/search?taxon_key=${details.gbifUrl.split('/').pop()}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {recordsAtAssessmentExclSpecimens.toLocaleString()}
                            </a>
                          }
                        >
                          {details?.gbifByRecordType && (
                            <div className="bg-zinc-800 dark:bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg p-2 text-xs text-left min-w-[200px]">
                              <div className="text-zinc-300 font-medium mb-1">{assessmentYear && assessmentMonth ? `Up to ${new Date(assessmentYear, assessmentMonth - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}:` : assessmentYear ? `Up to ${assessmentYear}:` : 'Breakdown by type:'}</div>
                              <div className="space-y-0.5 text-zinc-400">
                                <div className="flex justify-between">
                                  <span>Human observations</span>
                                  <a
                                    href={assessmentYear ? `https://www.gbif.org/occurrence/search?basis_of_record=HUMAN_OBSERVATION&taxon_key=${details.gbifUrl?.split('/').pop()}&year=*,${assessmentYear}` : `https://www.gbif.org/occurrence/search?basis_of_record=HUMAN_OBSERVATION&taxon_key=${details.gbifUrl?.split('/').pop()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-zinc-200 hover:text-blue-400 hover:underline tabular-nums"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {preAssessmentHuman.toLocaleString()}
                                  </a>
                                </div>
                                {preAssessmentInat > 0 && details.recentInatObservations.length > 0 && (
                                  <div className="flex justify-between pl-3 text-[11px]">
                                    <span>iNaturalist</span>
                                    <a
                                      href={assessmentYear ? `https://www.gbif.org/occurrence/search?dataset_key=50c9509d-22c7-4a22-a47d-8c48425ef4a7&taxon_key=${details.gbifUrl?.split('/').pop()}&year=*,${assessmentYear}` : `https://www.gbif.org/occurrence/search?dataset_key=50c9509d-22c7-4a22-a47d-8c48425ef4a7&taxon_key=${details.gbifUrl?.split('/').pop()}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-zinc-300 hover:text-amber-400 hover:underline tabular-nums"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {preAssessmentInat.toLocaleString()}
                                    </a>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span>Preserved specimens</span>
                                  <a
                                    href={assessmentYear ? `https://www.gbif.org/occurrence/search?basis_of_record=PRESERVED_SPECIMEN&taxon_key=${details.gbifUrl?.split('/').pop()}&year=*,${assessmentYear}` : `https://www.gbif.org/occurrence/search?basis_of_record=PRESERVED_SPECIMEN&taxon_key=${details.gbifUrl?.split('/').pop()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-zinc-200 hover:text-blue-400 hover:underline tabular-nums"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {preAssessmentSpecimen.toLocaleString()}
                                  </a>
                                </div>
                                <div className="flex justify-between">
                                  <span>Machine observations</span>
                                  <a
                                    href={assessmentYear ? `https://www.gbif.org/occurrence/search?basis_of_record=MACHINE_OBSERVATION&taxon_key=${details.gbifUrl?.split('/').pop()}&year=*,${assessmentYear}` : `https://www.gbif.org/occurrence/search?basis_of_record=MACHINE_OBSERVATION&taxon_key=${details.gbifUrl?.split('/').pop()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-zinc-200 hover:text-blue-400 hover:underline tabular-nums"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {preAssessmentMachine.toLocaleString()}
                                  </a>
                                </div>
                                {preAssessmentOther > 0 && (
                                  <div className="flex justify-between">
                                    <span>Other</span>
                                    <span className="text-zinc-200 tabular-nums">{preAssessmentOther.toLocaleString()}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </GbifBreakdownPopup>
                        );
                      })() : details?.gbifOccurrences != null ? (() => {
                        const totalRecords = details.gbifOccurrences - (details.gbifOccurrencesSinceAssessment ?? 0);
                        const preSpecimen = details.gbifByRecordType?.preservedSpecimen
                          ? details.gbifByRecordType.preservedSpecimen - (details.gbifNewByRecordType?.preservedSpecimen ?? 0)
                          : 0;
                        return (totalRecords - preSpecimen).toLocaleString();
                      })() : details?.gbifMatchStatus?.matchType === 'HIGHERRANK' || details?.gbifMatchStatus?.matchType === 'NONE' ? (
                        <HoverTooltip
                          text={details.gbifMatchStatus.matchType === 'HIGHERRANK'
                            ? `Name not found in GBIF (matched to ${details.gbifMatchStatus.matchedRank?.toLowerCase() || 'higher rank'} instead). May be due to a taxonomic split, synonym, or naming difference.`
                            : "Species not found in GBIF. May be due to a taxonomic split, synonym, or naming difference."}
                        >
                          <span className="text-zinc-400 cursor-help">?</span>
                        </HoverTooltip>
                      ) : "—"}
                    </td>
                    )}
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {s.category === "NE" && s.gbif_occurrence_count != null ? (
                        <a
                          href={`https://www.gbif.org/occurrence/search?taxon_key=${s.gbif_species_key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.gbif_occurrence_count.toLocaleString()}
                        </a>
                      ) : details === undefined ? (
                        <span className="inline-block animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
                      ) : details?.gbifOccurrencesSinceAssessment != null && details?.gbifUrl && assessmentYear ? (() => {
                        // Exclude preserved specimens from new records count
                        const newSpecimens = details.gbifNewByRecordType?.preservedSpecimen ?? 0;
                        const newRecordsExclSpecimens = details.gbifOccurrencesSinceAssessment - newSpecimens;
                        return (
                        <GbifBreakdownPopup
                          speciesId={s.sis_taxon_id}
                          inatIndex={inatIndex}
                          setInatIndex={setInatIndex}
                          trigger={
                            <a
                              href={`https://www.gbif.org/occurrence/search?taxon_key=${details.gbifUrl.split('/').pop()}&year=${assessmentYear + 1},${new Date().getFullYear()}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                              title={assessmentMonth ? `Data count includes ${assessmentYear} from month ${assessmentMonth + 1} onwards` : undefined}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {newRecordsExclSpecimens.toLocaleString()}
                            </a>
                          }
                        >
                          {details?.gbifNewByRecordType && (
                            <div className="bg-zinc-800 dark:bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg p-2 text-xs text-left min-w-[200px]">
                              <div className="text-zinc-300 font-medium mb-1">After {assessmentMonth ? new Date(assessmentYear, assessmentMonth - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : assessmentYear}:</div>
                              <div className="space-y-0.5 text-zinc-400">
                                <div className="flex justify-between">
                                  <span>Human observations</span>
                                  <a
                                    href={`https://www.gbif.org/occurrence/search?basis_of_record=HUMAN_OBSERVATION&taxon_key=${details.gbifUrl?.split('/').pop()}&year=${assessmentYear + 1},${new Date().getFullYear()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-zinc-200 hover:text-blue-400 hover:underline tabular-nums"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {details.gbifNewByRecordType.humanObservation.toLocaleString()}
                                  </a>
                                </div>
                                {details.gbifNewByRecordType.iNaturalist != null && details.gbifNewByRecordType.iNaturalist > 0 && (
                                  <div className="flex justify-between pl-3 text-[11px]">
                                    <span>iNaturalist</span>
                                    <a
                                      href={`https://www.gbif.org/occurrence/search?dataset_key=50c9509d-22c7-4a22-a47d-8c48425ef4a7&taxon_key=${details.gbifUrl?.split('/').pop()}&year=${assessmentYear + 1},${new Date().getFullYear()}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-zinc-300 hover:text-amber-400 hover:underline tabular-nums"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {details.gbifNewByRecordType.iNaturalist.toLocaleString()}
                                    </a>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span>Preserved specimens</span>
                                  <a
                                    href={`https://www.gbif.org/occurrence/search?basis_of_record=PRESERVED_SPECIMEN&taxon_key=${details.gbifUrl?.split('/').pop()}&year=${assessmentYear + 1},${new Date().getFullYear()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-zinc-200 hover:text-blue-400 hover:underline tabular-nums"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {details.gbifNewByRecordType.preservedSpecimen.toLocaleString()}
                                  </a>
                                </div>
                                <div className="flex justify-between">
                                  <span>Machine observations</span>
                                  <a
                                    href={`https://www.gbif.org/occurrence/search?basis_of_record=MACHINE_OBSERVATION&taxon_key=${details.gbifUrl?.split('/').pop()}&year=${assessmentYear + 1},${new Date().getFullYear()}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-zinc-200 hover:text-blue-400 hover:underline tabular-nums"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {details.gbifNewByRecordType.machineObservation.toLocaleString()}
                                  </a>
                                </div>
                                {details.gbifNewByRecordType.other > 0 && (
                                  <div className="flex justify-between">
                                    <span>Other</span>
                                    <span className="text-zinc-200 tabular-nums">{details.gbifNewByRecordType.other.toLocaleString()}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </GbifBreakdownPopup>
                        );
                      })() : details?.gbifOccurrencesSinceAssessment != null ? (
                        (details.gbifOccurrencesSinceAssessment - (details.gbifNewByRecordType?.preservedSpecimen ?? 0)).toLocaleString()
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
                    {!showingOnlyNE && (
                    <>
                    {/* Papers When Assessed */}
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {s.category === "NE" ? "—" : details === undefined ? (
                        <span className="inline-block animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
                      ) : details?.papersAtAssessment != null && assessmentYear ? (
                        <a
                          href={`https://openalex.org/works?page=1&filter=default.search%3A%22${encodeURIComponent(s.scientific_name)}%22,publication_year%3A%3C%3D${assessmentYear},type%3A%21dataset&sort=publication_date%3Adesc`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                          title={`OpenAlex: search="${s.scientific_name}" AND year<=${assessmentYear} AND type!=dataset`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {details.papersAtAssessment.toLocaleString()}
                        </a>
                      ) : "—"}
                    </td>
                    </>
                    )}
                    {/* New Papers */}
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {details === undefined ? (
                        <span className="inline-block animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
                      ) : details?.openAlexPaperCount != null ? (
                        <a
                          href={s.category === "NE"
                            ? `https://openalex.org/works?page=1&filter=default.search%3A%22${encodeURIComponent(s.scientific_name)}%22,type%3A%21dataset&sort=publication_date%3Adesc`
                            : `https://openalex.org/works?page=1&filter=default.search%3A%22${encodeURIComponent(s.scientific_name)}%22,publication_year%3A%3E${assessmentYear},type%3A%21dataset&sort=publication_date%3Adesc`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                          title={s.category === "NE"
                            ? `OpenAlex: search="${s.scientific_name}" AND type!=dataset`
                            : `OpenAlex: search="${s.scientific_name}" AND year>${assessmentYear} AND type!=dataset`
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          {details.openAlexPaperCount.toLocaleString()}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                  {selectedSpeciesKey === s.sis_taxon_id && (
                    <tr>
                      <td colSpan={showingOnlyNE ? 5 : 8} className="p-0 bg-zinc-50 dark:bg-zinc-800/30">
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
                                    OpenAlex
                                  </button>
                                )}
                                {s.category !== "NE" && (
                                  <button
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${activeDetailTab === "redlist" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("redlist")}
                                  >
                                    IUCN Red List
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
                                sisTaxonId={s.sis_taxon_id}
                                currentAssessmentId={s.assessment_id}
                                currentCategory={s.category}
                                currentAssessmentDate={s.assessment_date}
                                previousAssessments={s.previous_assessments}
                                speciesUrl={s.url}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {filteredSpecies.length === 0 && (
                <tr>
                  <td colSpan={showingOnlyNE ? 5 : 8} className="px-4 py-8 text-center text-zinc-500">
                    {neLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading NE species...
                      </div>
                    ) : (
                      "No species found"
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-3 md:px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 gap-2">
            <div className="text-xs md:text-sm text-zinc-500">
              {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredSpecies.length)} of {filteredSpecies.length}
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
