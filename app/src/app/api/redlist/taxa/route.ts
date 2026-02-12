import { NextResponse } from "next/server";
import { TAXA, CATEGORY_COLORS } from "@/config/taxa";
import {
  loadTaxonData,
  countNESpecies,
  ensureCacheWarmed,
} from "@/lib/dataLoader";

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  estimatedSource: string;
  estimatedSourceUrl?: string;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  byCategory: {
    code: string;
    count: number;
    color: string;
  }[];
  outdated: number;
  percentOutdated: number;
  lastUpdated: string | null;
}

// In-memory cache for the final summary response
let cachedSummary: TaxonSummary[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function buildSummary(): Promise<TaxonSummary[]> {
  // Warm all data caches in parallel (loads all JSON files + computes NE counts
  // concurrently). Subsequent calls are no-ops since the cache is already warm.
  await ensureCacheWarmed();

  const realTaxa = TAXA.filter((taxon) => taxon.id !== "all");

  // Process all taxa in parallel – data is already cached from warmup
  const summaries = await Promise.all(
    realTaxa.map(async (taxon) => {
      const data = await loadTaxonData(taxon.id);

      if (!data) {
        return {
          id: taxon.id,
          name: taxon.name,
          color: taxon.color,
          estimatedDescribed: taxon.estimatedDescribed,
          estimatedSource: taxon.estimatedSource,
          estimatedSourceUrl: taxon.estimatedSourceUrl,
          available: false,
          totalAssessed: 0,
          percentAssessed: 0,
          byCategory: [],
          outdated: 0,
          percentOutdated: 0,
          lastUpdated: null,
        };
      }

      // NE count is already cached from warmup
      const neCount = await countNESpecies(taxon.id, data.species);

      const byCategory = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD", "NE"].map((code) => ({
        code,
        count: code === "NE" ? neCount : (data.metadata.byCategory[code] || 0),
        color: CATEGORY_COLORS[code],
      }));

      // Calculate outdated assessments (>10 years old)
      const currentYear = new Date().getFullYear();
      let outdated = 0;
      for (const s of data.species) {
        if (s.assessment_date) {
          const assessmentYear = new Date(s.assessment_date).getFullYear();
          if (currentYear - assessmentYear > 10) outdated++;
        }
      }

      const percentAssessed =
        taxon.estimatedDescribed > 0
          ? (data.metadata.totalSpecies / taxon.estimatedDescribed) * 100
          : 0;

      const percentOutdated =
        data.metadata.totalSpecies > 0
          ? (outdated / data.metadata.totalSpecies) * 100
          : 0;

      return {
        id: taxon.id,
        name: taxon.name,
        color: taxon.color,
        estimatedDescribed: taxon.estimatedDescribed,
        estimatedSource: taxon.estimatedSource,
        estimatedSourceUrl: taxon.estimatedSourceUrl,
        available: true,
        totalAssessed: data.metadata.totalSpecies,
        percentAssessed: Math.round(percentAssessed * 10) / 10,
        byCategory,
        outdated,
        percentOutdated: Math.round(percentOutdated * 10) / 10,
        lastUpdated: data.metadata.fetchedAt,
      };
    }),
  );

  return summaries;
}

export async function GET() {
  // Check cache
  if (cachedSummary && Date.now() - cacheTime < CACHE_TTL) {
    return NextResponse.json({ taxa: cachedSummary, cached: true });
  }

  // Build fresh summary (parallel + shared cache)
  cachedSummary = await buildSummary();
  cacheTime = Date.now();

  return NextResponse.json({ taxa: cachedSummary, cached: false });
}
