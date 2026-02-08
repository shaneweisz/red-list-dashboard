import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getTaxonConfig, CATEGORY_COLORS, CATEGORY_NAMES } from "@/config/taxa";

// Category order for display (most threatened first, NE last)
const CATEGORY_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD", "NE"];

interface CategoryStats {
  code: string;
  name: string;
  count: number;
  color: string;
}

interface Species {
  sis_taxon_id: number;
  scientific_name?: string;
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
    // First try to load the single data file
    if (fs.existsSync(dataPath)) {
      const fileContent = fs.readFileSync(dataPath, "utf-8");
      return JSON.parse(fileContent) as PrecomputedData;
    }

    // If single file doesn't exist, try to merge multiple data files (for combined taxa)
    if (taxon.dataFiles && taxon.dataFiles.length > 0) {
      const allSpecies: Species[] = [];
      const byCategory: Record<string, number> = {};
      let latestFetchedAt = "";

      for (const fileName of taxon.dataFiles) {
        const filePath = path.join(process.cwd(), "data", fileName);
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(fileContent) as PrecomputedData;
          allSpecies.push(...data.species);

          // Merge category counts
          if (data.metadata.byCategory) {
            for (const [cat, count] of Object.entries(data.metadata.byCategory)) {
              byCategory[cat] = (byCategory[cat] || 0) + count;
            }
          }

          // Track the latest fetch time
          if (data.metadata.fetchedAt > latestFetchedAt) {
            latestFetchedAt = data.metadata.fetchedAt;
          }
        }
      }

      if (allSpecies.length > 0) {
        return {
          species: allSpecies,
          metadata: {
            totalSpecies: allSpecies.length,
            fetchedAt: latestFetchedAt,
            pagesProcessed: 0,
            byCategory,
            taxonId,
          },
        };
      }
    }

    console.warn(`Pre-computed data file not found: ${dataPath}`);
    return null;
  } catch (error) {
    console.error(`Error loading pre-computed data for ${taxonId}:`, error);
    return null;
  }
}

function getSpeciesData(taxonId: string): PrecomputedData | null {
  const cacheTime = cacheLoadTimes.get(taxonId) || 0;
  const cached = cachedData.get(taxonId);
  // Reload from file if cache is stale, empty, or was null (retry failed loads)
  if (!cachedData.has(taxonId) || cached === null || Date.now() - cacheTime > CACHE_RELOAD_INTERVAL) {
    const data = loadPrecomputedData(taxonId);
    // Only cache successful loads
    if (data) {
      cachedData.set(taxonId, data);
      cacheLoadTimes.set(taxonId, Date.now());
    }
    return data;
  }
  return cached || null;
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
  let neCount = 0;
  try {
    const gbifCsvPath = path.join(process.cwd(), "data", taxon.gbifDataFile);
    if (fs.existsSync(gbifCsvPath)) {
      // Build set of Red List scientific names for matching
      const redListNames = new Set(
        data.species.map((s) => s.scientific_name?.toLowerCase?.() || "").filter(Boolean)
      );

      const csvContent = fs.readFileSync(gbifCsvPath, "utf-8");
      const lines = csvContent.trim().split("\n");
      const header = lines[0];
      const hasScientificName = header.includes("scientific_name");

      if (hasScientificName) {
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(",");
          const scientificName = parts[2]?.toLowerCase?.().trim();
          if (scientificName && !redListNames.has(scientificName)) {
            neCount++;
          }
        }
      }
    }
  } catch {
    // Ignore errors counting NE species
  }

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
