"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaInfoCircle, FaChevronRight, FaChevronDown } from "react-icons/fa";
import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import TaxaIcon from "@/components/TaxaIcon";
import { CATEGORY_COLORS, CATEGORY_NAMES, CATEGORY_ORDER } from "@/config/taxa";
import { TAXA_SUBGROUPS, getSubgroupDef } from "@/config/taxa-hierarchy";

const IUCN_SOURCE_URL = "https://nc.iucnredlist.org/redlist/content/attachment_files/2025-2_RL_Table1a.pdf";

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
  gbifObsDistribution?: Record<string, number>;
}

interface SubGroupSummary {
  id: string;
  name: string;
  estimatedDescribed: number;
  totalAssessed: number;
  outdated: number;
  byCategory: Record<string, number>;
}

interface Props {
  onToggleTaxon: (taxonId: string, event: React.MouseEvent) => void;
  selectedTaxa: Set<string>;
  selectedSubgroups: Set<string>;
  onToggleSubgroup: (subgroupId: string, parentTaxonId: string) => void;
  disableAllSpecies?: boolean;
}

// Taxa IDs that have expandable subgroups
const EXPANDABLE_TAXA = new Set(Object.keys(TAXA_SUBGROUPS));

// Bar color helpers
const getAssessedBarColor = (percent: number) =>
  percent >= 50 ? "#22c55e" : percent >= 20 ? "#eab308" : "#ef4444";

const getOutdatedBarColor = (percent: number) =>
  percent < 10 ? "#22c55e" : percent < 50 ? "#eab308" : "#ef4444";

// Sticky cell classes for the pinned taxon column
const stickyClasses = "sticky left-0 z-10";
// Compact cell classes for tighter table spacing
const cellPad = "px-3 md:px-4 py-2 md:py-2.5";
const numericTdClasses = `${cellPad} text-right whitespace-nowrap w-0`;
const numericThClasses = `${cellPad} text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap w-0`;
const flexTdClasses = `${cellPad} whitespace-nowrap w-0`;
const flexThClasses = `${cellPad} text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap w-0`;

// Toggleable column IDs (Taxon is always visible)
type ColumnId = "described" | "assessed" | "pctAssessed" | "outdated" | "pctOutdated" | "breakdown" | "gbifSpecies" | "totalGbifObs" | "meanGbifObs" | "medianGbifObs" | "gbifDistribution";

const COLUMN_LABELS: Record<ColumnId, string> = {
  described: "Est. # Described",
  assessed: "# Assessed",
  pctAssessed: "% Assessed",
  outdated: "# Outdated (10+Y)",
  pctOutdated: "% Outdated",
  breakdown: "Risk Category Breakdown",
  gbifSpecies: "# on GBIF",
  totalGbifObs: "Total Obs",
  meanGbifObs: "Mean Obs",
  medianGbifObs: "Median Obs",
  gbifDistribution: "Obs Distribution",
};

const DISTRIBUTION_BIN_LABELS = ["1", "2–10", "11–100", "101–1K", "1K–10K", "10K–100K", "100K–1M", ">1M"];

type FocusMode = "redlist" | "gbif";

const FOCUS_HIDDEN: Record<FocusMode, Set<ColumnId>> = {
  redlist: new Set(["gbifSpecies", "totalGbifObs", "meanGbifObs", "medianGbifObs", "gbifDistribution", "breakdown"]),
  gbif: new Set(["pctAssessed", "outdated", "pctOutdated", "breakdown"]),
};

const DEFAULT_HIDDEN_COLUMNS = FOCUS_HIDDEN.redlist;

function DisabledAllTooltip() {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (hovered && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
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
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
        >
          Unassessed species must be loaded per taxon group (loading all species at once requires too much data/memory)
        </div>,
        document.body
      )}
    </span>
  );
}

