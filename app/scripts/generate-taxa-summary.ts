/**
 * Generate a pre-computed taxa summary file for fast API responses.
 *
 * This script reads all redlist JSON files and computes summary statistics,
 * writing them to a small taxa-summary.json file (~1KB) that can be read
 * instantly by the API endpoint.
 *
 * Usage:
 *   npx tsx scripts/generate-taxa-summary.ts
 *
 * Run this script after fetching new data from the database.
 */

import * as fs from "fs";
import * as path from "path";

// Taxa configuration - mirrors the main config but simplified
const TAXA = [
  { id: "mammalia", name: "Mammals", dataFile: "redlist-mammalia.json", estimatedDescribed: 6819, color: "#f97316" },
  { id: "aves", name: "Birds", dataFile: "redlist-aves.json", estimatedDescribed: 11185, color: "#3b82f6" },
  { id: "reptilia", name: "Reptiles", dataFile: "redlist-reptilia.json", estimatedDescribed: 12502, color: "#84cc16" },
  { id: "amphibia", name: "Amphibians", dataFile: "redlist-amphibia.json", estimatedDescribed: 8918, color: "#14b8a6" },
  {
    id: "fishes",
    name: "Fishes",
    dataFiles: ["redlist-actinopterygii.json", "redlist-chondrichthyes.json"],
    estimatedDescribed: 37288,
    color: "#06b6d4",
  },
  {
    id: "invertebrates",
    name: "Invertebrates",
    dataFiles: [
      "redlist-insecta.json",
      "redlist-arachnida.json",
      "redlist-gastropoda.json",
      "redlist-bivalvia.json",
      "redlist-malacostraca.json",
      "redlist-anthozoa.json",
    ],
    estimatedDescribed: 1508442,
    color: "#78716c",
  },
  { id: "plantae", name: "Plants", dataFile: "redlist-plantae.json", estimatedDescribed: 426132, color: "#22c55e" },
  {
    id: "fungi",
    name: "Fungi",
    dataFiles: ["redlist-ascomycota.json", "redlist-basidiomycota.json"],
    estimatedDescribed: 162653,
    color: "#d97706",
  },
];

interface SpeciesRecord {
  assessment_date?: string;
}

interface DataFile {
  species: SpeciesRecord[];
  metadata: {
    totalSpecies: number;
    fetchedAt: string;
    byCategory?: Record<string, number>;
  };
}

// Map legacy IUCN categories to modern equivalents
const LEGACY_CATEGORY_MAP: Record<string, string> = {
  "LR/nt": "NT",
  "LR/lc": "LC",
  "LR/cd": "NT",
};

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  outdated: number;
  percentOutdated: number;
  lastUpdated: string | null;
  byCategory: Record<string, number>;
}

function loadDataFile(filename: string): DataFile | null {
  const filePath = path.join(__dirname, "../data", filename);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function computeTaxonSummary(taxon: typeof TAXA[number]): TaxonSummary {
  const currentYear = new Date().getFullYear();
  let allSpecies: SpeciesRecord[] = [];
  let latestFetchedAt: string | null = null;
  const byCategory: Record<string, number> = {};

  // Load data files
  const dataFiles = "dataFiles" in taxon && taxon.dataFiles ? taxon.dataFiles : [(taxon as { dataFile: string }).dataFile];
  for (const filename of dataFiles) {
    const data = loadDataFile(filename);
    if (data) {
      allSpecies = allSpecies.concat(data.species);
      if (!latestFetchedAt || data.metadata.fetchedAt > latestFetchedAt) {
        latestFetchedAt = data.metadata.fetchedAt;
      }
      // Merge category counts, normalizing legacy categories
      if (data.metadata.byCategory) {
        for (const [cat, count] of Object.entries(data.metadata.byCategory)) {
          const normalizedCat = LEGACY_CATEGORY_MAP[cat] || cat;
          byCategory[normalizedCat] = (byCategory[normalizedCat] || 0) + count;
        }
      }
    }
  }

  if (allSpecies.length === 0) {
    return {
      id: taxon.id,
      name: taxon.name,
      color: taxon.color,
      estimatedDescribed: taxon.estimatedDescribed,
      available: false,
      totalAssessed: 0,
      percentAssessed: 0,
      outdated: 0,
      percentOutdated: 0,
      lastUpdated: null,
      byCategory: {},
    };
  }

  // Calculate outdated (>10 years since assessment)
  const outdated = allSpecies.filter((s) => {
    if (!s.assessment_date) return false;
    const assessmentYear = new Date(s.assessment_date).getFullYear();
    return currentYear - assessmentYear > 10;
  }).length;

  const totalAssessed = allSpecies.length;
  const percentAssessed = (totalAssessed / taxon.estimatedDescribed) * 100;
  const percentOutdated = (outdated / totalAssessed) * 100;

  return {
    id: taxon.id,
    name: taxon.name,
    color: taxon.color,
    estimatedDescribed: taxon.estimatedDescribed,
    available: true,
    totalAssessed,
    percentAssessed: Math.round(percentAssessed * 10) / 10,
    outdated,
    percentOutdated: Math.round(percentOutdated * 10) / 10,
    lastUpdated: latestFetchedAt,
    byCategory,
  };
}

function main() {
  console.log("Generating taxa summary...\n");

  const summaries: TaxonSummary[] = [];

  for (const taxon of TAXA) {
    const summary = computeTaxonSummary(taxon);
    summaries.push(summary);
    console.log(`  ${taxon.name.padEnd(15)} - ${summary.totalAssessed.toLocaleString()} assessed, ${summary.percentOutdated.toFixed(1)}% outdated`);
  }

  const output = {
    taxa: summaries,
    generatedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "../data/taxa-summary.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  const stats = fs.statSync(outputPath);
  console.log(`\nSaved to data/taxa-summary.json (${(stats.size / 1024).toFixed(1)} KB)`);
}

main();
