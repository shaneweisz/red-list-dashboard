"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateNameVariants } from "@/lib/nameVariants";

/**
 * The Literature tab: one chronological run of everything published about a
 * species, newest first, with a dotted line marking where the last Red List
 * assessment falls.
 *
 * This replaces a pre-assessment / post-assessment tab pair. The split forced a
 * reader to hold two lists in their head to answer one question — "what has
 * appeared since we last looked?" — which on a timeline is just a position.
 *
 * Records are merged from several sources by `/api/literature`; the per-source
 * report it returns is rendered at the foot of the tab so a source that is
 * missing, throttled or unconfigured is visible rather than silently narrowing
 * what you see.
 */

type DatePrecision = "day" | "month" | "year";
type WorkType = "article" | "preprint" | "book" | "chapter" | "report" | "other";
type SourceStatus = "ok" | "unconfigured" | "rate_limited" | "error";

interface WorkProvenance {
  id: string;
  label: string;
  url: string | null;
}

interface LiteratureWork {
  key: string;
  title: string;
  url: string;
  doi: string | null;
  date: string | null;
  datePrecision: DatePrecision | null;
  year: number | null;
  authors: string | null;
  venue: string | null;
  citations: number | null;
  type: WorkType;
  openAccessUrl: string | null;
  abstract: string | null;
  sources: WorkProvenance[];
}

interface SourceReport {
  id: string;
  label: string;
  homepage: string;
  status: SourceStatus;
  fetched: number;
  upstreamTotal: number | null;
  note: string | null;
}

interface TimelineResponse {
  scientificName: string;
  nameVariants: string[];
  assessmentDate: string | null;
  assessmentStamp: string | null;
  items: LiteratureWork[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  markerIndex: number | null;
  counts: { afterAssessment: number; beforeAssessment: number; undated: number };
  upstreamTotal: number | null;
  poolTruncated: boolean;
  sources: SourceReport[];
}

const PER_PAGE = 10;

const TYPE_LABELS: Record<WorkType, string> = {
  article: "Article",
  preprint: "Preprint",
  book: "Book",
  chapter: "Chapter",
  report: "Report",
  other: "",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Render only as much of a date as the sources actually knew. */
function formatDate(date: string | null, precision: DatePrecision | null): string {
  if (!date) return "No date";
  const [year, month, day] = date.split("-");
  if (precision === "day" && month && day) return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  if (precision === "month" && month) return `${MONTHS[Number(month) - 1]} ${year}`;
  return year;
}

function formatAssessmentDate(raw: string | null): string {
  if (!raw) return "";
  const parsed = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(raw);
  if (!parsed) return raw;
  const [, year, month, day] = parsed;
  if (day && month) return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  if (month) return `${MONTHS[Number(month) - 1]} ${year}`;
  return year;
}

/** The dotted line that says where the assessment sits in the record. */
function AssessmentMarker({ assessmentDate }: { assessmentDate: string | null }) {
  return (
    <li className="relative flex items-center gap-3 py-3" aria-label="Last assessment">
      <span className="relative z-10 flex h-3 w-3 shrink-0 items-center justify-center">
        <span className="h-3 w-3 rounded-full border-2 border-red-500 bg-white dark:bg-zinc-900" />
      </span>
      <span className="whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
        Last assessed{assessmentDate ? ` ${formatAssessmentDate(assessmentDate)}` : ""}
      </span>
      <span className="h-0 flex-1 border-t-2 border-dashed border-red-300 dark:border-red-800/70" />
    </li>
  );
}

function SourceBadge({ source }: { source: WorkProvenance }) {
  const className =
    "rounded border border-zinc-200 px-1.5 py-px text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400";
  if (!source.url) return <span className={className}>{source.label}</span>;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`${className} hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400`}
    >
      {source.label}
    </a>
  );
}

