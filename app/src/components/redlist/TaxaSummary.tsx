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
  percent < 10 ? "#22c55e" : percent <= 30 ? "#eab308" : "#ef4444";

// Text color classes with dark mode support
const getAssessedTextClasses = (percent: number) =>
  percent >= 50
    ? "text-green-600 dark:text-green-400"
    : percent >= 20
    ? "text-yellow-600 dark:text-yellow-400"
    : "text-red-600 dark:text-red-400";

const getOutdatedTextClasses = (percent: number) =>
  percent < 10
    ? "text-green-600 dark:text-green-400"
    : percent <= 30
    ? "text-yellow-600 dark:text-yellow-400"
    : "text-red-600 dark:text-red-400";

// Neutral colors for the All Species summary row
const NEUTRAL_BAR_COLOR = "#a1a1aa"; // zinc-400
const NEUTRAL_TEXT_CLASSES = "text-zinc-600 dark:text-zinc-400";

// Sticky cell classes for the pinned taxon column
const stickyClasses = "sticky left-0 z-10";

type MobileColumn = "assessed" | "outdated";

export default function TaxaSummary({ onSelectTaxon, selectedTaxon }: Props) {
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileColumn, setMobileColumn] = useState<MobileColumn>("assessed");

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

  // Render a bar + percentage + count inside a table cell
  const renderBarCell = (
    percent: number,
    numerator: number,
    denominator: number,
    barColor: string,
    textClasses: string,
    available: boolean,
    visibleOn: MobileColumn
  ) => {
    // On mobile, hide the column that isn't active; always show on md+
    const mobileVisibility = mobileColumn === visibleOn
      ? "table-cell"
      : "hidden md:table-cell";

    if (!available) {
      return (
        <td className={`px-3 md:px-4 py-2.5 md:py-3 ${mobileVisibility}`}>
          <span className="text-sm text-zinc-400">—</span>
        </td>
      );
    }

    return (
      <td className={`px-3 md:px-4 py-2.5 md:py-3 min-w-[200px] md:min-w-[240px] ${mobileVisibility}`}>
        <div className="flex items-center gap-2 mb-0.5">
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
          <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${textClasses}`}>
            {percent.toFixed(1)}%
          </span>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          {numerator.toLocaleString()} of {denominator.toLocaleString()}
        </div>
      </td>
    );
  };

  // Render a full data row
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
    const rowBg = isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "";
    const hoverClass = available
      ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
      : "opacity-50 cursor-not-allowed";

    const assessedBarColor = neutral ? NEUTRAL_BAR_COLOR : getAssessedBarColor(percentAssessed);
    const assessedTextCls = neutral ? NEUTRAL_TEXT_CLASSES : getAssessedTextClasses(percentAssessed);
    const outdatedBarColor = neutral ? NEUTRAL_BAR_COLOR : getOutdatedBarColor(percentOutdated);
    const outdatedTextCls = neutral ? NEUTRAL_TEXT_CLASSES : getOutdatedTextClasses(percentOutdated);

    return (
      <tr
        key={id}
        onClick={() => {
          if (!available) return;
          onSelectTaxon(isSelected ? null : id);
        }}
        className={`transition-colors ${rowBg} ${hoverClass}`}
      >
        <td className={`${stickyClasses} px-3 md:px-4 py-2.5 md:py-3 whitespace-nowrap ${isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
          <div className="flex items-center gap-2">
            <TaxaIcon taxonId={id} size={22} className="flex-shrink-0" style={{ color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{name}</span>
          </div>
        </td>
        {renderBarCell(
          percentAssessed,
          assessed,
          estimatedDescribed,
          assessedBarColor,
          assessedTextCls,
          available,
          "assessed"
        )}
        {renderBarCell(
          percentOutdated,
          outdated,
          assessed,
          outdatedBarColor,
          outdatedTextCls,
          available,
          "outdated"
        )}
      </tr>
    );
  };

  // Table header
  const renderHead = () => (
    <thead>
      <tr className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <th className={`${stickyClasses} bg-zinc-50 dark:bg-zinc-800 px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap`}>
          Taxon
        </th>
        <th className={`px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap ${mobileColumn === "assessed" ? "table-cell" : "hidden md:table-cell"}`}>
          <span className="inline-flex items-center gap-1">
            % Assessed
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
        <th className={`px-3 md:px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap ${mobileColumn === "outdated" ? "table-cell" : "hidden md:table-cell"}`}>
          % Outdated (10+y)
        </th>
      </tr>
    </thead>
  );

  // Mobile column toggle (visible only below md)
  const renderMobileToggle = () => (
    <div className="md:hidden flex border-b border-zinc-200 dark:border-zinc-700">
      <button
        onClick={(e) => { e.stopPropagation(); setMobileColumn("assessed"); }}
        className={`flex-1 px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
          mobileColumn === "assessed"
            ? "text-zinc-900 dark:text-zinc-100 border-b-2 border-zinc-900 dark:border-zinc-100"
            : "text-zinc-400 dark:text-zinc-500"
        }`}
      >
        % Assessed
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setMobileColumn("outdated"); }}
        className={`flex-1 px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
          mobileColumn === "outdated"
            ? "text-zinc-900 dark:text-zinc-100 border-b-2 border-zinc-900 dark:border-zinc-100"
            : "text-zinc-400 dark:text-zinc-500"
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
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
        {renderMobileToggle()}
        <table className="w-full">
          {renderHead()}
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
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
      {renderMobileToggle()}
      <table className="w-full">
        {renderHead()}
        <tbody>
          {/* All Species row (neutral colors) */}
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
              <td colSpan={3} className="p-0">
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
