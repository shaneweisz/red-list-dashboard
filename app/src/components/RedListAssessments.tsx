"use client";

import { useState, useEffect, useCallback } from "react";
import { CATEGORY_COLORS, CATEGORY_NAMES } from "@/config/taxa";

interface AssessmentDetail {
  assessment_id: number;
  assessment_date: string | null;
  year_published: string | null;
  category: string | null;
  criteria: string | null;
  population_trend: string | null;
  possibly_extinct: boolean;
  possibly_extinct_in_the_wild: boolean;
  habitats: { code: string; name: string; suitability: string | null; major_importance: boolean }[];
  threats: { code: string; title: string; timing: string | null; scope: string | null; severity: string | null }[];
  conservation_actions: { code: string; title: string }[];
  countries: string[];
  rationale: string | null;
  population: string | null;
  range: string | null;
  habitat_and_ecology: string | null;
  use_and_trade: string | null;
  cached?: boolean;
}

interface AssessmentSummary {
  assessment_id: number;
  year: string;
  category: string;
}

interface RedListAssessmentsProps {
  sisTaxonId: number;
  currentAssessmentId: number;
  previousAssessments: AssessmentSummary[];
  scientificName: string;
  currentCategory: string;
  currentYearPublished: string;
}

// Strip HTML tags from API text fields
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] || "#6b7280";
  const name = CATEGORY_NAMES[category] || category;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
      style={{ backgroundColor: color + "22", color, border: `1px solid ${color}44` }}
      title={name}
    >
      {category}
    </span>
  );
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </h4>
      {children}
    </div>
  );
}

function HighlightWrapper({ changed, children }: { changed: boolean; children: React.ReactNode }) {
  if (!changed) return <>{children}</>;
  return (
    <span className="bg-amber-100 dark:bg-amber-900/30 px-0.5 rounded">
      {children}
    </span>
  );
}

