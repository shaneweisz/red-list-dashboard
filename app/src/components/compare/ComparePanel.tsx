"use client";

import { useEffect, useMemo, useState } from "react";
import TaxaIcon from "@/components/TaxaIcon";
import { TAXA } from "@/config/taxa";
import {
  CATEGORY_COLORS,
  CATEGORY_NAMES,
  CATEGORY_ORDER,
} from "@/config/taxa";
import type { RedListSpecies } from "@/hooks/useRedListSpeciesQuery";
import { matchesSpeciesFilter, type SpeciesFilterCriteria } from "@/lib/species-filter";
import { POPULATION_TRENDS, THREAT_LABEL } from "@/lib/filter-vocab";

const SPECIES_API = "/api/redlist/species";

// Categories shown as toggleable filter chips (most-threatened first).
const FILTER_CATEGORIES = Object.keys(CATEGORY_ORDER)
  .filter((c) => c !== "NE")
  .sort((a, b) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b]);

// Threatened = CR + EN + VU (the IUCN "threatened" grouping).
const THREATENED = new Set(["CR", "EN", "VU"]);

// Population-trend values come from the shared filter vocabulary so this panel
// stays in lockstep with the dashboard / browse endpoint.
const TREND_OPTIONS = POPULATION_TRENDS;
const TREND_GLYPH: Record<string, string> = {
  Increasing: "↑",
  Stable: "→",
  Decreasing: "↓",
  Unknown: "?",
};

// The 8 real taxon groups (exclude the giant "all" aggregate for a snappy POC).
const TAXON_OPTIONS = TAXA.filter((t) => t.id !== "all");

export interface PanelState {
  taxonId: string;
  selectedCategories: Set<string>;
  selectedTrends: Set<string>;
  search: string;
}

interface ComparePanelProps {
  /** Accent color label for the panel ("A" / "B"). */
  side: "A" | "B";
  /** Controlled filter state — owned by the page so it can be serialized to the URL. */
  state: PanelState;
  /** Patch this side's state (page merges + syncs the URL). */
  onChange: (patch: Partial<PanelState>) => void;
}

