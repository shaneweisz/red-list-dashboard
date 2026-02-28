"use client";

import { useState, useCallback } from "react";
import {
  EOO_THRESHOLDS,
  AOO_THRESHOLDS,
  LOCATION_THRESHOLDS,
  type CriteriaEstimationResult,
} from "@/lib/criteria-estimation";

// ── Types ────────────────────────────────────────────────────────────────

interface CriteriaEstimationProps {
  speciesKey: number;
  assessmentYear?: number | null;
}

interface Params {
  minYear: number;
  maxUncertainty: number;
  gridSize: number;
  clusterDistance: number;
  outlierDistance: number;
}

// ── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: Params = {
  minYear: 0,
  maxUncertainty: 10_000,
  gridSize: 2,
  clusterDistance: 10,
  outlierDistance: 0,
};

const UNCERTAINTY_OPTIONS = [
  { label: "100 m", value: 100 },
  { label: "1 km", value: 1_000 },
  { label: "10 km", value: 10_000 },
  { label: "50 km", value: 50_000 },
  { label: "No limit", value: 0 },
];

const GRID_SIZE_OPTIONS = [
  { label: "1 km", value: 1 },
  { label: "2 km (IUCN standard)", value: 2 },
  { label: "4 km", value: 4 },
  { label: "10 km", value: 10 },
];

// ── Category styling ─────────────────────────────────────────────────────

const CATEGORY_STYLE: Record<string, { color: string; bg: string }> = {
  CR: { color: "#dc2626", bg: "#fef2f2" },
  EN: { color: "#ea580c", bg: "#fff7ed" },
  VU: { color: "#ca8a04", bg: "#fefce8" },
};

// ── Threshold gauge component ────────────────────────────────────────────

function ThresholdGauge({
  label,
  value,
  unit,
  thresholds,
  suggestedCategory,
  description,
}: {
  label: string;
  value: number;
  unit: string;
  thresholds: { CR: number; EN: number; VU: number };
  suggestedCategory: string | null;
  description?: string;
}) {
  // Map value to gauge position (log scale for large ranges)
  const maxDisplay = thresholds.VU * 3;
  const logValue = Math.log10(Math.max(value, 0.1));
  const logMax = Math.log10(maxDisplay);
  const logMin = Math.log10(Math.max(thresholds.CR * 0.1, 0.1));
  const position = Math.min(100, Math.max(0, ((logValue - logMin) / (logMax - logMin)) * 100));

  // Threshold positions on the log scale
  const crPos = ((Math.log10(thresholds.CR) - logMin) / (logMax - logMin)) * 100;
  const enPos = ((Math.log10(thresholds.EN) - logMin) / (logMax - logMin)) * 100;
  const vuPos = ((Math.log10(thresholds.VU) - logMin) / (logMax - logMin)) * 100;

  const style = suggestedCategory ? CATEGORY_STYLE[suggestedCategory] : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
            {value < 1 ? value.toFixed(2) : value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
          <span className="text-xs text-zinc-500">{unit}</span>
          {suggestedCategory && style && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ color: style.color, backgroundColor: style.bg }}
            >
              {suggestedCategory}
            </span>
          )}
        </span>
      </div>
      {description && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      )}
      {/* Gauge bar */}
      <div className="relative h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-visible">
        {/* Threshold zones */}
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-red-100 dark:bg-red-900/30" style={{ width: `${crPos}%` }} />
        <div className="absolute inset-y-0 bg-orange-100 dark:bg-orange-900/30" style={{ left: `${crPos}%`, width: `${enPos - crPos}%` }} />
        <div className="absolute inset-y-0 bg-yellow-100 dark:bg-yellow-900/30" style={{ left: `${enPos}%`, width: `${vuPos - enPos}%` }} />
        <div className="absolute inset-y-0 rounded-r-full bg-green-100 dark:bg-green-900/30" style={{ left: `${vuPos}%`, right: 0 }} />

        {/* Threshold markers */}
        {[
          { pos: crPos, label: "CR", val: thresholds.CR },
          { pos: enPos, label: "EN", val: thresholds.EN },
          { pos: vuPos, label: "VU", val: thresholds.VU },
        ].map(({ pos, label: lbl, val }) => (
          <div key={lbl} className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: `${pos}%` }}>
            <div className="w-px h-full bg-zinc-400 dark:bg-zinc-600" />
            <span className="absolute -bottom-4 text-[10px] text-zinc-500 whitespace-nowrap" style={{ transform: "translateX(-50%)" }}>
              {val >= 1000 ? `${val / 1000}K` : val}
            </span>
          </div>
        ))}

        {/* Value indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 shadow-sm"
          style={{
            left: `${position}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: style?.color || "#22c55e",
          }}
        />
      </div>
      {/* Threshold labels row */}
      <div className="h-3" /> {/* spacer for threshold labels */}
    </div>
  );
}