function TextSection({
  label,
  text,
  compareText,
  compareMode,
}: {
  label: string;
  text: string | null;
  compareText?: string | null;
  compareMode: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  const cleaned = stripHtml(text);
  const isLong = cleaned.length > 300;
  const displayText = isLong && !expanded ? cleaned.slice(0, 300) + "..." : cleaned;
  const changed = compareMode && compareText !== undefined && text !== compareText;

  return (
    <div>
      <SectionHeader title={label} />
      <div
        className={`text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-line ${
          changed ? "bg-amber-50 dark:bg-amber-900/20 border-l-2 border-amber-400 pl-2" : ""
        }`}
      >
        {displayText}
        {isLong && (
          <button
            className="ml-1 text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

function AssessmentView({
  assessment,
  compareAssessment,
  compareMode,
}: {
  assessment: AssessmentDetail;
  compareAssessment: AssessmentDetail | null;
  compareMode: boolean;
}) {
  const catChanged = compareMode && compareAssessment && assessment.category !== compareAssessment.category;
  const criteriaChanged = compareMode && compareAssessment && assessment.criteria !== compareAssessment.criteria;
  const trendChanged = compareMode && compareAssessment && assessment.population_trend !== compareAssessment.population_trend;

  // Compare threats by title set
  const currentThreats = new Set(assessment.threats.map((t) => t.title));
  const compareThreats = compareAssessment ? new Set(compareAssessment.threats.map((t) => t.title)) : new Set<string>();
  const currentHabitats = new Set(assessment.habitats.map((h) => h.name));
  const compareHabitats = compareAssessment ? new Set(compareAssessment.habitats.map((h) => h.name)) : new Set<string>();
  const currentActions = new Set(assessment.conservation_actions.map((a) => a.title));
  const compareActions = compareAssessment ? new Set(compareAssessment.conservation_actions.map((a) => a.title)) : new Set<string>();

  return (
    <div className="space-y-1">
      {/* Category & Criteria */}
      <div className="flex flex-wrap items-center gap-3 mt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Category:</span>
          <HighlightWrapper changed={!!catChanged}>
            <CategoryBadge category={assessment.category || "?"} />
          </HighlightWrapper>
          {assessment.possibly_extinct && (
            <span className="text-xs text-red-600 dark:text-red-400 font-medium">(Possibly Extinct)</span>
          )}
          {assessment.possibly_extinct_in_the_wild && (
            <span className="text-xs text-red-600 dark:text-red-400 font-medium">(Possibly Extinct in the Wild)</span>
          )}
        </div>
        {assessment.criteria && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Criteria:</span>
            <HighlightWrapper changed={!!criteriaChanged}>
              <code className="text-xs font-mono text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                {assessment.criteria}
              </code>
            </HighlightWrapper>
          </div>
        )}
        {assessment.population_trend && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Trend:</span>
            <HighlightWrapper changed={!!trendChanged}>
              <span className={`text-xs font-medium ${
                assessment.population_trend === "Decreasing" ? "text-red-600 dark:text-red-400" :
                assessment.population_trend === "Increasing" ? "text-green-600 dark:text-green-400" :
                assessment.population_trend === "Stable" ? "text-blue-600 dark:text-blue-400" :
                "text-zinc-500 dark:text-zinc-400"
              }`}>
                {assessment.population_trend === "Decreasing" ? "\u2198" :
                 assessment.population_trend === "Increasing" ? "\u2197" :
                 assessment.population_trend === "Stable" ? "\u2192" : ""}{" "}
                {assessment.population_trend}
              </span>
            </HighlightWrapper>
          </div>
        )}
      </div>

      {/* Rationale */}
      <TextSection
        label="Rationale"
        text={assessment.rationale}
        compareText={compareAssessment?.rationale}
        compareMode={compareMode}
      />

      {/* Population */}
      <TextSection
        label="Population"
        text={assessment.population}
        compareText={compareAssessment?.population}
        compareMode={compareMode}
      />

      {/* Range */}
      <TextSection
        label="Range"
        text={assessment.range}
        compareText={compareAssessment?.range}
        compareMode={compareMode}
      />

      {/* Habitat & Ecology */}
      <TextSection
        label="Habitat & Ecology"
        text={assessment.habitat_and_ecology}
        compareText={compareAssessment?.habitat_and_ecology}
        compareMode={compareMode}
      />

      {/* Habitats */}
      {assessment.habitats.length > 0 && (
        <div>
          <SectionHeader title="Habitats" />
          <div className="flex flex-wrap gap-1.5">
            {assessment.habitats.map((h, i) => {
              const isNew = compareMode && !compareHabitats.has(h.name);
              return (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                    isNew
                      ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400"
                      : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                  }`}
                  title={[h.suitability && `Suitability: ${h.suitability}`, h.major_importance && "Major importance"].filter(Boolean).join(", ") || undefined}
                >
                  {h.name}
                  {h.major_importance && <span className="text-amber-500">*</span>}
                </span>
              );
            })}
            {/* Show removed habitats in compare mode */}
            {compareMode && compareAssessment && compareAssessment.habitats
              .filter((h) => !currentHabitats.has(h.name))
              .map((h, i) => (
                <span
                  key={`removed-${i}`}
                  className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-500 dark:text-red-400 line-through"
                >
                  {h.name}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Threats */}
      {assessment.threats.length > 0 && (
        <div>
          <SectionHeader title="Threats">
            <span className="text-[10px] text-zinc-400">({assessment.threats.length})</span>
          </SectionHeader>
          <div className="space-y-1">
            {assessment.threats.map((t, i) => {
              const isNew = compareMode && !compareThreats.has(t.title);
              return (
                <div
                  key={i}
                  className={`text-xs flex items-start gap-2 py-0.5 ${
                    isNew ? "bg-green-50 dark:bg-green-900/20 px-1 rounded" : ""
                  }`}
                >
                  <span className="text-zinc-400 font-mono text-[10px] mt-0.5 flex-shrink-0">{t.code}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{t.title}</span>
                  {(t.timing || t.scope || t.severity) && (
                    <span className="text-zinc-400 text-[10px] flex-shrink-0">
                      {[t.timing, t.scope, t.severity].filter(Boolean).join(" / ")}
                    </span>
                  )}
                </div>
              );
            })}
            {/* Show removed threats in compare mode */}
            {compareMode && compareAssessment && compareAssessment.threats
              .filter((t) => !currentThreats.has(t.title))
              .map((t, i) => (
                <div key={`removed-${i}`} className="text-xs flex items-start gap-2 py-0.5 bg-red-50 dark:bg-red-900/20 px-1 rounded">
                  <span className="text-zinc-400 font-mono text-[10px] mt-0.5 flex-shrink-0">{t.code}</span>
                  <span className="text-red-500 dark:text-red-400 line-through">{t.title}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Conservation Actions */}
      {assessment.conservation_actions.length > 0 && (
        <div>
          <SectionHeader title="Conservation Actions">
            <span className="text-[10px] text-zinc-400">({assessment.conservation_actions.length})</span>
          </SectionHeader>
          <div className="space-y-0.5">
            {assessment.conservation_actions.map((a, i) => {
              const isNew = compareMode && !compareActions.has(a.title);
              return (
                <div
                  key={i}
                  className={`text-xs flex items-start gap-2 py-0.5 ${
                    isNew ? "bg-green-50 dark:bg-green-900/20 px-1 rounded" : ""
                  }`}
                >
                  <span className="text-zinc-400 font-mono text-[10px] mt-0.5 flex-shrink-0">{a.code}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{a.title}</span>
                </div>
              );
            })}
            {/* Show removed actions in compare mode */}
            {compareMode && compareAssessment && compareAssessment.conservation_actions
              .filter((a) => !currentActions.has(a.title))
              .map((a, i) => (
                <div key={`removed-${i}`} className="text-xs flex items-start gap-2 py-0.5 bg-red-50 dark:bg-red-900/20 px-1 rounded">
                  <span className="text-zinc-400 font-mono text-[10px] mt-0.5 flex-shrink-0">{a.code}</span>
                  <span className="text-red-500 dark:text-red-400 line-through">{a.title}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Use & Trade */}
      <TextSection
        label="Use & Trade"
        text={assessment.use_and_trade}
        compareText={compareAssessment?.use_and_trade}
        compareMode={compareMode}
      />

      {/* Countries */}
      {assessment.countries.length > 0 && (
        <div>
          <SectionHeader title="Range Countries">
            <span className="text-[10px] text-zinc-400">({assessment.countries.length})</span>
          </SectionHeader>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            {assessment.countries.join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RedListAssessments({
  sisTaxonId,
  currentAssessmentId,
  previousAssessments,
  scientificName,
  currentCategory,
  currentYearPublished,
}: RedListAssessmentsProps) {
  // Build full timeline: current + previous, sorted newest first
  const allAssessments: AssessmentSummary[] = [
    { assessment_id: currentAssessmentId, year: currentYearPublished, category: currentCategory },
    ...previousAssessments,
  ].sort((a, b) => parseInt(b.year) - parseInt(a.year));

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [assessmentData, setAssessmentData] = useState<Record<number, AssessmentDetail>>({});
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [errorIds, setErrorIds] = useState<Set<number>>(new Set());

  const selectedAssessment = allAssessments[selectedIndex];
  const compareAssessment = compareMode && selectedIndex < allAssessments.length - 1
    ? allAssessments[selectedIndex + 1]
    : null;

  const fetchAssessment = useCallback(async (assessmentId: number) => {
    if (assessmentData[assessmentId] || loadingIds.has(assessmentId)) return;

    setLoadingIds((prev) => new Set(prev).add(assessmentId));
    try {
      const response = await fetch(`/api/redlist/assessment/${assessmentId}`);
      if (!response.ok) throw new Error("Failed to fetch");
      const data: AssessmentDetail = await response.json();
      setAssessmentData((prev) => ({ ...prev, [assessmentId]: data }));
    } catch {
      setErrorIds((prev) => new Set(prev).add(assessmentId));
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(assessmentId);
        return next;
      });
    }
  }, [assessmentData, loadingIds]);

  // Fetch the selected assessment and compare assessment
  useEffect(() => {
    if (selectedAssessment) {
      fetchAssessment(selectedAssessment.assessment_id);
    }
    if (compareAssessment) {
      fetchAssessment(compareAssessment.assessment_id);
    }
  }, [selectedAssessment, compareAssessment, fetchAssessment]);

  const selectedData = selectedAssessment ? assessmentData[selectedAssessment.assessment_id] : null;
  const compareData = compareAssessment ? assessmentData[compareAssessment.assessment_id] : null;
  const isLoading = selectedAssessment && loadingIds.has(selectedAssessment.assessment_id);
  const hasError = selectedAssessment && errorIds.has(selectedAssessment.assessment_id);

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Red List Assessments
        </h3>
        <span className="text-xs text-zinc-500">
          {allAssessments.length} assessment{allAssessments.length !== 1 ? "s" : ""}
        </span>
        <a
          href={`https://www.iucnredlist.org/species/${sisTaxonId}/${currentAssessmentId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          View on IUCN Red List →
        </a>
      </div>

      {/* Assessment timeline nav */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {allAssessments.map((a, i) => (
            <button
              key={a.assessment_id}
              className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                selectedIndex === i
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              } ${i > 0 ? "border-l border-zinc-200 dark:border-zinc-700" : ""}`}
              onClick={() => setSelectedIndex(i)}
              title={`Assessment ${a.assessment_id}`}
            >
              {a.year}
              <CategoryBadge category={a.category} />
              {i === 0 && <span className="text-[10px] text-zinc-400">(latest)</span>}
            </button>
          ))}
        </div>

        {/* Navigation arrows */}
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
            disabled={selectedIndex === 0}
            title="Newer assessment"
          >
            <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => setSelectedIndex((i) => Math.min(allAssessments.length - 1, i + 1))}
            disabled={selectedIndex === allAssessments.length - 1}
            title="Older assessment"
          >
            <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Compare toggle */}
        {allAssessments.length > 1 && (
          <button
            className={`ml-auto px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
              compareMode
                ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
            onClick={() => setCompareMode(!compareMode)}
            title={compareMode ? "Disable compare mode" : "Compare with previous assessment"}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5l-7 7 7 7" />
            </svg>
            Compare
          </button>
        )}
      </div>

      {/* Compare mode legend */}
      {compareMode && compareAssessment && (
        <div className="text-[10px] text-zinc-400 mb-3 flex items-center gap-3">
          <span>
            Comparing <strong className="text-zinc-600 dark:text-zinc-300">{selectedAssessment.year}</strong> with previous <strong className="text-zinc-600 dark:text-zinc-300">{compareAssessment.year}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-200 dark:bg-amber-800 border border-amber-400" /> Changed
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-green-200 dark:bg-green-800 border border-green-400" /> Added
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-red-200 dark:bg-red-800 border border-red-400" /> Removed
          </span>
        </div>
      )}

      {/* Content */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-4">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading assessment details...
        </div>
      )}

      {hasError && (
        <div className="text-sm text-red-500 py-4">
          Failed to load assessment details.{" "}
          <button
            className="text-blue-500 hover:underline"
            onClick={() => {
              setErrorIds((prev) => {
                const next = new Set(prev);
                next.delete(selectedAssessment.assessment_id);
                return next;
              });
              fetchAssessment(selectedAssessment.assessment_id);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {selectedData && (
        <AssessmentView
          assessment={selectedData}
          compareAssessment={compareMode ? compareData || null : null}
          compareMode={compareMode && compareData !== undefined}
        />
      )}

      {/* Subtle note */}
      <p className="text-[10px] text-zinc-400 mt-4">
        Data from the <a href="https://www.iucnredlist.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-500" onClick={(e) => e.stopPropagation()}>IUCN Red List of Threatened Species</a> API v4
      </p>
    </div>
  );
}
