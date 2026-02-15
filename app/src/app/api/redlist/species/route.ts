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
  common_name?: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string;
  url: string;
  population_trend: string | null;
  countries: string[];
  assessment_count: number;
  previous_assessments: PreviousAssessment[];
  taxon_id?: string; // Added when merging from multiple files
  gbif_species_key?: number; // GBIF species key for NE species
  gbif_occurrence_count?: number; // Total GBIF occurrences for NE species
  gbif_observations_after_assessment_year?: number | null; // Pre-computed from GBIF CSV
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

// Cache for GBIF since-assessment lookups (scientific_name_lowercase → count)
const sinceAssessmentCache: Map<string, Map<string, number>> = new Map();
const sinceAssessmentCacheLoadTimes: Map<string, number> = new Map();

/**
 * Load GBIF CSV and build a lookup of scientific_name → observations_after_assessment_year.
 * The CSV must have been enriched by enrich-gbif-since-assessment.ts.
 */
function loadSinceAssessmentLookup(taxonId: string): Map<string, number> {
  const cacheTime = sinceAssessmentCacheLoadTimes.get(taxonId) || 0;
  if (sinceAssessmentCache.has(taxonId) && Date.now() - cacheTime < CACHE_RELOAD_INTERVAL) {
    return sinceAssessmentCache.get(taxonId)!;
  }

  const lookup = new Map<string, number>();
  const dataDir = path.join(process.cwd(), "data");

  // For "all" taxon, load each top-level taxon's CSV
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
      if (!header.includes("observations_after_assessment_year") && !header.includes("occurrences_since_assessment")) continue;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Parse: species_key,occurrence_count,scientific_name,common_name,observations_after_assessment_year
        // The last field is the since-assessment count
        const lastComma = line.lastIndexOf(",");
        const sinceStr = line.slice(lastComma + 1).trim();
        if (!sinceStr) continue;

        const sinceCount = parseInt(sinceStr, 10);
        if (isNaN(sinceCount)) continue;

        // Extract scientific_name (3rd field)
        const firstComma = line.indexOf(",");
        const secondComma = line.indexOf(",", firstComma + 1);
        const thirdComma = line.indexOf(",", secondComma + 1);
        const scientificName = line.slice(secondComma + 1, thirdComma).toLowerCase().trim();

        if (scientificName) {
          lookup.set(scientificName, sinceCount);
        }
      }
    } catch {
      // CSV not available or malformed, skip
    }
  }

  sinceAssessmentCache.set(taxonId, lookup);
  sinceAssessmentCacheLoadTimes.set(taxonId, Date.now());
  return lookup;
}

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

      // Map data file names to taxon IDs for tagging species
      const fileToTaxonId: Record<string, string> = {
        "redlist-mammalia.json": "mammalia",
        "redlist-aves.json": "aves",
        "redlist-reptilia.json": "reptilia",
        "redlist-amphibia.json": "amphibia",
        "redlist-actinopterygii.json": "fishes",
        "redlist-chondrichthyes.json": "fishes",
        "redlist-insecta.json": "invertebrates",
        "redlist-arachnida.json": "invertebrates",
        "redlist-gastropoda.json": "invertebrates",
        "redlist-bivalvia.json": "invertebrates",
        "redlist-malacostraca.json": "invertebrates",
        "redlist-anthozoa.json": "invertebrates",
        "redlist-plantae.json": "plantae",
        "redlist-ascomycota.json": "fungi",
        "redlist-basidiomycota.json": "fungi",
      };

      for (const fileName of taxon.dataFiles) {
        const filePath = path.join(process.cwd(), "data", fileName);
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(fileContent) as PrecomputedData;

          // Tag each species with its source taxon ID
          const sourceTaxonId = fileToTaxonId[fileName] || "all";
          const taggedSpecies = data.species.map(s => ({ ...s, taxon_id: sourceTaxonId }));
          allSpecies.push(...taggedSpecies);

          // Merge category counts
          for (const [cat, count] of Object.entries(data.metadata.byCategory)) {
            byCategory[cat] = (byCategory[cat] || 0) + count;
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

// Get list of available taxa with their data status
function getAvailableTaxa(): { id: string; name: string; available: boolean; speciesCount: number }[] {
  return TAXA.map((taxon) => {
    let available = false;
    let speciesCount = 0;

    try {
      // Use getSpeciesData which handles both single and multiple data files
      const data = getSpeciesData(taxon.id);
      if (data) {
        available = true;
        speciesCount = data.species.length;
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

  // Handle NE category: serve species from GBIF CSV that aren't in Red List
  if (category === "NE") {
    try {
      // Build set of Red List scientific names
      const redListNames = new Set(
        data.species.map((s) => s.scientific_name.toLowerCase().trim())
      );

      // For "all" taxon, read each individual taxon's CSV
      const csvFiles = taxonId === "all"
        ? TAXA.filter(t => t.id !== "all").map(t => t.gbifDataFile)
        : [taxon.gbifDataFile];

      let neSpecies: Species[] = [];

      for (const csvFile of csvFiles) {
        const gbifCsvPath = path.join(process.cwd(), "data", csvFile);
        if (!fs.existsSync(gbifCsvPath)) continue;

        const csvContent = fs.readFileSync(gbifCsvPath, "utf-8");
        const lines = csvContent.trim().split("\n");
        const header = lines[0];
        if (!header.includes("scientific_name")) continue;
        const hasCommonName = header.includes("common_name");

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(",");
          const speciesKey = parseInt(parts[0], 10);
          const occurrenceCount = parseInt(parts[1], 10);
          const scientificName = parts[2]?.trim() || "";
          // Common name is in column 3; handle quoted values that may contain commas
          let commonName: string | null = null;
          if (hasCommonName) {
            // Column 4 (index 3) is common_name, column 5 is observations_after_assessment_year
            // Common names may be quoted and contain commas, so rejoin and strip last column
            const remaining = parts.slice(3);
            // Last element is observations_after_assessment_year
            remaining.pop();
            const raw = remaining.join(",").trim();
            commonName = raw.replace(/^"|"$/g, "") || null;
          }
          if (scientificName && !redListNames.has(scientificName.toLowerCase())) {
            neSpecies.push({
              sis_taxon_id: speciesKey, // Use GBIF species key as ID
              assessment_id: 0,
              scientific_name: scientificName,
              common_name: commonName,
              family: null,
              category: "NE",
              assessment_date: null,
              year_published: "",
              url: `https://www.gbif.org/species/${speciesKey}`,
              population_trend: null,
              countries: [],
              assessment_count: 0,
              previous_assessments: [],
              gbif_species_key: speciesKey,
              gbif_occurrence_count: occurrenceCount,
            } as Species);
          }
        }
      }

      // Apply search filter
      if (search) {
        neSpecies = neSpecies.filter((s) =>
          s.scientific_name.toLowerCase().includes(search) ||
          s.common_name?.toLowerCase().includes(search)
        );
      }

      return NextResponse.json({
        species: neSpecies,
        total: neSpecies.length,
        metadata: data.metadata,
        taxon: { id: taxon.id, name: taxon.name, estimatedDescribed: taxon.estimatedDescribed, estimatedSource: taxon.estimatedSource, color: taxon.color },
      });
    } catch (error) {
      console.error("Error loading NE species:", error);
      return NextResponse.json({
        species: [],
        total: 0,
        taxon: { id: taxon.id, name: taxon.name, estimatedDescribed: taxon.estimatedDescribed, estimatedSource: taxon.estimatedSource, color: taxon.color },
      });
    }
  }

  // Filter by category if specified
  let filtered = data.species;

  if (category) {
    filtered = filtered.filter((s) => s.category === category);
  }

  if (search) {
    filtered = filtered.filter(
      (s) =>
        s.scientific_name.toLowerCase().includes(search) ||
        s.common_name?.toLowerCase().includes(search)
    );
  }

  // Enrich species with pre-computed GBIF since-assessment counts
  const sinceAssessmentLookup = loadSinceAssessmentLookup(taxonId);
  const enriched = sinceAssessmentLookup.size > 0
    ? filtered.map(s => {
        const count = sinceAssessmentLookup.get(s.scientific_name.toLowerCase().trim());
        return count !== undefined ? { ...s, gbif_observations_after_assessment_year: count } : s;
      })
    : filtered;

  return NextResponse.json({
    species: enriched,
    total: enriched.length,
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
