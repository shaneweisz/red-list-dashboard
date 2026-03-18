import { NextRequest, NextResponse } from "next/server";
import { getTaxaSummary } from "@/lib/data/species-store";
import { TAXA } from "@/config/taxa";
import { getTaxonGroups } from "@/lib/data/taxon-groups";
import { TABLE_1A_SECTIONS } from "@/config/table1a";
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
  gbifNeSpeciesCount?: number;
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

export async function GET(request: NextRequest) {
  try {
    const data = getTaxaSummary();
    const rowsByGroup = new Map(
      data.map((row) => [row.table1a_taxon_group, row])
    );

    const isTable1a = request.nextUrl.searchParams.get("table1a") === "true";

    if (isTable1a) {
      // Return data structured by Table 1a sections
      const sections = TABLE_1A_SECTIONS.map((section) => ({
        title: section.title,
        rows: section.rows.map((def) => {
          const row = rowsByGroup.get(def.group);
          const totalAssessed = Number(row?.total_assessed ?? 0);
          const outdated = Number(row?.outdated ?? 0);
          const gbifSpeciesCount = Number(row?.gbif_species_count ?? 0);
          const gbifNeSpeciesCount = Number(row?.gbif_ne_species_count ?? 0);
          const totalGbifObservations = Number(row?.total_gbif_observations ?? 0);
          return {
            group: def.group,
            name: def.name,
            estimatedDescribed: def.estimatedDescribed,
            totalAssessed,
            percentAssessed: def.estimatedDescribed > 0 ? (totalAssessed / def.estimatedDescribed) * 100 : 0,
            outdated,
            percentOutdated: totalAssessed > 0 ? (outdated / totalAssessed) * 100 : 0,
            byCategory: row?.by_category ?? {},
            gbifSpeciesCount,
            gbifNeSpeciesCount,
            totalGbifObservations,
            meanGbifObsPerSpecies: gbifSpeciesCount > 0 ? totalGbifObservations / gbifSpeciesCount : undefined,
            medianGbifObsPerSpecies: row?.median_gbif_obs != null ? Number(row.median_gbif_obs) : undefined,
          };
        }),
      }));
      return NextResponse.json({ sections }, { headers: CACHE_1H });
    }

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
      const gbifNeSpeciesCount = matchedRows.reduce(
        (sum, r) => sum + Number(r.gbif_ne_species_count ?? 0),
        0
      );
      const meanGbifObsPerSpecies =
        gbifSpeciesCount > 0 ? totalGbifObservations / gbifSpeciesCount : undefined;

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
        gbifNeSpeciesCount: available ? gbifNeSpeciesCount : undefined,
      };
    });

    return NextResponse.json({ taxa }, { headers: CACHE_1H });
  } catch (error) {
    console.error("Taxa summary error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Taxa summary failed: ${message}` },
      { status: 500 }
    );
  }
}
