"use client";

/**
 * The species recorded around a point, and what their assessments blame.
 *
 * Opened by right-clicking a record, so the centre is a collection locality
 * someone actually cares about — this specimen, this observation — rather than
 * wherever the cursor happened to be. It takes the record's own coordinates,
 * not the click's.
 *
 * Threats lead and the species list follows. The summary is the reusable part:
 * "18 of the 41 species recorded within 25 km cite Agriculture" is a line that
 * sends someone to check a threat they hadn't written down, which is the whole
 * point of the panel. The species list underneath is the evidence for it, and
 * is what you read once the summary has told you where to look.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORY_COLORS, normalizeCategory } from "@/config/taxa";
import { findNode } from "@/lib/taxonomy-utils";
import {
  NEARBY_RADII_KM,
  NEARBY_RECORDS_NOTE,
  NEARBY_SEARCH_COLOR,
  NEARBY_STALENESS_NOTE,
  nearbyGbifSiteUrl,
  type NearbyRadiusKm,
  type NearbyResult,
} from "@/lib/mapping/nearby-species";

interface Props {
  lat: number;
  lng: number;
  /** The record the radius is centred on, named in the header. */
  recordName: string;
  /** The species whose map this is — never its own neighbour. */
  excludeGbifKey?: string | null;
  /** Controlled by the map, which draws this radius on the ground. */
  radiusKm: NearbyRadiusKm;
  onRadiusChange: (km: NearbyRadiusKm) => void;
  /** The neighbours the map is drawing, with the colour each was given. */
  picked: { key: string; color: string; drawn: { shown: number; total: number } | null }[];
  onTogglePick: (species: { key: string; name: string }) => void;
  onClose: () => void;
}

/**
 * The table's column track, shared by the header and every row so the two can't
 * drift apart.
 */
const ROW = "grid grid-cols-[10px_26px_minmax(0,1fr)_58px_54px_30px] gap-1 items-baseline";

/**
 * The panel's one busy indicator, used wherever it waits on GBIF.
 *
 * Both waits here are a second or so of nothing — long enough that a static
 * "looking…" reads as a state rather than as progress.
 */
function Spinner() {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin"
      aria-hidden
    />
  );
}

/** "flowering_plants" → "Flowering Plants", falling back to the raw group. */
function taxonLabel(taxonGroup: string): string {
  return findNode(taxonGroup)?.name ?? taxonGroup.replace(/_/g, " ");
}

