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

// Color for percentage text based on coverage level
const getAssessedColor = (percent: number) =>
  percent >= 50 ? "#16a34a" : percent >= 20 ? "#ca8a04" : "#dc2626";

const getAssessedColorDark = (percent: number) =>
  percent >= 50 ? "#4ade80" : percent >= 20 ? "#facc15" : "#f87171";

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
  const totalDescribed = taxa.reduce((sum, t) => sum + t.estimatedDescribed, 0);
  const totalPercentAssessed = (totalAssessed / totalDescribed) * 100;

  const isAllSelected = selectedTaxon === "all";
  const hasSpecificTaxon = selectedTaxon && selectedTaxon !== "all";

  // Render a single bar row
  const renderBarRow = (
    id: string,
    name: string,
    color: string,
    estimatedDescribed: number,
    assessed: number,
    percentAssessed: number,
    isSelected?: boolean,
    available = true
  ) => {
    const hoverClass = available
      ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
      : "opacity-50 cursor-not-allowed";

    return (
      <div
        key={id}
        onClick={() => {
          if (!available) return;
          onSelectTaxon(isSelected ? null : id);
        }}
        className={`px-3 md:px-4 py-2.5 md:py-3 transition-colors ${
          isSelected ? "bg-zinc-100 dark:bg-zinc-800" : ""
        } ${hoverClass}`}
      >
        {/* Row header: icon + name on left, percentage + counts on right */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <TaxaIcon taxonId={id} size={20} className="flex-shrink-0" style={{ color }} />
            <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{name}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            {available ? (
              <>
                <span
                  className="font-semibold text-sm tabular-nums dark:hidden"
                  style={{ color: getAssessedColor(percentAssessed) }}
                >
                  {percentAssessed.toFixed(1)}%
                </span>
                <span
                  className="font-semibold text-sm tabular-nums hidden dark:inline"
                  style={{ color: getAssessedColorDark(percentAssessed) }}
                >
                  {percentAssessed.toFixed(1)}%
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  ({assessed.toLocaleString()} of {estimatedDescribed.toLocaleString()})
                </span>
              </>
            ) : (
              <span className="text-sm text-zinc-400">—</span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {available && (
          <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percentAssessed}%`,
                minWidth: percentAssessed > 0 ? "4px" : "0",
                backgroundColor: color,
              }}
            />
          </div>
        )}
      </div>
    );
  };

  // If a specific taxon is selected, show just that one
  if (hasSpecificTaxon) {
    const taxon = taxa.find(t => t.id === selectedTaxon);
    if (!taxon) return null;

    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        {renderBarRow(
          taxon.id,
          taxon.name,
          taxon.color,
          taxon.estimatedDescribed,
          taxon.totalAssessed,
          taxon.percentAssessed,
          true
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      {/* Header with source link */}
      <div className="px-3 md:px-4 pt-3 pb-1 flex items-center justify-between">
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Assessment Coverage
        </h3>
        <a
          href={IUCN_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <FaInfoCircle size={12} />
          <span className="text-xs">IUCN 2025-2</span>
        </a>
      </div>

      {/* All Species row */}
      {renderBarRow(
        "all",
        "All Species",
        "#22c55e",
        totalDescribed,
        totalAssessed,
        totalPercentAssessed,
        isAllSelected
      )}

      {/* Separator */}
      {!isAllSelected && (
        <div className="mx-3 md:mx-4 border-b-2 border-zinc-200 dark:border-zinc-700" />
      )}

      {/* Individual taxa rows */}
      {!isAllSelected && taxa.map((taxon) =>
        renderBarRow(
          taxon.id,
          taxon.name,
          taxon.color,
          taxon.estimatedDescribed,
          taxon.totalAssessed,
          taxon.percentAssessed,
          false,
          taxon.available
        )
      )}
    </div>
  );
}
