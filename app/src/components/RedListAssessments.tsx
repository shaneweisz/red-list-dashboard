"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CATEGORY_COLORS, CATEGORY_NAMES, normalizeCategory } from "@/config/taxa";
import { stripHtml } from "@/lib/html-text";

interface PreviousAssessment {
  year: string;
  assessment_id: number;
  category: string;
  assessors?: string | null;
  reviewers?: string | null;
}

interface AssessmentDetail {
  assessment_id: number;
  sis_taxon_id: number;
  url: string;
  red_list_category: { code: string; description?: string } | string | null;
  criteria: string | null;
  assessment_date: string | null;
  year_published: string | null;
  possibly_extinct: boolean | null;
  possibly_extinct_in_the_wild: boolean | null;
  rationale: string | null;
  population: string | null;
  habitat: string | null;
  threats: string | null;
  conservation_actions: string | null;
  use_trade: string | null;
  range: string | null;
  population_trend: { code: string; description?: string } | string | null;
  habitats: ({ code: string; name: string; suitability?: string | null; season?: string | null; major_importance?: string | null } | string)[] | null;
  threat_classification: ({ code: string; name: string; timing?: string | null; scope?: string | null; severity?: string | null; score?: string | null; stresses?: string[] | null } | string)[] | null;
  conservation_actions_classification: ({ code: string; name: string } | string)[] | null;
  systems: ({ code: string; description?: string } | string)[] | null;
  scopes: ({ code: string; description?: string } | string)[] | null;
  supplementary_info: {
    estimated_extent_of_occurence: string | null;
    estimated_area_of_occupancy: string | null;
    population_size: string | null;
    number_of_locations: string | null;
    no_of_subpopulations: string | null;
    generational_length: string | null;
    upper_elevation_limit: number | null;
    lower_elevation_limit: number | null;
    upper_depth_limit: number | null;
    lower_depth_limit: number | null;
    movement_patterns: string | null;
    congregatory: string | null;
    population_severely_fragmented: string | null;
    population_continuing_decline: string | null;
    continuing_decline_in_extent_of_occurence: string | null;
    continuing_decline_in_area_of_occupancy: string | null;
    continuing_decline_in_number_of_locations: string | null;
  } | null;
  cached?: boolean;
  error?: string;
}

interface RedListAssessmentsProps {
  sisTaxonId?: number;
  currentAssessmentId: number;
  currentCategory: string;
  currentAssessmentDate: string | null;
  previousAssessments: PreviousAssessment[];
  speciesUrl: string;
}

// Format ISO date string to human-readable form (e.g. "25 July 2022")
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

// Safely extract category code from red_list_category (can be string or object)
function getCategoryCode(cat: AssessmentDetail["red_list_category"]): string {
  if (!cat) return "?";
  if (typeof cat === "string") return cat;
  return cat.code || "?";
}

// Safely extract population trend text (can be string or object)
function getTrendText(trend: AssessmentDetail["population_trend"]): string {
  if (!trend) return "";
  if (typeof trend === "string") return trend;
  return trend.description || trend.code || "";
}

