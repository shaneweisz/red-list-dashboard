import { NextRequest, NextResponse } from "next/server";
import {
  estimateCriteria,
  type OccurrencePoint,
  type EstimationParams,
} from "@/lib/criteria-estimation";
import { CACHE_5M } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

const GBIF_BASE = "https://api.gbif.org/v1";
const GBIF_PAGE_LIMIT = 300;
/** Max occurrence points to fetch for estimation. */
const MAX_OCCURRENCES = 10_000;

// ── Cache ────────────────────────────────────────────────────────────────

interface CacheEntry {
  points: OccurrencePoint[];
  timestamp: number;
  totalAvailable: number;
}

const pointsCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── GBIF occurrence fetching ─────────────────────────────────────────────

/**
 * Fetch occurrence points from GBIF for a species, paginating as needed.
 * Returns raw points before any filtering (filtering is done in the
 * estimation library so the assessor can adjust parameters).
 */
async function fetchOccurrencePoints(
  speciesKey: number,
  maxPoints: number = MAX_OCCURRENCES,
): Promise<{ points: OccurrencePoint[]; totalAvailable: number }> {
  const cacheKey = `${speciesKey}:${maxPoints}`;
  const cached = pointsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { points: cached.points, totalAvailable: cached.totalAvailable };
  }

  const baseParams = new URLSearchParams({
    speciesKey: String(speciesKey),
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
  });

  const points: OccurrencePoint[] = [];
  let totalAvailable = 0;
  let offset = 0;

  while (points.length < maxPoints) {
    const pageSize = Math.min(GBIF_PAGE_LIMIT, maxPoints - points.length);
    const params = new URLSearchParams(baseParams);
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));

    const res = await fetch(`${GBIF_BASE}/occurrence/search?${params}`, {
      cache: "no-store",
    });

    if (!res.ok) break;

    const data = await res.json();
    totalAvailable = data.count;

    for (const r of data.results) {
      if (r.decimalLatitude == null || r.decimalLongitude == null) continue;
      points.push({
        lat: r.decimalLatitude,
        lng: r.decimalLongitude,
        year: r.year ?? undefined,
        coordinateUncertainty: r.coordinateUncertaintyInMeters ?? undefined,
        basisOfRecord: r.basisOfRecord ?? undefined,
      });
    }

    offset += pageSize;
    if (data.endOfRecords || points.length >= totalAvailable) break;
  }

  pointsCache.set(cacheKey, { points, timestamp: Date.now(), totalAvailable });
  return { points, totalAvailable };
}

// ── Route handler ────────────────────────────────────────────────────────

/**
 * GET /api/redlist/criteria-estimate?speciesKey=123&[params]
 *
 * Fetches GBIF occurrence data and computes IUCN Criterion B parameters.
 *
 * Query parameters:
 *   speciesKey (required)     — GBIF species key
 *   minYear                   — Minimum observation year (default: all)
 *   maxYear                   — Maximum observation year (default: current)
 *   maxUncertainty            — Max coordinate uncertainty in meters (default: 10000)
 *   gridSize                  — AOO grid cell size in km (default: 2)
 *   clusterDistance            — Location clustering distance in km (default: 10)
 *   outlierDistance            — Outlier exclusion distance from median in km (0=off, default: 0)
 *   basisOfRecord             — Comma-separated basis of record types to include (default: all)
 *   maxPoints                 — Max GBIF records to fetch (default: 10000)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const speciesKey = searchParams.get("speciesKey");

  if (!speciesKey) {
    return NextResponse.json(
      { error: "speciesKey query parameter is required" },
      { status: 400 },
    );
  }

  const key = parseInt(speciesKey, 10);
  if (isNaN(key) || key <= 0) {
    return NextResponse.json(
      { error: "speciesKey must be a positive integer" },
      { status: 400 },
    );
  }

  // Parse optional parameters
  const maxPoints = Math.min(
    parseInt(searchParams.get("maxPoints") || String(MAX_OCCURRENCES), 10),
    MAX_OCCURRENCES,
  );

  const params: Partial<EstimationParams> = {};

  const minYear = searchParams.get("minYear");
  if (minYear) params.minYear = parseInt(minYear, 10);

  const maxYear = searchParams.get("maxYear");
  if (maxYear) params.maxYear = parseInt(maxYear, 10);

  const maxUncertainty = searchParams.get("maxUncertainty");
  if (maxUncertainty) params.maxUncertaintyMeters = parseInt(maxUncertainty, 10);

  const gridSize = searchParams.get("gridSize");
  if (gridSize) params.gridSizeKm = parseFloat(gridSize);

  const clusterDistance = searchParams.get("clusterDistance");
  if (clusterDistance) params.clusterDistanceKm = parseFloat(clusterDistance);

  const outlierDistance = searchParams.get("outlierDistance");
  if (outlierDistance) params.outlierDistanceKm = parseFloat(outlierDistance);

  const prevalence = searchParams.get("prevalence");
  if (prevalence) params.prevalence = parseFloat(prevalence);

  const aooMethod = searchParams.get("aooMethod");
  if (aooMethod === "gbif" || aooMethod === "eoo-prevalence") params.aooMethod = aooMethod;

  const basisOfRecord = searchParams.get("basisOfRecord");
  if (basisOfRecord) params.basisOfRecord = basisOfRecord.split(",");

  try {
    const { points, totalAvailable } = await fetchOccurrencePoints(key, maxPoints);

    if (points.length === 0) {
      return NextResponse.json({
        error: null,
        result: null,
        totalAvailable: 0,
        message: "No georeferenced occurrences found for this species",
      });
    }

    const result = estimateCriteria(points, params);

    // Cap filtered points sent to client to limit payload size.
    // The map only needs lat/lng/year for rendering; strip extra fields
    // and limit to 5000 points to keep the response under ~500KB.
    const MAX_MAP_POINTS = 5_000;
    const mapPoints = result.filteredPoints.slice(0, MAX_MAP_POINTS).map((p) => ({
      lat: p.lat,
      lng: p.lng,
      year: p.year ?? null,
      coordinateUncertainty: p.coordinateUncertainty ?? null,
      basisOfRecord: p.basisOfRecord ?? null,
    }));

    // Don't include the full filteredPoints array in the response
     
    const { filteredPoints: _, ...resultWithoutPoints } = result;

    return NextResponse.json({
      error: null,
      result: resultWithoutPoints,
      filteredPoints: mapPoints,
      filteredPointsCapped: result.filteredPoints.length > MAX_MAP_POINTS,
      totalAvailable,
      fetchedPoints: points.length,
    }, { headers: CACHE_5M });
  } catch (err) {
    console.error("Criteria estimation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
