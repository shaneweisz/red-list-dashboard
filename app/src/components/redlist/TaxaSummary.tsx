"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { FaInfoCircle, FaExpandAlt, FaCompressAlt, FaChevronRight } from "react-icons/fa";

import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import TaxaIcon from "@/components/TaxaIcon";
import { CATEGORY_COLORS, CATEGORY_NAMES, CATEGORY_ORDER } from "@/config/taxa";
import { hasChildren, findNode, getAncestors } from "@/lib/taxonomy-utils";
import { TAXONOMY_VIEWS } from "@/config/taxonomy-views";
interface Table1aRowData {
  group: string;
  name: string;
  estimatedDescribed: number;
  totalAssessed: number;
  percentAssessed: number;
  outdated: number;
  percentOutdated: number;
  byCategory: Record<string, number>;
  gbifSpeciesCount?: number;
  gbifNeSpeciesCount?: number;
  totalGbifObservations?: number;
  meanGbifObsPerSpecies?: number;
  medianGbifObsPerSpecies?: number;
  colDescribed?: number;
  colNe?: number;
}

interface Table1aSectionData {
  title: string;
  rows: Table1aRowData[];
}

const IUCN_SOURCE_URL = "https://nc.iucnredlist.org/redlist/content/attachment_files/2025-2_RL_Table1a.pdf";
const COL_SOURCE_URL = "https://www.catalogueoflife.org/";

// Ordered categories for the breakdown bar (most threatened first)
const BAR_CATEGORIES = Object.keys(CATEGORY_ORDER).sort(
  (a, b) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b]
);

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  outdated: number;
  percentOutdated: number;
  lastUpdated: string | null;
  byCategory: Record<string, number>;
  totalGbifObservations?: number;
  meanGbifObsPerSpecies?: number;
  medianGbifObsPerSpecies?: number;
  gbifSpeciesCount?: number;
  gbifNeSpeciesCount?: number;
  gbifObsDistribution?: Record<string, number>;
  colDescribed?: number;
  colNe?: number;
}

interface SubGroupSummary {
  id: string;
  name: string;
  estimatedDescribed: number;
  totalAssessed: number;
  outdated: number;
  gbifNeSpeciesCount: number;
  byCategory: Record<string, number>;
  colDescribed?: number;
  colNe?: number;
}

interface Props {
  onToggleTaxon: (taxonId: string, event: React.MouseEvent) => void;
  selectedTaxa: Set<string>;
  selectedSubgroups: Set<string>;
  onToggleSubgroup: (subgroupId: string) => void;
  /** Navigate directly to a taxon + subgroup (used by Table 1a click-through) */
  onNavigateToSubgroup?: (taxonId: string, subgroupId: string) => void;
  disableAllSpecies?: boolean;
  viewMode?: "reassessments" | "new-assessments";
}

// Dynamic: any tree node with children is expandable
const isExpandable = (id: string) => hasChildren(id);

