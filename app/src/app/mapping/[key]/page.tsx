/**
 * The occurrence map and record list on their own page, addressed by GBIF
 * species key: /mapping/6CX6F.
 *
 * It exists to be linked and shared, and to load quickly — the dashboard's own
 * queries (species lists, taxa summaries, country stats) aren't run at all
 * here. The species is resolved server-side in the same request that renders
 * the page, so the only thing the browser waits on is GBIF itself.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getSpeciesByGbifKey } from "@/lib/data/species-duckdb";
import OccurrencePanel from "./OccurrencePanel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  const species = await getSpeciesByGbifKey(key).catch(() => null);
  return {
    title: species ? `${species.scientific_name} — GBIF occurrences` : "GBIF occurrences",
    description: species
      ? `GBIF occurrence records for ${species.scientific_name}, with the locality detail behind each one.`
      : undefined,
  };
}

export default async function OccurrencesPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const species = await getSpeciesByGbifKey(key);
  if (!species) notFound();

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900">
      <div className="flex items-baseline gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
        <Link href="/" className="text-sm font-medium italic text-zinc-800 dark:text-zinc-100 truncate hover:underline">
          {species.scientific_name}
        </Link>
        {species.common_name && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{species.common_name}</span>
        )}
        <span className="text-[11px] text-zinc-400 shrink-0">GBIF occurrences</span>
      </div>
      <div className="flex-1 min-h-0">
        <OccurrencePanel
          speciesKey={species.gbif_species_key}
          scientificName={species.scientific_name}
          taxonGroup={species.taxon_group}
          category={species.category}
          criteria={species.criteria}
          assessmentId={species.assessment_id}
          assessmentDate={species.assessment_date}
          sisTaxonId={species.sis_taxon_id}
          // Only a real assessment has an IUCN native range. An unassessed
          // species' countries are derived from GBIF itself, so passing them
          // would dress the occurrence data up as an independent source.
          nativeCountriesRedList={species.assessed ? species.countries : undefined}
          dashboardTaxonToken={species.node_id}
        />
      </div>
    </div>
  );
}