// ── Trend row ────────────────────────────────────────────────────────────

function TrendRow({
  label,
  earlier,
  later,
  changePercent,
  earlierPeriod,
  laterPeriod,
  unit,
}: {
  label: string;
  earlier: number;
  later: number;
  changePercent: number;
  earlierPeriod: string;
  laterPeriod: string;
  unit: string;
}) {
  const isDecline = changePercent < -10;
  const isIncrease = changePercent > 10;
  const color = isDecline ? "#ef4444" : isIncrease ? "#22c55e" : "#71717a";
  const arrow = isDecline ? "↓" : isIncrease ? "↑" : "→";

  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-3 tabular-nums">
        <span className="text-zinc-500 text-xs">{earlierPeriod}: {earlier.toLocaleString()} {unit}</span>
        <span className="font-bold" style={{ color }}>
          {arrow} {changePercent > 0 ? "+" : ""}{changePercent}%
        </span>
        <span className="text-zinc-500 text-xs">{laterPeriod}: {later.toLocaleString()} {unit}</span>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export default function CriteriaEstimation({ speciesKey, assessmentYear }: CriteriaEstimationProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [result, setResult] = useState<CriteriaEstimationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showParams, setShowParams] = useState(false);

  const runEstimation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const searchParams = new URLSearchParams({
        speciesKey: String(speciesKey),
      });
      if (params.minYear > 0) searchParams.set("minYear", String(params.minYear));
      if (params.maxUncertainty > 0) searchParams.set("maxUncertainty", String(params.maxUncertainty));
      if (params.gridSize !== 2) searchParams.set("gridSize", String(params.gridSize));
      if (params.clusterDistance !== 10) searchParams.set("clusterDistance", String(params.clusterDistance));
      if (params.outlierDistance > 0) searchParams.set("outlierDistance", String(params.outlierDistance));

      const res = await fetch(`/api/redlist/criteria-estimate?${searchParams}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else if (data.result) {
        setResult(data.result);
      } else {
        setError(data.message || "No data available");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [speciesKey, params]);

  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Criterion B Parameter Estimation
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Approximate EOO, AOO, and number of locations from GBIF occurrence data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowParams(!showParams)}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            {showParams ? "Hide" : "Show"} Parameters
          </button>
          <button
            onClick={runEstimation}
            disabled={loading}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                Analyzing...
              </span>
            ) : result ? "Re-run Analysis" : "Run Analysis"}
          </button>
        </div>
      </div>

      {/* Parameter controls (collapsible) */}
      {showParams && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Min. year
            </label>
            <input
              type="number"
              value={params.minYear || ""}
              placeholder="All time"
              onChange={(e) => updateParam("minYear", parseInt(e.target.value) || 0)}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Max uncertainty
            </label>
            <select
              value={params.maxUncertainty}
              onChange={(e) => updateParam("maxUncertainty", parseInt(e.target.value))}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            >
              {UNCERTAINTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              AOO grid cell size
            </label>
            <select
              value={params.gridSize}
              onChange={(e) => updateParam("gridSize", parseFloat(e.target.value))}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            >
              {GRID_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Location cluster distance (km)
            </label>
            <input
              type="number"
              value={params.clusterDistance}
              min={1}
              max={500}
              onChange={(e) => updateParam("clusterDistance", parseFloat(e.target.value) || 10)}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Outlier exclusion (km from median, 0=off)
            </label>
            <input
              type="number"
              value={params.outlierDistance}
              min={0}
              max={10000}
              onChange={(e) => updateParam("outlierDistance", parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setParams(DEFAULT_PARAMS)}
              className="px-3 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              Reset defaults
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Data summary */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 pb-2 border-b border-zinc-200 dark:border-zinc-700">
            <span>Points used: <strong className="text-zinc-700 dark:text-zinc-300">{result.meta.usedPoints.toLocaleString()}</strong> of {result.meta.totalPoints.toLocaleString()}</span>
            {result.meta.filteredOut.uncertainty > 0 && <span>Excluded (uncertainty): {result.meta.filteredOut.uncertainty}</span>}
            {result.meta.filteredOut.year > 0 && <span>Excluded (year): {result.meta.filteredOut.year}</span>}
            {result.meta.filteredOut.outlier > 0 && <span>Excluded (outlier): {result.meta.filteredOut.outlier}</span>}
            {result.meta.filteredOut.duplicate > 0 && <span>Deduplicated: {result.meta.filteredOut.duplicate}</span>}
          </div>

          {/* Gauges */}
          <div className="space-y-5">
            <ThresholdGauge
              label="EOO (Extent of Occurrence)"
              value={result.eoo.areaKm2}
              unit="km²"
              thresholds={EOO_THRESHOLDS}
              suggestedCategory={result.eoo.suggestedCategory}
              description={`Minimum convex polygon enclosing ${result.eoo.pointCount} occurrence points (${result.eoo.hullVertices.length} hull vertices)`}
            />
            <ThresholdGauge
              label="AOO (Area of Occupancy)"
              value={result.aoo.areaKm2}
              unit="km²"
              thresholds={AOO_THRESHOLDS}
              suggestedCategory={result.aoo.suggestedCategory}
              description={`${result.aoo.occupiedCells} occupied ${result.aoo.gridSizeKm}×${result.aoo.gridSizeKm} km grid cells`}
            />
            <ThresholdGauge
              label="Number of Locations"
              value={result.locations.count}
              unit={result.locations.count === 1 ? "location" : "locations"}
              thresholds={LOCATION_THRESHOLDS}
              suggestedCategory={
                result.locations.count <= LOCATION_THRESHOLDS.CR ? "CR" :
                result.locations.count <= LOCATION_THRESHOLDS.EN ? "EN" :
                result.locations.count <= LOCATION_THRESHOLDS.VU ? "VU" : null
              }
              description={`Clusters at ${result.locations.clusterDistanceKm} km distance threshold (largest cluster: ${result.locations.clusters[0]?.pointCount ?? 0} points)`}
            />
          </div>

          {/* Temporal trends */}
          {(result.temporal.eooTrend || result.temporal.aooTrend) && (
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
              <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Temporal Trends (split at {result.temporal.splitYear})
              </h4>
              {result.temporal.eooTrend && (
                <TrendRow
                  label="EOO"
                  earlier={result.temporal.eooTrend.earlierValue}
                  later={result.temporal.eooTrend.laterValue}
                  changePercent={result.temporal.eooTrend.changePercent}
                  earlierPeriod={result.temporal.eooTrend.earlierPeriod}
                  laterPeriod={result.temporal.eooTrend.laterPeriod}
                  unit="km²"
                />
              )}
              {result.temporal.aooTrend && (
                <TrendRow
                  label="AOO"
                  earlier={result.temporal.aooTrend.earlierValue}
                  later={result.temporal.aooTrend.laterValue}
                  changePercent={result.temporal.aooTrend.changePercent}
                  earlierPeriod={result.temporal.aooTrend.earlierPeriod}
                  laterPeriod={result.temporal.aooTrend.laterPeriod}
                  unit="km²"
                />
              )}
              {result.temporal.locationsTrend && (
                <TrendRow
                  label="Locations"
                  earlier={result.temporal.locationsTrend.earlierValue}
                  later={result.temporal.locationsTrend.laterValue}
                  changePercent={result.temporal.locationsTrend.changePercent}
                  earlierPeriod={result.temporal.locationsTrend.earlierPeriod}
                  laterPeriod={result.temporal.locationsTrend.laterPeriod}
                  unit=""
                />
              )}
            </div>
          )}

          {/* Criterion B assessment */}
          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <h4 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider mb-2">
              Criterion B Assessment
            </h4>
            <div className="space-y-2 text-sm">
              {/* B1 and B2 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                  <span className="text-xs font-medium text-zinc-500">B1 (EOO)</span>
                  <div className="mt-0.5">
                    {result.criterionB.b1.meetsThreshold ? (
                      <span className="font-semibold" style={{ color: CATEGORY_STYLE[result.criterionB.b1.eooCategory!]?.color }}>
                        {result.criterionB.b1.eooCategory} threshold met
                      </span>
                    ) : (
                      <span className="text-zinc-400">Above thresholds</span>
                    )}
                  </div>
                </div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                  <span className="text-xs font-medium text-zinc-500">B2 (AOO)</span>
                  <div className="mt-0.5">
                    {result.criterionB.b2.meetsThreshold ? (
                      <span className="font-semibold" style={{ color: CATEGORY_STYLE[result.criterionB.b2.aooCategory!]?.color }}>
                        {result.criterionB.b2.aooCategory} threshold met
                      </span>
                    ) : (
                      <span className="text-zinc-400">Above thresholds</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Subcriteria */}
              <div className="px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                <span className="text-xs font-medium text-zinc-500">Subcriteria (need ≥2 for Criterion B)</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <SubcriterionBadge
                    code="(a)"
                    label="Few locations"
                    met={result.criterionB.subcriteria.a}
                  />
                  <SubcriterionBadge
                    code="(b)(i)"
                    label="EOO decline"
                    met={result.criterionB.subcriteria.bi}
                  />
                  <SubcriterionBadge
                    code="(b)(ii)"
                    label="AOO decline"
                    met={result.criterionB.subcriteria.bii}
                  />
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 inline-block" />
                    (b)(iii-v), (c) — requires additional data
                  </span>
                </div>
              </div>

              {/* Overall */}
              {result.criterionB.overallCategory ? (
                <div
                  className="px-4 py-3 rounded-lg border text-sm"
                  style={{
                    borderColor: CATEGORY_STYLE[result.criterionB.overallCategory]?.color + "40",
                    backgroundColor: CATEGORY_STYLE[result.criterionB.overallCategory]?.bg,
                  }}
                >
                  <span className="font-bold" style={{ color: CATEGORY_STYLE[result.criterionB.overallCategory]?.color }}>
                    Criterion B suggests: {result.criterionB.overallCategory}
                  </span>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                    Based on geographic range thresholds and {[
                      result.criterionB.subcriteria.a && "few locations",
                      result.criterionB.subcriteria.bi && "EOO decline",
                      result.criterionB.subcriteria.bii && "AOO decline",
                    ].filter(Boolean).join(", ")}. This is an automated estimate — expert review is essential.
                  </p>
                </div>
              ) : (
                <div className="px-4 py-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400">
                  {(result.criterionB.b1.meetsThreshold || result.criterionB.b2.meetsThreshold)
                    ? "Geographic range meets a threshold, but fewer than 2 subcriteria are met from GBIF data alone. Additional evidence may change this assessment."
                    : "Geographic range is above all Criterion B thresholds based on GBIF occurrence data."}
                </div>
              )}
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
            These estimates are derived from GBIF occurrence records and should be treated as
            approximations. EOO and AOO calculations follow IUCN standards (minimum convex polygon
            and 2×2 km grid respectively). Number of locations is approximated by spatial clustering
            and does not account for threat-based definitions. Assessors should verify results using
            additional data sources and expert knowledge.
          </p>
        </div>
      )}

      {/* Initial empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-8 text-zinc-400 dark:text-zinc-500">
          <p className="text-sm">Click &quot;Run Analysis&quot; to estimate Criterion B parameters from GBIF occurrences</p>
          <p className="text-xs mt-1">Fetches up to 10,000 georeferenced records and computes EOO, AOO, and locations</p>
        </div>
      )}
    </div>
  );
}

// ── Subcriterion badge ───────────────────────────────────────────────────

function SubcriterionBadge({ code, label, met }: { code: string; label: string; met: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
      met
        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
    }`}>
      <span className={`w-3 h-3 rounded-full inline-flex items-center justify-center text-[8px] font-bold ${
        met ? "bg-red-500 text-white" : "border border-zinc-300 dark:border-zinc-600"
      }`}>
        {met ? "✓" : ""}
      </span>
      <span className="font-medium">{code}</span>
      {label}
    </span>
  );
}
