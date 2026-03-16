"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import TaxaSummary from "./TaxaSummary";
import TaxaIcon from "../TaxaIcon";
const WorldMap = dynamic(() => import("../WorldMap"), { ssr: false });
import { TAXA_BY_ID } from "@/config/taxa";
import { speciesMatchesSubgroup, getSubgroupDef } from "@/config/taxa-hierarchy";
import { type RedListSpecies } from "@/hooks/useRedListSpeciesQuery";

const OccurrenceMapRow = dynamic(
  () => import("../OccurrenceMapRow"),
  { ssr: false }
);

const FilterBarChart = dynamic(
  () => import("./FilterBarChart"),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" /> }
);

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

type Species = RedListSpecies;

interface InatDefaultImage {
  squareUrl: string | null;
  mediumUrl: string | null;
}

interface SpeciesDetails {
  gbifUrl: string | null;
  gbifOccurrences: number | null;
  inatDefaultImage: InatDefaultImage | null | undefined;
}

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
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">HUMAN_OBSERVATION</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MACHINE_OBSERVATION</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MATERIAL_SAMPLE</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OCCURRENCE</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OBSERVATION</code></li>
          </ul>
        </div>,
        document.body
      )}
    </span>
  );
}

interface NewAssessmentsViewProps {
  sharedTaxa?: Set<string>;
  sharedSubgroups?: Set<string>;
  onTaxaChange?: (taxa: Set<string>) => void;
  onSubgroupsChange?: (subgroups: Set<string>) => void;
}

