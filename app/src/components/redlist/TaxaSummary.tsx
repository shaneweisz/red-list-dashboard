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

// Toggleable column IDs (Taxon is always visible)
type ColumnId = "described" | "assessed" | "pctAssessed" | "outdated" | "pctOutdated" | "breakdown";

const COLUMN_LABELS: Record<ColumnId, string> = {
  described: "Est. # Described",
  assessed: "# Assessed",
  pctAssessed: "% Assessed",
  outdated: "# Outdated (10+Y)",
  pctOutdated: "% Outdated",
  breakdown: "Risk Category Breakdown",
};

const DEFAULT_HIDDEN_COLUMNS: Set<ColumnId> = new Set(["breakdown"]);

export default function TaxaSummary({ onToggleTaxon, selectedTaxa }: Props) {
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [modifierHeld, setModifierHeld] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(DEFAULT_HIDDEN_COLUMNS);
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
        <td className={`${stickyClasses} bg-white dark:bg-zinc-900 px-3 md:px-4 py-2.5 md:py-3`}>
          <div className="flex items-center gap-2">
            <div className="w-[22px] h-[22px] rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
          </div>
        </td>
        {isVisible("described") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 text-right">
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("assessed") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 text-right">
            <div className="h-4 w-14 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("pctAssessed") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3">
            <div className="flex items-center gap-2 min-w-[120px] md:min-w-[160px]">
              <div className="flex-1 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-700 rounded" />
            </div>
          </td>
        )}
        {isVisible("outdated") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 text-right">
            <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("pctOutdated") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3">
            <div className="flex items-center gap-2 min-w-[120px] md:min-w-[160px]">
              <div className="flex-1 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-700 rounded" />
            </div>
          </td>
        )}
        {isVisible("breakdown") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3">
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
              <th className={`${stickyClasses} bg-zinc-50 dark:bg-zinc-800 px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap`}>Taxon</th>
              {isVisible("described") && <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">Est. # Described</th>}
              {isVisible("assessed") && <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap"># Assessed</th>}
              {isVisible("pctAssessed") && <th className="px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">% Assessed</th>}
              {isVisible("outdated") && <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap"># Outdated (10+Y)</th>}
              {isVisible("pctOutdated") && <th className="px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">% Outdated</th>}
              {isVisible("breakdown") && <th className="px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">Risk Category Breakdown</th>}
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


  // Column order: Taxon (sticky) | Est. Described | Assessed | % Assessed | Outdated | % Outdated | Category Breakdown

  // Render a percentage bar
  const renderBar = (percent: number, barColor: string, isAll: boolean) => {
    const clampedPercent = Math.min(100, Math.max(0, percent));
    const fillColor = isAll ? "rgba(255,255,255,0.25)" : barColor;
    return (
      <div className="flex items-center gap-2 min-w-[120px] md:min-w-[160px]">
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
      <div className="min-w-[120px] md:min-w-[160px] relative">
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
    isAllRow = false
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
        <td className={`${stickyClasses} px-3 md:px-4 py-2.5 md:py-3 whitespace-nowrap ${stickyBg}`}>
          <div className="flex items-center gap-2">
            <TaxaIcon taxonId={id} size={22} className="flex-shrink-0" style={{ color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{name}</span>
          </div>
        </td>
        {isVisible("described") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {estimatedDescribed.toLocaleString()}
            </span>
          </td>
        )}
        {isVisible("assessed") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {available ? assessed.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("pctAssessed") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 whitespace-nowrap">
            {available ? (
              renderBar(percentAssessed, getAssessedBarColor(percentAssessed), isAllRow)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("outdated") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {available ? outdated.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("pctOutdated") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 whitespace-nowrap">
            {available ? (
              renderBar(percentOutdated, getOutdatedBarColor(percentOutdated), isAllRow)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("breakdown") && (
          <td className="px-3 md:px-4 py-2.5 md:py-3 whitespace-nowrap">
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
        <th className={`${stickyClasses} bg-zinc-50 dark:bg-zinc-800 px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap`}>
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
          <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
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
          <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
            # Assessed
          </th>
        )}
        {isVisible("pctAssessed") && (
          <th className="px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
            % Assessed
          </th>
        )}
        {isVisible("outdated") && (
          <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
            # Outdated (10+Y)
          </th>
        )}
        {isVisible("pctOutdated") && (
          <th className="px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
            % Outdated
          </th>
        )}
        {isVisible("breakdown") && (
          <th className="px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 tracking-wider whitespace-nowrap">
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
            true
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
                    taxon.available
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
                  taxon.available
                )
              )
          }
        </tbody>
      </table>
    </div>
    </>
  );
}