function CategoryBadge({ code, small }: { code: string; small?: boolean }) {
  const normalized = normalizeCategory(code);
  const color = CATEGORY_COLORS[normalized] || "#6b7280";
  const name = CATEGORY_NAMES[normalized] || code;
  const isLegacy = code !== normalized && !CATEGORY_NAMES[code];
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded ${small ? "text-xs px-1.5 py-0.5" : "text-sm px-2 py-1"}`}
      style={{ backgroundColor: color + "20", color }}
      title={isLegacy ? `${code} (legacy) -> ${name}` : name}
    >
      {code}
      {!small && <span className="font-normal opacity-75">{name}</span>}
    </span>
  );
}

// A narrative section of the assessment. Always expanded — the assessment text
// is the point of the tab, so there is nothing to hide behind a toggle.
function NarrativeSection({ title, content }: { title: string; content: string }) {
  const text = stripHtml(content);
  if (!text) return null;

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-0 py-2">
      <h5 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</h5>
      <div className="pt-1 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-line leading-relaxed">
        {text}
      </div>
    </div>
  );
}

// Comparison view showing diff between two assessments
function AssessmentComparison({
  older,
  newer,
}: {
  older: AssessmentDetail;
  newer: AssessmentDetail;
}) {
  const olderCat = getCategoryCode(older.red_list_category);
  const newerCat = getCategoryCode(newer.red_list_category);
  const olderNorm = normalizeCategory(olderCat);
  const newerNorm = normalizeCategory(newerCat);

  const categoryChanged = olderNorm !== newerNorm;
  const olderOrder = getCategoryThreatLevel(olderNorm);
  const newerOrder = getCategoryThreatLevel(newerNorm);
  const improved = newerOrder > olderOrder; // higher order = less threatened
  const worsened = newerOrder < olderOrder;

  const sections: { key: string; title: string; field: keyof AssessmentDetail }[] = [
    { key: "rationale", title: "Rationale", field: "rationale" },
    { key: "population", title: "Population", field: "population" },
    { key: "habitat", title: "Habitat & Ecology", field: "habitat" },
    { key: "threats", title: "Threats", field: "threats" },
    { key: "conservation", title: "Conservation Actions", field: "conservation_actions" },
    { key: "range", title: "Geographic Range", field: "range" },
  ];

  return (
    <div className="space-y-4">
      {/* Category change header */}
      {categoryChanged && (
        <div
          className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
            improved
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
              : worsened
              ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
              : "bg-zinc-50 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400"
          }`}
        >
          <CategoryBadge code={olderCat} small />
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <CategoryBadge code={newerCat} small />
          <span className="ml-1">
            {improved ? "Status improved" : worsened ? "Status worsened" : "Category changed"}
          </span>
        </div>
      )}
      {!categoryChanged && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-sm text-zinc-500">
          <CategoryBadge code={newerCat} small />
          <span>Category unchanged between assessments</span>
        </div>
      )}

      {/* Criteria change */}
      {older.criteria !== newer.criteria && (older.criteria || newer.criteria) && (
        <div className="text-sm space-y-1">
          <div className="font-medium text-zinc-700 dark:text-zinc-300">Criteria</div>
          <div className="flex gap-4 text-xs">
            {older.criteria && (
              <span className="text-zinc-400 line-through">{older.criteria}</span>
            )}
            {newer.criteria && (
              <span className="text-zinc-600 dark:text-zinc-300">{newer.criteria}</span>
            )}
          </div>
        </div>
      )}

      {/* Narrative sections - show only where content differs */}
      {sections.map(({ key, title, field }) => {
        const olderText = older[field] ? stripHtml(older[field] as string) : null;
        const newerText = newer[field] ? stripHtml(newer[field] as string) : null;
        if (!olderText && !newerText) return null;
        if (olderText === newerText) return null;

        return (
          <ComparisonSection
            key={key}
            title={title}
            olderText={olderText}
            newerText={newerText}
            olderYear={older.year_published || older.assessment_date?.split("-")[0] || "?"}
            newerYear={newer.year_published || newer.assessment_date?.split("-")[0] || "?"}
          />
        );
      })}

      {/* If all narrative sections are the same, show a note */}
      {sections.every(({ field }) => {
        const ot = older[field] ? stripHtml(older[field] as string) : null;
        const nt = newer[field] ? stripHtml(newer[field] as string) : null;
        return ot === nt;
      }) && (
        <div className="text-sm text-zinc-400 italic py-2">
          No changes in narrative text between these assessments.
        </div>
      )}
    </div>
  );
}