export default function NewAssessmentsView({ sharedTaxa, sharedSubgroups, onTaxaChange, onSubgroupsChange }: NewAssessmentsViewProps = {}) {
  // Taxa selection — initialize from shared state
  const [selectedTaxa, setSelectedTaxaLocal] = useState<Set<string>>(sharedTaxa ?? new Set());
  const [selectedSubgroups, setSelectedSubgroupsLocal] = useState<Set<string>>(sharedSubgroups ?? new Set());

  // Sync local state up to parent via effects (not during render)
  useEffect(() => { onTaxaChange?.(selectedTaxa); }, [selectedTaxa, onTaxaChange]);
  useEffect(() => { onSubgroupsChange?.(selectedSubgroups); }, [selectedSubgroups, onSubgroupsChange]);

  const setSelectedTaxa = setSelectedTaxaLocal;
  const setSelectedSubgroups = setSelectedSubgroupsLocal;

  // Search & sort
  const [searchFilter, setSearchFilter] = useState("");
  const [sortField, setSortField] = useState<"totalGbif" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // GBIF obs range filter
  const [selectedObsRanges, setSelectedObsRanges] = useState<Set<string>>(new Set());

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Country filter
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());

  // Pinned species
  const [pinnedSpecies, setPinnedSpecies] = useState<number[]>([]);
  const pinnedSet = useMemo(() => new Set(pinnedSpecies), [pinnedSpecies]);
  const [showOnlyStarred, setShowOnlyStarred] = useState(false);

  // Data
  const [speciesByTaxon, setSpeciesByTaxon] = useState<Record<string, RedListSpecies[]>>({});
  const [loadingTaxa, setLoadingTaxa] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const abortRefs = useRef<Record<string, AbortController>>({});

  // Species details (images)
  const [speciesDetails, setSpeciesDetails] = useState<Record<number, SpeciesDetails>>({});

  // Row expansion
  const [selectedSpeciesKey, setSelectedSpeciesKey] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("new-assessments-pinned-species");
      if (stored) setPinnedSpecies(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const savePinnedSpecies = (newPinned: number[]) => {
    setPinnedSpecies(newPinned);
    try {
      localStorage.setItem("new-assessments-pinned-species", JSON.stringify(newPinned));
    } catch { /* ignore */ }
  };

  const togglePinned = (speciesId: number) => {
    if (pinnedSet.has(speciesId)) {
      savePinnedSpecies(pinnedSpecies.filter(id => id !== speciesId));
    } else {
      savePinnedSpecies([...pinnedSpecies, speciesId]);
    }
  };

  // Taxa toggle
  const handleToggleTaxon = useCallback((taxonId: string, event: React.MouseEvent) => {
    const isMulti = event.metaKey || event.ctrlKey;
    if (taxonId === "all") {
      setSelectedTaxa(prev => prev.has("all") ? new Set<string>() : new Set(["all"]));
      return;
    }
    setSelectedTaxa(prev => {
      if (isMulti) {
        const next = new Set(prev);
        next.delete("all");
        if (next.has(taxonId)) next.delete(taxonId);
        else next.add(taxonId);
        return next;
      }
      if (prev.size === 1 && prev.has(taxonId)) return new Set<string>();
      return new Set([taxonId]);
    });
  }, []);

  // Reset filters on taxa change
  const prevTaxaRef = useRef(selectedTaxa);
  const skipClearOnTaxaChangeRef = useRef(false);
  useEffect(() => {
    const prev = prevTaxaRef.current;
    prevTaxaRef.current = selectedTaxa;
    if (prev === selectedTaxa) return;
    if (prev.size === selectedTaxa.size && [...selectedTaxa].every(t => prev.has(t))) return;
    if (skipClearOnTaxaChangeRef.current) {
      skipClearOnTaxaChangeRef.current = false;
      return;
    }
    setSelectedObsRanges(new Set());
    setSearchFilter("");
    setSortField(null);
    setSortDirection("desc");
    setShowOnlyStarred(false);
  }, [selectedTaxa]);

  // Fetch NE species for selected taxa
  useEffect(() => {
    if (selectedTaxa.size === 0) return;

    // Skip "all" — too large for serverless; fetch per-taxon instead
    const taxaToFetch = [...selectedTaxa].filter(t => t !== "all" && !speciesByTaxon[t] && !loadingTaxa.has(t));
    if (taxaToFetch.length === 0) return;

    for (const taxonId of taxaToFetch) {
      const controller = new AbortController();
      abortRefs.current[taxonId] = controller;
      setLoadingTaxa(prev => new Set(prev).add(taxonId));

      fetch(`/api/redlist/species?taxon=${encodeURIComponent(taxonId)}&category=NE`, { signal: controller.signal })
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
  }, [selectedTaxa, speciesByTaxon, loadingTaxa]);

  // No prefetch of all NE species — too large for serverless memory limits.
  // Species are fetched per-taxon when the user selects a taxon group.

  const speciesLoading = loadingTaxa.size > 0;

  // Merge species from cached taxa
  const allSpecies = useMemo(() => {
    if (selectedTaxa.size === 0) return [];
    if (speciesByTaxon["all"]) return speciesByTaxon["all"];
    let merged: RedListSpecies[] = [];
    for (const taxonId of selectedTaxa) {
      if (speciesByTaxon[taxonId]) merged = merged.concat(speciesByTaxon[taxonId]);
    }
    return merged;
  }, [selectedTaxa, speciesByTaxon]);

  // Filter by taxa + subgroup
  const taxaFilteredSpecies = useMemo(() => {
    let filtered = allSpecies;
    if (selectedTaxa.size > 0 && !selectedTaxa.has("all")) {
      filtered = filtered.filter(s => s.taxon_id && selectedTaxa.has(s.taxon_id));
    }
    if (selectedSubgroups.size > 0) {
      filtered = filtered.filter(s =>
        Array.from(selectedSubgroups).some(sg => speciesMatchesSubgroup(s, sg))
      );
    }
    return filtered;
  }, [allSpecies, selectedTaxa, selectedSubgroups]);

  // Search helper
  const matchesSearch = useCallback((s: Species) => {
    if (!searchFilter) return true;
    return s.scientific_name.toLowerCase().includes(searchFilter) ||
      !!s.common_name?.toLowerCase().includes(searchFilter);
  }, [searchFilter]);

  // GBIF obs range filter helper
  const matchesObsRangeFilter = (obsCount: number | null | undefined): boolean => {
    if (selectedObsRanges.size === 0) return true;
    const obs = obsCount ?? 0;
    for (const range of selectedObsRanges) {
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

  // GBIF observations chart data
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
  }, [taxaFilteredSpecies, matchesSearch]);

  // Handle GBIF obs bar click
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

  // Sort handler
  const handleSort = () => {
    if (sortField === "totalGbif") {
      if (sortDirection === "desc") {
        setSortDirection("asc");
      } else {
        setSortField(null);
        setSortDirection("desc");
      }
    } else {
      setSortField("totalGbif");
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };

  const handleSearch = useCallback((value: string) => {
    setSearchFilter(value);
  }, []);

  // Reset page on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedTaxa, selectedObsRanges, searchFilter, showOnlyStarred]);

  // Filter + sort
  const { filteredSpecies, sortedSpecies } = useMemo(() => {
    const filtered = taxaFilteredSpecies.filter(s => {
      const search = !searchFilter ||
        s.scientific_name.toLowerCase().includes(searchFilter) ||
        s.common_name?.toLowerCase().includes(searchFilter);
      const obs = matchesObsRangeFilter(s.gbif_occurrence_count);
      const country = selectedCountries.size === 0 || s.countries.some(c => selectedCountries.has(c));
      const starred = !showOnlyStarred || (s.gbif_species_key != null && pinnedSet.has(Math.abs(s.id)));
      return search && obs && country && starred;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (showOnlyStarred) {
        const aIdx = pinnedSpecies.indexOf(Math.abs(a.id));
        const bIdx = pinnedSpecies.indexOf(Math.abs(b.id));
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      }

      let comparison = 0;
      if (sortField === "totalGbif") {
        comparison = (a.gbif_occurrence_count ?? -1) - (b.gbif_occurrence_count ?? -1);
      } else {
        // Default: sort by total GBIF desc
        comparison = (a.gbif_occurrence_count ?? -1) - (b.gbif_occurrence_count ?? -1);
      }

      const primary = sortDirection === "asc" ? comparison : -comparison;
      if (primary !== 0) return primary;
      return a.scientific_name.localeCompare(b.scientific_name);
    });

    return { filteredSpecies: filtered, sortedSpecies: sorted };
  }, [taxaFilteredSpecies, searchFilter, selectedObsRanges, selectedCountries, showOnlyStarred, pinnedSet, pinnedSpecies, sortField, sortDirection]);

  // Country stats for the map (computed from species matching all filters EXCEPT country)
  const countryStatsForMap = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      const search = !searchFilter ||
        s.scientific_name.toLowerCase().includes(searchFilter) ||
        s.common_name?.toLowerCase().includes(searchFilter);
      const obs = matchesObsRangeFilter(s.gbif_occurrence_count);
      const starred = !showOnlyStarred || (s.gbif_species_key != null && pinnedSet.has(Math.abs(s.id)));
      if (!search || !obs || !starred) return;
      s.countries.forEach(code => { counts[code] = (counts[code] || 0) + 1; });
    });
    return Object.fromEntries(
      Object.entries(counts).map(([code, count]) => [code, { occurrences: 0, species: count }])
    );
  }, [taxaFilteredSpecies, searchFilter, selectedObsRanges, showOnlyStarred, pinnedSet]);

  const handleCountrySelect = useCallback((countryCode: string, _countryName: string, event: React.MouseEvent) => {
    setSelectedCountries(prev => {
      const next = new Set(event.metaKey || event.ctrlKey ? prev : new Set<string>());
      if (prev.has(countryCode) && !event.metaKey && !event.ctrlKey) return new Set();
      if (next.has(countryCode)) next.delete(countryCode); else next.add(countryCode);
      return next;
    });
    setCurrentPage(1);
  }, []);

  const handleClearCountry = useCallback(() => {
    setSelectedCountries(new Set());
    setCurrentPage(1);
  }, []);

  // Pagination
  const totalFiltered = filteredSpecies.length;
  const totalPages = Math.ceil(sortedSpecies.length / PAGE_SIZE);
  const paginatedSpecies = sortedSpecies.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Populate species details from DB data
  useEffect(() => {
    const newDetails: Record<number, SpeciesDetails> = {};
    for (const s of paginatedSpecies) {
      if (speciesDetails[s.id]) continue;
      newDetails[s.id] = {
        gbifUrl: s.gbif_species_key ? `https://www.gbif.org/species/${s.gbif_species_key}` : null,
        gbifOccurrences: s.gbif_occurrence_count ?? null,
        inatDefaultImage: undefined,
      };
    }
    if (Object.keys(newDetails).length > 0) {
      setSpeciesDetails(prev => ({ ...prev, ...newDetails }));
    }
  }, [paginatedSpecies, speciesDetails]);

  // Fetch iNat profile pics for visible species
  useEffect(() => {
    const speciesToFetch = paginatedSpecies.filter(s => {
      const d = speciesDetails[s.id];
      return d && d.inatDefaultImage === undefined;
    });
    if (speciesToFetch.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;

    async function fetchImages() {
      const promises = speciesToFetch.map(async (s) => {
        try {
          const res = await fetch(
            `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(s.scientific_name)}&rank=species&per_page=1`,
            { signal }
          );
          let inatDefaultImage: InatDefaultImage | null = null;
          if (res.ok) {
            const data = await res.json();
            const defaultPhoto = data.results?.[0]?.default_photo;
            if (defaultPhoto) {
              inatDefaultImage = {
                squareUrl: defaultPhoto.square_url || defaultPhoto.url || null,
                mediumUrl: defaultPhoto.medium_url || defaultPhoto.url || null,
              };
            }
          }
          return { id: s.id, inatDefaultImage };
        } catch {
          return { id: s.id, inatDefaultImage: null };
        }
      });

      const results = await Promise.all(promises);
      if (signal.aborted) return;

      setSpeciesDetails(prev => {
        const next = { ...prev };
        for (const r of results) {
          if (next[r.id]) {
            next[r.id] = { ...next[r.id], inatDefaultImage: r.inatDefaultImage };
          }
        }
        return next;
      });
    }

    fetchImages();
    return () => controller.abort("cleanup");
  }, [paginatedSpecies, speciesDetails]);

  const GBIF_FILTERS = "has_coordinate=true&has_geospatial_issue=false&basis_of_record=HUMAN_OBSERVATION&basis_of_record=MACHINE_OBSERVATION&basis_of_record=OCCURRENCE&basis_of_record=MATERIAL_SAMPLE&basis_of_record=OBSERVATION";

  return (
    <div className="space-y-4">
      <TaxaSummary
        onToggleTaxon={handleToggleTaxon}
        selectedTaxa={selectedTaxa}
        selectedSubgroups={selectedSubgroups}
        disableAllSpecies
        onToggleSubgroup={(sgId, parentTaxonId) => {
          const wasSelected = selectedSubgroups.has(sgId);
          setSelectedSubgroups(prev => {
            const next = new Set(prev);
            if (next.has(sgId)) next.delete(sgId);
            else next.add(sgId);
            return next;
          });
          if (!wasSelected && parentTaxonId) {
            if (!selectedTaxa.has(parentTaxonId) || selectedTaxa.size !== 1) {
              skipClearOnTaxaChangeRef.current = true;
              setSelectedTaxa(new Set([parentTaxonId]));
            }
          }
        }}
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-6 py-4 rounded-lg">
          <p className="font-medium">Failed to load data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {selectedTaxa.size > 0 && (
        <div className="space-y-3">
          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Country Map */}
            <div>
              {Object.keys(countryStatsForMap).length > 0 ? (
                <WorldMap
                  selectedCountries={selectedCountries}
                  onCountrySelect={handleCountrySelect}
                  onClearSelection={handleClearCountry}
                  precomputedStats={countryStatsForMap}
                  selectedTaxa={selectedTaxa}
                  speciesLabel="# Unassessed"
                />
              ) : speciesLoading && allSpecies.length === 0 ? (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 min-h-[220px] flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Country</h2>
                  </div>
                  <div className="flex-1 flex items-center justify-center"><Spinner /></div>
                </div>
              ) : null}
            </div>

            {/* GBIF Observations chart */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                  GBIF Observations <GbifInfoTooltip />
                </span>
              </div>
              <div style={{ height: 180 }} className="flex items-center justify-center">
                {speciesLoading && allSpecies.length === 0 ? (
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
                    className="w-full px-3 md:px-4 py-2 pl-9 md:pl-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
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
                    className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full flex items-center gap-1 hover:opacity-80"
                    style={{ backgroundColor: (TAXA_BY_ID[taxonId]?.color || "#666") + "20", color: TAXA_BY_ID[taxonId]?.color || "#666" }}
                  >
                    {TAXA_BY_ID[taxonId]?.name || taxonId}
                    <span className="text-xs">&times;</span>
                  </button>
                ))}
                {Array.from(selectedSubgroups).map(sgId => {
                  const sgInfo = getSubgroupDef(sgId);
                  return (
                    <button
                      key={sgId}
                      onClick={() => setSelectedSubgroups(prev => { const next = new Set(prev); next.delete(sgId); return next; })}
                      className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
                    >
                      {sgInfo?.def.name ?? sgId}
                      <span className="text-xs">&times;</span>
                    </button>
                  );
                })}
                {Array.from(selectedObsRanges).map(range => (
                  <button
                    key={range}
                    onClick={() => setSelectedObsRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                    className="px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 flex items-center gap-1 hover:opacity-80"
                  >
                    {range} obs
                    <span className="text-xs">&times;</span>
                  </button>
                ))}
                {(selectedTaxa.size > 0 || selectedSubgroups.size > 0 || selectedObsRanges.size > 0 || showOnlyStarred) && (
                  <button
                    onClick={() => {
                      setSelectedTaxa(new Set());
                      setSelectedSubgroups(new Set());
                      setSelectedObsRanges(new Set());
                      setSearchFilter("");
                      setShowOnlyStarred(false);
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline"
                  >
                    Clear all
                  </button>
                )}
                <span className="ml-auto text-sm md:text-base font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">
                  {totalFiltered.toLocaleString()} species
                </span>
              </div>
            </div>

            {/* Species table */}
            {speciesLoading && allSpecies.length === 0 ? (
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
                  >
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                        <tr>
                          <th className="px-2 py-3 text-center text-xs font-medium text-zinc-500 uppercase tracking-wider w-10">
                            <svg className="w-4 h-4 mx-auto text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                          </th>
                          <th className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                            Species
                          </th>
                          <th
                            className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                            onClick={handleSort}
                          >
                            <span className="flex items-center justify-end gap-1">
                              GBIF Observations
                              <GbifInfoTooltip />
                              {(sortField === "totalGbif" || sortField === null) && (
                                <span className="text-emerald-500">{sortDirection === "desc" ? "\u2193" : "\u2191"}</span>
                              )}
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {paginatedSpecies.map((s) => {
                          const speciesKey = Math.abs(s.id);
                          const details = speciesDetails[s.id];
                          const isPinned = pinnedSet.has(speciesKey);
                          return (
                            <React.Fragment key={s.id}>
                              <tr
                                className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer ${selectedSpeciesKey === speciesKey ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
                                onClick={() => { setSelectedSpeciesKey(selectedSpeciesKey === speciesKey ? null : speciesKey); }}
                              >
                                <td className="px-2 py-2 text-center">
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
                                </td>
                                <td className="px-2 md:px-4 py-2">
                                  <div className="flex items-center gap-2">
                                    {details?.inatDefaultImage === undefined ? (
                                      <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-100 dark:bg-zinc-800 rounded flex-shrink-0 flex items-center justify-center">
                                        <span className="inline-block animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
                                      </div>
                                    ) : details?.inatDefaultImage?.squareUrl ? (
                                      <img
                                        src={details.inatDefaultImage.squareUrl}
                                        alt=""
                                        className="w-8 h-8 md:w-10 md:h-10 object-cover rounded flex-shrink-0"
                                      />
                                    ) : (
                                      <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 flex-shrink-0">
                                        <TaxaIcon taxonId={s.taxon_id || "all"} size={18} />
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <span className="italic font-medium text-zinc-900 dark:text-zinc-100 text-xs md:text-sm">
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
                                <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                                  {s.gbif_species_key && s.gbif_occurrence_count != null ? (
                                    <a
                                      href={`https://www.gbif.org/occurrence/search?taxon_key=${s.gbif_species_key}&${GBIF_FILTERS}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {s.gbif_occurrence_count.toLocaleString()}
                                    </a>
                                  ) : (
                                    "\u2014"
                                  )}
                                </td>
                              </tr>
                              {selectedSpeciesKey === speciesKey && s.gbif_species_key && (
                                <tr>
                                  <td colSpan={3} className="p-0 bg-zinc-50 dark:bg-zinc-800/30">
                                    <OccurrenceMapRow
                                      speciesKey={s.gbif_species_key}
                                      mounted={mounted}
                                      assessmentYear={null}
                                      assessmentDate={null}
                                    />
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {totalFiltered === 0 && !speciesLoading && (
                          <tr>
                            <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
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
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        Prev
                      </button>
                      <span className="text-xs md:text-sm text-zinc-600 dark:text-zinc-400">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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
        id="image-preview-new"
        alt=""
        className="fixed z-[9999] w-48 h-48 object-cover rounded shadow-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pointer-events-none"
        style={{ display: 'none' }}
      />
    </div>
  );
}
