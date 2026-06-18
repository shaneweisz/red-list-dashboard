"use client";

import { useState, useEffect } from "react";

interface EolImage {
  url: string;
  thumb: string;
  title: string | null;
  rightsHolder: string | null;
  license: string | null;
  source: string | null;
}

interface EolSummaryData {
  found: boolean;
  eolId?: number;
  pageUrl?: string;
  scientificName?: string;
  englishNames?: string[];
  otherLanguageCount?: number;
  summary?: {
    html: string;
    title: string | null;
    source: string | null;
    license: string | null;
    rightsHolder: string | null;
  } | null;
  images?: EolImage[];
  providers?: string[];
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-zinc-500 dark:text-zinc-400">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}
    </div>
  );
}

export default function EolSummary({ scientificName }: { scientificName: string }) {
  const [data, setData] = useState<EolSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const res = await fetch(`/api/eol?name=${encodeURIComponent(scientificName)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scientificName]);

  if (loading) return <Spinner label="Loading Encyclopedia of Life data..." />;
  if (error) return <div className="p-6 text-sm text-red-500 dark:text-red-400">Failed to load EOL data: {error}</div>;
  if (!data || !data.found) {
    return (
      <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
        No Encyclopedia of Life page found for <span className="italic">{scientificName}</span>.
      </div>
    );
  }

  const { pageUrl, englishNames = [], otherLanguageCount = 0, summary, images = [], providers = [] } = data;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C7 2 3 6 3 11c0 5 4 9 9 9 1 0 2-.2 2-.2-.5-2-1.3-3.6-2.4-5C10 12.5 8 11.5 6 11c2.3-.2 4.3.4 6 1.6 1.2-2.3 3.2-4 5.8-5C16.7 4.5 14.5 2 12 2z" />
        </svg>
        {pageUrl ? (
          <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
            {data.scientificName} — Encyclopedia of Life ↗
          </a>
        ) : (
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{data.scientificName}</span>
        )}
      </div>

      {/* Common names */}
      {englishNames.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Common names</div>
          <div className="flex flex-wrap gap-1.5">
            {englishNames.slice(0, 12).map((n, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300">{n}</span>
            ))}
          </div>
          {otherLanguageCount > 0 && (
            <div className="text-[11px] text-zinc-400 mt-1">+ names in {otherLanguageCount} other languages on EOL</div>
          )}
        </div>
      )}

      {/* Image gallery */}
      {images.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1.5">Images ({images.length})</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {images.map((img, i) => (
              <a key={i} href={pageUrl ?? img.url} target="_blank" rel="noopener noreferrer" className="group block" title={img.title ?? undefined}>
                <img src={img.thumb} alt={img.title ?? data.scientificName ?? "EOL image"} loading="lazy" className="w-full h-28 object-cover rounded border border-zinc-200 dark:border-zinc-700" />
                <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                  {img.rightsHolder ?? "Unknown"}{img.license ? ` · ${img.license}` : ""}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Brief summary */}
      {summary && (
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">{summary.title || "Summary"}</div>
          <div
            className="eol-content text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 [&_p]:mb-2 [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a:hover]:underline [&_i]:italic [&_b]:font-semibold [&_img]:hidden"
            dangerouslySetInnerHTML={{ __html: summary.html }}
          />
          {(summary.source || summary.rightsHolder || summary.license) && (
            <div className="text-[10px] text-zinc-400 mt-1">
              {[summary.rightsHolder, summary.source, summary.license].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* Data providers */}
      {providers.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Data providers ({providers.length})</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{providers.join(" · ")}</div>
        </div>
      )}

      <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
        Data from the <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">Encyclopedia of Life</a>. Image rights belong to their respective holders.
      </p>
    </div>
  );
}
