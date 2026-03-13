"use client";

import { useState, useEffect } from "react";

interface WikiSection {
  title: string;
  html: string;
  toclevel: number;
}

interface WikipediaData {
  found: boolean;
  scientificName: string;
  title?: string;
  description?: string | null;
  leadHtml?: string | null;
  sections?: WikiSection[];
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  } | null;
  originalImage?: {
    source: string;
    width: number;
    height: number;
  } | null;
  pageUrl?: string | null;
  cached?: boolean;
}

function CollapsibleSection({ section }: { section: WikiSection }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span
          className={`font-medium text-zinc-800 dark:text-zinc-200 ${section.toclevel === 1 ? "text-sm" : "text-xs"}`}
        >
          {section.title}
        </span>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform shrink-0 ml-2 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800">
          <div
            className="pt-3 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: section.html }}
          />
        </div>
      )}
    </div>
  );
}

export default function WikipediaSummary({
  scientificName,
}: {
  scientificName: string;
}) {
  const [data, setData] = useState<WikipediaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchWikipediaData() {
      setLoading(true);
      setError(null);

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

    fetchWikipediaData();

    return () => {
      cancelled = true;
    };
  }, [scientificName]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-zinc-500 dark:text-zinc-400">
        <svg
          className="animate-spin h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading Wikipedia data...
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
        No Wikipedia article found for{" "}
        <span className="italic">{scientificName}</span>.
      </div>
    );
  }

  // Filter out sections that are just references/external links/metadata
  const contentSections = (data.sections || []).filter(
    (s) => s.toclevel <= 2
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header with title and link */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {data.title}
          </h3>
          {data.description && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              {data.description}
            </p>
          )}
        </div>
        {data.pageUrl && (
          <a
            href={data.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View on Wikipedia
          </a>
        )}
      </div>

      {/* Lead section with optional thumbnail */}
      <div className="flex flex-col sm:flex-row gap-4">
        {data.thumbnail && (
          <div className="shrink-0">
            <a
              href={data.originalImage?.source || data.thumbnail.source}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src={data.thumbnail.source}
                alt={data.title || scientificName}
                width={data.thumbnail.width}
                height={data.thumbnail.height}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 max-w-[200px] h-auto"
              />
            </a>
          </div>
        )}
        {data.leadHtml && (
          <div className="flex-1 min-w-0">
            <div
              className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: data.leadHtml }}
            />
          </div>
        )}
      </div>

      {/* Collapsible sections */}
      {contentSections.length > 0 && (
        <div className="space-y-2">
          {contentSections.map((section, i) => (
            <CollapsibleSection key={i} section={section} />
          ))}
        </div>
      )}

      {/* Footer attribution */}
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-2">
        <p>
          Content from{" "}
          <a
            href="https://en.wikipedia.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Wikipedia
          </a>
          , the free encyclopedia. Available under the{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            CC BY-SA 4.0
          </a>{" "}
          license.
        </p>
      </div>
    </div>
  );
}
