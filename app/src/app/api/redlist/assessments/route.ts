import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

interface YearRange {
  range: string;
  count: number;
  minYear: number;
  maxYear: number;
}

interface Species {
  year_published: string;
}

interface PrecomputedData {
  species: Species[];
  metadata: {
    totalSpecies: number;
    fetchedAt: string;
  };
}

// In-memory cache
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
  if (!cachedData || Date.now() - cacheLoadTime > CACHE_RELOAD_INTERVAL) {
    cachedData = loadPrecomputedData();
    cacheLoadTime = Date.now();
  }
  return cachedData;
}

function getYearRange(yearsSince: number): string {
  if (yearsSince <= 1) return "0-1 years";
  if (yearsSince <= 5) return "2-5 years";
  if (yearsSince <= 10) return "6-10 years";
  if (yearsSince <= 20) return "11-20 years";
  return "20+ years";
}

export async function GET() {
  const data = getSpeciesData();

  if (!data) {
    return NextResponse.json(
      {
        error:
          "Species data not available. Run the fetch script: npx tsx scripts/fetch-redlist-species.ts",
      },
      { status: 503 }
    );
  }

  const currentYear = new Date().getFullYear();
  const yearCounts: Record<string, number> = {
    "0-1 years": 0,
    "2-5 years": 0,
    "6-10 years": 0,
    "11-20 years": 0,
    "20+ years": 0,
  };

  // Count species by year range
  for (const species of data.species) {
    const yearPublished = parseInt(species.year_published, 10);
    if (!isNaN(yearPublished)) {
      const yearsSince = currentYear - yearPublished;
      const range = getYearRange(yearsSince);
      yearCounts[range]++;
    }
  }

  // Build year ranges array in order
  const yearRanges: YearRange[] = [
    { range: "0-1 years", count: yearCounts["0-1 years"], minYear: 0, maxYear: 1 },
    { range: "2-5 years", count: yearCounts["2-5 years"], minYear: 2, maxYear: 5 },
    { range: "6-10 years", count: yearCounts["6-10 years"], minYear: 6, maxYear: 10 },
    { range: "11-20 years", count: yearCounts["11-20 years"], minYear: 11, maxYear: 20 },
    { range: "20+ years", count: yearCounts["20+ years"], minYear: 21, maxYear: 999 },
  ];

  return NextResponse.json({
    yearsSinceAssessment: yearRanges,
    sampleSize: data.metadata.totalSpecies,
    lastUpdated: data.metadata.fetchedAt,
    cached: true,
  });
}
