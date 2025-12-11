"use client";

import { useState, useEffect } from "react";
import TaxaIcon from "@/components/TaxaIcon";

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  estimatedSource: string;
  estimatedSourceUrl?: string;
  gbifSpeciesCount: number;
  gbifTotalOccurrences: number;
  gbifMedian: number;
  gbifMean: number;
  gbifDataAvailable: boolean;
  distribution?: {
    lte1: number;
    lte10: number;
    lte100: number;
    lte1000: number;
    lte10000: number;
  };
}

interface Props {
  onSelectTaxon: (taxonId: string | null) => void;
  selectedTaxon: string | null;
}

const formatNumber = (num: number) => num.toLocaleString();

export default function GBIFTaxaSummary({ onSelectTaxon, selectedTaxon }: Props) {
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTaxa() {
      try {
        const res = await fetch("/api/gbif/taxa");
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
  const totalSpecies = taxa.reduce((sum, t) => sum + t.gbifSpeciesCount, 0);
  const totalOccurrences = taxa.reduce((sum, t) => sum + t.gbifTotalOccurrences, 0);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Taxon
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Total Species
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Total Occurrences
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                <div>Mean Occurrences</div>
                <div className="font-normal normal-case tracking-normal">(per species)</div>
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                <div>Median Occurrences</div>
                <div className="font-normal normal-case tracking-normal">(per species)</div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {taxa
              .filter((taxon) => !selectedTaxon || taxon.id === selectedTaxon)
              .map((taxon) => (
              <tr
                key={taxon.id}
                onClick={() => {
                  if (!taxon.gbifDataAvailable) return;
                  // Toggle: if already selected, deselect; otherwise select
                  onSelectTaxon(selectedTaxon === taxon.id ? null : taxon.id);
                }}
                className={`
                  ${taxon.gbifDataAvailable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" : "opacity-50 cursor-not-allowed"}
                  ${selectedTaxon === taxon.id ? "bg-zinc-100 dark:bg-zinc-800" : ""}
                `}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <TaxaIcon
                      taxonId={taxon.id}
                      size={18}
                      className="flex-shrink-0"
                      style={{ color: taxon.color }}
                    />
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {taxon.name}
                    </span>
                    {!taxon.gbifDataAvailable && (
                      <span className="text-xs text-zinc-400">(no data)</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {taxon.gbifDataAvailable ? formatNumber(taxon.gbifSpeciesCount) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {taxon.gbifDataAvailable ? formatNumber(taxon.gbifTotalOccurrences) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {taxon.gbifDataAvailable ? formatNumber(taxon.gbifMean) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {taxon.gbifDataAvailable ? formatNumber(taxon.gbifMedian) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          {!selectedTaxon && (
            <tfoot className="bg-zinc-50 dark:bg-zinc-800 font-medium">
              <tr>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  Total
                </td>
                <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
                  {formatNumber(totalSpecies)}
                </td>
                <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
                  {formatNumber(totalOccurrences)}
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
