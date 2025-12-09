import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { TAXA, CATEGORY_COLORS } from "@/config/taxa";

interface PrecomputedData {
  species: { category: string }[];
  metadata: {
    totalSpecies: number;
    fetchedAt: string;
    byCategory: Record<string, number>;
  };
}

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  estimatedSource: string;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  byCategory: {
    code: string;
    count: number;
    color: string;
  }[];
  threatened: number;
  percentThreatened: number;
  lastUpdated: string | null;
}

// In-memory cache for summary data
let cachedSummary: TaxonSummary[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function loadTaxonData(dataFile: string): PrecomputedData | null {
  const dataPath = path.join(process.cwd(), "data", dataFile);

  try {
    if (!fs.existsSync(dataPath)) {
      return null;
    }
    const content = fs.readFileSync(dataPath, "utf-8");
    return JSON.parse(content) as PrecomputedData;
  } catch {
    return null;
  }
}

function buildSummary(): TaxonSummary[] {
  return TAXA.map((taxon) => {
    const data = loadTaxonData(taxon.dataFile);

    if (!data) {
      return {
        id: taxon.id,
        name: taxon.name,
        color: taxon.color,
        estimatedDescribed: taxon.estimatedDescribed,
        estimatedSource: taxon.estimatedSource,
        available: false,
        totalAssessed: 0,
        percentAssessed: 0,
        byCategory: [],
        threatened: 0,
        percentThreatened: 0,
        lastUpdated: null,
      };
    }

    const byCategory = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD"].map((code) => ({
      code,
      count: data.metadata.byCategory[code] || 0,
      color: CATEGORY_COLORS[code],
    }));

    // Threatened = CR + EN + VU
    const threatened =
      (data.metadata.byCategory["CR"] || 0) +
      (data.metadata.byCategory["EN"] || 0) +
      (data.metadata.byCategory["VU"] || 0);

    const percentAssessed =
      taxon.estimatedDescribed > 0
        ? (data.metadata.totalSpecies / taxon.estimatedDescribed) * 100
        : 0;

    const percentThreatened =
      data.metadata.totalSpecies > 0
        ? (threatened / data.metadata.totalSpecies) * 100
        : 0;

    return {
      id: taxon.id,
      name: taxon.name,
      color: taxon.color,
      estimatedDescribed: taxon.estimatedDescribed,
      estimatedSource: taxon.estimatedSource,
      available: true,
      totalAssessed: data.metadata.totalSpecies,
      percentAssessed: Math.round(percentAssessed * 10) / 10,
      byCategory,
      threatened,
      percentThreatened: Math.round(percentThreatened * 10) / 10,
      lastUpdated: data.metadata.fetchedAt,
    };
  });
}

export async function GET() {
  // Check cache
  if (cachedSummary && Date.now() - cacheTime < CACHE_TTL) {
    return NextResponse.json({ taxa: cachedSummary, cached: true });
  }

  // Build fresh summary
  cachedSummary = buildSummary();
  cacheTime = Date.now();

  return NextResponse.json({ taxa: cachedSummary, cached: false });
}