export default function TaxaSummary({ onToggleTaxon, selectedTaxa, selectedSubgroups, onToggleSubgroup, disableAllSpecies }: Props) {
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [globalGbifMedian, setGlobalGbifMedian] = useState<number | undefined>();
  const [globalGbifDistribution, setGlobalGbifDistribution] = useState<Record<string, number> | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks whether the taxa table is expanded for multi-select.
  // Set to true only when the user Cmd/Ctrl+clicks a taxon row;
  // cleared when the modifier key is released.
  const [taxaExpanded, setTaxaExpanded] = useState(false);
  // Which taxa are expanded to show subgroups (e.g., "reptilia", "fishes")
  const [expandedTaxa, setExpandedTaxa] = useState<Set<string>>(new Set());
  // Fetched subgroup data keyed by taxonId
  const [subgroupData, setSubgroupData] = useState<Record<string, SubGroupSummary[]>>({});
  const [loadingSubgroups, setLoadingSubgroups] = useState<Set<string>>(new Set());
  const [focusMode, setFocusMode] = useState<FocusMode>("redlist");
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(new Set(DEFAULT_HIDDEN_COLUMNS));
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

  // Auto-scroll to show Assessed column on mobile (skip past Est. Described)
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

    // Fetch subgroup data if not already loaded
    if (!subgroupData[taxonId] && !loadingSubgroups.has(taxonId)) {
      setLoadingSubgroups((prev) => new Set(prev).add(taxonId));
      try {
        const res = await fetch(`/api/redlist/taxa-subgroups?taxonId=${taxonId}`);
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
  }, [subgroupData, loadingSubgroups]);

  // Auto-expand parent taxa when subgroups are selected (e.g. from URL)
  useEffect(() => {
    if (selectedSubgroups.size === 0) return;
    const parentsToExpand = new Set<string>();
    for (const sgId of selectedSubgroups) {
      const info = getSubgroupDef(sgId);
      if (info && !expandedTaxa.has(info.taxonId)) {
        parentsToExpand.add(info.taxonId);
      }
    }
    for (const taxonId of parentsToExpand) {
      toggleExpand(taxonId);
    }
  }, [selectedSubgroups]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchTaxa() {
      try {
        const res = await fetch("/api/redlist/taxa-summary");
        if (!res.ok) throw new Error("Failed to load taxa");
        const data = await res.json();
        setTaxa(data.taxa);
        setGlobalGbifMedian(data.globalGbifMedian);
        setGlobalGbifDistribution(data.globalGbifDistribution);
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
          <td className={numericTdClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("assessed") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-14 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("pctAssessed") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-2 min-w-[80px] md:min-w-[100px]">
              <div className="flex-1 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-700 rounded" />
            </div>
          </td>
        )}
        {isVisible("outdated") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("pctOutdated") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-2 min-w-[80px] md:min-w-[100px]">
              <div className="flex-1 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-700 rounded" />
            </div>
          </td>
        )}
        {isVisible("gbifSpecies") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-14 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}>
            <div className="h-5 w-28 bg-zinc-200 dark:bg-zinc-700 rounded" />
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
            <div className="h-3 w-32 md:w-40 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
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
              {isVisible("described") && <th className={numericThClasses}>Est. # Described</th>}
              {isVisible("assessed") && <th className={numericThClasses}># Assessed</th>}
              {isVisible("pctAssessed") && <th className={flexThClasses}>% Assessed</th>}
              {isVisible("outdated") && <th className={numericThClasses}># Outdated (10+Y)</th>}
              {isVisible("pctOutdated") && <th className={flexThClasses}>% Outdated</th>}
              {isVisible("gbifSpecies") && <th className={numericThClasses}># on GBIF</th>}
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

  // Separate "all" row from per-taxon rows
  const allTaxon = taxa.find((t) => t.id === "all");
  const perTaxa = taxa.filter((t) => t.id !== "all");

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
  const totalMeanGbifObs = totalGbifSpecies > 0 ? Math.round(totalGbifObs / totalGbifSpecies) : 0;


  // Column order: Taxon (sticky) | Est. Described | Assessed | % Assessed | Outdated | % Outdated | Category Breakdown

  // Render a percentage bar
  const renderBar = (percent: number, barColor: string, isAll: boolean) => {
    const clampedPercent = Math.min(100, Math.max(0, percent));
    const fillColor = isAll ? "rgba(255,255,255,0.25)" : barColor;
    return (
      <div className="flex items-center gap-2 min-w-[160px] md:min-w-[220px]">
        <div className="flex-1 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${clampedPercent}%`, backgroundColor: fillColor }}
          />
        </div>
        <span className="text-sm md:text-base font-medium tabular-nums text-zinc-700 dark:text-zinc-300 w-[52px] text-right">
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
        <div className="flex h-3 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700">
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
    gbifObs?: { total?: number; mean?: number; median?: number; speciesCount?: number; distribution?: Record<string, number> }
  ) => {
    const isAllSelected = isAllRow && selectedTaxa.has("all");
    const rowBg = isAllRow
      ? isAllSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-zinc-50/80 dark:bg-zinc-800/60"
      : isSelected
        ? "bg-zinc-100 dark:bg-zinc-800"
        : "";
    const allDisabled = isAllRow && disableAllSpecies;
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
            <TaxaIcon taxonId={id} size={22} className="flex-shrink-0" style={{ color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{name}</span>
            {allDisabled && <DisabledAllTooltip />}
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {estimatedDescribed.toLocaleString()}
            </span>
          </td>
        )}
        {isVisible("assessed") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {available ? assessed.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("pctAssessed") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBar(percentAssessed, getAssessedBarColor(percentAssessed), isAllRow)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {available ? outdated.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("pctOutdated") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBar(percentOutdated, getOutdatedBarColor(percentOutdated), isAllRow)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("gbifSpecies") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {gbifObs?.speciesCount != null ? gbifObs.speciesCount.toLocaleString() : "—"}
            </span>
          </td>
        )}
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

  // Render a standalone subgroup row (used when table is collapsed to a selected subgroup)
  const renderCollapsedSubgroupRow = (taxon: TaxonSummary, sg: SubGroupSummary) => {
    const sgPctAssessed = sg.estimatedDescribed > 0 ? (sg.totalAssessed / sg.estimatedDescribed) * 100 : 0;
    const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
    return (
      <tr
        key={`collapsed-${sg.id}`}
        className="transition-colors cursor-pointer bg-zinc-100 dark:bg-zinc-800"
        onClick={() => {
          onToggleSubgroup(sg.id, taxon.id);
        }}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-zinc-100 dark:bg-zinc-800`}>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: taxon.color }}
            />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{sg.name}</span>
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums inline-flex items-center gap-1">
              {sg.estimatedDescribed.toLocaleString()}
              {(() => {
                const sgDefs = TAXA_SUBGROUPS[taxon.id];
                const sgDef = sgDefs?.find(d => d.id === sg.id);
                if (!sgDef?.source) return null;
                return (
                  <span className="relative group/src">
                    <a
                      href={sgDef.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      <FaInfoCircle size={10} />
                    </a>
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 mr-5 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/src:opacity-100 group-hover/src:visible z-50 shadow-lg normal-case max-w-[300px] whitespace-normal text-left">
                      {sgDef.source}
                    </span>
                  </span>
                );
              })()}
            </span>
          </td>
        )}
        {isVisible("assessed") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {sg.totalAssessed.toLocaleString()}
            </span>
          </td>
        )}
        {isVisible("pctAssessed") && (
          <td className={flexTdClasses}>
            {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false)}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {sg.outdated.toLocaleString()}
            </span>
          </td>
        )}
        {isVisible("pctOutdated") && (
          <td className={flexTdClasses}>
            {sg.totalAssessed > 0
              ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {isVisible("gbifSpecies") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
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

  // Render a taxon row with optional expandable subgroups
  const renderTaxonWithSubgroups = (taxon: TaxonSummary, isSelected: boolean) => {
    const hasSubgroups = EXPANDABLE_TAXA.has(taxon.id);
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
          }}
        >
          <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
            <div className="flex items-center gap-2">
              <TaxaIcon taxonId={taxon.id} size={22} className="flex-shrink-0" style={{ color: taxon.color }} />
              <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{taxon.name}</span>
              {hasSubgroups && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(taxon.id);
                  }}
                  className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  title={isExpanded ? "Collapse subgroups" : "Expand subgroups"}
                >
                  {isLoadingSubs ? (
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : isExpanded ? (
                    <FaChevronDown size={10} />
                  ) : (
                    <FaChevronRight size={10} />
                  )}
                </button>
              )}
            </div>
          </td>
          {isVisible("described") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.estimatedDescribed.toLocaleString()}
              </span>
            </td>
          )}
          {isVisible("assessed") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.available ? taxon.totalAssessed.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("pctAssessed") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBar(taxon.percentAssessed, getAssessedBarColor(taxon.percentAssessed), false)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("outdated") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.available ? taxon.outdated.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("pctOutdated") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBar(taxon.percentOutdated, getOutdatedBarColor(taxon.percentOutdated), false)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("gbifSpecies") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.gbifSpeciesCount != null ? taxon.gbifSpeciesCount.toLocaleString() : "—"}
              </span>
            </td>
          )}
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

        {/* Expanded subgroup rows */}
        {isExpanded && subs.map((sg) => {
          const sgPctAssessed = sg.estimatedDescribed > 0 ? (sg.totalAssessed / sg.estimatedDescribed) * 100 : 0;
          const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
          const isSgSelected = selectedSubgroups.has(sg.id);
          return (
            <tr
              key={`${taxon.id}-${sg.id}`}
              className={`transition-colors cursor-pointer ${
                isSgSelected
                  ? "bg-violet-50 dark:bg-violet-900/20"
                  : "hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
              }`}
              onClick={() => {
                onToggleSubgroup(sg.id, taxon.id);
              }}
            >
              <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${isSgSelected ? "bg-violet-50 dark:bg-violet-900/20" : "bg-white dark:bg-zinc-900"}`}>
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: taxon.color, opacity: isSgSelected ? 1 : 0.6 }}
                  />
                  <span className={`text-sm ${isSgSelected ? "font-medium text-violet-700 dark:text-violet-300" : "text-zinc-700 dark:text-zinc-300"}`}>{sg.name}</span>
                </div>
              </td>
              {isVisible("described") && (
                <td className={numericTdClasses}>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums inline-flex items-center gap-1">
                    {sg.estimatedDescribed.toLocaleString()}
                    {(() => {
                      const sgDefs = TAXA_SUBGROUPS[taxon.id];
                      const sgDef = sgDefs?.find(d => d.id === sg.id);
                      if (!sgDef?.source) return null;
                      return (
                        <span className="relative group/src">
                          <a
                            href={sgDef.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          >
                            <FaInfoCircle size={10} />
                          </a>
                          <span className="absolute right-0 top-1/2 -translate-y-1/2 mr-5 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/src:opacity-100 group-hover/src:visible z-50 shadow-lg normal-case max-w-[300px] whitespace-normal text-left">
                            {sgDef.source}
                          </span>
                        </span>
                      );
                    })()}
                  </span>
                </td>
              )}
              {isVisible("assessed") && (
                <td className={numericTdClasses}>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {sg.totalAssessed.toLocaleString()}
                  </span>
                </td>
              )}
              {isVisible("pctAssessed") && (
                <td className={flexTdClasses}>
                  {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false)}
                </td>
              )}
              {isVisible("outdated") && (
                <td className={numericTdClasses}>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {sg.outdated.toLocaleString()}
                  </span>
                </td>
              )}
              {isVisible("pctOutdated") && (
                <td className={flexTdClasses}>
                  {sg.totalAssessed > 0
                    ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false)
                    : <span className="text-sm text-zinc-400">—</span>}
                </td>
              )}
              {isVisible("gbifSpecies") && (
                <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
              )}
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
        })}
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
          <th className={`${numericThClasses}`}>
            <span className="inline-flex items-center gap-1">
              Est. # Described
              <span className="relative group">
                <a
                  href={IUCN_SOURCE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <FaInfoCircle size={12} />
                </a>
                <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible z-50 shadow-lg normal-case">
                  Source: IUCN Red List Table 1a (2025-2)
                </span>
              </span>
            </span>
          </th>
        )}
        {isVisible("assessed") && (
          <th className={numericThClasses}># Assessed</th>
        )}
        {isVisible("pctAssessed") && (
          <th className={flexThClasses}>% Assessed</th>
        )}
        {isVisible("outdated") && (
          <th className={numericThClasses}># Outdated (10+Y)</th>
        )}
        {isVisible("pctOutdated") && (
          <th className={flexThClasses}>% Outdated</th>
        )}
        {isVisible("gbifSpecies") && (
          <th className={numericThClasses}># on GBIF</th>
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
            { total: totalGbifObs, mean: totalMeanGbifObs, median: globalGbifMedian, speciesCount: totalGbifSpecies, distribution: globalGbifDistribution }
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
              ? /* When subgroups are selected, collapse to show only those subgroup rows */
                perTaxa
                  .filter((taxon) => selectedTaxa.has(taxon.id))
                  .flatMap((taxon) => {
                    const subs = subgroupData[taxon.id] ?? [];
                    return subs
                      .filter((sg) => selectedSubgroups.has(sg.id))
                      .map((sg) => renderCollapsedSubgroupRow(taxon, sg));
                  })
              : (selectedTaxa.size > 0 && !taxaExpanded
                ? perTaxa
                    .filter((taxon) => selectedTaxa.has(taxon.id))
                    .map((taxon) => renderTaxonWithSubgroups(taxon, true))
                : perTaxa.map((taxon) =>
                    renderTaxonWithSubgroups(taxon, selectedTaxa.has(taxon.id))
                  )
              )
          }
        </tbody>
      </table>
    </div>
    </>
  );
}
