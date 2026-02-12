/**
 * Shared data loading and caching module for all Red List API routes.
 *
 * Previously each API route (taxa, stats, assessments, species) independently
 * loaded and parsed the same large JSON/CSV files with its own in-memory cache.
 * This module provides a single shared cache so files are only parsed once,
 * and exposes async APIs with parallel loading support.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { TAXA, getTaxonConfig, TaxonConfig } from "@/config/taxa";

// ---------- Shared types ----------

export interface SpeciesRecord {
  sis_taxon_id: number;
  assessment_id?: number;
  scientific_name: string;
  common_name?: string | null;
  family?: string | null;
  category: string;
  assessment_date?: string | null;
  year_published?: string;
  url?: string;
  population_trend?: string | null;
  countries?: string[];
  assessment_count?: number;
  previous_assessments?: { year: string; assessment_id: number; category: string }[];
  taxon_id?: string;
  gbif_species_key?: number;
  gbif_occurrence_count?: number;
}

export interface PrecomputedData {
  species: SpeciesRecord[];
  metadata: {
    totalSpecies: number;
    fetchedAt: string;
    pagesProcessed?: number;
    byCategory: Record<string, number>;
    taxonId?: string;
  };
}

// ---------- Caches ----------

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Cache for parsed JSON data files (keyed by filename)
const jsonFileCache = new Map<string, { data: PrecomputedData; time: number }>();

// Cache for merged taxon data (keyed by taxon id)
const taxonDataCache = new Map<string, { data: PrecomputedData | null; time: number }>();

// Cache for NE species counts (keyed by taxon id)
const neCountCache = new Map<string, { count: number; time: number }>();

// File-to-taxon mapping for tagging species in "all" taxon
const FILE_TO_TAXON_ID: Record<string, string> = {
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

function isCacheValid(time: number | undefined): boolean {
  return time !== undefined && Date.now() - time < CACHE_TTL;
}

// ---------- Single file loading (cached, async) ----------

async function loadSingleFile(dataFile: string): Promise<PrecomputedData | null> {
  const cached = jsonFileCache.get(dataFile);
  if (cached && isCacheValid(cached.time)) {
    return cached.data;
  }

  try {
    const dataPath = path.join(process.cwd(), "data", dataFile);
    const content = await fs.readFile(dataPath, "utf-8");
    const data = JSON.parse(content) as PrecomputedData;
    jsonFileCache.set(dataFile, { data, time: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ---------- Taxon data loading (handles single + multi-file taxa) ----------

export async function loadTaxonData(
  taxonId: string,
  { tagSpecies = false }: { tagSpecies?: boolean } = {},
): Promise<PrecomputedData | null> {
  const cacheKey = `${taxonId}:${tagSpecies}`;
  const cached = taxonDataCache.get(cacheKey);
  if (cached && isCacheValid(cached.time)) {
    return cached.data;
  }

  const taxon = getTaxonConfig(taxonId);

  // Multi-file taxa (all, fishes, invertebrates, fungi)
  if (taxon.dataFiles && taxon.dataFiles.length > 0) {
    // Load all files in parallel
    const results = await Promise.all(taxon.dataFiles.map((f) => loadSingleFile(f)));
    const validResults = results.filter((r): r is PrecomputedData => r !== null);

    if (validResults.length === 0) {
      taxonDataCache.set(cacheKey, { data: null, time: Date.now() });
      return null;
    }

    const mergedByCategory: Record<string, number> = {};
    let mergedSpecies: SpeciesRecord[];

    if (tagSpecies) {
      // Tag each species with source taxon ID (used by species route for "all")
      mergedSpecies = [];
      for (let i = 0; i < validResults.length; i++) {
        const fileName = taxon.dataFiles[results.indexOf(validResults[i])] ||
          taxon.dataFiles[i];
        const sourceTaxonId = FILE_TO_TAXON_ID[fileName] || "all";
        for (const s of validResults[i].species) {
          mergedSpecies.push({ ...s, taxon_id: sourceTaxonId } as SpeciesRecord);
        }
      }
    } else {
      mergedSpecies = validResults.flatMap((d) => d.species);
    }

    for (const data of validResults) {
      if (data.metadata.byCategory) {
        for (const [cat, count] of Object.entries(data.metadata.byCategory)) {
          mergedByCategory[cat] = (mergedByCategory[cat] || 0) + count;
        }
      }
    }

    const latestFetchedAt = validResults
      .map((d) => d.metadata.fetchedAt)
      .sort()
      .pop()!;

    const merged: PrecomputedData = {
      species: mergedSpecies,
      metadata: {
        totalSpecies: mergedSpecies.length,
        fetchedAt: latestFetchedAt,
        pagesProcessed: 0,
        byCategory: mergedByCategory,
        taxonId,
      },
    };

    taxonDataCache.set(cacheKey, { data: merged, time: Date.now() });
    return merged;
  }

  // Single-file taxon – try primary dataFile first, fall back to loading it
  const data = await loadSingleFile(taxon.dataFile);
  taxonDataCache.set(cacheKey, { data, time: Date.now() });
  return data;
}

// ---------- NE species counting (cached, async) ----------

export async function countNESpecies(taxonId: string, redListSpecies: SpeciesRecord[]): Promise<number> {
  const cached = neCountCache.get(taxonId);
  if (cached && isCacheValid(cached.time)) {
    return cached.count;
  }

  const taxon = getTaxonConfig(taxonId);

  try {
    const gbifCsvPath = path.join(process.cwd(), "data", taxon.gbifDataFile);
    const csvContent = await fs.readFile(gbifCsvPath, "utf-8");
    const lines = csvContent.split("\n");
    const header = lines[0];
    if (!header || !header.includes("scientific_name")) {
      neCountCache.set(taxonId, { count: 0, time: Date.now() });
      return 0;
    }

    const redListNames = new Set<string>();
    for (const s of redListSpecies) {
      const name = s.scientific_name?.toLowerCase?.()?.trim();
      if (name) redListNames.add(name);
    }

    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // CSV columns: speciesKey, occurrenceCount, scientific_name, [common_name]
      // Find the 3rd column (index 2) by scanning for the 2nd comma
      let commaCount = 0;
      let start = 0;
      for (let j = 0; j < line.length; j++) {
        if (line[j] === ",") {
          commaCount++;
          if (commaCount === 2) {
            start = j + 1;
          } else if (commaCount === 3) {
            const name = line.substring(start, j).toLowerCase().trim();
            if (name && !redListNames.has(name)) count++;
            break;
          }
        }
      }
      // Handle lines with no 4th column (no common_name)
      if (commaCount === 2) {
        const name = line.substring(start).toLowerCase().trim();
        if (name && !redListNames.has(name)) count++;
      }
    }

    neCountCache.set(taxonId, { count, time: Date.now() });
    return count;
  } catch {
    neCountCache.set(taxonId, { count: 0, time: Date.now() });
    return 0;
  }
}

// ---------- Warm the cache for all taxa in parallel ----------

let warmupPromise: Promise<void> | null = null;

export function ensureCacheWarmed(): Promise<void> {
  if (!warmupPromise) {
    warmupPromise = warmCaches().catch(() => {
      // Allow retry on next call
      warmupPromise = null;
    });
  }
  return warmupPromise;
}

async function warmCaches(): Promise<void> {
  // Load all individual taxon data files in parallel (this populates jsonFileCache)
  const allFiles = new Set<string>();
  for (const taxon of TAXA) {
    if (taxon.dataFiles) {
      for (const f of taxon.dataFiles) allFiles.add(f);
    }
    if (taxon.dataFile && taxon.dataFile !== "redlist-all.json") {
      allFiles.add(taxon.dataFile);
    }
  }
  await Promise.all([...allFiles].map((f) => loadSingleFile(f)));

  // Now compute NE counts for all real taxa in parallel
  const realTaxa = TAXA.filter((t) => t.id !== "all");
  await Promise.all(
    realTaxa.map(async (taxon) => {
      const data = await loadTaxonData(taxon.id);
      if (data) {
        await countNESpecies(taxon.id, data.species);
      }
    }),
  );
}
