import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

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
  };
}

// In-memory cache of the JSON file
let cachedData: PrecomputedData | null = null;
let cacheLoadTime: number = 0;
const CACHE_RELOAD_INTERVAL = 60 * 60 * 1000; // Reload file every hour

function loadPrecomputedData(): PrecomputedData | null {
  const dataPath = path.join(process.cwd(), "data", "redlist-species.json");

  try {
    if (!fs.existsSync(dataPath)) {
      console.warn(`Pre-computed data file not found: ${dataPath}`);
      return null;
    }

    const fileContent = fs.readFileSync(dataPath, "utf-8");
    return JSON.parse(fileContent) as PrecomputedData;
  } catch (error) {
    console.error("Error loading pre-computed data:", error);
    return null;
  }
}

function getSpeciesData(): PrecomputedData | null {
  // Reload from file if cache is stale or empty
  if (!cachedData || Date.now() - cacheLoadTime > CACHE_RELOAD_INTERVAL) {
    cachedData = loadPrecomputedData();
    cacheLoadTime = Date.now();
  }
  return cachedData;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const search = searchParams.get("search")?.toLowerCase();

  const data = getSpeciesData();

  if (!data) {
    return NextResponse.json(
      {
        error:
          "Species data not available. Run the fetch script: npx tsx scripts/fetch-redlist-species.ts",
        species: [],
        total: 0,
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
  });
}
