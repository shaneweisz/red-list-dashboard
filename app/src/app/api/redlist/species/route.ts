import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { TAXA, getTaxonConfig } from "@/config/taxa";

interface PreviousAssessment {
  year: string;
  assessment_id: number;
  category: string;
}

interface Species {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string;
  url: string;
  population_trend: string | null;
  countries: string[];
  assessment_count: number;
  previous_assessments: PreviousAssessment[];
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

// In-memory cache of the JSON files (keyed by taxon ID)
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
  // Reload from file if cache is stale or empty
  if (!cachedData.has(taxonId) || Date.now() - cacheTime > CACHE_RELOAD_INTERVAL) {
    cachedData.set(taxonId, loadPrecomputedData(taxonId));
    cacheLoadTimes.set(taxonId, Date.now());
  }
  return cachedData.get(taxonId) || null;
}

// Get list of available taxa with their data status
function getAvailableTaxa(): { id: string; name: string; available: boolean; speciesCount: number }[] {
  return TAXA.map((taxon) => {
    const dataPath = path.join(process.cwd(), "data", taxon.dataFile);
    let available = false;
    let speciesCount = 0;

    try {
      if (fs.existsSync(dataPath)) {
        const data = getSpeciesData(taxon.id);
        if (data) {
          available = true;
          speciesCount = data.species.length;
        }
      }
    } catch {
      // File doesn't exist or can't be read
    }

    return {
      id: taxon.id,
      name: taxon.name,
      available,
      speciesCount,
    };
  });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "plantae";
  const category = searchParams.get("category");
  const search = searchParams.get("search")?.toLowerCase();

  // Special case: return list of available taxa
  if (searchParams.get("list") === "taxa") {
    return NextResponse.json({
      taxa: getAvailableTaxa(),
    });
  }

  const taxon = getTaxonConfig(taxonId);
  const data = getSpeciesData(taxonId);

  if (!data) {
    return NextResponse.json(
      {
        error: `Species data not available for ${taxon.name}. Run: npx tsx scripts/fetch-redlist-species.ts ${taxonId}`,
        species: [],
        total: 0,
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

  // Filter by category if specified
  let filtered = data.species;

  if (category) {
    filtered = filtered.filter((s) => s.category === category);
  }

  if (search) {
    filtered = filtered.filter((s) =>
      s.scientific_name.toLowerCase().includes(search)
    );
  }

  return NextResponse.json({
    species: filtered,
    total: filtered.length,
    metadata: data.metadata,
    taxon: {
      id: taxon.id,
      name: taxon.name,
      estimatedDescribed: taxon.estimatedDescribed,
      estimatedSource: taxon.estimatedSource,
      color: taxon.color,
    },
  });
}
