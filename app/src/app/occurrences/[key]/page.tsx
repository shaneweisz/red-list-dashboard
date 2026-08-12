"use client";

/**
 * The occurrence map and record list on their own page, addressed by GBIF
 * species key: /occurrences/6CX6F.
 *
 * It exists to be linked and shared, and to load quickly — the dashboard's own
 * queries (species lists, taxa summaries, country stats) aren't run at all
 * here. One small lookup for the species' name and assessment context, then
 * the GBIF fetches the panel would make anyway.
 */
import { use, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const OccurrenceMapRow = dynamic(() => import("@/components/OccurrenceMapRow"), { ssr: false });

interface SpeciesSummary {
  scientific_name: string;
  common_name: string | null;
  taxon_group: string;
  category: string;
  gbif_species_key: string;
  assessment_id: number | null;
  assessment_date: string | null;
  sis_taxon_id: number | null;
  criteria: string | null;
  countries: string[];
  assessed: boolean;
}

export default function OccurrencesPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [species, setSpecies] = useState<SpeciesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/species/${encodeURIComponent(key)}/summary`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "No species with that GBIF key." : "Couldn't load this species.");
        return res.json();
      })
      .then((data: SpeciesSummary) => {
        if (!cancelled) setSpecies(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 text-center px-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
        <p className="text-xs text-zinc-400 tabular-nums">{key}</p>
        <Link href="/" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
          Back to the dashboard
        </Link>
      </div>
    );
  }

  if (!species) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <div className="animate-spin h-8 w-8 border-4 border-zinc-300 dark:border-zinc-600 border-t-transparent rounded-full" />
        <p className="text-xs text-zinc-400">Loading occurrences…</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900">
      <div className="flex items-baseline gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
        <h1 className="text-sm font-medium italic text-zinc-800 dark:text-zinc-100 truncate">
          {species.scientific_name}
        </h1>
        {species.common_name && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{species.common_name}</span>
        )}
        <span className="text-[11px] text-zinc-400 shrink-0">GBIF occurrences</span>
      </div>
      <div className="flex-1 min-h-0">
        <OccurrenceMapRow
          speciesKey={species.gbif_species_key}
          // This page is client-only, so the map can mount immediately.
          mounted
          fullscreen
          assessmentYear={species.assessment_date ? new Date(species.assessment_date).getFullYear() : null}
          assessmentDate={species.assessment_date}
          assessmentId={species.assessment_id}
          sisTaxonId={species.sis_taxon_id}
          category={species.category}
          criteria={species.criteria}
          taxonGroup={species.taxon_group}
          scientificName={species.scientific_name}
          // Only a real assessment has an IUCN native range. An unassessed
          // species' countries are derived from GBIF itself, so passing them
          // would dress the occurrence data up as an independent source.
          nativeCountriesRedList={species.assessed ? species.countries : undefined}
        />
      </div>
    </div>
  );
}
