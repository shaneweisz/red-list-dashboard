import { NextRequest, NextResponse } from "next/server";
import {
  analyzeTrend,
  computeTrendFlag,
  type TrendResult,
  type YearCount,
} from "@/lib/trend-analysis";
import { getTaxonConfig } from "@/config/taxa";
import { buildTaxonParams } from "@/lib/gbif-taxon-params";
import { CACHE_1H } from "@/lib/cache-headers";

// ── Cache ────────────────────────────────────────────────────────────────

const trendCache = new Map<string, { result: TrendResult; timestamp: number }>();
const TREND_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** Cache for taxon-level year facets (shared across all species in a taxon). */
const taxonBaselineCache = new Map<string, { yearCounts: YearCount[]; timestamp: number }>();
const BASELINE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (taxon totals change slowly)

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
async function fetchSpeciesYearFacets(speciesKey: number): Promise<YearCount[]> {
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
  return parseYearFacets(data);
}

/**
 * Fetch year-faceted occurrence counts for an entire taxon group from GBIF.
 * Uses the taxon's GBIF keys (classKey, kingdomKey, etc.) to aggregate
 * all observations across species within the group.
 *
 * For taxa with multiple GBIF class keys (e.g. Reptilia = Squamata +
 * Testudines + Crocodylia), fetches each in parallel and sums per year.
 */
async function fetchTaxonYearFacets(taxonId: string): Promise<YearCount[]> {
  const cached = taxonBaselineCache.get(taxonId);
  if (cached && Date.now() - cached.timestamp < BASELINE_CACHE_TTL) {
    return cached.yearCounts;
  }

  const taxon = getTaxonConfig(taxonId);
  if (taxonId === "all" || (!taxon.gbifClassKey && !taxon.gbifClassKeys && !taxon.gbifOrderKeys && !taxon.gbifKingdomKey)) {
    return [];
  }

  const taxonParams = buildTaxonParams(taxon);

  // For taxa with multiple class/order keys, we need separate queries
  // because GBIF treats multiple classKey params as OR, which is what we want.
  // So buildTaxonParams already handles this correctly.
  const params = new URLSearchParams({
    facet: "year",
    facetLimit: "50",
    limit: "0",
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
  });

  taxonParams.forEach((value, key) => {
    params.append(key, value);
  });

  for (const bor of BASIS_OF_RECORD) {
    params.append("basisOfRecord", bor);
  }

  const url = `${GBIF_BASE}/occurrence/search?${params}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const yearCounts = parseYearFacets(data);

    taxonBaselineCache.set(taxonId, { yearCounts, timestamp: Date.now() });
    return yearCounts;
  } catch {
    return [];
  }
}

/** Parse year facets from a GBIF occurrence search response. */
function parseYearFacets(data: Record<string, unknown>): YearCount[] {
  const facets = data.facets as { field: string; counts: { name: string; count: number }[] }[] | undefined;
  const yearFacet = facets?.find((f) => f.field === "YEAR");
  if (!yearFacet) return [];

  return yearFacet.counts
    .map((c) => ({
      year: parseInt(c.name, 10),
      count: c.count,
    }))
    .sort((a, b) => a.year - b.year);
}

// ── Route handler ────────────────────────────────────────────────────────

/**
 * GET /api/redlist/trends?keys=123,456&categories=LC,DD&taxons=mammalia,mammalia
 *
 * Fetches year-faceted GBIF data for the given species keys, normalizes
 * against taxon-level baselines for effort adjustment, computes observation
 * trends, and returns category-change flags.
 *
 * - keys:       comma-separated GBIF species keys
 * - categories: comma-separated IUCN categories (same order as keys)
 * - taxons:     comma-separated taxon IDs (same order as keys) for effort normalization
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const keysParam = searchParams.get("keys");
  const categoriesParam = searchParams.get("categories");
  const taxonsParam = searchParams.get("taxons");

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
  const taxons = taxonsParam ? taxonsParam.split(",") : [];

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

  // Prefetch unique taxon baselines in parallel (cached aggressively)
  const uniqueTaxons = [...new Set(taxons.filter(Boolean))];
  const taxonBaselines: Record<string, YearCount[]> = {};

  if (uniqueTaxons.length > 0) {
    const baselineResults = await Promise.all(
      uniqueTaxons.map(async (taxonId) => ({
        taxonId,
        yearCounts: await fetchTaxonYearFacets(taxonId),
      })),
    );
    for (const { taxonId, yearCounts } of baselineResults) {
      taxonBaselines[taxonId] = yearCounts;
    }
  }

  // Separate cached vs uncached
  const toFetch: { key: number; category: string; taxonId: string }[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const taxonId = taxons[i] || "";
    // Cache key includes taxon so re-normalization happens when taxon context changes
    const cacheKey = `${key}:${taxonId}`;
    const cached = trendCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < TREND_CACHE_TTL) {
      // Recompute flag in case the category changed since caching
      const { flag, flagLabel } = computeTrendFlag(
        cached.result.direction,
        categories[i],
        cached.result.yearCounts.reduce((s, yc) => s + yc.count, 0),
      );
      trends[String(key)] = { ...cached.result, flag, flagLabel };
    } else {
      toFetch.push({ key, category: categories[i], taxonId });
    }
  }

  // Fetch uncached species in parallel
  if (toFetch.length > 0) {
    const results = await Promise.all(
      toFetch.map(async ({ key, category, taxonId }) => {
        try {
          const yearCounts = await fetchSpeciesYearFacets(key);
          const taxonBaseline = taxonId ? taxonBaselines[taxonId] : undefined;
          const analysis = analyzeTrend(yearCounts, currentYear, taxonBaseline);
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
          const cacheKey = `${key}:${taxonId}`;
          trendCache.set(cacheKey, { result, timestamp: Date.now() });
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

  return NextResponse.json({ trends }, { headers: CACHE_1H });
}
