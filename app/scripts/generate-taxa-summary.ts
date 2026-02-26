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
  { id: "mammalia", name: "Mammals", dataFile: "redlist-mammalia.json", gbifCsvFile: "gbif-mammalia.csv", estimatedDescribed: 6819, color: "#f97316" },
  { id: "aves", name: "Birds", dataFile: "redlist-aves.json", gbifCsvFile: "gbif-aves.csv", estimatedDescribed: 11185, color: "#3b82f6" },
  { id: "reptilia", name: "Reptiles", dataFile: "redlist-reptilia.json", gbifCsvFile: "gbif-reptilia.csv", estimatedDescribed: 12502, color: "#84cc16" },
  { id: "amphibia", name: "Amphibians", dataFile: "redlist-amphibia.json", gbifCsvFile: "gbif-amphibia.csv", estimatedDescribed: 8918, color: "#14b8a6" },
  {
    id: "fishes",
    name: "Fishes",
    dataFiles: ["redlist-actinopterygii.json", "redlist-chondrichthyes.json"],
    gbifCsvFile: "gbif-fishes.csv",
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
    gbifCsvFile: "gbif-invertebrates.csv",
    estimatedDescribed: 1508442,
    color: "#78716c",
  },
  { id: "plantae", name: "Plants", dataFile: "redlist-plantae.json", gbifCsvFile: "gbif-plantae.csv", estimatedDescribed: 426132, color: "#22c55e" },
  {
    id: "fungi",
    name: "Fungi",
    dataFiles: ["redlist-ascomycota.json", "redlist-basidiomycota.json"],
    gbifCsvFile: "gbif-fungi.csv",
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
  totalGbifObservations?: number;
  meanGbifObsPerSpecies?: number;
  medianGbifObsPerSpecies?: number;
  gbifSpeciesCount?: number;
  gbifObsDistribution?: Record<string, number>;
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

// Log-scale histogram bins for GBIF observation distribution
const DISTRIBUTION_BINS = [
  { label: "1", min: 1, max: 1 },
  { label: "2–10", min: 2, max: 10 },
  { label: "11–100", min: 11, max: 100 },
  { label: "101–1K", min: 101, max: 1000 },
  { label: "1K–10K", min: 1001, max: 10000 },
  { label: "10K–100K", min: 10001, max: 100000 },
  { label: "100K–1M", min: 100001, max: 1000000 },
  { label: ">1M", min: 1000001, max: Infinity },
];

interface GbifStats {
  total: number;
  mean: number;
  median: number;
  speciesCount: number;
  distribution: Record<string, number>;
  observations: number[]; // raw values for computing global median
}

function computeGbifStats(csvFilename: string): GbifStats | null {
  const csvPath = path.join(__dirname, "../data", csvFilename);
  try {
    if (!fs.existsSync(csvPath)) return null;
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) return null;

    // Parse header to find observations_total column index
    const headers = lines[0].split(",");
    const obsIdx = headers.indexOf("observations_total");
    if (obsIdx === -1) return null;

    const observations: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const val = parseInt(cols[obsIdx], 10);
      if (!isNaN(val)) observations.push(val);
    }
    if (observations.length === 0) return null;

    const total = observations.reduce((sum, v) => sum + v, 0);
    const mean = total / observations.length;
    observations.sort((a, b) => a - b);
    const mid = Math.floor(observations.length / 2);
    const median = observations.length % 2 === 0
      ? (observations[mid - 1] + observations[mid]) / 2
      : observations[mid];

    // Compute histogram distribution
    const distribution: Record<string, number> = {};
    for (const { label, min, max } of DISTRIBUTION_BINS) {
      distribution[label] = observations.filter((v) => v >= min && v <= max).length;
    }

    return { total, mean, median, speciesCount: observations.length, distribution, observations };
  } catch {
    return null;
  }
}

function computeTaxonSummary(taxon: typeof TAXA[number]): TaxonSummary {
  const currentYear = new Date().getFullYear();
  let allSpecies: SpeciesRecord[] = [];
  const byCategory: Record<string, number> = {};

  // Load data files
  const dataFiles = "dataFiles" in taxon && taxon.dataFiles ? taxon.dataFiles : [(taxon as { dataFile: string }).dataFile];
  for (const filename of dataFiles) {
    const data = loadDataFile(filename);
    if (data) {
      allSpecies = allSpecies.concat(data.species);
      // Merge category counts, normalizing legacy categories
      if (data.metadata.byCategory) {
        for (const [cat, count] of Object.entries(data.metadata.byCategory)) {
          const normalizedCat = LEGACY_CATEGORY_MAP[cat] || cat;
          byCategory[normalizedCat] = (byCategory[normalizedCat] || 0) + count;
        }
      }
    }
  }

  // Compute GBIF stats
  const gbifCsvFile = "gbifCsvFile" in taxon ? (taxon as { gbifCsvFile: string }).gbifCsvFile : undefined;
  const gbifStats = gbifCsvFile ? computeGbifStats(gbifCsvFile) : null;

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
      lastUpdated: new Date().toISOString(),
      byCategory: {},
      ...(gbifStats && {
        totalGbifObservations: gbifStats.total,
        meanGbifObsPerSpecies: Math.round(gbifStats.mean),
        medianGbifObsPerSpecies: Math.round(gbifStats.median),
        gbifSpeciesCount: gbifStats.speciesCount,
        gbifObsDistribution: gbifStats.distribution,
      }),
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
    lastUpdated: new Date().toISOString(),
    byCategory,
    ...(gbifStats && {
      totalGbifObservations: gbifStats.total,
      meanGbifObsPerSpecies: Math.round(gbifStats.mean),
      medianGbifObsPerSpecies: Math.round(gbifStats.median),
      gbifSpeciesCount: gbifStats.speciesCount,
      gbifObsDistribution: gbifStats.distribution,
    }),
  };
}

function computeMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function main() {
  console.log("Generating taxa summary...\n");

  const summaries: TaxonSummary[] = [];
  let allGbifObs: number[] = [];

  for (const taxon of TAXA) {
    const summary = computeTaxonSummary(taxon);
    summaries.push(summary);
    console.log(`  ${taxon.name.padEnd(15)} - ${summary.totalAssessed.toLocaleString()} assessed, ${summary.percentOutdated.toFixed(1)}% outdated`);

    // Collect raw GBIF observations for global stats
    const gbifCsvFile = "gbifCsvFile" in taxon ? (taxon as { gbifCsvFile: string }).gbifCsvFile : undefined;
    if (gbifCsvFile) {
      const stats = computeGbifStats(gbifCsvFile);
      if (stats) allGbifObs = allGbifObs.concat(stats.observations);
    }
  }

  // Compute global GBIF stats
  allGbifObs.sort((a, b) => a - b);
  const globalGbifMedian = allGbifObs.length > 0 ? Math.round(computeMedian(allGbifObs)) : 0;
  const globalGbifDistribution: Record<string, number> = {};
  if (allGbifObs.length > 0) {
    for (const { label, min, max } of DISTRIBUTION_BINS) {
      globalGbifDistribution[label] = allGbifObs.filter((v) => v >= min && v <= max).length;
    }
  }

  const output = {
    taxa: summaries,
    globalGbifMedian,
    globalGbifDistribution,
    generatedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "../data/taxa-summary.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  const stats = fs.statSync(outputPath);
  console.log(`\nSaved to data/taxa-summary.json (${(stats.size / 1024).toFixed(1)} KB)`);
}

main();