// Expand affordance for tree rows: a chevron that points right when collapsed and rotates
// down when expanded, so it's obvious a row drills into sub-groups. Leaf rows get a
// same-width spacer to keep names aligned with their expandable siblings.
const expandToggle = (expandable: boolean, expanded: boolean) =>
  expandable ? (
    <FaChevronRight
      aria-hidden
      className={`flex-shrink-0 w-2.5 h-2.5 text-zinc-400 dark:text-zinc-500 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
    />
  ) : (
    <span aria-hidden className="flex-shrink-0 w-2.5" />
  );

// Bar color helpers
const getAssessedBarColor = (percent: number) =>
  percent >= 50 ? "#22c55e" : percent >= 20 ? "#eab308" : "#ef4444";

const getOutdatedBarColor = (percent: number) =>
  percent < 10 ? "#22c55e" : percent < 50 ? "#eab308" : "#ef4444";

// Sticky cell classes for the pinned taxon column
const stickyClasses = "sticky left-0 z-10";
// Compact cell classes for tighter table spacing
const cellPad = "px-3 py-2 md:px-5 md:py-2.5";
const colDivider = "border-l border-zinc-200 dark:border-zinc-700";
const numericTdNoDividerClasses = `${cellPad} text-right whitespace-nowrap w-0`;
const numericThNoDividerClasses = `${cellPad} text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap w-0`;
const numericTdClasses = `${numericTdNoDividerClasses} ${colDivider}`;
const numericThClasses = `${numericThNoDividerClasses} ${colDivider}`;
const flexTdClasses = `${cellPad} ${colDivider} whitespace-nowrap w-0`;
const flexThClasses = `${cellPad} ${colDivider} text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap w-0`;
const centeredThClasses = `${cellPad} ${colDivider} text-center text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap w-0`;

// Toggleable column IDs (Taxon is always visible)
type ColumnId = "described" | "colDescribed" | "assessed" | "outdated" | "breakdown" | "gbifUnassessed" | "colNe" | "totalGbifObs" | "meanGbifObs" | "medianGbifObs" | "gbifDistribution";

const COLUMN_LABELS: Record<ColumnId, string> = {
  described: "# Described Species",
  colDescribed: "# Described Species (CoL)",
  assessed: "# Red List Assessed",
  outdated: "# Outdated Assessments (10+Y)",
  breakdown: "Risk Category Breakdown",
  gbifUnassessed: "# Unassessed, 1+ GBIF Obs",
  colNe: "# Not Evaluated",
  totalGbifObs: "Total Obs",
  meanGbifObs: "Mean Obs",
  medianGbifObs: "Median Obs",
  gbifDistribution: "Obs Distribution",
};

const DISTRIBUTION_BIN_LABELS = ["1", "2–10", "11–100", "101–1K", "1K–10K", "10K–100K", "100K–1M", ">1M"];

type FocusMode = "redlist" | "gbif" | "new-assessments";

// "# Described (CoL)" is hidden by default in every focus — the IUCN/CoL toggle on
// the "# Described" header flips the primary column's source instead. Enable this
// column via the cog menu to see IUCN and CoL described counts side by side.
const FOCUS_HIDDEN: Record<FocusMode, Set<ColumnId>> = {
  redlist: new Set(["colDescribed", "colNe", "gbifUnassessed", "totalGbifObs", "meanGbifObs", "medianGbifObs", "gbifDistribution", "breakdown"]),
  gbif: new Set(["colDescribed", "outdated", "breakdown"]),
  "new-assessments": new Set(["colDescribed", "outdated", "breakdown", "gbifUnassessed", "totalGbifObs", "meanGbifObs", "medianGbifObs", "gbifDistribution"]),
};

function DisabledAllTooltip() {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (hovered && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.top, left: rect.right + 8 });
    }
  }, [hovered]);

  return (
    <span
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="ml-1 text-zinc-400 dark:text-zinc-500 cursor-help"
    >
      <svg className="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      {hovered && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999] px-2 py-1 text-xs bg-zinc-800 text-zinc-200 rounded shadow-lg whitespace-nowrap"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
        >
          Unassessed species must be loaded per taxon group. Loading all species at once would require very high memory usage and data transfer.
        </div>,
        document.body
      )}
    </span>
  );
}

export default function TaxaSummary({ onToggleTaxon, selectedTaxa, selectedSubgroups, onToggleSubgroup, onNavigateToSubgroup, disableAllSpecies, viewMode = "reassessments" }: Props) {
  const isNewAssessments = viewMode === "new-assessments";
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks whether the taxa table is expanded for multi-select.
  // Set to true only when the user Cmd/Ctrl+clicks a taxon row;
  // cleared when the modifier key is released.
  const [taxaExpanded, setTaxaExpanded] = useState(false);
  // Which taxa are expanded to show subgroups (e.g., "reptiles", "fishes")
  const [expandedTaxa, setExpandedTaxa] = useState<Set<string>>(new Set());
  // Fetched subgroup data keyed by taxonId
  const [subgroupData, setSubgroupData] = useState<Record<string, SubGroupSummary[]>>({});
  const [loadingSubgroups, setLoadingSubgroups] = useState<Set<string>>(new Set());
  // Refs to avoid stale closures in toggleExpand
  const subgroupDataRef = useRef(subgroupData);
  subgroupDataRef.current = subgroupData;
  const loadingSubgroupsRef = useRef(loadingSubgroups);
  loadingSubgroupsRef.current = loadingSubgroups;
  const initialFocus: FocusMode = isNewAssessments ? "new-assessments" : "redlist";
  const [focusMode, setFocusMode] = useState<FocusMode>(initialFocus);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(new Set(FOCUS_HIDDEN[initialFocus]));

  // Sync focus mode when viewMode changes
  useEffect(() => {
    const mode: FocusMode = isNewAssessments ? "new-assessments" : "redlist";
    setFocusMode(mode);
    setHiddenColumns(new Set(FOCUS_HIDDEN[mode]));
  }, [isNewAssessments]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const isVisible = (col: ColumnId) => !hiddenColumns.has(col);
  const toggleColumn = (col: ColumnId) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const switchFocus = (mode: FocusMode) => {
    setFocusMode(mode);
    setHiddenColumns(new Set(FOCUS_HIDDEN[mode]));
  };

  const visibleColCount = 1 + (Object.keys(COLUMN_LABELS) as ColumnId[]).filter(isVisible).length;

  // Close column menu on outside click
  useEffect(() => {
    if (!showColumnMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColumnMenu]);

  // Collapse taxa table when Cmd/Ctrl is released after a multi-select click
  useEffect(() => {
    if (!taxaExpanded) return;
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) setTaxaExpanded(false);
    };
    const onBlur = () => setTaxaExpanded(false);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [taxaExpanded]);

  // Auto-scroll to show Assessed column on mobile (skip past # Described)
  const autoScroll = useCallback((el: HTMLDivElement) => {
    if (window.innerWidth < 768) {
      const firstDataTh = el.querySelector('thead th:nth-child(2)') as HTMLElement;
      if (firstDataTh) {
        el.scrollLeft = firstDataTh.offsetWidth;
      }
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current && taxa.length > 0) {
      autoScroll(scrollRef.current);
    }
  }, [taxa, autoScroll]);

  // Fetch subgroup data when a taxon is expanded
  const toggleExpand = useCallback(async (taxonId: string) => {
    setExpandedTaxa((prev) => {
      const next = new Set(prev);
      if (next.has(taxonId)) {
        next.delete(taxonId);
      } else {
        next.add(taxonId);
      }
      return next;
    });

    // Fetch subgroup data if not already loaded (read from refs to avoid stale closures)
    if (!subgroupDataRef.current[taxonId] && !loadingSubgroupsRef.current.has(taxonId)) {
      setLoadingSubgroups((prev) => new Set(prev).add(taxonId));
      try {
        const res = await fetch(`/api/redlist/taxa-subgroups?nodeId=${taxonId}`);
        if (res.ok) {
          const data = await res.json();
          setSubgroupData((prev) => ({ ...prev, [taxonId]: data.subgroups }));
        }
      } finally {
        setLoadingSubgroups((prev) => {
          const next = new Set(prev);
          next.delete(taxonId);
          return next;
        });
      }
    }
  }, []);

  // Table 1a mode
  const [table1aMode, setTable1aMode] = useState(false);
  const [table1aData, setTable1aData] = useState<Table1aSectionData[] | null>(null);
  const [table1aLoading, setTable1aLoading] = useState(false);

  // "# Described" source toggle (#272/#274): IUCN Table 1a estimates vs the CoL
  // backbone described count. Flipping to CoL swaps the described value AND
  // recomputes % Assessed against it. The separate "# Described (CoL)" column
  // (cog-only) is unaffected. Rows without a CoL count (sub-groups) stay IUCN.
  const [describedSource, setDescribedSource] = useState<"iucn" | "col">("iucn");
  const applySource = useCallback(
    <T extends { estimatedDescribed: number; colDescribed?: number; totalAssessed: number; percentAssessed: number }>(row: T): T => {
      if (describedSource !== "col" || row.colDescribed == null) return row;
      const described = row.colDescribed;
      return {
        ...row,
        estimatedDescribed: described,
        percentAssessed: described > 0 ? (row.totalAssessed / described) * 100 : 0,
      };
    },
    [describedSource]
  );

  // Separate "all" row from per-taxon rows (needed before early returns for hooks)
  const allTaxon = useMemo(() => {
    const raw = taxa.find((t) => t.id === "all");
    return raw ? applySource(raw) : undefined;
  }, [taxa, applySource]);
  const perTaxa = useMemo(() => taxa.filter((t) => t.id !== "all").map(applySource), [taxa, applySource]);

  // Expand all expandable taxa
  const expandAll = useCallback(async () => {
    const expandableTaxaIds = perTaxa.filter(t => isExpandable(t.id)).map(t => t.id);
    setExpandedTaxa(new Set(expandableTaxaIds));
    for (const taxonId of expandableTaxaIds) {
      if (!subgroupDataRef.current[taxonId] && !loadingSubgroupsRef.current.has(taxonId)) {
        setLoadingSubgroups((prev) => new Set(prev).add(taxonId));
        fetch(`/api/redlist/taxa-subgroups?nodeId=${taxonId}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setSubgroupData((prev) => ({ ...prev, [taxonId]: data.subgroups }));
          })
          .finally(() => {
            setLoadingSubgroups((prev) => {
              const next = new Set(prev);
              next.delete(taxonId);
              return next;
            });
          });
      }
    }
  }, [perTaxa]);

  const collapseAll = useCallback(() => {
    setExpandedTaxa(new Set());
  }, []);

  const enterTable1a = useCallback(async () => {
    setTable1aMode(true);
    if (!table1aData) {
      setTable1aLoading(true);
      try {
        const res = await fetch("/api/redlist/taxa-summary?table1a=true");
        if (res.ok) {
          const data = await res.json();
          setTable1aData(data.sections);
        }
      } finally {
        setTable1aLoading(false);
      }
    }
  }, [table1aData]);

  const exitTable1a = useCallback(() => {
    setTable1aMode(false);
  }, []);

  const allExpanded = useMemo(() => perTaxa.filter(t => isExpandable(t.id)).every(t => expandedTaxa.has(t.id)), [perTaxa, expandedTaxa]);

  // Collapse all when returning to landing page (no taxa selected)
  useEffect(() => {
    if (selectedTaxa.size === 0 && selectedSubgroups.size === 0) {
      setExpandedTaxa(new Set());
    }
  }, [selectedTaxa, selectedSubgroups]);

  // Auto-expand ancestor chain when subgroups are selected (e.g. from URL)
  useEffect(() => {
    if (selectedSubgroups.size === 0) return;
    const toExpand = new Set<string>();
    for (const sgId of selectedSubgroups) {
      // Expand all ancestors up to the view root (which is in selectedTaxa)
      for (const ancestorId of getAncestors(sgId)) {
        if (selectedTaxa.has(ancestorId)) break; // Stop at the view root
        if (!expandedTaxa.has(ancestorId)) toExpand.add(ancestorId);
      }
      // Expand the node itself if it has children
      if (hasChildren(sgId) && !expandedTaxa.has(sgId)) {
        toExpand.add(sgId);
      }
    }
    for (const id of toExpand) toggleExpand(id);
    // Deps intentionally limited to selectedSubgroups only:
    // - toggleExpand: stable identity (useCallback with empty deps + refs)
    // - selectedTaxa: would cause re-runs when taxa selection changes, but this
    //   effect only needs to react to subgroup URL changes
    // - expandedTaxa: including it would create an infinite loop since this effect
    //   expands taxa (mutates expandedTaxa), which would re-trigger the effect
  }, [selectedSubgroups]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchTaxa() {
      try {
        const res = await fetch("/api/redlist/taxa-summary");
        if (!res.ok) throw new Error("Failed to load taxa");
        const data = await res.json();
        setTaxa(data.taxa);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load taxa");
      } finally {
        setLoading(false);
      }
    }
    fetchTaxa();
  }, []);

  if (loading) {
    // Skeleton rows matching actual table structure
    const skeletonRows = Array.from({ length: 9 }, (_, i) => (
      <tr key={i} className={i === 0 ? "bg-zinc-50/80 dark:bg-zinc-800/60" : ""}>
        <td className={`${stickyClasses} bg-white dark:bg-zinc-900 ${cellPad} w-0`}>
          <div className="flex items-center gap-2">
            <div className="w-[22px] h-[22px] rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("colDescribed") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[140px] md:min-w-[200px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[140px] md:min-w-[200px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[140px] md:min-w-[200px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("colNe") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[140px] md:min-w-[200px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}>
            <div className="min-w-[100px] md:min-w-[120px]">
              <div className="h-5 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
            </div>
          </td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            <div className="min-w-[80px] md:min-w-[100px]">
              <div className="h-4 sm:h-3 w-full rounded-full bg-zinc-200 dark:bg-zinc-700" />
            </div>
          </td>
        )}
      </tr>
    ));

    return (
      <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
        {/* Spinner overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-zinc-900/60 z-20">
          <svg
            className="animate-spin h-8 w-8 text-zinc-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
              <th className={`${stickyClasses} bg-zinc-50 dark:bg-zinc-800 ${cellPad} text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap w-0`}>Taxon</th>
              {isVisible("described") && <th className={numericThNoDividerClasses}># Described Species</th>}
              {isVisible("colDescribed") && <th className={numericThClasses}># Described Species (CoL)</th>}
              {isVisible("assessed") && <th className={centeredThClasses}># Red List Assessed</th>}
              {isVisible("outdated") && <th className={centeredThClasses}># Outdated Assessments (10+Y)</th>}
              {isVisible("gbifUnassessed") && <th className={centeredThClasses}># Unassessed, 1+ GBIF Obs</th>}
              {isVisible("colNe") && <th className={centeredThClasses}># Not Evaluated</th>}
              {isVisible("totalGbifObs") && <th className={numericThClasses}>Total Obs</th>}
              {isVisible("gbifDistribution") && <th className={flexThClasses}>Obs Distribution</th>}
              {isVisible("meanGbifObs") && <th className={numericThClasses}>Mean Obs</th>}
              {isVisible("medianGbifObs") && <th className={numericThClasses}>Median Obs</th>}
              {isVisible("breakdown") && <th className={flexThClasses}>Risk Category Breakdown</th>}
            </tr>
          </thead>
          <tbody>
            {skeletonRows[0]}
            <tr>
              <td colSpan={visibleColCount} className="p-0">
                <div className="border-b-2 border-zinc-200 dark:border-zinc-700" />
              </td>
            </tr>
            {skeletonRows.slice(1)}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg">
        {error}
      </div>
    );
  }

  // Calculate totals
  const totalAssessed = perTaxa.reduce((sum, t) => sum + t.totalAssessed, 0);
  const totalOutdated = perTaxa.reduce((sum, t) => sum + t.outdated, 0);
  const totalDescribed = allTaxon?.estimatedDescribed ?? perTaxa.reduce((sum, t) => sum + t.estimatedDescribed, 0);
  const totalPercentAssessed = (totalAssessed / totalDescribed) * 100;
  const totalPercentOutdated = (totalOutdated / totalAssessed) * 100;
  const totalByCategory: Record<string, number> = {};
  for (const t of perTaxa) {
    for (const [cat, count] of Object.entries(t.byCategory || {})) {
      totalByCategory[cat] = (totalByCategory[cat] || 0) + count;
    }
  }
  const totalGbifObs = perTaxa.reduce((sum, t) => sum + (t.totalGbifObservations || 0), 0);
  const totalGbifSpecies = perTaxa.reduce((sum, t) => sum + (t.gbifSpeciesCount || 0), 0);
  const totalGbifNeSpecies = perTaxa.reduce((sum, t) => sum + (t.gbifNeSpeciesCount || 0), 0);
  const totalMeanGbifObs = totalGbifSpecies > 0 ? Math.round(totalGbifObs / totalGbifSpecies) : 0;
  const totalColDescribed = allTaxon?.colDescribed ?? perTaxa.reduce((sum, t) => sum + (t.colDescribed || 0), 0);
  const totalColNe = allTaxon?.colNe ?? perTaxa.reduce((sum, t) => sum + (t.colNe || 0), 0);


  // Column order: Taxon (sticky) | # Described | Assessed | Outdated | Category Breakdown

  // Render a percentage bar (optionally with a count label above)
  const renderBar = (percent: number, barColor: string, isAll: boolean, count?: number, fontWeight?: string) => {
    const clampedPercent = Math.min(100, Math.max(0, percent));
    const fillColor = isAll ? "rgba(255,255,255,0.25)" : barColor;
    const fw = fontWeight || "font-medium";
    return (
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-[140px] md:min-w-[200px]">
        {count != null && (
          <span className={`text-sm md:text-base ${fw} tabular-nums text-zinc-700 dark:text-zinc-300 w-[48px] sm:w-[60px] text-right flex-shrink-0`}>
            {count.toLocaleString()}
          </span>
        )}
        <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${clampedPercent}%`, backgroundColor: fillColor }}
          />
        </div>
        <span className="text-xs md:text-sm tabular-nums text-zinc-500 dark:text-zinc-400 w-[44px] sm:w-[52px] text-right flex-shrink-0">
          {percent.toFixed(1)}%
        </span>
      </div>
    );
  };

  // Render a stacked category breakdown bar
  const renderBreakdownBar = (byCategory: Record<string, number>) => {
    const total = Object.values(byCategory).reduce((sum, n) => sum + n, 0);
    if (total === 0) return <span className="text-sm md:text-base text-zinc-400">—</span>;

    const segments = BAR_CATEGORIES
      .filter((cat) => (byCategory[cat] || 0) > 0)
      .map((cat) => ({
        cat,
        count: byCategory[cat],
        pct: (byCategory[cat] / total) * 100,
        color: CATEGORY_COLORS[cat] || "#a3a3a3",
        name: CATEGORY_NAMES[cat] || cat,
      }));

    return (
      <div className="min-w-[80px] md:min-w-[100px] relative">
        {/* Visible bar (clipped for rounded corners) */}
        <div className="flex h-4 sm:h-3 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700">
          {segments.map((seg) => (
            <div
              key={seg.cat}
              className="h-full"
              style={{
                width: `${seg.pct}%`,
                backgroundColor: seg.color,
                minWidth: seg.pct > 0 ? "2px" : 0,
              }}
            />
          ))}
        </div>
        {/* Hover zones + tooltips (outside overflow-hidden so tooltips aren't clipped) */}
        <div className="absolute inset-0 flex">
          {segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            const isFirst = i === 0;
            const posClass = isLast && !isFirst
              ? "right-0"
              : isFirst && !isLast
                ? "left-0"
                : "left-1/2 -translate-x-1/2";
            return (
              <div
                key={seg.cat}
                className="group/seg relative h-full"
                style={{ width: `${seg.pct}%`, minWidth: seg.pct > 0 ? "2px" : 0 }}
              >
                <div className={`absolute ${posClass} bottom-full mb-2 px-2 py-1 text-xs bg-zinc-800 dark:bg-zinc-700 text-white rounded-lg shadow-lg opacity-0 invisible group-hover/seg:opacity-100 group-hover/seg:visible z-50 whitespace-nowrap pointer-events-none`}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="text-zinc-300">{seg.name}</span>
                    <span className="font-medium pl-1">{seg.count.toLocaleString()}</span>
                    <span className="text-zinc-400">({seg.pct.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render a mini histogram for GBIF observation distribution
  const renderDistributionBar = (distribution: Record<string, number>) => {
    const entries = DISTRIBUTION_BIN_LABELS.map((label) => ({ label, count: distribution[label] || 0 }));
    const max = Math.max(...entries.map((e) => e.count));
    if (max === 0) return <span className="text-sm text-zinc-400">—</span>;

    return (
      <div className="min-w-[100px] md:min-w-[120px] relative">
        <div className="flex items-end h-5">
          {entries.map(({ label, count }, i) => {
            const heightPct = (count / max) * 100;
            return (
              <div key={label} className="group/bar relative flex-1 flex items-end h-full">
                <div
                  className={`w-full bg-emerald-500/70 dark:bg-emerald-400/60 transition-colors group-hover/bar:bg-emerald-500 dark:group-hover/bar:bg-emerald-400 ${i === 0 ? "rounded-l-sm" : ""} ${i === entries.length - 1 ? "rounded-r-sm" : ""}`}
                  style={{ height: `${Math.max(heightPct, count > 0 ? 6 : 0)}%` }}
                />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2 py-1 text-xs bg-zinc-800 dark:bg-zinc-700 text-white rounded-lg shadow-lg opacity-0 invisible group-hover/bar:opacity-100 group-hover/bar:visible z-50 whitespace-nowrap pointer-events-none">
                  <span className="text-zinc-300">{label} obs:</span>{" "}
                  <span className="font-medium">{count.toLocaleString()}</span> species
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // CoL backbone cells (#272): "# Described (CoL)" and "# Not Evaluated". Rendered
  // wherever a row has CoL data; sub-group rows pass undefined → "—" (the node-children
  // endpoint doesn't carry CoL counts). bold matches subtotal/total row weight.
  const colDescribedCell = (value: number | undefined, bold = false) =>
    isVisible("colDescribed") ? (
      <td className={numericTdClasses}>
        <span className={`text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums ${bold ? "font-semibold" : ""}`}>
          {value != null ? value.toLocaleString() : "—"}
        </span>
      </td>
    ) : null;
  // "# Not Evaluated" renders as a progress bar (ne / col_described) with the count,
  // mirroring the assessed column. Falls back to a plain count if there's no
  // denominator, and "—" when the row has no CoL data (sub-groups).
  const colNeCell = (ne: number | undefined, described: number | undefined, opts?: { bold?: boolean; isAllRow?: boolean }) =>
    isVisible("colNe") ? (
      <td className={flexTdClasses}>
        {ne == null ? (
          <span className="text-sm text-zinc-400">—</span>
        ) : (
          // Mirror the Assessed column: a bar over the same (toggled) described
          // denominator + the count, so flipping IUCN↔CoL moves both bars together.
          renderBar(described && described > 0 ? (ne / described) * 100 : 0, "#f59e0b", opts?.isAllRow ?? false, ne, opts?.bold ? "font-semibold" : undefined)
        )}
      </td>
    ) : null;

  // Render a data row
  const renderRow = (
    id: string,
    name: string,
    color: string,
    estimatedDescribed: number,
    assessed: number,
    percentAssessed: number,
    outdated: number,
    percentOutdated: number,
    byCategory: Record<string, number>,
    isSelected?: boolean,
    available = true,
    isAllRow = false,
    gbifObs?: { total?: number; mean?: number; median?: number; speciesCount?: number; gbifNeCount?: number; distribution?: Record<string, number>; colDescribed?: number; colNe?: number }
  ) => {
    const isAllSelected = isAllRow && selectedTaxa.has("all");
    const rowBg = isAllRow
      ? isAllSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-zinc-50/80 dark:bg-zinc-800/60"
      : isSelected
        ? "bg-zinc-100 dark:bg-zinc-800"
        : "";
    const isOnLandingPage = selectedTaxa.size === 0 && selectedSubgroups.size === 0;
    const allDisabled = isAllRow && disableAllSpecies && isOnLandingPage;
    const hoverClass = allDisabled
      ? "cursor-not-allowed"
      : isAllRow
        ? "hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        : available
          ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
          : "opacity-50 cursor-not-allowed";

    const stickyBg = isAllRow
      ? isAllSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-zinc-50 dark:bg-zinc-800/60"
      : isSelected
        ? "bg-zinc-100 dark:bg-zinc-800"
        : "bg-white dark:bg-zinc-900";

    return (
      <tr
        key={id}
        onClick={(e) => {
          if (allDisabled) return;
          if (!isAllRow && !available) return;
          // Expand taxa table when Cmd/Ctrl+clicking a taxon row (not "all")
          if (!isAllRow && (e.metaKey || e.ctrlKey)) {
            setTaxaExpanded(true);
          }
          onToggleTaxon(id, e);
        }}
        className={`transition-colors ${rowBg} ${hoverClass}`}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${stickyBg}`}>
          <div className="flex items-center gap-2">
            {expandToggle(false, false)}
            <TaxaIcon taxonId={id} size={22} className="flex-shrink-0" style={{ color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{name}</span>
            {allDisabled && <DisabledAllTooltip />}
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {estimatedDescribed.toLocaleString()}
            </span>
          </td>
        )}
        {colDescribedCell(gbifObs?.colDescribed)}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBar(percentAssessed, getAssessedBarColor(percentAssessed), isAllRow, assessed)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBar(percentOutdated, getOutdatedBarColor(percentOutdated), isAllRow, outdated)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            {(() => {
              const ne = gbifObs?.gbifNeCount;
              if (ne == null || estimatedDescribed <= 0) return <span className="text-sm md:text-base text-zinc-400">—</span>;
              const pct = (ne / estimatedDescribed) * 100;
              return renderBar(pct, "#3b82f6", isAllRow, ne);
            })()}
          </td>
        )}
        {colNeCell(gbifObs?.colNe, estimatedDescribed, { isAllRow })}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {gbifObs?.total != null ? gbifObs.total.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}>
            {gbifObs?.distribution ? renderDistributionBar(gbifObs.distribution) : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {gbifObs?.mean != null ? gbifObs.mean.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {gbifObs?.median != null ? gbifObs.median.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBreakdownBar(byCategory)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
      </tr>
    );
  };

  // Render an ancestor context row with full data — clicking navigates to that level.
  const renderAncestorRow = (sg: SubGroupSummary, color: string, depth: number, topTaxonId: string, isViewRoot: boolean) => {
    const sgDescribed = describedSource === "col" && sg.colDescribed != null ? sg.colDescribed : sg.estimatedDescribed;
    const sgPctAssessed = sgDescribed > 0 ? (sg.totalAssessed / sgDescribed) * 100 : 0;
    const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
    return (
      <tr
        key={`ancestor-${sg.id}`}
        className="transition-colors cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        onClick={() => {
          onToggleSubgroup(sg.id);
        }}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-white dark:bg-zinc-900`}>
          <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 12}px` }}>
            <TaxaIcon taxonId={sg.id} size={isViewRoot ? 18 : 16} className="flex-shrink-0" style={{ color }} />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{sg.name}</span>
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <span className="text-sm text-zinc-700 dark:text-zinc-300 tabular-nums">{sgDescribed.toLocaleString()}</span>
          </td>
        )}
        {colDescribedCell(sg.colDescribed)}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false, sg.totalAssessed)}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            {sg.totalAssessed > 0
              ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false, sg.outdated)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            {sg.gbifNeSpeciesCount > 0 && sgDescribed > 0
              ? renderBar((sg.gbifNeSpeciesCount / sgDescribed) * 100, "#3b82f6", false, sg.gbifNeSpeciesCount)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {colNeCell(sg.colNe, sgDescribed)}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            {renderBreakdownBar(sg.byCategory)}
          </td>
        )}
      </tr>
    );
  };

  // Render a standalone subgroup row (used when table is collapsed to a selected subgroup)
  const renderCollapsedSubgroupRow = (taxon: TaxonSummary, sg: SubGroupSummary) => {
    const sgDescribed = describedSource === "col" && sg.colDescribed != null ? sg.colDescribed : sg.estimatedDescribed;
    const sgPctAssessed = sgDescribed > 0 ? (sg.totalAssessed / sgDescribed) * 100 : 0;
    const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
    return (
      <tr
        key={`collapsed-${sg.id}`}
        className={`transition-colors bg-zinc-100 dark:bg-zinc-800 ${isExpandable(sg.id) ? "cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700" : ""}`}
        onClick={() => {
          if (isExpandable(sg.id)) {
            toggleExpand(sg.id);
          }
        }}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-zinc-100 dark:bg-zinc-800`}>
          <div className="flex items-center gap-2">
            {expandToggle(isExpandable(sg.id), expandedTaxa.has(sg.id))}
            <TaxaIcon taxonId={sg.id} size={18} className="flex-shrink-0" style={{ color: taxon.color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{sg.name}</span>
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums inline-flex items-center gap-1">
              {sgDescribed.toLocaleString()}
              {(() => {
                const sgNode = findNode(sg.id);
                if (!sgNode?.estimatedSource) return null;
                return (
                  <span className="relative group/src">
                    <a
                      href={sgNode.estimatedSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      <FaInfoCircle size={10} />
                    </a>
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 mr-5 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/src:opacity-100 group-hover/src:visible z-50 shadow-lg normal-case max-w-[300px] whitespace-normal text-left">
                      {sgNode.estimatedSource}
                    </span>
                  </span>
                );
              })()}
            </span>
          </td>
        )}
        {colDescribedCell(sg.colDescribed)}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false, sg.totalAssessed)}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            {sg.totalAssessed > 0
              ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false, sg.outdated)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            {sg.gbifNeSpeciesCount > 0 && sgDescribed > 0
              ? renderBar((sg.gbifNeSpeciesCount / sgDescribed) * 100, "#3b82f6", false, sg.gbifNeSpeciesCount)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {colNeCell(sg.colNe, sgDescribed)}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            {renderBreakdownBar(sg.byCategory)}
          </td>
        )}
      </tr>
    );
  };

  // Render a subgroup row, recursively expandable if it has children
  const renderSubgroupRow = (sg: SubGroupSummary, parentColor: string, depth: number, topTaxonId: string): React.ReactNode => {
    const sgDescribed = describedSource === "col" && sg.colDescribed != null ? sg.colDescribed : sg.estimatedDescribed;
    const sgPctAssessed = sgDescribed > 0 ? (sg.totalAssessed / sgDescribed) * 100 : 0;
    const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
    const isSgSelected = selectedSubgroups.has(sg.id);
    const sgHasChildren = isExpandable(sg.id);
    const isSgExpanded = expandedTaxa.has(sg.id);
    const sgSubs = subgroupData[sg.id] ?? [];
    const isLoadingSgSubs = loadingSubgroups.has(sg.id);
    return (
      <React.Fragment key={sg.id}>
        <tr
          className={`transition-colors cursor-pointer ${
            isSgSelected
              ? "bg-violet-50 dark:bg-violet-900/20"
              : "hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
          }`}
          onClick={() => {
            if (sgHasChildren && isSgSelected) {
              // Already selected parent → toggle expand/collapse
              toggleExpand(sg.id);
            } else {
              onToggleSubgroup(sg.id);
              if (sgHasChildren && !isSgExpanded) {
                // Selecting → expand to show children
                toggleExpand(sg.id);
              }
            }
          }}
        >
          <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${isSgSelected ? "bg-violet-50 dark:bg-violet-900/20" : "bg-white dark:bg-zinc-900"}`}>
            <div className="flex items-center gap-2" style={{ paddingLeft: `${(depth - 1) * 12}px` }}>
              {expandToggle(sgHasChildren, isSgExpanded)}
              <TaxaIcon taxonId={sg.id} size={depth === 1 ? 16 : 14} className="flex-shrink-0" style={{ color: parentColor, opacity: isSgSelected ? 1 : 0.6 }} />
              <span className={`text-sm ${isSgSelected ? "font-medium text-violet-700 dark:text-violet-300" : "text-zinc-700 dark:text-zinc-300"}`}>{sg.name}</span>
              {isLoadingSgSubs && (
                <svg className="animate-spin h-3 w-3 text-zinc-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
          </td>
          {isVisible("described") && (
            <td className={numericTdNoDividerClasses}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums inline-flex items-center gap-1">
                {sgDescribed.toLocaleString()}
                {(() => {
                  const sgNode = findNode(sg.id);
                  if (!sgNode?.estimatedSource) return null;
                  return (
                    <span className="relative group/src">
                      <a
                        href={sgNode.estimatedSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        <FaInfoCircle size={10} />
                      </a>
                      <span className="absolute right-0 top-1/2 -translate-y-1/2 mr-5 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/src:opacity-100 group-hover/src:visible z-50 shadow-lg normal-case max-w-[300px] whitespace-normal text-left">
                        {sgNode.estimatedSource}
                      </span>
                    </span>
                  );
                })()}
              </span>
            </td>
          )}
          {colDescribedCell(sg.colDescribed)}
          {isVisible("assessed") && (
            <td className={flexTdClasses}>
              {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false, sg.totalAssessed)}
            </td>
          )}
          {isVisible("outdated") && (
            <td className={flexTdClasses}>
              {sg.totalAssessed > 0
                ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false, sg.outdated)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("gbifUnassessed") && (
            <td className={flexTdClasses}>
              {sg.gbifNeSpeciesCount > 0 && sgDescribed > 0
                ? renderBar((sg.gbifNeSpeciesCount / sgDescribed) * 100, "#3b82f6", false, sg.gbifNeSpeciesCount)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {colNeCell(sg.colNe, sgDescribed)}
          {isVisible("totalGbifObs") && (
            <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("gbifDistribution") && (
            <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("meanGbifObs") && (
            <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("medianGbifObs") && (
            <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("breakdown") && (
            <td className={flexTdClasses}>
              {renderBreakdownBar(sg.byCategory)}
            </td>
          )}
        </tr>
        {/* Recursively render children if expanded */}
        {isSgExpanded && sgSubs.map((child) => renderSubgroupRow(child, parentColor, depth + 1, topTaxonId))}
      </React.Fragment>
    );
  };

  // Render a taxon row with optional expandable subgroups
  const renderTaxonWithSubgroups = (taxon: TaxonSummary, isSelected: boolean) => {
    const hasSubgroups = isExpandable(taxon.id);
    const isExpanded = expandedTaxa.has(taxon.id);
    const subs = subgroupData[taxon.id] ?? [];
    const isLoadingSubs = loadingSubgroups.has(taxon.id);

    return (
      <React.Fragment key={taxon.id}>
        <tr
          className={`transition-colors ${
            isSelected ? "bg-zinc-100 dark:bg-zinc-800" : ""
          } ${taxon.available ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
          onClick={(e) => {
            if (!taxon.available) return;
            if (e.metaKey || e.ctrlKey) setTaxaExpanded(true);
            onToggleTaxon(taxon.id, e);
            if (hasSubgroups) {
              if (isSelected) {
                // Already selected → toggle expand/collapse
                toggleExpand(taxon.id);
              } else {
                // Selecting → show collapsed table view first (don't auto-expand)
                setExpandedTaxa(new Set());
              }
            } else {
              // Non-expandable taxon selected → collapse all expanded
              setExpandedTaxa(new Set());
            }
          }}
        >
          <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
            <div className="flex items-center gap-2">
              {/* Only show the expand chevron once the taxon is selected — on the landing
                  page a click selects (doesn't expand yet), so a chevron there misleads. */}
              {expandToggle(hasSubgroups && isSelected, isExpanded)}
              <TaxaIcon taxonId={taxon.id} size={22} className="flex-shrink-0" style={{ color: taxon.color }} />
              <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{taxon.name}</span>
              {isLoadingSubs && (
                <svg className="animate-spin h-3 w-3 text-zinc-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
          </td>
          {isVisible("described") && (
            <td className={numericTdNoDividerClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.estimatedDescribed.toLocaleString()}
              </span>
            </td>
          )}
          {colDescribedCell(taxon.available ? taxon.colDescribed : undefined)}
          {isVisible("assessed") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBar(taxon.percentAssessed, getAssessedBarColor(taxon.percentAssessed), false, taxon.totalAssessed)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("outdated") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBar(taxon.percentOutdated, getOutdatedBarColor(taxon.percentOutdated), false, taxon.outdated)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("gbifUnassessed") && (
            <td className={flexTdClasses}>
              {taxon.gbifNeSpeciesCount != null && taxon.estimatedDescribed > 0
                ? renderBar((taxon.gbifNeSpeciesCount / taxon.estimatedDescribed) * 100, "#3b82f6", false, taxon.gbifNeSpeciesCount)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {colNeCell(taxon.available ? taxon.colNe : undefined, taxon.estimatedDescribed)}
          {isVisible("totalGbifObs") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.totalGbifObservations != null ? taxon.totalGbifObservations.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("gbifDistribution") && (
            <td className={flexTdClasses}>
              {taxon.gbifObsDistribution
                ? renderDistributionBar(taxon.gbifObsDistribution)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("meanGbifObs") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.meanGbifObsPerSpecies != null ? taxon.meanGbifObsPerSpecies.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("medianGbifObs") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.medianGbifObsPerSpecies != null ? taxon.medianGbifObsPerSpecies.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("breakdown") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBreakdownBar(taxon.byCategory || {})
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
        </tr>

        {/* Expanded subgroup rows (recursive) */}
        {isExpanded && subs.map((sg) => renderSubgroupRow(sg, taxon.color, 1, taxon.id))}
      </React.Fragment>
    );
  };

  // Table header
  const renderHead = () => (
    <thead>
      <tr className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <th className={`${stickyClasses} bg-zinc-50 dark:bg-zinc-800 ${cellPad} text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap w-0`}>
          <div className="flex items-center gap-1.5">
            Taxon
            <button
              ref={menuButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                if (!showColumnMenu && menuButtonRef.current) {
                  const rect = menuButtonRef.current.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom + 4, left: rect.left });
                }
                setShowColumnMenu((v) => !v);
              }}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title="Toggle columns"
            >
              <HiOutlineAdjustmentsHorizontal size={14} />
            </button>
          </div>
        </th>
        {isVisible("described") && (
          <th className={`${numericThNoDividerClasses}`}>
            <div className="flex items-center justify-end gap-2">
              <span className="inline-flex items-center gap-1">
                # Described Species
                <span className="relative group">
                  <a
                    href={describedSource === "col" ? COL_SOURCE_URL : IUCN_SOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    <FaInfoCircle size={12} />
                  </a>
                  <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible z-50 shadow-lg normal-case">
                    {describedSource === "col"
                      ? "Described species from the Catalogue of Life backbone"
                      : "Estimates from IUCN Red List Table 1a (2025-2)"}
                  </span>
                </span>
              </span>
              {/* IUCN ↔ CoL source toggle: flips the described count + recomputes % Assessed */}
              <span className="inline-flex rounded-md overflow-hidden border border-zinc-300 dark:border-zinc-600 text-[10px] font-semibold normal-case" title="Switch # Described Species between IUCN Table 1a estimates and the Catalogue of Life backbone">
                {(["iucn", "col"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={(e) => { e.stopPropagation(); setDescribedSource(src); }}
                    className={`px-1.5 py-0.5 transition-colors ${
                      describedSource === src
                        ? "bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900"
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {src === "iucn" ? "IUCN" : "CoL"}
                  </button>
                ))}
              </span>
            </div>
          </th>
        )}
        {isVisible("colDescribed") && (
          <th className={numericThClasses}># Described Species (CoL)</th>
        )}
        {isVisible("assessed") && (
          <th className={centeredThClasses}># Red List Assessed</th>
        )}
        {isVisible("outdated") && (
          <th className={centeredThClasses}># Outdated Assessments (10+Y)</th>
        )}
        {isVisible("gbifUnassessed") && (
          <th className={centeredThClasses}># Unassessed, 1+ GBIF Obs</th>
        )}
        {isVisible("colNe") && (
          <th className={centeredThClasses}># Not Evaluated</th>
        )}
        {isVisible("totalGbifObs") && (
          <th className={numericThClasses}>Total Obs</th>
        )}
        {isVisible("gbifDistribution") && (
          <th className={flexThClasses}>Obs Distribution</th>
        )}
        {isVisible("meanGbifObs") && (
          <th className={numericThClasses}>Mean Obs</th>
        )}
        {isVisible("medianGbifObs") && (
          <th className={numericThClasses}>Median Obs</th>
        )}
        {isVisible("breakdown") && (
          <th className={flexThClasses}>
            <span className="uppercase">Risk Category Breakdown</span>
            <div className="flex items-center gap-1.5 mt-1 font-normal normal-case">
              {BAR_CATEGORIES.map((cat) => (
                <span key={cat} className="inline-flex items-center gap-0.5">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ backgroundColor: CATEGORY_COLORS[cat] || "#a3a3a3" }}
                  />
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{cat}</span>
                </span>
              ))}
            </div>
          </th>
        )}
      </tr>
    </thead>
  );

  return (
    <>
    {showColumnMenu && createPortal(
      <div
        ref={menuRef}
        className="fixed bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-[9999] py-1 min-w-[180px]"
        style={{ top: menuPos.top, left: menuPos.left }}
      >
        {!isNewAssessments && (
          <>
            <div className="px-3 pt-2 pb-1.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Focus</div>
            <div className="mx-3 mb-1.5 flex rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-600">
              <button
                onClick={() => switchFocus("redlist")}
                className={`flex-1 text-xs py-1 font-medium transition-colors ${focusMode === "redlist" ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}
              >
                Red List
              </button>
              <button
                onClick={() => switchFocus("gbif")}
                className={`flex-1 text-xs py-1 font-medium transition-colors ${focusMode === "gbif" ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}
              >
                GBIF
              </button>
            </div>
            <div className="border-t border-zinc-100 dark:border-zinc-700" />
          </>
        )}
        <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Columns</div>
        {(Object.keys(COLUMN_LABELS) as ColumnId[]).map((col) => (
          <label
            key={col}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={isVisible(col)}
              onChange={() => toggleColumn(col)}
              className="rounded border-zinc-300 dark:border-zinc-600 text-green-600 focus:ring-green-500"
            />
            {COLUMN_LABELS[col]}
          </label>
        ))}
      </div>,
      document.body
    )}
    <div ref={scrollRef} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
      <table className="w-full">
        {renderHead()}
        <tbody>
          {table1aMode ? (
            /* Table 1a view: sections with headers, individual rows, subtotals */
            table1aLoading ? (
              <tr>
                <td colSpan={visibleColCount} className={`${cellPad} text-center text-sm text-zinc-400`}>
                  <div className="flex items-center justify-center gap-2 py-4">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading Table 1a data…
                  </div>
                </td>
              </tr>
            ) : table1aData ? (
              <>
                {table1aData.map((section, si) => {
                  // Apply the IUCN/CoL described-source toggle to every row first, so the
                  // per-row cells and the subtotals below all use the effective described.
                  const rows = section.rows.map(applySource);
                  // Compute section subtotals
                  const subDescribed = rows.reduce((s, r) => s + r.estimatedDescribed, 0);
                  const subAssessed = rows.reduce((s, r) => s + r.totalAssessed, 0);
                  const subOutdated = rows.reduce((s, r) => s + r.outdated, 0);
                  const subPctAssessed = subDescribed > 0 ? (subAssessed / subDescribed) * 100 : 0;
                  const subPctOutdated = subAssessed > 0 ? (subOutdated / subAssessed) * 100 : 0;
                  const subByCategory: Record<string, number> = {};
                  for (const r of rows) {
                    for (const [cat, count] of Object.entries(r.byCategory || {})) {
                      subByCategory[cat] = (subByCategory[cat] || 0) + count;
                    }
                  }
                  const subGbifSpecies = rows.reduce((s, r) => s + (r.gbifSpeciesCount ?? 0), 0);
                  const subGbifNe = rows.reduce((s, r) => s + (r.gbifNeSpeciesCount ?? 0), 0);
                  const subColDescribed = rows.reduce((s, r) => s + (r.colDescribed ?? 0), 0);
                  const subColNe = rows.reduce((s, r) => s + (r.colNe ?? 0), 0);
                  const subGbifObs = rows.reduce((s, r) => s + (r.totalGbifObservations ?? 0), 0);
                  const subMeanGbif = subGbifSpecies > 0 ? Math.round(subGbifObs / subGbifSpecies) : undefined;

                  return (
                    <React.Fragment key={section.title}>
                      {/* Section header */}
                      <tr className="bg-zinc-100 dark:bg-zinc-800/80">
                        <td
                          colSpan={visibleColCount}
                          className={`${stickyClasses} bg-zinc-100 dark:bg-zinc-800/80 ${cellPad}`}
                        >
                          <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
                            {section.title}
                          </span>
                        </td>
                      </tr>
                      {/* Section rows */}
                      {rows.map((row) => (
                        <tr
                          key={row.group}
                          className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                          onClick={(e) => {
                            setTable1aMode(false);
                            const defaultRoots = new Set(TAXONOMY_VIEWS.default.roots);
                            if (defaultRoots.has(row.group)) {
                              // Direct view root (e.g. mammals, birds) — select it
                              onToggleTaxon(row.group, e);
                            } else if (onNavigateToSubgroup) {
                              // Table 1a group under a virtual root (e.g. molluscs → invertebrates).
                              // row.group is a tree node id. Aggregating parent rows (e.g. "insecta",
                              // which spans 8 order CSV groups) match a child by node id; single-group
                              // rows match by CSV group.
                              const stripPrefix = (id: string) => id.replace(/^(inv-|pl-|fu-)/, "");
                              for (const rootId of defaultRoots) {
                                const rootNode = findNode(rootId);
                                const matchingChild =
                                  rootNode?.children?.find(c => stripPrefix(c.id) === row.group)
                                  ?? rootNode?.children?.find(c =>
                                    c.filter.csvGroups.length === 1 && c.filter.csvGroups[0] === row.group
                                  )
                                  ?? rootNode?.children?.find(c =>
                                    c.filter.csvGroups.includes(row.group)
                                  );
                                if (matchingChild) {
                                  onNavigateToSubgroup(rootId, matchingChild.id);
                                  break;
                                }
                              }
                            }
                          }}
                        >
                          <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-white dark:bg-zinc-900`}>
                            <span className="text-sm md:text-base text-zinc-900 dark:text-zinc-100 pl-4">
                              {row.name}
                            </span>
                          </td>
                          {isVisible("described") && (
                            <td className={numericTdNoDividerClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                                {row.estimatedDescribed.toLocaleString()}
                              </span>
                            </td>
                          )}
                          {colDescribedCell(row.colDescribed)}
                          {isVisible("assessed") && (
                            <td className={flexTdClasses}>
                              {renderBar(row.percentAssessed, getAssessedBarColor(row.percentAssessed), false, row.totalAssessed)}
                            </td>
                          )}
                          {isVisible("outdated") && (
                            <td className={flexTdClasses}>
                              {row.totalAssessed > 0
                                ? renderBar(row.percentOutdated, getOutdatedBarColor(row.percentOutdated), false, row.outdated)
                                : <span className="text-sm text-zinc-400">—</span>}
                            </td>
                          )}
                          {isVisible("gbifUnassessed") && (
                            <td className={flexTdClasses}>
                              {row.gbifNeSpeciesCount != null && row.estimatedDescribed > 0
                                ? renderBar((row.gbifNeSpeciesCount / row.estimatedDescribed) * 100, "#3b82f6", false, row.gbifNeSpeciesCount)
                                : <span className="text-sm text-zinc-400">—</span>}
                            </td>
                          )}
                          {colNeCell(row.colNe, row.estimatedDescribed)}
                          {isVisible("totalGbifObs") && (
                            <td className={numericTdClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                                {row.totalGbifObservations != null ? row.totalGbifObservations.toLocaleString() : "—"}
                              </span>
                            </td>
                          )}
                          {isVisible("gbifDistribution") && (
                            <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
                          )}
                          {isVisible("meanGbifObs") && (
                            <td className={numericTdClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                                {row.meanGbifObsPerSpecies != null ? Math.round(row.meanGbifObsPerSpecies).toLocaleString() : "—"}
                              </span>
                            </td>
                          )}
                          {isVisible("medianGbifObs") && (
                            <td className={numericTdClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                                {row.medianGbifObsPerSpecies != null ? row.medianGbifObsPerSpecies.toLocaleString() : "—"}
                              </span>
                            </td>
                          )}
                          {isVisible("breakdown") && (
                            <td className={flexTdClasses}>
                              {renderBreakdownBar(row.byCategory || {})}
                            </td>
                          )}
                        </tr>
                      ))}
                      {/* Subtotal row */}
                      <tr className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
                        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-zinc-50/50 dark:bg-zinc-800/30`}>
                          <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 pl-6">Subtotal</span>
                        </td>
                        {isVisible("described") && (
                          <td className={numericTdNoDividerClasses}>
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{subDescribed.toLocaleString()}</span>
                          </td>
                        )}
                        {colDescribedCell(subColDescribed, true)}
                        {isVisible("assessed") && (
                          <td className={flexTdClasses}>
                            {renderBar(subPctAssessed, getAssessedBarColor(subPctAssessed), false, subAssessed, "font-semibold")}
                          </td>
                        )}
                        {isVisible("outdated") && (
                          <td className={flexTdClasses}>
                            {subAssessed > 0 ? renderBar(subPctOutdated, getOutdatedBarColor(subPctOutdated), false, subOutdated, "font-semibold") : <span className="text-sm text-zinc-400">—</span>}
                          </td>
                        )}
                        {isVisible("gbifUnassessed") && (
                          <td className={flexTdClasses}>
                            {subGbifNe > 0 && subDescribed > 0
                              ? renderBar((subGbifNe / subDescribed) * 100, "#3b82f6", false, subGbifNe, "font-semibold")
                              : <span className="text-sm text-zinc-400">—</span>}
                          </td>
                        )}
                        {colNeCell(subColNe, subDescribed, { bold: true })}
                        {isVisible("totalGbifObs") && (
                          <td className={numericTdClasses}>
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{subGbifObs.toLocaleString()}</span>
                          </td>
                        )}
                        {isVisible("gbifDistribution") && <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>}
                        {isVisible("meanGbifObs") && (
                          <td className={numericTdClasses}>
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{subMeanGbif != null ? subMeanGbif.toLocaleString() : "—"}</span>
                          </td>
                        )}
                        {isVisible("medianGbifObs") && <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>}
                        {isVisible("breakdown") && (
                          <td className={flexTdClasses}>{renderBreakdownBar(subByCategory)}</td>
                        )}
                      </tr>
                      {/* Gap between sections */}
                      {si < table1aData.length - 1 && (
                        <tr><td colSpan={visibleColCount} className="p-0"><div className="h-1" /></td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {/* Grand TOTAL row */}
                {renderRow(
                  "total",
                  "TOTAL",
                  "#22c55e",
                  totalDescribed,
                  totalAssessed,
                  totalPercentAssessed,
                  totalOutdated,
                  totalPercentOutdated,
                  totalByCategory,
                  false,
                  true,
                  true,
                  { total: totalGbifObs, mean: totalMeanGbifObs, speciesCount: totalGbifSpecies, gbifNeCount: totalGbifNeSpecies, colDescribed: totalColDescribed, colNe: totalColNe }
                )}
              </>
            ) : null
          ) : (
            <>
              {/* All Species totals row (always visible) */}
              {renderRow(
                "all",
                "All Species",
                "#22c55e",
                totalDescribed,
                totalAssessed,
                totalPercentAssessed,
                totalOutdated,
                totalPercentOutdated,
                totalByCategory,
                false,
                true,
                true,
                { total: totalGbifObs, mean: totalMeanGbifObs, speciesCount: totalGbifSpecies, gbifNeCount: totalGbifNeSpecies, colDescribed: totalColDescribed, colNe: totalColNe }
              )}

              {/* Separator - hide when only "All Species" is selected */}
              {!selectedTaxa.has("all") && (
                <tr>
                  <td colSpan={visibleColCount} className="p-0">
                    <div className="border-b-2 border-zinc-200 dark:border-zinc-700" />
                  </td>
                </tr>
              )}

              {/* Per-taxon rows with expandable subgroups */}
              {selectedTaxa.has("all")
                ? null
                : selectedSubgroups.size > 0 && selectedTaxa.size > 0 && !taxaExpanded
                  ? /* When subgroups are selected, show ancestor breadcrumbs + selected subgroup */
                    (() => {
                      const rows: React.ReactNode[] = [];
                      for (const sgId of selectedSubgroups) {
                        const parentTaxon = perTaxa.find(t => selectedTaxa.has(t.id));
                        if (!parentTaxon) continue;

                        // Render ancestor context rows (view root → intermediate ancestors)
                        // getAncestors returns [immediate parent, ..., root] so we reverse and
                        // skip ancestors at or above the view root (which is in selectedTaxa)
                        const ancestors = getAncestors(sgId);
                        const intermediateAncestorIds: string[] = [];
                        for (const aId of ancestors) {
                          if (selectedTaxa.has(aId)) break; // Stop at view root
                          intermediateAncestorIds.push(aId);
                        }

                        // View root data from perTaxa
                        const viewRootSummary: SubGroupSummary = {
                          id: parentTaxon.id, name: parentTaxon.name,
                          estimatedDescribed: parentTaxon.estimatedDescribed,
                          totalAssessed: parentTaxon.totalAssessed, outdated: parentTaxon.outdated,
                          gbifNeSpeciesCount: parentTaxon.gbifNeSpeciesCount ?? 0,
                          byCategory: parentTaxon.byCategory,
                          colDescribed: parentTaxon.colDescribed, colNe: parentTaxon.colNe,
                        };
                        rows.push(renderAncestorRow(viewRootSummary, parentTaxon.color, 0, parentTaxon.id, true));

                        // Intermediate ancestors from subgroupData
                        intermediateAncestorIds.reverse().forEach((aId, i) => {
                          let ancestorData: SubGroupSummary | undefined;
                          for (const subs of Object.values(subgroupData)) {
                            ancestorData = subs.find(s => s.id === aId);
                            if (ancestorData) break;
                          }
                          if (!ancestorData) {
                            const node = findNode(aId);
                            if (!node) return;
                            ancestorData = { id: node.id, name: node.name, estimatedDescribed: node.estimatedDescribed ?? 0,
                                             totalAssessed: 0, outdated: 0, gbifNeSpeciesCount: 0, byCategory: {} };
                          }
                          rows.push(renderAncestorRow(ancestorData, parentTaxon.color, i + 1, parentTaxon.id, false));
                        });

                        // Search ALL fetched subgroup data for this node (any depth)
                        let sgData: SubGroupSummary | undefined;
                        for (const subs of Object.values(subgroupData)) {
                          sgData = subs.find(s => s.id === sgId);
                          if (sgData) break;
                        }
                        // Fallback: construct from taxonomy node while data loads
                        if (!sgData) {
                          const node = findNode(sgId);
                          if (!node) continue;
                          sgData = { id: node.id, name: node.name, estimatedDescribed: node.estimatedDescribed ?? 0,
                                     totalAssessed: 0, outdated: 0, gbifNeSpeciesCount: 0, byCategory: {} };
                        }

                        rows.push(renderCollapsedSubgroupRow(parentTaxon, sgData));
                        // Render children if expanded
                        const sgChildren = subgroupData[sgId] ?? [];
                        if (expandedTaxa.has(sgId)) {
                          rows.push(...sgChildren.map(child =>
                            renderSubgroupRow(child, parentTaxon.color, 1, parentTaxon.id)));
                        }
                      }
                      return rows;
                    })()
                  : (selectedTaxa.size > 0 && !taxaExpanded
                    ? perTaxa
                        .filter((taxon) => selectedTaxa.has(taxon.id))
                        .map((taxon) => renderTaxonWithSubgroups(taxon, true))
                    : perTaxa.map((taxon) =>
                        renderTaxonWithSubgroups(taxon, selectedTaxa.has(taxon.id))
                      )
                  )
              }
            </>
          )}
        </tbody>
      </table>
    </div>
    {/* Subtle expand/table controls */}
    {!loading && perTaxa.length > 0 && selectedTaxa.size === 0 && (
      <div className="flex items-center justify-end gap-3 mt-1.5">
        {table1aMode ? (
          <button
            onClick={exitTable1a}
            className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            Exit Table 1a mode
          </button>
        ) : (
          <>
            <button
              onClick={allExpanded ? collapseAll : expandAll}
              className="inline-flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {allExpanded ? <FaCompressAlt size={9} /> : <FaExpandAlt size={9} />}
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
            <span className="text-zinc-300 dark:text-zinc-700">|</span>
            <span className="inline-flex items-center gap-1">
              <button
                onClick={enterTable1a}
                className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                Table 1a mode
              </button>
              <span className="relative group/t1a">
                <a
                  href={IUCN_SOURCE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FaInfoCircle size={10} />
                </a>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/t1a:opacity-100 group-hover/t1a:visible z-50 shadow-lg pointer-events-none">
                  View IUCN Red List Table 1a (PDF)
                </span>
              </span>
            </span>
          </>
        )}
      </div>
    )}
    </>
  );
}
