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

// Helper to get color styling for percentages
const getAssessedStyle = (percent: number) => ({
  backgroundColor: percent >= 50 ? "rgba(34, 197, 94, 0.15)" : percent >= 20 ? "rgba(234, 179, 8, 0.15)" : "rgba(239, 68, 68, 0.15)",
  color: percent >= 50 ? "#16a34a" : percent >= 20 ? "#ca8a04" : "#dc2626",
});

const getOutdatedStyle = (percent: number) => ({
  backgroundColor: percent < 20 ? "rgba(34, 197, 94, 0.15)" : percent < 40 ? "rgba(234, 179, 8, 0.15)" : "rgba(239, 68, 68, 0.15)",
  color: percent < 20 ? "#16a34a" : percent < 40 ? "#ca8a04" : "#dc2626",
});

// Sticky cell classes for the pinned taxon column
const stickyClasses = "sticky left-0 z-10";

export default function TaxaSummary({ onSelectTaxon, selectedTaxon }: Props) {
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Check if "all" is selected or a specific taxon
  const isAllSelected = selectedTaxon === "all";
  const hasSpecificTaxon = selectedTaxon && selectedTaxon !== "all";

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
    isSelected?: boolean,
    available = true
  ) => {
    const rowBg = isSelected
      ? "bg-zinc-100 dark:bg-zinc-800"
      : "";
    const hoverClass = available
      ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
      : "opacity-50 cursor-not-allowed";

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
        <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
          <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
            {estimatedDescribed.toLocaleString()}
          </span>
        </td>
        <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
          <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
            {available ? assessed.toLocaleString() : "—"}
          </span>
        </td>
        <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
          {available ? (
            <span
              className="text-sm md:text-base font-medium px-1.5 md:px-2 py-0.5 rounded tabular-nums"
              style={getAssessedStyle(percentAssessed)}
            >
              {percentAssessed.toFixed(1)}%
            </span>
          ) : (
            <span className="text-sm md:text-base text-zinc-400">—</span>
          )}
        </td>
        <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
          <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
            {available ? outdated.toLocaleString() : "—"}
          </span>
        </td>
        <td className="px-3 md:px-4 py-2.5 md:py-3 text-right whitespace-nowrap">
          {available ? (
            <span
              className="text-sm md:text-base font-medium px-1.5 md:px-2 py-0.5 rounded tabular-nums"
              style={getOutdatedStyle(percentOutdated)}
            >
              {percentOutdated.toFixed(1)}%
            </span>
          ) : (
            <span className="text-sm md:text-base text-zinc-400">—</span>
          )}
        </td>
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
        <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            Est. Described
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
        <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
          Assessed
        </th>
        <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
          % Assessed
        </th>
        <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
          Outdated (10+y)
        </th>
        <th className="px-3 md:px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider whitespace-nowrap">
          % Outdated
        </th>
      </tr>
    </thead>
  );

  // If a specific taxon is selected (not "all"), show just that taxon
  if (hasSpecificTaxon) {
    const taxon = taxa.find(t => t.id === selectedTaxon);
    if (!taxon) return null;

    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
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
      <table className="w-full">
        {renderHead()}
        <tbody>
          {/* All Species row */}
          {renderRow(
            "all",
            "All Species",
            "#22c55e",
            totalDescribed,
            totalAssessed,
            totalPercentAssessed,
            totalOutdated,
            totalPercentOutdated,
            isAllSelected
          )}

          {/* Separator */}
          {!isAllSelected && (
            <tr>
              <td colSpan={6} className="p-0">
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
