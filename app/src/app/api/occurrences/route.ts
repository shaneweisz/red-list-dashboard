import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GBIF_PAGE_LIMIT = 300; // GBIF API max per request

// Major basisOfRecord types to stratify sampling across
const BASIS_OF_RECORD_TYPES = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "PRESERVED_SPECIMEN",
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
 * Fetch paginated records from GBIF for a given set of base params up to typeLimit.
 */
async function fetchPaginated(
  baseParams: URLSearchParams,
  typeLimit: number
): Promise<GbifRecord[]> {
  let results: GbifRecord[] = [];
  let offset = 0;

  while (results.length < typeLimit) {
    const pageSize = Math.min(GBIF_PAGE_LIMIT, typeLimit - results.length);
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
    results = results.concat(data.results);
    offset += pageSize;

    if (data.endOfRecords || results.length >= data.count) {
      break;
    }
  }

  return results;
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

    // Step 1: Get counts per basisOfRecord type in parallel (limit=0 for fast count-only queries)
    const countPromises = BASIS_OF_RECORD_TYPES.map((type) => {
      const params = new URLSearchParams(baseParams);
      params.set("basisOfRecord", type);
      params.set("limit", "0");
      return fetch(
        `https://api.gbif.org/v1/occurrence/search?${params}`,
        { cache: "no-store" }
      ).then((r) => r.json());
    });

    // Also get overall total count
    const totalParams = new URLSearchParams(baseParams);
    totalParams.set("limit", "0");
    const totalPromise = fetch(
      `https://api.gbif.org/v1/occurrence/search?${totalParams}`,
      { cache: "no-store" }
    ).then((r) => r.json());

    const [countResults, totalData] = await Promise.all([
      Promise.all(countPromises),
      totalPromise,
    ]);

    const typeCounts = BASIS_OF_RECORD_TYPES.map((type, i) => ({
      type,
      count: (countResults[i].count as number) || 0,
    }));

    const overallTotal = totalData.count || 0;

    // Step 2: Allocate sample proportionally across types
    const activeTypes = typeCounts.filter((tc) => tc.count > 0);

    let allResults: GbifRecord[] = [];

    if (activeTypes.length > 0) {
      // Calculate proportional allocation with minimum 1 per active type
      const allocations: { type: string; allocation: number }[] = [];
      let remaining = limit;

      for (const tc of activeTypes) {
        const share = Math.max(1, Math.round((tc.count / overallTotal) * limit));
        const allocation = Math.min(share, tc.count, remaining);
        allocations.push({ type: tc.type, allocation });
        remaining -= allocation;
      }

      // Distribute any leftover to the largest type
      if (remaining > 0) {
        const largest = allocations.reduce((a, b) =>
          (typeCounts.find((tc) => tc.type === a.type)?.count ?? 0) >=
          (typeCounts.find((tc) => tc.type === b.type)?.count ?? 0)
            ? a
            : b
        );
        const largestCount = typeCounts.find((tc) => tc.type === largest.type)?.count ?? 0;
        largest.allocation = Math.min(largest.allocation + remaining, largestCount);
      }

      // Step 3: Fetch records for each type in parallel
      const typeResults = await Promise.all(
        allocations
          .filter((a) => a.allocation > 0)
          .map((a) => {
            const params = new URLSearchParams(baseParams);
            params.set("basisOfRecord", a.type);
            return fetchPaginated(params, a.allocation);
          })
      );

      for (const results of typeResults) {
        allResults = allResults.concat(results);
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
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

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
        total: overallTotal,
        bbox: features.length > 0 ? [minLon, minLat, maxLon, maxLat] : null,
      },
    });
  } catch (error) {
    console.error("Error fetching occurrences:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
