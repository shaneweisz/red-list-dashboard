"use client";

import { useState, useEffect } from "react";

interface LiteratureResult {
  title: string;
  url: string;
  doi: string | null;
  year: number | null;
  date: string | null;
  citations: number | null;
  source: string;
  sourceType: "academic" | "grey";
  abstract: string | null;
  authors: string | null;
}

// Paper row with expandable details
function PaperRow({
  paper,
  isExpanded,
  onToggle
}: {
  paper: LiteratureResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer border-b border-zinc-100 dark:border-zinc-800 ${isExpanded ? "bg-zinc-50 dark:bg-zinc-800/30" : ""}`}
        onClick={onToggle}
      >
        {/* Title */}
        <td className="py-2 px-3">
          <div className="flex items-start gap-2">
            <svg
              className={`w-3 h-3 mt-1 flex-shrink-0 text-zinc-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-zinc-800 dark:text-zinc-200 line-clamp-2 leading-snug">
              {paper.title}
            </span>
          </div>
        </td>
        {/* Year */}
        <td className="py-2 px-3 text-sm text-zinc-500 whitespace-nowrap">
          {paper.year || "—"}
        </td>
        {/* Journal */}
        <td className="py-2 px-3 text-xs text-zinc-400 max-w-[150px] truncate hidden md:table-cell">
          {paper.source || "—"}
        </td>
        {/* Citations */}
        <td className="py-2 px-3 text-sm text-right whitespace-nowrap">
          {paper.citations !== null && paper.citations > 0 ? (
            <span className="text-amber-600 dark:text-amber-500 tabular-nums">
              {paper.citations.toLocaleString()}
            </span>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>
      </tr>
      {/* Expanded details row */}
      {isExpanded && (
        <tr className="bg-zinc-50 dark:bg-zinc-800/30">
          <td colSpan={4} className="px-3 py-3 pl-8">
            <div className="space-y-2">
              {/* Authors */}
              {paper.authors && (
                <div className="text-xs text-zinc-500">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Authors:</span>{" "}
                  {paper.authors}
                </div>
              )}
              {/* Journal (shown on mobile since hidden in table) */}
              {paper.source && (
                <div className="text-xs text-zinc-500 md:hidden">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Journal:</span>{" "}
                  {paper.source}
                </div>
              )}
              {/* Abstract */}
              {paper.abstract && (
                <div className="text-xs text-zinc-500 leading-relaxed">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Abstract:</span>{" "}
                  {paper.abstract}
                </div>
              )}
              {/* Link to paper */}
              <div className="pt-1">
                <a
                  href={paper.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  View paper
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface LiteratureResponse {
  scientificName: string;
  assessmentYear: number;
  totalPapersSinceAssessment: number;
  topPapers: LiteratureResult[];
  openAlexSearchUrl: string;
}

interface NewLiteratureSinceAssessmentProps {
  scientificName: string;
  assessmentYear: number;
  className?: string;
}

// Build the OpenAlex search URL for a species name after a given year
function buildOpenAlexUrl(scientificName: string, sinceYear: number): string {
  // OpenAlex uses this URL format for their web UI
  // Excludes datasets (GBIF occurrence downloads), sorted by most recent
  return `https://openalex.org/works?page=1&filter=default.search%3A%22${encodeURIComponent(scientificName)}%22,publication_year%3A%3E${sinceYear},type%3A%21dataset&sort=publication_date%3Adesc`;
}

export default function NewLiteratureSinceAssessment({
  scientificName,
  assessmentYear,
  className = "",
}: NewLiteratureSinceAssessmentProps) {
  const [data, setData] = useState<LiteratureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true); // Auto-expand to show papers
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);

  const isAllTime = assessmentYear === 0;
  const openAlexUrl = isAllTime
    ? `https://openalex.org/works?page=1&filter=default.search%3A%22${encodeURIComponent(scientificName)}%22,type%3A%21dataset&sort=publication_date%3Adesc`
    : buildOpenAlexUrl(scientificName, assessmentYear);

  // Human-readable query description
  const queryDescription = isAllTime
    ? `search="${scientificName}" AND type!=dataset`
    : `search="${scientificName}" AND year>${assessmentYear} AND type!=dataset`;

  useEffect(() => {
    async function fetchLiterature() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          scientificName,
          assessmentYear: assessmentYear.toString(),
          limit: "5",
        });

        const response = await fetch(`/api/literature?${params}`);
        if (!response.ok) {
          throw new Error("Failed to fetch literature");
        }
        const result: LiteratureResponse = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }

    if (scientificName && assessmentYear != null) {
      fetchLiterature();
    }
  }, [scientificName, assessmentYear]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-zinc-400 ${className}`}>
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Checking OpenAlex...
      </div>
    );
  }

  if (error || !data) {
    return null; // Silently fail - don't clutter UI
  }

  const { totalPapersSinceAssessment, topPapers } = data;

  return (
    <div className={`${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Literature
          </h3>
          <span className="text-sm text-zinc-500">
            {totalPapersSinceAssessment.toLocaleString()} paper{totalPapersSinceAssessment !== 1 ? "s" : ""}{isAllTime ? "" : ` since ${assessmentYear}`}
          </span>
          <a
            href={openAlexUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            View on OpenAlex →
          </a>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {/* Query info - subtle */}
      <div className="text-[10px] text-zinc-400 font-mono mb-2">
        OpenAlex: {queryDescription}
      </div>

      {/* Papers table */}
      {expanded && topPapers.length > 0 && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-zinc-100 dark:bg-zinc-800">
              <tr className="text-xs text-zinc-500 uppercase tracking-wider">
                <th className="py-2 px-3 font-medium">Title</th>
                <th className="py-2 px-3 font-medium w-16">Year</th>
                <th className="py-2 px-3 font-medium hidden md:table-cell">Journal</th>
                <th className="py-2 px-3 font-medium text-right w-20">Citations</th>
              </tr>
            </thead>
            <tbody>
              {topPapers.map((paper, index) => (
                <PaperRow
                  key={index}
                  paper={paper}
                  isExpanded={expandedRowIndex === index}
                  onToggle={() => setExpandedRowIndex(expandedRowIndex === index ? null : index)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expanded && topPapers.length > 0 && totalPapersSinceAssessment > topPapers.length && (
        <div className="text-center pt-2">
          <a
            href={openAlexUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            + {(totalPapersSinceAssessment - topPapers.length).toLocaleString()} more on OpenAlex
          </a>
        </div>
      )}

      {expanded && topPapers.length === 0 && (
        <div className="text-sm text-zinc-500 py-2">
          No papers found.{" "}
          <a href={openAlexUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
            Verify on OpenAlex
          </a>
        </div>
      )}

      {/* Subtle note at bottom */}
      {expanded && (
        <p className="text-[10px] text-zinc-400 mt-2">
          Simple text search — may miss synonyms or indirect references
        </p>
      )}
    </div>
  );
}
