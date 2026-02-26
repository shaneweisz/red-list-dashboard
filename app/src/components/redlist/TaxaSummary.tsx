"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaInfoCircle } from "react-icons/fa";
import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import TaxaIcon from "@/components/TaxaIcon";
import { CATEGORY_COLORS, CATEGORY_NAMES, CATEGORY_ORDER } from "@/config/taxa";

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

interface Props {
  onToggleTaxon: (taxonId: string, event: React.MouseEvent) => void;
  selectedTaxa: Set<string>;
}

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
  gbif: new Set(["assessed", "pctAssessed", "outdated", "pctOutdated", "breakdown"]),
};

const DEFAULT_HIDDEN_COLUMNS: Set<ColumnId> = FOCUS_HIDDEN.redlist;

export default function TaxaSummary({ onToggleTaxon, selectedTaxa }: Props) {
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [globalGbifMedian, setGlobalGbifMedian] = useState<number | undefined>();
  const [globalGbifDistribution, setGlobalGbifDistribution] = useState<Record<string, number> | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [modifierHeld, setModifierHeld] = useState(false);
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

  // Track Cmd/Ctrl key state for delayed collapse
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) setModifierHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) setModifierHeld(false);
    };
    const onBlur = () => setModifierHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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

  useEffect(() => {
    async function fetchTaxa() {
      try {
        const res = await fetch("/api/redlist/taxa");
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

  // Calculate totals
  const totalAssessed = taxa.reduce((sum, t) => sum + t.totalAssessed, 0);
  const totalOutdated = taxa.reduce((sum, t) => sum + t.outdated, 0);
  const totalDescribed = taxa.reduce((sum, t) => sum + t.estimatedDescribed, 0);
  const totalPercentAssessed = (totalAssessed / totalDescribed) * 100;
  const totalPercentOutdated = (totalOutdated / totalAssessed) * 100;
  const totalByCategory: Record<string, number> = {};
  for (const t of taxa) {
    for (const [cat, count] of Object.entries(t.byCategory || {})) {
      totalByCategory[cat] = (totalByCategory[cat] || 0) + count;
    }
  }
  const totalGbifObs = taxa.reduce((sum, t) => sum + (t.totalGbifObservations || 0), 0);
  const totalGbifSpecies = taxa.reduce((sum, t) => sum + (t.gbifSpeciesCount || 0), 0);
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
    const rowBg = isAllRow
      ? "bg-zinc-50/80 dark:bg-zinc-800/60"
      : isSelected
        ? "bg-zinc-100 dark:bg-zinc-800"
        : "";
    const hoverClass = isAllRow
      ? ""
      : available
        ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
        : "opacity-50 cursor-not-allowed";

    const stickyBg = isAllRow
      ? "bg-zinc-50 dark:bg-zinc-800/60"
      : isSelected
        ? "bg-zinc-100 dark:bg-zinc-800"
        : "bg-white dark:bg-zinc-900";

    return (
      <tr
        key={id}
        onClick={(e) => {
          if (isAllRow || !available) return;
          onToggleTaxon(id, e);
        }}
        className={`transition-colors ${rowBg} ${hoverClass}`}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${stickyBg}`}>
          <div className="flex items-center gap-2">
            <TaxaIcon taxonId={id} size={22} className="flex-shrink-0" style={{ color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{name}</span>
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
        <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">View</div>
        {(["redlist", "gbif"] as FocusMode[]).map((mode) => (
          <label
            key={mode}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer"
          >
            <input
              type="radio"
              name="focusMode"
              checked={focusMode === mode}
              onChange={() => switchFocus(mode)}
              className="border-zinc-300 dark:border-zinc-600 text-green-600 focus:ring-green-500"
            />
            {mode === "redlist" ? "Red List" : "GBIF"}
          </label>
        ))}
        <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
        <div className="px-3 pt-1 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Columns</div>
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
    <div>
      <div className="flex items-center justify-end gap-1.5 mb-1">
        <span className="text-[11px] text-zinc-400">Change Focus:</span>
        <div className="flex items-center bg-zinc-200/70 dark:bg-zinc-700 rounded-md p-0.5 text-[11px]">
          <button
            onClick={() => switchFocus("redlist")}
            className={`px-2 py-0.5 rounded transition-colors ${focusMode === "redlist" ? "bg-white dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
          >
            Red List
          </button>
          <button
            onClick={() => switchFocus("gbif")}
            className={`px-2 py-0.5 rounded transition-colors ${focusMode === "gbif" ? "bg-white dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
          >
            GBIF
          </button>
        </div>
      </div>
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

          {/* Separator */}
          <tr>
            <td colSpan={visibleColCount} className="p-0">
              <div className="border-b-2 border-zinc-200 dark:border-zinc-700" />
            </td>
          </tr>

          {/* Collapse to selected rows only when taxa selected and modifier key not held */}
          {(selectedTaxa.size > 0 && !modifierHeld)
            ? taxa
                .filter((taxon) => selectedTaxa.has(taxon.id))
                .map((taxon) =>
                  renderRow(
                    taxon.id,
                    taxon.name,
                    taxon.color,
                    taxon.estimatedDescribed,
                    taxon.totalAssessed,
                    taxon.percentAssessed,
                    taxon.outdated,
                    taxon.percentOutdated,
                    taxon.byCategory || {},
                    true,
                    taxon.available,
                    false,
                    { total: taxon.totalGbifObservations, mean: taxon.meanGbifObsPerSpecies, median: taxon.medianGbifObsPerSpecies, speciesCount: taxon.gbifSpeciesCount, distribution: taxon.gbifObsDistribution }
                  )
                )
            : taxa.map((taxon) =>
                renderRow(
                  taxon.id,
                  taxon.name,
                  taxon.color,
                  taxon.estimatedDescribed,
                  taxon.totalAssessed,
                  taxon.percentAssessed,
                  taxon.outdated,
                  taxon.percentOutdated,
                  taxon.byCategory || {},
                  selectedTaxa.has(taxon.id),
                  taxon.available,
                  false,
                  { total: taxon.totalGbifObservations, mean: taxon.meanGbifObsPerSpecies, median: taxon.medianGbifObsPerSpecies, speciesCount: taxon.gbifSpeciesCount, distribution: taxon.gbifObsDistribution }
                )
              )
          }
        </tbody>
      </table>
      </div>
    </div>
    </>
  );
}
