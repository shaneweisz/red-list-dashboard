import { NextRequest, NextResponse } from "next/server";
import {
  analyzeTrend,
  computeTrendFlag,
  type TrendResult,
  type YearCount,
} from "@/lib/trend-analysis";

// ── Cache ────────────────────────────────────────────────────────────────

const trendCache = new Map<number, { result: TrendResult; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── GBIF helpers ─────────────────────────────────────────────────────────

const GBIF_BASE = "https://api.gbif.org/v1";

const BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OBSERVATION",
  "MATERIAL_SAMPLE",
];

/**
 * Fetch year-faceted occurrence counts for a single species from GBIF.
 * Returns an array of { year, count } sorted by year.
 */
async function fetchYearFacets(speciesKey: number): Promise<YearCount[]> {
  const params = new URLSearchParams({
    speciesKey: String(speciesKey),
    facet: "year",
    facetLimit: "50",
    limit: "0",
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
  });

  for (const bor of BASIS_OF_RECORD) {
    params.append("basisOfRecord", bor);
  }

  const url = `${GBIF_BASE}/occurrence/search?${params}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const yearFacet = data.facets?.find(
    (f: { field: string }) => f.field === "YEAR",
  );
  if (!yearFacet) return [];

  return yearFacet.counts
    .map((c: { name: string; count: number }) => ({
      year: parseInt(c.name, 10),
      count: c.count,
    }))
    .sort((a: YearCount, b: YearCount) => a.year - b.year);
}

// ── Route handler ────────────────────────────────────────────────────────

/**
 * GET /api/redlist/trends?keys=123,456&categories=LC,DD
 *
 * Fetches year-faceted GBIF data for the given species keys, computes
 * observation trends, and returns category-change flags.
 *
 * - keys:       comma-separated GBIF species keys
 * - categories: comma-separated IUCN categories (same order as keys)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const keysParam = searchParams.get("keys");
  const categoriesParam = searchParams.get("categories");

  if (!keysParam || !categoriesParam) {
    return NextResponse.json(
      { error: "keys and categories query parameters are required" },
      { status: 400 },
    );
  }

  const keys = keysParam
    .split(",")
    .map(Number)
    .filter((k) => !isNaN(k) && k > 0);
  const categories = categoriesParam.split(",");

  if (keys.length === 0 || keys.length !== categories.length) {
    return NextResponse.json(
      { error: "keys and categories must be non-empty and same length" },
      { status: 400 },
    );
  }

  // Cap batch size to prevent abuse
  if (keys.length > 20) {
    return NextResponse.json(
      { error: "maximum 20 species per request" },
      { status: 400 },
    );
  }

  const currentYear = new Date().getFullYear();
  const trends: Record<string, TrendResult> = {};

  // Separate cached vs uncached
  const toFetch: { key: number; category: string }[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const cached = trendCache.get(key);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      // Recompute flag in case the category changed since caching
      const { flag, flagLabel } = computeTrendFlag(
        cached.result.direction,
        categories[i],
        cached.result.yearCounts.reduce((s, yc) => s + yc.count, 0),
      );
      trends[String(key)] = { ...cached.result, flag, flagLabel };
    } else {
      toFetch.push({ key, category: categories[i] });
    }
  }

  // Fetch uncached species in parallel
  if (toFetch.length > 0) {
    const results = await Promise.all(
      toFetch.map(async ({ key, category }) => {
        try {
          const yearCounts = await fetchYearFacets(key);
          const analysis = analyzeTrend(yearCounts, currentYear);
          const totalRecentObs = analysis.yearCounts.reduce(
            (s, yc) => s + yc.count,
            0,
          );
          const { flag, flagLabel } = computeTrendFlag(
            analysis.direction,
            category,
            totalRecentObs,
          );

          const result: TrendResult = { ...analysis, flag, flagLabel };
          trendCache.set(key, { result, timestamp: Date.now() });
          return { key: String(key), result };
        } catch {
          return { key: String(key), result: null };
        }
      }),
    );

    for (const { key, result } of results) {
      if (result) trends[key] = result;
    }
  }

  return NextResponse.json({ trends });
}
