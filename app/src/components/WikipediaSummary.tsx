"use client";

import { useState, useEffect } from "react";

interface WikiSection {
  id: number;
  title: string;
  level: number;
  html: string;
}

interface WikiData {
  found: boolean;
  title?: string;
  pageUrl?: string;
  summary?: string;
  thumbnail?: { source: string; width: number; height: number };
  sections?: WikiSection[];
  error?: string;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function WikipediaSummary({
  scientificName,
}: {
  scientificName: string;
}) {
  const [data, setData] = useState<WikiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function fetchWikipedia() {
      setLoading(true);
      setError(null);
      setExpandedSections(new Set());

      try {
        const res = await fetch(
          `/api/wikipedia?name=${encodeURIComponent(scientificName)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (cancelled) return;
        setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchWikipedia();
    return () => {
      cancelled = true;
    };
  }, [scientificName]);

  function toggleSection(id: number) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-zinc-500 dark:text-zinc-400">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading Wikipedia article...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-red-500 dark:text-red-400">
        Failed to load Wikipedia data: {error}
      </div>
    );
  }

  if (!data || !data.found) {
    return (
      <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
        No Wikipedia article found for <span className="italic">{scientificName}</span>.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header with link */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {data.title}
        </h3>
        {data.pageUrl && (
          <a
            href={data.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View on Wikipedia
          </a>
        )}
      </div>

      {/* Summary (always expanded) */}
      <div className="space-y-3">
        {data.thumbnail && (
          <img
            src={data.thumbnail.source}
            alt={data.title}
            className="float-right ml-4 mb-2 rounded max-w-[200px] max-h-[200px] object-contain"
            width={data.thumbnail.width}
            height={data.thumbnail.height}
          />
        )}
        {data.summary && (
          <div
            className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed wiki-content"
            dangerouslySetInnerHTML={{ __html: data.summary }}
          />
        )}
        <div className="clear-both" />
      </div>

      {/* Collapsible sections */}
      {data.sections && data.sections.length > 0 && (
        <div className="space-y-0 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
          {data.sections.map((section) => {
            const isOpen = expandedSections.has(section.id);
            return (
              <div key={section.id} className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleSection(section.id)}
                >
                  <ChevronIcon open={isOpen} />
                  <span style={{ paddingLeft: `${(section.level - 1) * 12}px` }}>
                    {section.title}
                  </span>
                </button>
                {isOpen && (
                  <div
                    className="px-4 pb-4 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed wiki-content"
                    dangerouslySetInnerHTML={{ __html: section.html }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Attribution */}
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-2">
        <p>
          Content from{" "}
          <a
            href={data.pageUrl || "https://en.wikipedia.org"}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Wikipedia
          </a>
          , licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            CC BY-SA 4.0
          </a>
          .
        </p>
      </div>
    </div>
  );
}
