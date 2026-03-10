import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { TAXA } from "@/config/taxa";
import { getTaxonGroups } from "@/lib/supabase/taxon-groups";
import { CACHE_1H } from "@/lib/cache-headers";

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  outdated: number;
  percentOutdated: number;
  lastUpdated: string | null;
  byCategory: Record<string, number>;
  totalGbifObservations?: number;
  meanGbifObsPerSpecies?: number;
  medianGbifObsPerSpecies?: number;
  gbifSpeciesCount?: number;
  gbifObsDistribution?: Record<string, number>;
}

function mergeByCategory(
  rows: Array<{ by_category: Record<string, number> }>
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const row of rows) {
    for (const [cat, count] of Object.entries(row.by_category ?? {})) {
      merged[cat] = (merged[cat] ?? 0) + count;
    }
  }
  return merged;
}

export async function GET() {
  const { data: rows, error } = await supabase.rpc("get_taxa_summary");
  const data = (rows ?? []) as Array<{
    table1a_taxon_group: string;
    total_assessed: number;
    outdated: number;
    by_category: Record<string, number>;
    gbif_species_count: number;
    total_gbif_observations: number;
    mean_gbif_obs: number;
    median_gbif_obs: number | null;
  }>;

  if (error) {
    return NextResponse.json(
      { error: `Failed to query taxa_summary: ${error.message}` },
      { status: 500 }
    );
  }

  // Index rows by taxon group for fast lookup
  const rowsByGroup = new Map(
    (data ?? []).map((row) => [row.table1a_taxon_group, row])
  );

  const taxa: TaxonSummary[] = TAXA.map((taxon) => {
    const groups = getTaxonGroups(taxon.id);
    const matchedRows = groups
      .map((g) => rowsByGroup.get(g))
      .filter(Boolean) as typeof data;

    const available = matchedRows.length > 0;

    const totalAssessed = matchedRows.reduce(
      (sum, r) => sum + Number(r.total_assessed ?? 0),
      0
    );
    const outdated = matchedRows.reduce(
      (sum, r) => sum + Number(r.outdated ?? 0),
      0
    );
    const byCategory = mergeByCategory(
      matchedRows.map((r) => ({ by_category: r.by_category ?? {} }))
    );
    const totalGbifObservations = matchedRows.reduce(
      (sum, r) => sum + Number(r.total_gbif_observations ?? 0),
      0
    );
    const gbifSpeciesCount = matchedRows.reduce(
      (sum, r) => sum + Number(r.gbif_species_count ?? 0),
      0
    );
    const meanGbifObsPerSpecies =
      gbifSpeciesCount > 0 ? totalGbifObservations / gbifSpeciesCount : undefined;

    // For combined taxa the per-group medians cannot be recomputed exactly;
    // use the single-group median when available, otherwise omit.
    const medianGbifObsPerSpecies =
      matchedRows.length === 1 && matchedRows[0].median_gbif_obs != null
        ? Number(matchedRows[0].median_gbif_obs)
        : undefined;

    return {
      id: taxon.id,
      name: taxon.name,
      color: taxon.color,
      estimatedDescribed: taxon.estimatedDescribed,
      available,
      totalAssessed,
      percentAssessed:
        taxon.estimatedDescribed > 0
          ? (totalAssessed / taxon.estimatedDescribed) * 100
          : 0,
      outdated,
      percentOutdated:
        totalAssessed > 0 ? (outdated / totalAssessed) * 100 : 0,
      lastUpdated: null,
      byCategory,
      totalGbifObservations: available ? totalGbifObservations : undefined,
      meanGbifObsPerSpecies: available ? meanGbifObsPerSpecies : undefined,
      medianGbifObsPerSpecies: available ? medianGbifObsPerSpecies : undefined,
      gbifSpeciesCount: available ? gbifSpeciesCount : undefined,
    };
  });

  return NextResponse.json({ taxa }, { headers: CACHE_1H });
}