function TimelineRow({
  work,
  isExpanded,
  onToggle,
}: {
  work: LiteratureWork;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const typeLabel = TYPE_LABELS[work.type];
  return (
    <li className="relative flex gap-3">
      {/* Dot on the rail */}
      <span className="relative z-10 mt-2 flex h-3 w-3 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-zinc-300 ring-4 ring-white dark:bg-zinc-600 dark:ring-zinc-900" />
      </span>

      <div className="min-w-0 flex-1 pb-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        >
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap text-xs tabular-nums text-zinc-400">
              {formatDate(work.date, work.datePrecision)}
            </span>
            <span className="text-sm leading-snug text-zinc-800 dark:text-zinc-200">
              {work.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0 text-xs text-zinc-500">
            {work.venue && <span className="truncate max-w-[22rem]">{work.venue}</span>}
            {typeLabel && (
              <span className="rounded bg-zinc-100 px-1.5 py-px text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {typeLabel}
              </span>
            )}
            {work.citations !== null && work.citations > 0 && (
              <span className="tabular-nums text-amber-600 dark:text-amber-500">
                {work.citations.toLocaleString()} citation{work.citations === 1 ? "" : "s"}
              </span>
            )}
            {work.openAccessUrl && (
              <span className="rounded bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                Free to read
              </span>
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="mt-1 space-y-2 px-2 pb-1">
            {work.authors && <div className="text-xs text-zinc-500">{work.authors}</div>}
            {work.abstract && (
              <p className="text-xs leading-relaxed text-zinc-500">{work.abstract}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={work.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
              >
                {work.doi ? "View via DOI" : "View record"}
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              {work.openAccessUrl && work.openAccessUrl !== work.url && (
                <a
                  href={work.openAccessUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  Full text
                </a>
              )}
              <span className="flex flex-wrap items-center gap-1">
                {work.sources.map((source) => (
                  <SourceBadge key={source.id} source={source} />
                ))}
              </span>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** Footer line naming what answered and what didn't. */
function SourceLegend({ sources }: { sources: SourceReport[] }) {
  const contributing = sources.filter((s) => s.status === "ok");
  const missing = sources.filter((s) => s.status !== "ok");

  return (
    <div className="mt-4 space-y-1 border-t border-zinc-100 pt-3 text-[10px] leading-relaxed text-zinc-400 dark:border-zinc-800">
      <div>
        Searched{" "}
        {contributing.map((source, index) => (
          <span key={source.id}>
            {index > 0 && ", "}
            <a
              href={source.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-500 hover:underline"
            >
              {source.label}
            </a>
            {source.fetched > 0 && ` (${source.fetched})`}
          </span>
        ))}
        {contributing.length === 0 && "no sources"} — duplicates merged across sources.
      </div>
      <div>
        Searches match on full text as well as title and abstract, so a work may mention the
        species only in passing. Latin gender variants of the epithet are searched too.
      </div>
      {missing.length > 0 && (
        <div>
          Not included:{" "}
          {missing
            .map((source) => `${source.label}${source.note ? ` — ${source.note}` : ""}`)
            .join("; ")}
          .
        </div>
      )}
    </div>
  );
}

interface LiteratureTimelineProps {
  scientificName: string;
  /** ISO assessment date; where the dotted marker goes. */
  assessmentDate?: string | null;
  /** Fallback when only the year is known. Null/0 means no assessment to mark. */
  assessmentYear?: number | null;
  className?: string;
}

export default function LiteratureTimeline({
  scientificName,
  assessmentDate = null,
  assessmentYear = null,
  className = "",
}: LiteratureTimelineProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const listTopRef = useRef<HTMLDivElement | null>(null);

  const nameVariants = useMemo(() => generateNameVariants(scientificName), [scientificName]);

  // A new species starts at the top of its own timeline.
  useEffect(() => {
    setPage(1);
    setExpandedKey(null);
  }, [scientificName]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          scientificName,
          page: String(page),
          perPage: String(PER_PAGE),
        });
        if (assessmentDate) params.set("assessmentDate", assessmentDate);
        else if (assessmentYear) params.set("assessmentYear", String(assessmentYear));

        const response = await fetch(`/api/literature?${params}`);
        if (!response.ok) throw new Error("Failed to fetch literature");
        const result: TimelineResponse = await response.json();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (scientificName) load();
    return () => {
      cancelled = true;
    };
  }, [scientificName, assessmentDate, assessmentYear, page]);

  const goToPage = useCallback((next: number) => {
    setPage(next);
    setExpandedKey(null);
    listTopRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const searchDisplay =
    nameVariants.length > 1
      ? `${scientificName} + ${nameVariants.length - 1} name variant${nameVariants.length > 2 ? "s" : ""}`
      : scientificName;

  const items = data?.items ?? [];
  const counts = data?.counts;
  const hasAssessment = Boolean(data?.assessmentStamp);

  return (
    <div className={className}>
      <div ref={listTopRef} className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Literature</h3>
        {data && (
          <span className="text-sm text-zinc-500">
            {data.total.toLocaleString()} work{data.total === 1 ? "" : "s"}
            {hasAssessment && counts && (
              <>
                {" — "}
                <span className="text-zinc-700 dark:text-zinc-300">
                  {counts.afterAssessment.toLocaleString()}
                </span>{" "}
                since the last assessment
              </>
            )}
          </span>
        )}
        <span className="text-[10px] text-zinc-400">Searching: {searchDisplay}</span>
      </div>

      {loading && !data && (
        <div className="flex items-center gap-2 py-4 text-sm text-zinc-400">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Searching the literature…
        </div>
      )}

      {error && !data && (
        <div className="py-4 text-sm text-zinc-500">Could not load the literature timeline.</div>
      )}

      {data && items.length === 0 && (
        <div className="py-4 text-sm text-zinc-500">
          No literature found for <span className="italic">{scientificName}</span>.
        </div>
      )}

      {data && items.length > 0 && (
        <div className={`relative ${loading ? "opacity-60 transition-opacity" : ""}`}>
          {/* The rail the dots sit on. */}
          <span
            aria-hidden
            className="absolute bottom-2 left-[5px] top-2 w-px bg-zinc-200 dark:bg-zinc-800"
          />
          <ol className="relative space-y-0">
            {items.map((work, index) => (
              <Fragment key={work.key}>
                {data.markerIndex === index && (
                  <AssessmentMarker assessmentDate={data.assessmentDate} />
                )}
                <TimelineRow
                  work={work}
                  isExpanded={expandedKey === work.key}
                  onToggle={() => setExpandedKey(expandedKey === work.key ? null : work.key)}
                />
              </Fragment>
            ))}
            {data.markerIndex === items.length && (
              <AssessmentMarker assessmentDate={data.assessmentDate} />
            )}
          </ol>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => goToPage(data.page - 1)}
            disabled={data.page <= 1 || loading}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ← Newer
          </button>
          <span className="text-xs text-zinc-500 tabular-nums">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            type="button"
            onClick={() => goToPage(data.page + 1)}
            disabled={data.page >= data.totalPages || loading}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Older →
          </button>
        </div>
      )}

      {data && data.poolTruncated && (
        <p className="mt-2 text-[10px] text-zinc-400">
          Showing the {data.total.toLocaleString()} most recent works found. At least one source
          holds more ({data.upstreamTotal?.toLocaleString()} matches at the largest), so older
          material may not appear here.
        </p>
      )}

      {data && <SourceLegend sources={data.sources} />}
    </div>
  );
}