export default function ComparePanel({ side, state, onChange }: ComparePanelProps) {
  const { taxonId, selectedCategories, selectedTrends, search } = state;
  const setTaxonId = (id: string) => onChange({ taxonId: id });
  const setSelectedCategories = (s: Set<string>) => onChange({ selectedCategories: s });
  const setSelectedTrends = (s: Set<string>) => onChange({ selectedTrends: s });
  const setSearch = (s: string) => onChange({ search: s });

  // ── Per-taxon species fetch (cached per taxon in this panel) ───────────────
  const [cache, setCache] = useState<Record<string, RedListSpecies[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache[taxonId]) return;
    const controller = new AbortController();
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- kick off async fetch
    setError(null);
    fetch(`${SPECIES_API}?taxon=${encodeURIComponent(taxonId)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Species API returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setCache((prev) => ({ ...prev, [taxonId]: data.species ?? [] }));
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load species");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [taxonId, cache]);

  const allSpecies = useMemo(() => cache[taxonId] ?? [], [cache, taxonId]);

  // ── Apply this panel's filters independently ───────────────────────────────
  // Uses the SHARED predicate (lib/species-filter) so the comparison can never
  // drift from the dashboard's filter semantics. Adding a new filter there makes
  // it available here too — just surface a control and pass the criterion below.
  const filtered = useMemo(() => {
    const criteria: SpeciesFilterCriteria = {
      categories: selectedCategories,
      populationTrends: selectedTrends,
      search: search.trim().toLowerCase(),
    };
    return allSpecies.filter((s) => matchesSpeciesFilter(s, criteria));
  }, [allSpecies, selectedCategories, selectedTrends, search]);

  // ── Derived insights ───────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const total = filtered.length;
    const byCategory: Record<string, number> = {};
    const byTrend: Record<string, number> = {};
    const byThreat: Record<string, number> = {};
    let threatened = 0;
    let withGbif = 0;

    for (const s of filtered) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
      if (THREATENED.has(s.category)) threatened++;
      const trend = s.population_trend || "Unknown";
      byTrend[trend] = (byTrend[trend] || 0) + 1;
      if ((s.gbif_occurrence_count ?? 0) > 0) withGbif++;
      // Count each top-level threat category at most once per species.
      const topThreats = new Set((s.threat_codes ?? []).map((c) => c.split(".")[0]));
      for (const t of topThreats) byThreat[t] = (byThreat[t] || 0) + 1;
    }

    const topThreats = Object.entries(byThreat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code, count]) => ({ code, count, label: THREAT_LABEL[code] ?? `Threat ${code}` }));

    return {
      total,
      threatened,
      pctThreatened: total > 0 ? (threatened / total) * 100 : 0,
      withGbif,
      pctGbif: total > 0 ? (withGbif / total) * 100 : 0,
      byCategory,
      byTrend,
      topThreats,
    };
  }, [filtered]);

  const taxonConfig = TAXON_OPTIONS.find((t) => t.id === taxonId);
  const accent = taxonConfig?.color ?? "#71717a";

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const hasFilters = selectedCategories.size > 0 || selectedTrends.size > 0 || search.trim() !== "";

  return (
    <section className="flex-1 min-w-0 flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Panel header: taxon picker */}
      <header
        className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Side {side}
        </span>
        <TaxaIcon taxonId={taxonId} size={22} style={{ color: accent }} className="flex-shrink-0" />
        <select
          value={taxonId}
          onChange={(e) => {
            setTaxonId(e.target.value);
            // Filters persist across taxon switches so comparisons stay aligned.
          }}
          className="flex-1 min-w-0 bg-transparent text-base sm:text-lg font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none cursor-pointer"
        >
          {TAXON_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </header>

      {/* Filters (independent per panel) */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 space-y-3 bg-zinc-50/60 dark:bg-zinc-800/30">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search species…"
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
        />

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5">
            Red List category
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_CATEGORIES.map((cat) => {
              const active = selectedCategories.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => toggle(selectedCategories, cat, setSelectedCategories)}
                  title={CATEGORY_NAMES[cat]}
                  className={`px-2 py-0.5 text-xs font-medium rounded-md border transition-colors ${
                    active
                      ? "text-white border-transparent"
                      : "text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                  style={active ? { backgroundColor: CATEGORY_COLORS[cat] } : undefined}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5">
            Population trend
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TREND_OPTIONS.map((trend) => {
              const active = selectedTrends.has(trend);
              return (
                <button
                  key={trend}
                  onClick={() => toggle(selectedTrends, trend, setSelectedTrends)}
                  className={`px-2 py-0.5 text-xs font-medium rounded-md border transition-colors ${
                    active
                      ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                      : "text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {TREND_GLYPH[trend]} {trend}
                </button>
              );
            })}
          </div>
        </div>

        {hasFilters && (
          <button
            onClick={() => {
              setSelectedCategories(new Set());
              setSelectedTrends(new Set());
              setSearch("");
            }}
            className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Insights */}
      <div className="flex-1 px-4 py-4">
        {error ? (
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : loading && allSpecies.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Headline stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Species" value={insights.total.toLocaleString()} />
              <Stat
                label="Threatened"
                value={insights.threatened.toLocaleString()}
                sub={`${insights.pctThreatened.toFixed(0)}%`}
              />
              <Stat
                label="With GBIF obs"
                value={`${insights.pctGbif.toFixed(0)}%`}
              />
            </div>

            {/* Risk category breakdown */}
            <Insight title="Risk category breakdown">
              <StackedBar byCategory={insights.byCategory} total={insights.total} />
              <ul className="mt-2 space-y-0.5">
                {FILTER_CATEGORIES.concat(["DD"])
                  .filter((cat) => (insights.byCategory[cat] || 0) > 0)
                  .map((cat) => (
                    <LegendRow
                      key={cat}
                      color={CATEGORY_COLORS[cat]}
                      label={CATEGORY_NAMES[cat] ?? cat}
                      count={insights.byCategory[cat]}
                      total={insights.total}
                    />
                  ))}
              </ul>
            </Insight>

            {/* Population trend */}
            <Insight title="Population trend">
              <ul className="space-y-0.5">
                {TREND_OPTIONS.filter((t) => (insights.byTrend[t] || 0) > 0).map((trend) => (
                  <LegendRow
                    key={trend}
                    label={`${TREND_GLYPH[trend]} ${trend}`}
                    count={insights.byTrend[trend]}
                    total={insights.total}
                    barColor={accent}
                  />
                ))}
              </ul>
            </Insight>

            {/* Top threats */}
            <Insight title="Top threats">
              {insights.topThreats.length === 0 ? (
                <p className="text-sm text-zinc-400">No threat data for this selection.</p>
              ) : (
                <ul className="space-y-0.5">
                  {insights.topThreats.map((t) => (
                    <LegendRow
                      key={t.code}
                      label={t.label}
                      count={t.count}
                      total={insights.total}
                      barColor="#ef4444"
                    />
                  ))}
                </ul>
              )}
            </Insight>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-2">
      <div className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
        {value}
        {sub && <span className="text-xs font-normal text-zinc-400 ml-1">{sub}</span>}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

function Insight({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StackedBar({ byCategory, total }: { byCategory: Record<string, number>; total: number }) {
  if (total === 0) return <div className="h-3 rounded-full bg-zinc-200 dark:bg-zinc-700" />;
  const segments = FILTER_CATEGORIES.concat(["DD"])
    .filter((cat) => (byCategory[cat] || 0) > 0)
    .map((cat) => ({ cat, pct: (byCategory[cat] / total) * 100 }));
  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700">
      {segments.map((seg) => (
        <div
          key={seg.cat}
          style={{ width: `${seg.pct}%`, backgroundColor: CATEGORY_COLORS[seg.cat], minWidth: "2px" }}
          title={`${CATEGORY_NAMES[seg.cat]}: ${seg.pct.toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

function LegendRow({
  color,
  label,
  count,
  total,
  barColor,
}: {
  color?: string;
  label: string;
  count: number;
  total: number;
  barColor?: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <li className="flex items-center gap-2 text-sm">
      {color && <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />}
      <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-300">{label}</span>
      <div className="w-16 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex-shrink-0">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor ?? color ?? "#71717a" }} />
      </div>
      <span className="w-12 text-right tabular-nums text-zinc-500 dark:text-zinc-400 flex-shrink-0">
        {count.toLocaleString()}
      </span>
    </li>
  );
}
