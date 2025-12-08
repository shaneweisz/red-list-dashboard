import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

// IUCN Red List category colors (official)
const IUCN_COLORS: Record<string, string> = {
  EX: "#000000", // Extinct - Black
  EW: "#542344", // Extinct in Wild - Purple
  CR: "#d81e05", // Critically Endangered - Red
  EN: "#fc7f3f", // Endangered - Orange
  VU: "#f9e814", // Vulnerable - Yellow
  NT: "#cce226", // Near Threatened - Yellow-green
  LC: "#60c659", // Least Concern - Green
  DD: "#6b7280", // Data Deficient - Gray
};

const IUCN_CATEGORY_NAMES: Record<string, string> = {
  EX: "Extinct",
  EW: "Extinct in the Wild",
  CR: "Critically Endangered",
  EN: "Endangered",
  VU: "Vulnerable",
  NT: "Near Threatened",
  LC: "Least Concern",
  DD: "Data Deficient",
};

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

  // Build category stats from precomputed data
  const byCategory: CategoryStats[] = CATEGORY_ORDER.map((code) => ({
    code,
    name: IUCN_CATEGORY_NAMES[code],
    count: data.metadata.byCategory[code] || 0,
    color: IUCN_COLORS[code],
  }));

  return NextResponse.json({
    totalAssessed: data.metadata.totalSpecies,
    byCategory,
    sampleSize: data.metadata.totalSpecies,
    lastUpdated: data.metadata.fetchedAt,
    cached: true,
  });
}
