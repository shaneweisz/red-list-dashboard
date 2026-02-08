"use client";

import { useState, useEffect } from "react";
import { FaInfoCircle } from "react-icons/fa";
import TaxaIcon from "@/components/TaxaIcon";

const IUCN_SOURCE_URL = "https://nc.iucnredlist.org/redlist/content/attachment_files/2025-2_RL_Table1a.pdf";

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  estimatedSource: string;
  estimatedSourceUrl?: string;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  byCategory: {
    code: string;
    count: number;
    color: string;
  }[];
  outdated: number;
  percentOutdated: number;
  lastUpdated: string | null;
}

interface Props {
  onSelectTaxon: (taxonId: string | null) => void;
  selectedTaxon: string | null;
}

// Bar fill colors (semantic: green=good, yellow=moderate, red=poor)
const getAssessedBarColor = (percent: number) =>
  percent >= 50 ? "#22c55e" : percent >= 20 ? "#eab308" : "#ef4444";

const getOutdatedBarColor = (percent: number) =>
  percent < 10 ? "#22c55e" : percent <= 50 ? "#eab308" : "#ef4444";

// Neutral color for the All Species summary row
const NEUTRAL_BAR_COLOR = "#a1a1aa"; // zinc-400

type ActiveTab = "assessed" | "outdated";

export default function TaxaSummary({ onSelectTaxon, selectedTaxon }: Props) {
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("assessed");

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
    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-1/4"></div>
          <div className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded"></div>
        </div>
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

  const isAllSelected = selectedTaxon === "all";
  const hasSpecificTaxon = selectedTaxon && selectedTaxon !== "all";

  // Render the bar + percentage cell for the active tab
  const renderBarCell = (
    percent: number,
    numerator: number,
    denominator: number,
    barColor: string,
    available: boolean
  ) => {
    if (!available) {
      return (
        <td className="px-3 md:px-4 py-3.5 md:py-4">
          <span className="text-sm text-zinc-400">—</span>
        </td>
      );
    }

    return (
      <td className="px-3 md:px-4 py-3.5 md:py-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percent}%`,
                minWidth: percent > 0 ? "4px" : "0",
                backgroundColor: barColor,
              }}
            />
          </div>
          <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-zinc-800 dark:text-zinc-200 w-[52px] text-right">
            {percent.toFixed(1)}%
          </span>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums mt-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
          {numerator.toLocaleString()} of {denominator.toLocaleString()}
        </div>
      </td>
    );
  };

  // Render a full data row (taxon name + one active bar column)
  const renderRow = (
    id: string,
    name: string,
    color: string,
    estimatedDescribed: number,
    assessed: number,
    percentAssessed: number,
    outdated: number,
    percentOutdated: number,
    isSelected?: boolean,
    available = true,
    neutral = false
  ) => {
    const isAll = id === "all";
    const rowBg = isSelected
      ? "bg-zinc-100 dark:bg-zinc-800"
      : isAll
      ? "bg-zinc-50/70 dark:bg-zinc-800/40"
      : "";
    const hoverClass = available
      ? "hover:bg-zinc-100 dark:hover:bg-zinc-800/70 cursor-pointer"
      : "opacity-50 cursor-not-allowed";

    const barColor = activeTab === "assessed"
      ? (neutral ? NEUTRAL_BAR_COLOR : getAssessedBarColor(percentAssessed))
      : (neutral ? NEUTRAL_BAR_COLOR : getOutdatedBarColor(percentOutdated));

    const percent = activeTab === "assessed" ? percentAssessed : percentOutdated;
    const numerator = activeTab === "assessed" ? assessed : outdated;
    const denominator = activeTab === "assessed" ? estimatedDescribed : assessed;

    return (
      <tr
        key={id}
        onClick={() => {
          if (!available) return;
          onSelectTaxon(isSelected ? null : id);
        }}
        className={`transition-colors group/row ${rowBg} ${hoverClass}`}
      >
        <td className={`px-2 md:px-3 py-3.5 md:py-4 whitespace-nowrap ${isSelected ? "bg-zinc-100 dark:bg-zinc-800" : isAll ? "bg-zinc-50/70 dark:bg-zinc-800/40" : "bg-white dark:bg-zinc-900"}`}>
          <div className="flex items-center gap-1.5 md:gap-2">
            <TaxaIcon taxonId={id} size={20} className="flex-shrink-0" style={{ color }} />
            <span className={`text-sm text-zinc-900 dark:text-zinc-100 ${isAll ? "font-semibold" : "font-medium"}`}>{name}</span>
          </div>
        </td>
        {renderBarCell(percent, numerator, denominator, barColor, available)}
      </tr>
    );
  };

  // Tab toggle (always visible)
  const renderTabs = () => (
    <div className="flex border-b border-zinc-200 dark:border-zinc-700">
      <button
        onClick={(e) => { e.stopPropagation(); setActiveTab("assessed"); }}
        className={`flex-1 px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 ${
          activeTab === "assessed"
            ? "text-zinc-900 dark:text-zinc-100 border-b-2 border-zinc-900 dark:border-zinc-100"
            : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400"
        }`}
      >
        % Assessed
        <span className="relative group/tip">
          <span
            onClick={(e) => e.stopPropagation()}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-help"
          >
            <FaInfoCircle size={11} />
          </span>
          <span className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible z-50 shadow-lg normal-case">
            Source for Counts of Described Species: IUCN Red List Table 1a (2025-2)
          </span>
        </span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setActiveTab("outdated"); }}
        className={`flex-1 px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
          activeTab === "outdated"
            ? "text-zinc-900 dark:text-zinc-100 border-b-2 border-zinc-900 dark:border-zinc-100"
            : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400"
        }`}
      >
        % Outdated (10+y)
      </button>
    </div>
  );

  // Single taxon selected view
  if (hasSpecificTaxon) {
    const taxon = taxa.find(t => t.id === selectedTaxon);
    if (!taxon) return null;

    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        {renderTabs()}
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[140px] md:w-[160px]" />
            <col />
          </colgroup>
          <tbody>
            {renderRow(
              taxon.id,
              taxon.name,
              taxon.color,
              taxon.estimatedDescribed,
              taxon.totalAssessed,
              taxon.percentAssessed,
              taxon.outdated,
              taxon.percentOutdated,
              true
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      {renderTabs()}
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[140px] md:w-[160px]" />
          <col />
        </colgroup>
        <tbody>
          {/* All Species row (neutral colors, subtle background) */}
          {renderRow(
            "all",
            "All Species",
            "#22c55e",
            totalDescribed,
            totalAssessed,
            totalPercentAssessed,
            totalOutdated,
            totalPercentOutdated,
            isAllSelected,
            true,
            true
          )}

          {/* Separator */}
          {!isAllSelected && (
            <tr>
              <td colSpan={2} className="p-0">
                <div className="border-b-2 border-zinc-200 dark:border-zinc-700" />
              </td>
            </tr>
          )}

          {/* Individual taxa rows */}
          {!isAllSelected && taxa.map((taxon) =>
            renderRow(
              taxon.id,
              taxon.name,
              taxon.color,
              taxon.estimatedDescribed,
              taxon.totalAssessed,
              taxon.percentAssessed,
              taxon.outdated,
              taxon.percentOutdated,
              false,
              taxon.available
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
