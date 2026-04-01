import { NextRequest, NextResponse } from "next/server";
import { CACHE_5M } from "@/lib/cache-headers";

export const dynamic = "force-dynamic";

const GBIF_PAGE_LIMIT = 300; // GBIF API max per request

// Major basisOfRecord types that should be represented in the sample
const MAJOR_RECORD_TYPES = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "MATERIAL_SAMPLE",
];

type GbifRecord = {
  key: number;
  species?: string;
  scientificName?: string;
  eventDate?: string;
  recordedBy?: string;
  decimalLongitude: number;
  decimalLatitude: number;
  country?: string;
  basisOfRecord?: string;
  datasetKey?: string;
  datasetName?: string;
  publishingOrgKey?: string;
  coordinateUncertaintyInMeters?: number;
  year?: number;
  month?: number;
  institutionCode?: string;
};

/**
 * Fetch paginated records from GBIF up to the given limit.
 * Returns { results, totalCount }.
 */
async function fetchPaginated(
  baseParams: URLSearchParams,
  fetchLimit: number
): Promise<{ results: GbifRecord[]; totalCount: number }> {
  let results: GbifRecord[] = [];
  let totalCount = 0;
  let offset = 0;

  while (results.length < fetchLimit) {
    const pageSize = Math.min(GBIF_PAGE_LIMIT, fetchLimit - results.length);
    const params = new URLSearchParams(baseParams);
    params.set("limit", pageSize.toString());
    params.set("offset", offset.toString());

    const response = await fetch(
      `https://api.gbif.org/v1/occurrence/search?${params}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`GBIF API error: ${response.statusText}`);
    }

    const data = await response.json();
    totalCount = data.count;
    results = results.concat(data.results);
    offset += pageSize;

    if (data.endOfRecords || results.length >= totalCount) {
      break;
    }
  }

  return { results, totalCount };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const speciesKey = searchParams.get("speciesKey");
  const country = searchParams.get("country");
  const limit = Math.min(parseInt(searchParams.get("limit") || "500"), 5000);
  const maxUncertainty = searchParams.get("maxUncertainty");

  if (!speciesKey) {
    return NextResponse.json(
      { error: "speciesKey parameter is required" },
      { status: 400 }
    );
  }

  try {
    const baseParams = new URLSearchParams({
      speciesKey,
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
    });

    if (country) {
      baseParams.set("country", country.toUpperCase());
    }

    if (maxUncertainty) {
      baseParams.set("coordinateUncertaintyInMeters", `*,${maxUncertainty}`);
    }

    // Primary fetch: get records in GBIF's default order (most recently indexed first)
    const { results: primaryResults, totalCount } = await fetchPaginated(baseParams, limit);

    let allResults = primaryResults;

    // GBIF's default ordering returns most-recently-indexed records first, which
    // can cause entire record types (e.g. MACHINE_OBSERVATION) to be absent from
    // small samples. Fetch proportional supplements for missing types (see #58).
    const presentTypes = new Set(
      primaryResults.map((r) => r.basisOfRecord).filter(Boolean)
    );
    const missingTypes = MAJOR_RECORD_TYPES.filter(
      (type) => !presentTypes.has(type)
    );

    if (missingTypes.length > 0 && totalCount > primaryResults.length) {
      const missingCountResults = await Promise.all(
        missingTypes.map((type) => {
          const params = new URLSearchParams(baseParams);
          params.set("basisOfRecord", type);
          params.set("limit", "0");
          return fetch(
            `https://api.gbif.org/v1/occurrence/search?${params}`,
            { cache: "no-store" }
          )
            .then((r) => r.json())
            .then((d) => ({ type, count: (d.count as number) || 0 }))
            .catch(() => ({ type, count: 0 }));
        })
      );

      const typesWithRecords = missingCountResults.filter((tc) => tc.count > 0);

      if (typesWithRecords.length > 0) {
        const supplementResults = await Promise.all(
          typesWithRecords.map((tc) => {
            const share = Math.max(
              1,
              Math.round((tc.count / totalCount) * limit)
            );
            const typeLimit = Math.min(share, tc.count);
            const params = new URLSearchParams(baseParams);
            params.set("basisOfRecord", tc.type);
            return fetchPaginated(params, typeLimit).then((r) => r.results);
          })
        );

        for (const results of supplementResults) {
          allResults = allResults.concat(results);
        }

        // Cap to the requested limit so the returned count stays consistent
        if (allResults.length > limit) {
          allResults = allResults.slice(0, limit);
        }
      }
    }

    // Convert to GeoJSON
    const features = allResults
      .filter((r) => r.decimalLatitude != null && r.decimalLongitude != null)
      .map((r) => ({
        type: "Feature",
        properties: {
          gbifID: r.key,
          species: r.species || r.scientificName,
          eventDate: r.eventDate,
          recordedBy: r.recordedBy,
          country: r.country,
          basisOfRecord: r.basisOfRecord,
          datasetKey: r.datasetKey,
          datasetName: r.datasetName,
          publishingOrgKey: r.publishingOrgKey,
          coordinateUncertaintyInMeters: r.coordinateUncertaintyInMeters ?? null,
          year: r.year ?? null,
          month: r.month ?? null,
          institutionCode: r.institutionCode,
        },
        geometry: {
          type: "Point",
          coordinates: [r.decimalLongitude, r.decimalLatitude],
        },
      }));

    // Calculate bbox from features
    let minLon = Infinity,
      maxLon = -Infinity;
    let minLat = Infinity,
      maxLat = -Infinity;

    for (const feature of features) {
      const [lon, lat] = feature.geometry.coordinates;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    return NextResponse.json({
      type: "FeatureCollection",
      features,
      metadata: {
        speciesKey: parseInt(speciesKey),
        count: features.length,
        total: totalCount,
        bbox: features.length > 0 ? [minLon, minLat, maxLon, maxLat] : null,
      },
    }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Error fetching occurrences:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