export default function NearbySpeciesPanel({
  lat, lng, recordName, excludeGbifKey, radiusKm, onRadiusChange,
  picked, onTogglePick, onClose,
}: Props) {
  const pickedByKey = useMemo(() => new Map(picked.map((p) => [p.key, p])), [picked]);
  /** Which threat's species are expanded, if any. */
  const [openThreat, setOpenThreat] = useState<string | null>(null);
  /**
   * Which half of the answer is showing.
   *
   * They were stacked, and with a dozen threat rows above it the species list
   * began below the fold of a panel nobody had reason to scroll — the heading
   * that would have told you it was there was itself out of view. Tabs put
   * both counts in permanent sight and give whichever you pick the full
   * height, which at 320px wide is the only way either list gets read.
   */
  const [tab, setTab] = useState<"species" | "threats">("species");
  /**
   * Which taxon's neighbours are listed, or null for all of them.
   *
   * A hundred-odd species across birds, amphibians and plants is a list nobody
   * reads end to end, and an assessor almost always wants one of those groups —
   * the comparable one. Derived from what actually came back rather than from
   * the full taxonomy, so the row only ever offers groups with something in it.
   */
  const [taxon, setTaxon] = useState<string | null>(null);

  /**
   * The answer, tagged with the question it answers.
   *
   * Loading isn't state of its own: it's "what I'm holding doesn't match what's
   * being asked", which the tag makes a comparison rather than a flag to keep in
   * step. That also settles what the panel shows mid-flight — switching 25 km to
   * 50 km blanks the old list instead of leaving it up, labelled 50, until the
   * new one lands.
   */
  const [answer, setAnswer] = useState<{ key: string; result?: NearbyResult; error?: string } | null>(null);

  const key = `${lat},${lng},${radiusKm},${excludeGbifKey ?? ""}`;
  const loading = answer?.key !== key;
  const result = answer?.key === key ? answer.result : undefined;
  const error = answer?.key === key ? answer.error : undefined;

  useEffect(() => {
    // A radius switched twice quickly would otherwise be free to land in the
    // order the network felt like, not the order it was asked in.
    const controller = new AbortController();
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radiusKm: String(radiusKm) });
    if (excludeGbifKey) params.set("exclude", excludeGbifKey);
    fetch(`/api/nearby-species?${params}`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
        setAnswer({ key, result: body as NearbyResult });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setAnswer({ key, error: e instanceof Error ? e.message : "Lookup failed" });
      });
    return () => controller.abort();
  }, [lat, lng, radiusKm, excludeGbifKey, key]);

  // A radius that returns no birds should not keep offering a Birds tab, so the
  // row is rebuilt from each answer and a selection that no longer exists is
  // dropped rather than silently filtering everything away.
  const taxonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of result?.species ?? []) {
      counts.set(s.taxon_group, (counts.get(s.taxon_group) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [result]);

  // Derived, not corrected after the fact: a group that the new radius no
  // longer has simply stops being the selection, rather than being stored and
  // then filtering the whole list away until an effect catches up.
  const activeTaxon = taxon && taxonCounts.some(([g]) => g === taxon) ? taxon : null;

  const shownSpecies = useMemo(
    () => (result?.species ?? []).filter((s) => !activeTaxon || s.taxon_group === activeTaxon),
    [result, activeTaxon]
  );

  // Escape closes it, the way it dismisses every other mode on this map.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <div className="absolute top-2 right-2 z-[1001] w-[26rem] max-h-[75%] flex flex-col rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg text-[11px]">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-100 dark:border-zinc-700 shrink-0">
        {/* The same colour as the ring on the map, so the panel and the circle
            it drew read as one thing. */}
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke={NEARBY_SEARCH_COLOR} strokeWidth={2}>
          <circle cx="12" cy="12" r="3" fill={NEARBY_SEARCH_COLOR} stroke="none" />
          <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
        </svg>
        <span className="font-medium text-zinc-700 dark:text-zinc-200 shrink-0">Recorded near</span>
        <span className="italic text-zinc-500 dark:text-zinc-400 truncate" title={`${lat.toFixed(5)}, ${lng.toFixed(5)}`}>
          {recordName}
        </span>
        <button
          onClick={onClose}
          title="Close"
          className="ml-auto text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* The radius is the panel's one real control, so it sits above the
          answer rather than behind a menu. */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-100 dark:border-zinc-700 shrink-0">
        <span className="text-zinc-500 dark:text-zinc-400">Within</span>
        {NEARBY_RADII_KM.map((r) => (
          <button
            key={r}
            onClick={() => onRadiusChange(r)}
            className={`px-1.5 py-0.5 rounded border tabular-nums ${
              r === radiusKm
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            }`}
          >
            {r} km
          </button>
        ))}
        {loading && (
          <span className="ml-auto flex items-center gap-1 text-zinc-400">
            <Spinner />
            looking…
          </span>
        )}
      </div>

      <div className="overflow-y-auto px-2 py-1.5 space-y-2">
        {error && <p className="text-amber-600 dark:text-amber-400">{error}</p>}

        {result && !error && (
          <>
            <p className="text-zinc-500 dark:text-zinc-400">
              {result.species.length === 0 ? (
                <>No assessed threatened species recorded within {result.radiusKm} km.</>
              ) : (
                <>
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">
                    {result.species.length}
                  </span>{" "}
                  threatened or Near Threatened species, from{" "}
                  <span className="tabular-nums">{result.categoryRecords.toLocaleString()}</span> of the{" "}
                  <span className="tabular-nums">{result.totalRecords.toLocaleString()}</span> records here.
                </>
              )}
            </p>

            {result.truncated && (
              <p className="text-amber-600 dark:text-amber-400">
                Only the most-recorded {result.species.length} are shown — there are more here.
              </p>
            )}

            {/* Both counts always visible, so neither list can be the one
                nobody knew was there. */}
            {(result.threats.length > 0 || result.species.length > 0) && (
              <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 -mx-2 px-2">
                {([
                  ["species", "Species", result.species.length],
                  ["threats", "Threats", result.threats.length],
                ] as const).map(([id, label, n]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`px-1.5 py-1 -mb-px border-b-2 ${
                      tab === id
                        ? "border-blue-500 text-zinc-800 dark:text-zinc-100 font-medium"
                        : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    }`}
                  >
                    {label} <span className="tabular-nums text-zinc-400">{n}</span>
                  </button>
                ))}
              </div>
            )}

            {tab === "threats" && (<>
            {result.threats.length > 0 && (
              <div>
                {result.threats.map((t) => (
                  <div key={t.code}>
                    {/* Each row opens to name the species behind the count:
                        a bare "18 species" is a prompt, but the names are what
                        make it checkable. */}
                    <button
                      onClick={() => setOpenThreat(openThreat === t.code ? null : t.code)}
                      className="w-full flex items-center gap-1.5 py-0.5 text-left hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      <span className="tabular-nums text-zinc-500 dark:text-zinc-400 w-6 text-right shrink-0">
                        {t.species}
                      </span>
                      {/* A bar, because the shape of the list is the finding —
                          one dominant pressure reads differently from six even
                          ones, and the counts alone don't show that. */}
                      <span className="h-2 rounded-sm bg-blue-500/70 dark:bg-blue-400/70 shrink-0"
                        style={{ width: `${Math.max(4, (t.species / result.threats[0].species) * 72)}px` }}
                      />
                      <span className="truncate text-zinc-700 dark:text-zinc-200">{t.label}</span>
                    </button>
                    {openThreat === t.code && (
                      <div className="pl-8 pb-1 text-zinc-500 dark:text-zinc-400 italic leading-snug">
                        {t.examples.join(", ")}
                        {t.species > t.examples.length && ` and ${t.species - t.examples.length} more`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            </>)}

            {tab === "species" && (<>
            {/* One row of groups, biggest first. Horizontally scrollable rather
                than wrapped: a wrapped row of a dozen groups would push the
                list itself back below the fold, which is the problem the tabs
                above exist to solve. */}
            {taxonCounts.length > 1 && (
              <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-2 px-2">
                {([[null, "All", result.species.length], ...taxonCounts.map(
                  ([g, n]) => [g, taxonLabel(g), n] as const
                )] as readonly (readonly [string | null, string, number])[]).map(([id, label, n]) => (
                  <button
                    key={id ?? "all"}
                    onClick={() => setTaxon(id)}
                    className={`shrink-0 px-1.5 py-0.5 rounded-full border tabular-nums ${
                      activeTaxon === id
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {label} <span className="text-zinc-400">{n}</span>
                  </button>
                ))}
              </div>
            )}
            {shownSpecies.length > 0 && (
              <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
                {/* A table, not a list of paragraphs: the reason to look at a
                    hundred neighbours at once is to compare them, and comparing
                    needs the record counts and the years under one another
                    rather than trailing each name. The header stays put while
                    the rows scroll under it. */}
                <div className={`${ROW} sticky top-0 bg-white dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 pb-0.5 border-b border-zinc-100 dark:border-zinc-800`}>
                  <span />
                  <span />
                  <span>Species</span>
                  <span>Taxon</span>
                  <span className="text-right">Recs</span>
                  <span className="text-right">Yr</span>
                </div>
                {shownSpecies.map((s) => {
                  const pick = pickedByKey.get(s.gbif_species_key);
                  return (
                    <div
                      key={s.gbif_species_key}
                      className={`${ROW} py-[3px] border-b border-zinc-50 dark:border-zinc-800/60 ${
                        pick ? "bg-zinc-50 dark:bg-zinc-700/40" : ""
                      }`}
                    >
                      {/* The triangle the map is drawing it with, in its own
                          colour — the row and the mark have to be readable as
                          the same thing without counting positions. */}
                      <span className="leading-none" style={{ color: pick?.color }}>
                        {pick ? "▲" : ""}
                      </span>
                      <span
                        className="px-1 rounded text-[9px] font-medium text-white tabular-nums text-center"
                        style={{ backgroundColor: CATEGORY_COLORS[normalizeCategory(s.category)] ?? "#6b7280" }}
                        title={s.criteria ? `Assessed ${s.category} under ${s.criteria}` : `Assessed ${s.category}`}
                      >
                        {s.category}
                      </span>
                      <span className="min-w-0 flex items-baseline gap-1">
                        {/* The name is the switch: clicking draws this species'
                            records, clicking again takes them off. Several can
                            be on at once, each in its own colour. */}
                        <button
                          onClick={() => onTogglePick({ key: s.gbif_species_key, name: s.scientific_name })}
                          title={pick ? "Stop drawing this species" : "Draw this species' records on the map"}
                          className="italic text-left truncate text-zinc-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          <span title={s.scientific_name}>{s.scientific_name}</span>
                        </button>
                        {s.common_name && (
                          <span className="text-zinc-400 truncate" title={s.common_name}>
                            ({s.common_name})
                          </span>
                        )}
                        <a
                          href={nearbyGbifSiteUrl({ lat, lng, radiusKm: result.radiusKm, speciesKey: s.gbif_species_key })}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open these records on GBIF"
                          className="shrink-0 text-zinc-300 hover:text-blue-600 dark:text-zinc-600 dark:hover:text-blue-400"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5m0-5L10 14M9 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-3" />
                          </svg>
                        </a>
                      </span>
                      <span className="truncate text-zinc-400" title={taxonLabel(s.taxon_group)}>
                        {taxonLabel(s.taxon_group)}
                      </span>
                      <span className="text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                        {s.records}
                        {/* Under the count it qualifies: how many of them the
                            map is actually drawing. */}
                        {pick && (
                          <span
                            className="block whitespace-nowrap"
                            style={{ color: pick.color }}
                            title={
                              pick.drawn == null
                                ? "Drawing this species' records"
                                : pick.drawn.total > pick.drawn.shown
                                  ? `${pick.drawn.shown} of ${pick.drawn.total} records drawn on the map`
                                  : `All ${pick.drawn.shown} drawn on the map`
                            }
                          >
                            {pick.drawn == null
                              ? <Spinner />
                              : pick.drawn.total > pick.drawn.shown
                                ? `${pick.drawn.shown}/${pick.drawn.total}`
                                : `${pick.drawn.shown} ✓`}
                          </span>
                        )}
                      </span>
                      <span className="text-right tabular-nums text-zinc-400">
                        {s.assessment_year ?? "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            </>)}

            {result.unmatched > 0 && (
              <p className="text-zinc-400">
                {result.unmatched} more had no assessment in this dashboard&rsquo;s data.
              </p>
            )}

            <p className="pt-1 border-t border-zinc-100 dark:border-zinc-800 text-zinc-400 leading-snug">
              {NEARBY_RECORDS_NOTE} {NEARBY_STALENESS_NOTE}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
