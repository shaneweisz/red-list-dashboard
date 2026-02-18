import { NextRequest, NextResponse } from "next/server";
import { getTaxonConfig, CATEGORY_COLORS, CATEGORY_NAMES } from "@/config/taxa";
import { getSpeciesData, countNeSpecies } from "../_shared/data";

// Category order for display (most threatened first, NE last)
const CATEGORY_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD", "NE"];

interface CategoryStats {
  code: string;
  name: string;
  count: number;
  color: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "plantae";
  const taxon = getTaxonConfig(taxonId);

  const data = getSpeciesData(taxonId);

  if (!data) {
    return NextResponse.json(
      {
        error: `Species data not available for ${taxon.name}. Run: npx tsx scripts/fetch-redlist-species.ts ${taxonId}`,
        taxon: {
          id: taxon.id,
          name: taxon.name,
          estimatedDescribed: taxon.estimatedDescribed,
          estimatedSource: taxon.estimatedSource,
        },
      },
      { status: 503 }
    );
  }

  // Count NE species from GBIF CSV (species in GBIF but not in Red List)
  const redListNames = new Set(
    data.species.map((s) => s.scientific_name?.toLowerCase?.() || "").filter(Boolean)
  );
  const neCount = countNeSpecies(taxonId, redListNames);

  // Build category stats from precomputed data
  const byCategoryData: Record<string, number> = { ...data.metadata.byCategory, NE: neCount };
  const byCategory: CategoryStats[] = CATEGORY_ORDER.map((code) => ({
    code,
    name: CATEGORY_NAMES[code],
    count: byCategoryData[code] || 0,
    color: CATEGORY_COLORS[code],
  }));

  const totalWithNE = data.metadata.totalSpecies + neCount;

  return NextResponse.json({
    totalAssessed: data.metadata.totalSpecies,
    byCategory,
    sampleSize: totalWithNE,
    lastUpdated: data.metadata.fetchedAt,
    cached: true,
    taxon: {
      id: taxon.id,
      name: taxon.name,
      estimatedDescribed: taxon.estimatedDescribed,
      estimatedSource: taxon.estimatedSource,
      color: taxon.color,
    },
  });
}
