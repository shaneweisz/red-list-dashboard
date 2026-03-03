import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getTaxonConfig, TAXA, CATEGORY_COLORS, CATEGORY_NAMES } from "@/config/taxa";
import { parseGbifCsvLine } from "@/lib/data-utils";
import { CACHE_1H } from "@/lib/cache-headers";

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
  assessment_date?: string | null;
  countries?: string[];
}

// Cache for GBIF CSV lookups (scientific_name_lowercase → observationsTotal)
interface GbifCsvRow {
  observationsTotal: number;
}
const gbifCsvCache: Map<string, Map<string, GbifCsvRow>> = new Map();
const gbifCsvCacheLoadTimes: Map<string, number> = new Map();

function loadGbifCsvLookup(taxonId: string): Map<string, GbifCsvRow> {
  const cacheTime = gbifCsvCacheLoadTimes.get(taxonId) || 0;
  if (gbifCsvCache.has(taxonId) && Date.now() - cacheTime < CACHE_RELOAD_INTERVAL) {
    return gbifCsvCache.get(taxonId)!;
  }

  const lookup = new Map<string, GbifCsvRow>();
  const dataDir = path.join(process.cwd(), "data");

  const csvFiles: string[] = [];
  if (taxonId === "all") {
    const topLevelTaxa = TAXA.filter(t => t.id !== "all");
    for (const t of topLevelTaxa) {
      csvFiles.push(t.gbifDataFile);
    }
  } else {
    const taxon = getTaxonConfig(taxonId);
    csvFiles.push(taxon.gbifDataFile);
  }

  for (const csvFile of csvFiles) {
    const csvPath = path.join(dataDir, csvFile);
    if (!fs.existsSync(csvPath)) continue;

    try {
      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.trim().split("\n");
      const header = lines[0];
      if (!header.includes("scientific_name")) continue;

      for (let i = 1; i < lines.length; i++) {
        const record = parseGbifCsvLine(lines[i], { hasScientificName: true, hasSinceAssessment: false });
        const scientificName = record.scientific_name?.toLowerCase().trim();

        if (scientificName && !isNaN(record.occurrence_count)) {
          lookup.set(scientificName, { observationsTotal: record.occurrence_count });
        }
      }
    } catch {
      // CSV not available or malformed, skip
    }
  }

  gbifCsvCache.set(taxonId, lookup);
  gbifCsvCacheLoadTimes.set(taxonId, Date.now());
  return lookup;
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
    // Build set of Red List scientific names for matching
    const redListNames = new Set(
      data.species.map((s) => s.scientific_name?.toLowerCase?.() || "").filter(Boolean)
    );

    // For "all" taxon, read each individual taxon's CSV
    const csvFiles = taxonId === "all"
      ? TAXA.filter(t => t.id !== "all").map(t => t.gbifDataFile)
      : [taxon.gbifDataFile];

    for (const csvFile of csvFiles) {
      const gbifCsvPath = path.join(process.cwd(), "data", csvFile);
      if (!fs.existsSync(gbifCsvPath)) continue;

      const csvContent = fs.readFileSync(gbifCsvPath, "utf-8");
      const lines = csvContent.trim().split("\n");
      const header = lines[0];
      if (!header.includes("scientific_name")) continue;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        const scientificName = parts[2]?.toLowerCase?.().trim();
        if (scientificName && !redListNames.has(scientificName)) {
          neCount++;
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

  // Compute year-range distribution
  const currentYear = new Date().getFullYear();
  const yearRanges = [
    { range: "0-1 years", shortRange: "0-1y", count: 0 },
    { range: "2-5 years", shortRange: "2-5y", count: 0 },
    { range: "6-10 years", shortRange: "6-10y", count: 0 },
    { range: "11-20 years", shortRange: "11-20y", count: 0 },
    { range: "20+ years", shortRange: ">20y", count: 0 },
  ];
  for (const s of data.species) {
    if (!s.assessment_date || s.category === "NE") continue;
    const yr = new Date(s.assessment_date).getFullYear();
    const diff = currentYear - yr;
    if (diff <= 1) yearRanges[0].count++;
    else if (diff <= 5) yearRanges[1].count++;
    else if (diff <= 10) yearRanges[2].count++;
    else if (diff <= 20) yearRanges[3].count++;
    else yearRanges[4].count++;
  }

  // Compute GBIF observation distribution
  const gbifLookup = loadGbifCsvLookup(taxonId);
  const obsRanges = [
    { range: "0", shortRange: "0", count: 0 },
    { range: "1-10", shortRange: "1-10", count: 0 },
    { range: "11-100", shortRange: "11-100", count: 0 },
    { range: "101-1K", shortRange: "101-1K", count: 0 },
    { range: "1K-10K", shortRange: "1K-10K", count: 0 },
    { range: "10K+", shortRange: "10K+", count: 0 },
  ];
  for (const s of data.species) {
    const row = gbifLookup.get((s.scientific_name || "").toLowerCase().trim());
    const obs = row?.observationsTotal ?? 0;
    if (obs === 0) obsRanges[0].count++;
    else if (obs <= 10) obsRanges[1].count++;
    else if (obs <= 100) obsRanges[2].count++;
    else if (obs <= 1000) obsRanges[3].count++;
    else if (obs <= 10000) obsRanges[4].count++;
    else obsRanges[5].count++;
  }

  // Compute country counts
  const countryCounts: Record<string, number> = {};
  for (const s of data.species) {
    if (s.countries) {
      for (const code of s.countries) {
        countryCounts[code] = (countryCounts[code] || 0) + 1;
      }
    }
  }

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
    // Pre-computed chart distributions
    yearRanges,
    obsRanges,
    countryCounts,
  }, { headers: CACHE_1H });
}