function ComparisonSection({
  title,
  olderText,
  newerText,
  olderYear,
  newerYear,
}: {
  title: string;
  olderText: string | null;
  newerText: string | null;
  olderYear: string;
  newerYear: string;
}) {
  return (
    <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border-b border-zinc-100 dark:border-zinc-800">
        {title}
        <span className="text-xs text-zinc-400 font-normal">(changed)</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-zinc-100 dark:divide-zinc-800">
        <div className="p-3">
          <div className="text-xs font-medium text-zinc-400 mb-1">{olderYear} assessment</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-line leading-relaxed">
            {olderText || <span className="italic">Not available</span>}
          </div>
        </div>
        <div className="p-3">
          <div className="text-xs font-medium text-zinc-400 mb-1">{newerYear} assessment</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-line leading-relaxed">
            {newerText || <span className="italic">Not available</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function getCategoryThreatLevel(code: string): number {
  const order: Record<string, number> = {
    EX: 0, EW: 1, CR: 2, EN: 3, VU: 4, NT: 5, LC: 6, DD: 7, NE: 8,
  };
  return order[code] ?? 5;
}

// Loading spinner
function Spinner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400 py-4">
      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      {text}
    </div>
  );
}

export default function RedListAssessments({
  currentAssessmentId,
  currentCategory,
  currentAssessmentDate,
  previousAssessments,
  speciesUrl,
}: RedListAssessmentsProps) {
  // All assessments timeline, sorted oldest-first (left to right).
  // If previousAssessments includes the current one, use it directly;
  // otherwise fall back to constructing from current* props.
  const hasCurrentInHistory = previousAssessments.some((a) => a.assessment_id === currentAssessmentId);
  const allAssessments = hasCurrentInHistory
    ? [...previousAssessments].sort((a, b) => (a.year || "0").localeCompare(b.year || "0"))
    : [
        {
          year: currentAssessmentDate?.split("-")[0] || "Current",
          assessment_id: currentAssessmentId,
          category: currentCategory,
        },
        ...previousAssessments,
      ].sort((a, b) => (a.year || "0").localeCompare(b.year || "0"));

  const [selectedIndex, setSelectedIndex] = useState(allAssessments.length - 1);
  // History is fetched lazily, so allAssessments can grow from 1 → N after mount
  // (and changes when switching species). Default the selection to the newest
  // assessment whenever the set size changes; manual timeline clicks (which don't
  // change the size) are preserved.
  useEffect(() => {
    setSelectedIndex(allAssessments.length - 1);
  }, [allAssessments.length]);
  const [compareMode, setCompareMode] = useState(false);
  const [assessmentDetails, setAssessmentDetails] = useState<Record<number, AssessmentDetail>>({});
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [errorIds, setErrorIds] = useState<Set<number>>(new Set());

  // Use refs for the guard check to avoid stale closures in useCallback
  const detailsRef = useRef(assessmentDetails);
  detailsRef.current = assessmentDetails;
  const loadingRef = useRef(loadingIds);
  loadingRef.current = loadingIds;
  const errorRef = useRef(errorIds);
  errorRef.current = errorIds;

  const fetchAssessment = useCallback(async (assessmentId: number) => {
    if (detailsRef.current[assessmentId] || loadingRef.current.has(assessmentId) || errorRef.current.has(assessmentId)) return;

    setLoadingIds((prev) => new Set(prev).add(assessmentId));
    setErrorIds((prev) => {
      const next = new Set(prev);
      next.delete(assessmentId);
      return next;
    });

    try {
      const res = await fetch(`/api/redlist/assessment/${assessmentId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AssessmentDetail = await res.json();
      setAssessmentDetails((prev) => ({ ...prev, [assessmentId]: data }));
    } catch {
      setErrorIds((prev) => new Set(prev).add(assessmentId));
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(assessmentId);
        return next;
      });
    }
  }, []);

  // Fetch the selected assessment on mount/selection change
  useEffect(() => {
    const selected = allAssessments[selectedIndex];
    if (selected) {
      fetchAssessment(selected.assessment_id);
    }
    // In compare mode, also fetch the previous (older) assessment
    if (compareMode && selectedIndex > 0) {
      fetchAssessment(allAssessments[selectedIndex - 1].assessment_id);
    }
  }, [selectedIndex, compareMode, allAssessments, fetchAssessment]);

  const selectedAssessment = allAssessments[selectedIndex];
  const selectedDetail = selectedAssessment ? assessmentDetails[selectedAssessment.assessment_id] : null;
  const olderAssessment = selectedIndex > 0 ? allAssessments[selectedIndex - 1] : null;
  const olderDetail = olderAssessment ? assessmentDetails[olderAssessment.assessment_id] : null;

  const isLoading = selectedAssessment && loadingIds.has(selectedAssessment.assessment_id);
  const hasError = selectedAssessment && errorIds.has(selectedAssessment.assessment_id);
  const isCompareLoading = olderAssessment && loadingIds.has(olderAssessment.assessment_id);

  return (
    <div className="p-4 space-y-4">
      {/* Header with timeline and controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Red List Assessments
          </h3>
          <span className="text-xs text-zinc-400">
            {allAssessments.length} assessment{allAssessments.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          {/* Compare toggle */}
          {allAssessments.length >= 2 && (
            <button
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                compareMode
                  ? "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400"
                  : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
              onClick={() => setCompareMode(!compareMode)}
            >
              {compareMode ? "Exit comparison" : "Compare"}
            </button>
          )}

          {/* IUCN link */}
          <a
            href={speciesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
          >
            View on IUCN Red List website
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      {/* Assessment timeline navigation */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {allAssessments.map((a, i) => {
          const normalized = normalizeCategory(a.category);
          const color = CATEGORY_COLORS[normalized] || "#6b7280";
          const isSelected = i === selectedIndex;
          const isCompareTarget = compareMode && i === selectedIndex - 1;

          return (
            <button
              key={a.assessment_id}
              className={`flex flex-col items-center px-3 py-1.5 rounded-lg text-xs transition-colors flex-shrink-0 ${
                isSelected
                  ? "bg-zinc-100 dark:bg-zinc-800 ring-1 ring-zinc-300 dark:ring-zinc-600"
                  : isCompareTarget
                  ? "bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              }`}
              onClick={() => setSelectedIndex(i)}
              title={`${a.year} - ${a.category}`}
            >
              <span
                className="font-semibold"
                style={{ color }}
              >
                {a.category}
              </span>
              <span className="text-zinc-400 text-[10px]">{a.year}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading && <Spinner text="Loading assessment..." />}

      {hasError && (
        <div className="text-sm text-red-500 py-2">
          Failed to load assessment details.{" "}
          <button
            className="underline hover:text-red-600"
            onClick={() => selectedAssessment && fetchAssessment(selectedAssessment.assessment_id)}
          >
            Retry
          </button>
        </div>
      )}

      {/* Single assessment view */}
      {!compareMode && selectedDetail && !isLoading && (
        <AssessmentDetailView detail={selectedDetail} assessment={selectedAssessment} />
      )}

      {/* Comparison view */}
      {compareMode && !isLoading && !isCompareLoading && selectedDetail && olderDetail && (
        <AssessmentComparison older={olderDetail} newer={selectedDetail} />
      )}

      {compareMode && !isLoading && isCompareLoading && (
        <Spinner text="Loading comparison assessment..." />
      )}

      {compareMode && !olderAssessment && (
        <div className="text-sm text-zinc-400 py-2 italic">
          No previous assessment to compare with. This is the earliest assessment.
        </div>
      )}

      {/* Footer attribution — required by IUCN Red List Terms of Use */}
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-2 space-y-1">
        <p>
          IUCN ({new Date().getFullYear()}).{" "}
          <em>The IUCN Red List of Threatened Species.</em> Version 2026-1.{" "}
          <a
            href="https://www.iucnredlist.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            https://www.iucnredlist.org
          </a>
          . Subject to IUCN Red List{" "}
          <a
            href="https://www.iucnredlist.org/terms/terms-of-use"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Terms of Use
          </a>
          .
        </p>
      </div>
    </div>
  );
}

// Format large numbers with commas and optional unit
function formatMetric(value: string | number | null, unit?: string): string | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  const formatted = num.toLocaleString("en", { maximumFractionDigits: 1 });
  return unit ? `${formatted} ${unit}` : formatted;
}

// Compact grid showing key quantitative metrics from supplementary_info
function SupplementaryMetrics({
  info,
}: {
  info: AssessmentDetail["supplementary_info"];
}) {
  if (!info) return null;

  // Build list of metrics to show (only non-null values)
  const metrics: { label: string; value: string; declining?: boolean }[] = [];

  if (info.estimated_extent_of_occurence) {
    const v = formatMetric(info.estimated_extent_of_occurence, "km²");
    if (v) metrics.push({
      label: "EOO",
      value: v,
      declining: info.continuing_decline_in_extent_of_occurence === "Yes",
    });
  }
  if (info.estimated_area_of_occupancy) {
    const v = formatMetric(info.estimated_area_of_occupancy, "km²");
    if (v) metrics.push({
      label: "AOO",
      value: v,
      declining: info.continuing_decline_in_area_of_occupancy === "Yes",
    });
  }
  if (info.population_size) {
    const v = formatMetric(info.population_size);
    if (v) metrics.push({
      label: "Population",
      value: v,
      declining: info.population_continuing_decline === "Yes",
    });
  }
  if (info.number_of_locations) {
    const v = formatMetric(info.number_of_locations);
    if (v) metrics.push({
      label: "Locations",
      value: v,
      declining: info.continuing_decline_in_number_of_locations === "Yes",
    });
  }
  if (info.no_of_subpopulations) {
    metrics.push({ label: "Subpopulations", value: info.no_of_subpopulations });
  }
  if (info.generational_length) {
    const v = formatMetric(info.generational_length, "yr");
    if (v) metrics.push({ label: "Generation length", value: v });
  }

  // Elevation range
  if (info.lower_elevation_limit != null || info.upper_elevation_limit != null) {
    const lo = info.lower_elevation_limit;
    const hi = info.upper_elevation_limit;
    if (lo != null && hi != null) {
      metrics.push({ label: "Elevation", value: `${lo.toLocaleString()}–${hi.toLocaleString()} m` });
    } else if (hi != null) {
      metrics.push({ label: "Elevation", value: `≤ ${hi.toLocaleString()} m` });
    } else if (lo != null) {
      metrics.push({ label: "Elevation", value: `≥ ${lo.toLocaleString()} m` });
    }
  }

  // Depth range
  if (info.lower_depth_limit != null || info.upper_depth_limit != null) {
    const shallow = info.upper_depth_limit;
    const deep = info.lower_depth_limit;
    if (shallow != null && deep != null) {
      metrics.push({ label: "Depth", value: `${shallow.toLocaleString()}–${deep.toLocaleString()} m` });
    } else if (deep != null) {
      metrics.push({ label: "Depth", value: `≤ ${deep.toLocaleString()} m` });
    }
  }

  if (info.movement_patterns) {
    metrics.push({ label: "Movement", value: info.movement_patterns });
  }
  if (info.congregatory) {
    metrics.push({ label: "Congregatory", value: info.congregatory });
  }
  if (info.population_severely_fragmented === "Yes") {
    metrics.push({ label: "Severely fragmented", value: "Yes" });
  }

  if (metrics.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2 py-2 px-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-zinc-100 dark:border-zinc-800">
      {metrics.map((m, i) => (
        <div key={i} className="min-w-0">
          <div className="text-xs sm:text-[10px] uppercase tracking-wider text-zinc-400 truncate">
            {m.label}
          </div>
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate flex items-center gap-1">
            {m.value}
            {m.declining && (
              <span className="text-red-500 text-xs" title="Continuing decline">↓</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// A qualifier on a habitat or threat code — "Suitability: Marginal",
// "Severity: Rapid declines". These qualifiers are what separate a habitat the
// species merely tolerates from one it depends on, so they are spelled out on
// screen rather than tucked into a hover tooltip.
type Qualifier = { label: string; value: string | null };

// Values that mean "this one carries weight" and are worth picking out in colour.
const ALERT_VALUES = /ongoing|whole|majority|rapid declin|high impact/i;
const GOOD_VALUES = /^(yes|suitable)$/i;

function qualifierTone(value: string): "alert" | "good" | undefined {
  if (ALERT_VALUES.test(value)) return "alert";
  if (GOOD_VALUES.test(value)) return "good";
  return undefined;
}

function QualifierList({ items }: { items: Qualifier[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-1 text-[11px] leading-snug">
      {items.map((q) => {
        const tone = q.value ? qualifierTone(q.value) : undefined;
        return (
          <span key={q.label} className="text-zinc-400 dark:text-zinc-500">
            {q.label}:{" "}
            {q.value ? (
              <span
                className={
                  tone === "alert"
                    ? "font-medium text-red-600 dark:text-red-400"
                    : tone === "good"
                    ? "font-medium text-emerald-700 dark:text-emerald-400"
                    : "text-zinc-600 dark:text-zinc-300"
                }
              >
                {q.value}
              </span>
            ) : (
              <span className="italic text-zinc-400 dark:text-zinc-600">not specified</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// One entry of an IUCN classification scheme (habitat, threat, action): its
// code, its name, and any qualifiers underneath.
function ClassificationRow({
  code,
  name,
  qualifiers,
  footnote,
}: {
  code?: string;
  name: string;
  qualifiers?: Qualifier[];
  footnote?: string | null;
}) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline gap-2">
        {code && (
          <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0 w-12">
            {code}
          </span>
        )}
        <span className="text-sm text-zinc-700 dark:text-zinc-300">{name}</span>
      </div>
      <div className={code ? "pl-14" : undefined}>
        {qualifiers && <QualifierList items={qualifiers} />}
        {footnote && (
          <div className="mt-1 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{footnote}</div>
        )}
      </div>
    </li>
  );
}

function ClassificationSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
        {title} <span className="text-zinc-400 dark:text-zinc-500 font-normal">({count})</span>
      </h4>
      <ul className="rounded-lg border border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
        {children}
      </ul>
    </div>
  );
}

function AssessmentDetailView({
  detail,
  assessment,
}: {
  detail: AssessmentDetail;
  assessment: { year: string; assessment_id: number; category: string; assessors?: string | null; reviewers?: string | null };
}) {
  const catCode = getCategoryCode(detail.red_list_category) !== "?" ? getCategoryCode(detail.red_list_category) : assessment.category;
  const trendText = getTrendText(detail.population_trend);

  return (
    <div className="space-y-3">
      {/* Assessment header */}
      <div className="flex flex-wrap items-center gap-3">
        <CategoryBadge code={catCode} />
        {detail.criteria && (
          <span className="text-sm text-zinc-500 font-mono">
            Criteria: {detail.criteria}
          </span>
        )}
        {trendText && (
          <span className="text-xs text-zinc-400 flex items-center gap-1">
            Trend:{" "}
            <span className={
              trendText.toLowerCase().includes("decreasing")
                ? "text-red-500"
                : trendText.toLowerCase().includes("increasing")
                ? "text-green-500"
                : "text-zinc-500"
            }>
              {trendText}
            </span>
          </span>
        )}
        {detail.possibly_extinct && (
          <span className="text-xs px-2 py-0.5 bg-black/10 dark:bg-white/10 text-red-600 dark:text-red-400 rounded font-medium">
            Possibly Extinct
          </span>
        )}
        {detail.possibly_extinct_in_the_wild && (
          <span className="text-xs px-2 py-0.5 bg-black/10 dark:bg-white/10 text-red-600 dark:text-red-400 rounded font-medium">
            Possibly Extinct in the Wild
          </span>
        )}
      </div>

      {/* Date and systems */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
        {detail.assessment_date && (
          <span>Assessed: {formatDate(detail.assessment_date)}</span>
        )}
        {detail.year_published && (
          <span>Published: {detail.year_published}</span>
        )}
        {detail.systems && detail.systems.length > 0 && (
          <span>
            Systems: {detail.systems.map((s) => typeof s === "string" ? s : (s.description || s.code)).join(", ")}
          </span>
        )}
      </div>

      {/* Assessors & Reviewers */}
      {(assessment.assessors || assessment.reviewers) && (
        <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-0.5">
          {assessment.assessors && <div><span className="font-medium">Assessors:</span> {assessment.assessors}</div>}
          {assessment.reviewers && <div><span className="font-medium">Reviewers:</span> {assessment.reviewers}</div>}
        </div>
      )}

      {/* Key metrics grid */}
      <SupplementaryMetrics info={detail.supplementary_info} />

      {/* Narrative sections */}
      <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg overflow-hidden px-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {detail.rationale && <NarrativeSection title="Rationale" content={detail.rationale} />}
        {detail.population && <NarrativeSection title="Population" content={detail.population} />}
        {detail.habitat && <NarrativeSection title="Habitat & Ecology" content={detail.habitat} />}
        {detail.threats && <NarrativeSection title="Threats" content={detail.threats} />}
        {detail.conservation_actions && <NarrativeSection title="Conservation Actions" content={detail.conservation_actions} />}
        {detail.use_trade && <NarrativeSection title="Use & Trade" content={detail.use_trade} />}
        {detail.range && <NarrativeSection title="Geographic Range" content={detail.range} />}
      </div>

      {/* Structured data: Habitats */}
      {detail.habitats && detail.habitats.length > 0 && (
        <ClassificationSection title="Habitats" count={detail.habitats.length}>
          {detail.habitats.map((h, i) =>
            typeof h === "string" ? (
              <ClassificationRow key={i} name={h} />
            ) : (
              <ClassificationRow
                key={i}
                code={h.code}
                name={h.name}
                qualifiers={[
                  { label: "Suitability", value: h.suitability ?? null },
                  ...(h.season ? [{ label: "Season", value: h.season }] : []),
                  { label: "Major importance", value: h.major_importance ?? null },
                ]}
              />
            )
          )}
        </ClassificationSection>
      )}

      {/* Structured data: Threats */}
      {detail.threat_classification && detail.threat_classification.length > 0 && (
        <ClassificationSection title="Threats" count={detail.threat_classification.length}>
          {detail.threat_classification.map((t, i) =>
            typeof t === "string" ? (
              <ClassificationRow key={i} name={t} />
            ) : (
              <ClassificationRow
                key={i}
                code={t.code}
                name={t.name}
                qualifiers={[
                  { label: "Timing", value: t.timing ?? null },
                  { label: "Scope", value: t.scope ?? null },
                  { label: "Severity", value: t.severity ?? null },
                  { label: "Impact", value: t.score ?? null },
                ]}
                footnote={
                  t.stresses && t.stresses.length > 0
                    ? `Stresses: ${t.stresses.join(", ")}`
                    : null
                }
              />
            )
          )}
        </ClassificationSection>
      )}

      {/* Structured data: Conservation Actions */}
      {detail.conservation_actions_classification && detail.conservation_actions_classification.length > 0 && (
        <ClassificationSection
          title="Conservation Actions"
          count={detail.conservation_actions_classification.length}
        >
          {detail.conservation_actions_classification.map((c, i) =>
            typeof c === "string" ? (
              <ClassificationRow key={i} name={c} />
            ) : (
              <ClassificationRow key={i} code={c.code} name={c.name} />
            )
          )}
        </ClassificationSection>
      )}

      {/* No narrative data message */}
      {!detail.rationale && !detail.population && !detail.habitat && !detail.threats && !detail.conservation_actions && !detail.range && (
        <div className="text-sm text-zinc-400 py-2 italic">
          No detailed narrative data available for this assessment. View the full assessment on{" "}
          <a
            href={detail.url || `https://www.iucnredlist.org/species/${detail.sis_taxon_id}/${detail.assessment_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            IUCN Red List
          </a>
          .
        </div>
      )}
    </div>
  );
}
