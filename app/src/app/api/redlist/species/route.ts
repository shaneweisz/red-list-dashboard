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

// Maximum NE species to return in a single response to stay within memory/response size limits.
// The total count is always returned so the frontend knows the actual number.
const NE_SPECIES_LIMIT = 50000;

// Helper: collect NE species from a single taxon's GBIF CSV
function collectNESpeciesFromCSV(
  processTaxon: { id: string; gbifDataFile: string },
  redListNames: Set<string>,
  search: string | undefined,
  neSpecies: Species[],
  tagTaxonId: boolean,
): number {
  let count = 0;
  const gbifCsvPath = path.join(process.cwd(), "data", processTaxon.gbifDataFile);
  if (!fs.existsSync(gbifCsvPath)) return 0;

  const csvContent = fs.readFileSync(gbifCsvPath, "utf-8");
  const lines = csvContent.trim().split("\n");
  const header = lines[0];
  const hasScientificName = header.includes("scientific_name");
  const hasCommonName = header.includes("common_name");

  if (!hasScientificName) return 0;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const speciesKey = parseInt(parts[0], 10);
    const occurrenceCount = parseInt(parts[1], 10);
    const scientificName = parts[2]?.trim() || "";
    let commonName: string | null = null;
    if (hasCommonName) {
      const raw = parts.slice(3).join(",").trim();
      commonName = raw.replace(/^"|"$/g, "") || null;
    }
    if (scientificName && !redListNames.has(scientificName.toLowerCase())) {
      // Apply search filter inline to avoid accumulating unwanted entries
      if (search && !(
        scientificName.toLowerCase().includes(search) ||
        commonName?.toLowerCase().includes(search)
      )) {
        continue;
      }
      count++;
      if (neSpecies.length < NE_SPECIES_LIMIT) {
        neSpecies.push({
          sis_taxon_id: speciesKey,
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
          ...(tagTaxonId ? { taxon_id: processTaxon.id } : {}),
        } as Species);
      }
    }
  }
  return count;
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

  // Handle NE category for "all" taxon BEFORE loading merged data.
  // Loading all 15 JSON files (~100MB) plus accumulating ~900K NE species exceeds
  // Vercel's memory limits. Process each sub-taxon individually instead.
  if (category === "NE" && taxonId === "all") {
    try {
      const subTaxa = TAXA.filter(t => t.id !== "all");
      const neSpecies: Species[] = [];
      let totalNECount = 0;

      for (const subTaxon of subTaxa) {
        const subData = getSpeciesData(subTaxon.id);
        if (!subData) continue;

        const redListNames = new Set(
          subData.species.map((s) => s.scientific_name.toLowerCase().trim())
        );

        totalNECount += collectNESpeciesFromCSV(
          subTaxon, redListNames, search, neSpecies, true
        );
      }

      return NextResponse.json({
        species: neSpecies,
        total: neSpecies.length,
        totalNE: totalNECount,
        taxon: { id: taxon.id, name: taxon.name, estimatedDescribed: taxon.estimatedDescribed, estimatedSource: taxon.estimatedSource, color: taxon.color },
      });
    } catch (error) {
      console.error("Error loading NE species for all taxa:", error);
      return NextResponse.json({
        species: [],
        total: 0,
        taxon: { id: taxon.id, name: taxon.name, estimatedDescribed: taxon.estimatedDescribed, estimatedSource: taxon.estimatedSource, color: taxon.color },
      });
    }
  }

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

  // Handle NE category for individual taxa
  if (category === "NE") {
    try {
      const redListNames = new Set(
        data.species.map((s) => s.scientific_name.toLowerCase().trim())
      );

      const neSpecies: Species[] = [];
      const totalNECount = collectNESpeciesFromCSV(
        taxon, redListNames, search, neSpecies, false
      );

      return NextResponse.json({
        species: neSpecies,
        total: neSpecies.length,
        totalNE: totalNECount,
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
