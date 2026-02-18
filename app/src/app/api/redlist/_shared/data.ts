import * as fs from "fs";
import * as path from "path";
import { TAXA, getTaxonConfig } from "@/config/taxa";

export interface PreviousAssessment {
  year: string;
  assessment_id: number;
  category: string;
}

export interface Species {
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
  taxon_id?: string;
  gbif_species_key?: number;
  gbif_occurrence_count?: number;
  gbif_observations_after_assessment_year?: number | null;
}

export interface PrecomputedData {
  species: Species[];
  metadata: {
    totalSpecies: number;
    fetchedAt: string;
    pagesProcessed: number;
    byCategory: Record<string, number>;
    taxonId?: string;
  };
}

export interface GbifCsvRow {
  speciesKey: number;
  observationsTotal: number;
  observationsAfterAssessment: number;
}

// In-memory cache of the JSON files (keyed by taxon ID)
const cachedData: Map<string, PrecomputedData | null> = new Map();
const cacheLoadTimes: Map<string, number> = new Map();
const CACHE_RELOAD_INTERVAL = 60 * 60 * 1000; // Reload file every hour

// Cache for GBIF CSV lookups (scientific_name_lowercase -> { speciesKey, total, sinceAssessment })
const gbifCsvCache: Map<string, Map<string, GbifCsvRow>> = new Map();
const gbifCsvCacheLoadTimes: Map<string, number> = new Map();

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

/**
 * Load GBIF CSV and build a lookup of scientific_name -> { speciesKey, observationsTotal, observationsAfterAssessment }.
 * CSV format: species_key,observations_total,scientific_name,common_name,observations_after_assessment_year
 */
export function loadGbifCsvLookup(taxonId: string): Map<string, GbifCsvRow> {
  const cacheTime = gbifCsvCacheLoadTimes.get(taxonId) || 0;
  if (gbifCsvCache.has(taxonId) && Date.now() - cacheTime < CACHE_RELOAD_INTERVAL) {
    return gbifCsvCache.get(taxonId)!;
  }

  const lookup = new Map<string, GbifCsvRow>();
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
        const firstComma = line.indexOf(",");
        const secondComma = line.indexOf(",", firstComma + 1);
        const thirdComma = line.indexOf(",", secondComma + 1);
        const lastComma = line.lastIndexOf(",");

        const speciesKeyStr = line.slice(0, firstComma).trim();
        const totalStr = line.slice(firstComma + 1, secondComma).trim();
        const scientificName = line.slice(secondComma + 1, thirdComma).toLowerCase().trim();
        const sinceStr = line.slice(lastComma + 1).trim();

        const speciesKey = parseInt(speciesKeyStr, 10);
        const total = parseInt(totalStr, 10);
        const sinceCount = parseInt(sinceStr, 10);

        if (scientificName && !isNaN(speciesKey) && !isNaN(total)) {
          lookup.set(scientificName, {
            speciesKey,
            observationsTotal: total,
            observationsAfterAssessment: isNaN(sinceCount) ? 0 : sinceCount,
          });
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

function loadPrecomputedData(taxonId: string): PrecomputedData | null {
  const taxon = getTaxonConfig(taxonId);
  const dataPath = path.join(process.cwd(), "data", taxon.dataFile);

  try {
    if (fs.existsSync(dataPath)) {
      const fileContent = fs.readFileSync(dataPath, "utf-8");
      return JSON.parse(fileContent) as PrecomputedData;
    }

    if (taxon.dataFiles && taxon.dataFiles.length > 0) {
      const allSpecies: Species[] = [];
      const byCategory: Record<string, number> = {};
      let latestFetchedAt = "";

      for (const fileName of taxon.dataFiles) {
        const filePath = path.join(process.cwd(), "data", fileName);
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, "utf-8");
          const data = JSON.parse(fileContent) as PrecomputedData;

          const sourceTaxonId = fileToTaxonId[fileName] || "all";
          const taggedSpecies = data.species.map(s => ({ ...s, taxon_id: sourceTaxonId }));
          allSpecies.push(...taggedSpecies);

          for (const [cat, count] of Object.entries(data.metadata.byCategory)) {
            byCategory[cat] = (byCategory[cat] || 0) + count;
          }

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

export function getSpeciesData(taxonId: string): PrecomputedData | null {
  const cacheTime = cacheLoadTimes.get(taxonId) || 0;
  const cached = cachedData.get(taxonId);
  if (!cachedData.has(taxonId) || cached === null || Date.now() - cacheTime > CACHE_RELOAD_INTERVAL) {
    const data = loadPrecomputedData(taxonId);
    if (data) {
      cachedData.set(taxonId, data);
      cacheLoadTimes.set(taxonId, Date.now());
    }
    return data;
  }
  return cached || null;
}

/**
 * Get NE (Not Evaluated) species from GBIF CSVs that aren't in the Red List.
 * Returns species objects with category "NE" and GBIF data.
 */
export function getNeSpecies(taxonId: string, redListNames: Set<string>): Species[] {
  const taxon = getTaxonConfig(taxonId);
  const sourceTaxa = taxonId === "all"
    ? TAXA.filter(t => t.id !== "all")
    : [taxon];

  const neSpecies: Species[] = [];

  for (const sourceTaxon of sourceTaxa) {
    const gbifCsvPath = path.join(process.cwd(), "data", sourceTaxon.gbifDataFile);
    if (!fs.existsSync(gbifCsvPath)) continue;

    try {
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
        let commonName: string | null = null;
        if (hasCommonName) {
          const remaining = parts.slice(3);
          remaining.pop();
          const raw = remaining.join(",").trim();
          commonName = raw.replace(/^"|"$/g, "") || null;
        }
        if (scientificName && !redListNames.has(scientificName.toLowerCase())) {
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
            taxon_id: sourceTaxon.id,
          });
        }
      }
    } catch {
      // CSV not available or malformed, skip
    }
  }

  return neSpecies;
}

/**
 * Count NE species from GBIF CSVs (species in GBIF but not in Red List).
 */
export function countNeSpecies(taxonId: string, redListNames: Set<string>): number {
  const taxon = getTaxonConfig(taxonId);
  const csvFiles = taxonId === "all"
    ? TAXA.filter(t => t.id !== "all").map(t => t.gbifDataFile)
    : [taxon.gbifDataFile];

  let neCount = 0;

  for (const csvFile of csvFiles) {
    const gbifCsvPath = path.join(process.cwd(), "data", csvFile);
    if (!fs.existsSync(gbifCsvPath)) continue;

    try {
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
    } catch {
      // Ignore errors counting NE species
    }
  }

  return neCount;
}
