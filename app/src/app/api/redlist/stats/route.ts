import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getTaxonConfig, CATEGORY_COLORS, CATEGORY_NAMES } from "@/config/taxa";

// Category order for display (most threatened first)
const CATEGORY_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD"];

interface CategoryStats {
  code: string;
  name: string;
  count: number;
  color: string;
}

interface Species {
  sis_taxon_id: number;
  category: string;
  year_published: string;
}

interface PrecomputedData {
  species: Species[];
  metadata: {
    totalSpecies: number;
    fetchedAt: string;
    pagesProcessed: number;
    byCategory: Record<string, number>;
    taxonId?: string;
  };
}

// In-memory cache (keyed by taxon ID)
const cachedData: Map<string, PrecomputedData | null> = new Map();
const cacheLoadTimes: Map<string, number> = new Map();
const CACHE_RELOAD_INTERVAL = 60 * 60 * 1000; // Reload file every hour

function loadPrecomputedData(taxonId: string): PrecomputedData | null {
  const taxon = getTaxonConfig(taxonId);
  const dataPath = path.join(process.cwd(), "data", taxon.dataFile);

  try {
    if (!fs.existsSync(dataPath)) {
      console.warn(`Pre-computed data file not found: ${dataPath}`);
      return null;
    }

    const fileContent = fs.readFileSync(dataPath, "utf-8");
    return JSON.parse(fileContent) as PrecomputedData;
  } catch (error) {
    console.error(`Error loading pre-computed data for ${taxonId}:`, error);
    return null;
  }
}

function getSpeciesData(taxonId: string): PrecomputedData | null {
  const cacheTime = cacheLoadTimes.get(taxonId) || 0;
  if (!cachedData.has(taxonId) || Date.now() - cacheTime > CACHE_RELOAD_INTERVAL) {
    cachedData.set(taxonId, loadPrecomputedData(taxonId));
    cacheLoadTimes.set(taxonId, Date.now());
  }
  return cachedData.get(taxonId) || null;
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

  // Build category stats from precomputed data
  const byCategory: CategoryStats[] = CATEGORY_ORDER.map((code) => ({
    code,
    name: CATEGORY_NAMES[code],
    count: data.metadata.byCategory[code] || 0,
    color: CATEGORY_COLORS[code],
  }));

  return NextResponse.json({
    totalAssessed: data.metadata.totalSpecies,
    byCategory,
    sampleSize: data.metadata.totalSpecies,
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
