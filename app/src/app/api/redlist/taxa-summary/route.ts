import { NextRequest, NextResponse } from "next/server";
import { getTaxaSummary } from "@/lib/data/species-store";
import { findNode, getCsvGroupsForNode } from "@/lib/taxonomy-utils";
import { getView } from "@/config/taxonomy-views";
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
      // Return data structured by Table 1a sections from the view config
      const view = getView("table1a");
      const sections = (view.sections ?? []).map((section) => ({
        title: section.title,
        rows: section.nodeIds.map((nodeId) => {
          const node = findNode(nodeId);
          const csvGroups = getCsvGroupsForNode(nodeId);
          // For Table 1a, each node maps to one CSV group typically
          const row = csvGroups.length === 1 ? rowsByGroup.get(csvGroups[0]) : undefined;
          // For multi-group nodes, merge
          const matchedRows = csvGroups
            .map((g) => rowsByGroup.get(g))
            .filter(Boolean) as typeof data;
          const totalAssessed = matchedRows.reduce(
            (sum, r) => sum + Number(r.total_assessed ?? 0), 0
          );
          const outdated = matchedRows.reduce(
            (sum, r) => sum + Number(r.outdated ?? 0), 0
          );
          const gbifSpeciesCount = matchedRows.reduce(
            (sum, r) => sum + Number(r.gbif_species_count ?? 0), 0
          );
          const gbifNeSpeciesCount = matchedRows.reduce(
            (sum, r) => sum + Number(r.gbif_ne_species_count ?? 0), 0
          );
          const totalGbifObservations = matchedRows.reduce(
            (sum, r) => sum + Number(r.total_gbif_observations ?? 0), 0
          );
          const estimatedDescribed = node?.estimatedDescribed ?? 0;
          return {
            group: nodeId,
            name: node?.name ?? nodeId,
            estimatedDescribed,
            totalAssessed,
            percentAssessed: estimatedDescribed > 0 ? (totalAssessed / estimatedDescribed) * 100 : 0,
            outdated,
            percentOutdated: totalAssessed > 0 ? (outdated / totalAssessed) * 100 : 0,
            byCategory: matchedRows.length > 0 ? mergeByCategory(matchedRows.map((r) => ({ by_category: r.by_category ?? {} }))) : {},
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

    // Default view: use the 8-taxa view from taxonomy tree
    const defaultView = getView("default");
    const allNode = findNode("all");

    const taxa: TaxonSummary[] = [
      // "all" row first
      ...(allNode ? [{
        id: "all",
        name: allNode.name,
        color: allNode.color ?? "#dc2626",
        estimatedDescribed: allNode.estimatedDescribed ?? 0,
        available: true,
        totalAssessed: 0, // Will be computed below
        percentAssessed: 0,
        outdated: 0,
        percentOutdated: 0,
        lastUpdated: null,
        byCategory: {} as Record<string, number>,
      }] : []),
      // Per-taxon rows
      ...defaultView.roots.map((nodeId) => {
        const node = findNode(nodeId);
        if (!node) {
          return {
            id: nodeId,
            name: nodeId,
            color: "#78716c",
            estimatedDescribed: 0,
            available: false,
            totalAssessed: 0,
            percentAssessed: 0,
            outdated: 0,
            percentOutdated: 0,
            lastUpdated: null,
            byCategory: {},
          };
        }

        const groups = getCsvGroupsForNode(nodeId);
        const matchedRows = groups
          .map((g) => rowsByGroup.get(g))
          .filter(Boolean) as typeof data;

        const available = matchedRows.length > 0;

        const totalAssessed = matchedRows.reduce(
          (sum, r) => sum + Number(r.total_assessed ?? 0), 0
        );
        const outdated = matchedRows.reduce(
          (sum, r) => sum + Number(r.outdated ?? 0), 0
        );
        const byCategory = mergeByCategory(
          matchedRows.map((r) => ({ by_category: r.by_category ?? {} }))
        );
        const totalGbifObservations = matchedRows.reduce(
          (sum, r) => sum + Number(r.total_gbif_observations ?? 0), 0
        );
        const gbifSpeciesCount = matchedRows.reduce(
          (sum, r) => sum + Number(r.gbif_species_count ?? 0), 0
        );
        const gbifNeSpeciesCount = matchedRows.reduce(
          (sum, r) => sum + Number(r.gbif_ne_species_count ?? 0), 0
        );
        const meanGbifObsPerSpecies =
          gbifSpeciesCount > 0 ? totalGbifObservations / gbifSpeciesCount : undefined;

        const medianGbifObsPerSpecies =
          matchedRows.length === 1 && matchedRows[0].median_gbif_obs != null
            ? Number(matchedRows[0].median_gbif_obs)
            : undefined;

        const estimatedDescribed = node.estimatedDescribed ?? 0;

        return {
          id: nodeId,
          name: node.name,
          color: node.color ?? "#78716c",
          estimatedDescribed,
          available,
          totalAssessed,
          percentAssessed:
            estimatedDescribed > 0
              ? (totalAssessed / estimatedDescribed) * 100
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
      }),
    ];

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
