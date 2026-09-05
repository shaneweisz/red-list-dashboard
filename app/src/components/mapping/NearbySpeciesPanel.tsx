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

import { useCallback, useEffect, useState } from "react";
import { CATEGORY_COLORS, normalizeCategory } from "@/config/taxa";
import { findNode } from "@/lib/taxonomy-utils";
import {
  NEARBY_RADII_KM,
  NEARBY_RADIUS_DEFAULT,
  NEARBY_RECORDS_NOTE,
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
  onClose: () => void;
}

/** "flowering_plants" → "Flowering Plants", falling back to the raw group. */
function taxonLabel(taxonGroup: string): string {
  return findNode(taxonGroup)?.name ?? taxonGroup.replace(/_/g, " ");
}

export default function NearbySpeciesPanel({ lat, lng, recordName, excludeGbifKey, onClose }: Props) {
  const [radiusKm, setRadiusKm] = useState<NearbyRadiusKm>(NEARBY_RADIUS_DEFAULT);
  /** Which threat's species are expanded, if any. */
  const [openThreat, setOpenThreat] = useState<string | null>(null);

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
    <div className="absolute top-2 right-2 z-[1001] w-80 max-h-[75%] flex flex-col rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg text-[11px]">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-100 dark:border-zinc-700 shrink-0">
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
            onClick={() => setRadiusKm(r)}
            className={`px-1.5 py-0.5 rounded border tabular-nums ${
              r === radiusKm
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            }`}
          >
            {r} km
          </button>
        ))}
        {loading && <span className="ml-auto text-zinc-400">looking…</span>}
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

            {result.threats.length > 0 && (
              <div>
                <div className="text-zinc-500 dark:text-zinc-400 pb-0.5">Threats their assessments cite</div>
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

            {result.species.length > 0 && (
              <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <div className="text-zinc-500 dark:text-zinc-400 pb-0.5">The species</div>
                {result.species.map((s) => (
                  <div key={s.gbif_species_key} className="flex items-baseline gap-1.5 py-0.5">
                    <span
                      className="shrink-0 px-1 rounded text-[9px] font-medium text-white tabular-nums"
                      style={{ backgroundColor: CATEGORY_COLORS[normalizeCategory(s.category)] ?? "#6b7280" }}
                      title={s.criteria ? `Assessed ${s.category} under ${s.criteria}` : `Assessed ${s.category}`}
                    >
                      {s.category}
                    </span>
                    <a
                      href={nearbyGbifSiteUrl({ lat, lng, radiusKm: result.radiusKm, speciesKey: s.gbif_species_key })}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="See these records on GBIF"
                      className="italic text-zinc-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 hover:underline truncate"
                    >
                      {s.scientific_name}
                    </a>
                    {/* Both free — they came off the same parquet row as the
                        category, so naming the group and the year costs the
                        panel nothing and tells an assessor whether a precedent
                        is a comparable taxon and how current it is. */}
                    <span className="ml-auto shrink-0 text-zinc-400 tabular-nums">
                      {taxonLabel(s.taxon_group)}
                      {s.assessment_year != null && ` · ${s.assessment_year}`}
                      {" · "}
                      <span title={`${s.records} GBIF records within ${result.radiusKm} km`}>{s.records}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

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
