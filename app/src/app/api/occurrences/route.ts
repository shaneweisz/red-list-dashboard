import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GBIF_PAGE_LIMIT = 300; // GBIF API max per request

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

    // Add country filter if provided
    if (country) {
      baseParams.set("country", country.toUpperCase());
    }

    // Add coordinate uncertainty filter if provided (meters)
    if (maxUncertainty) {
      baseParams.set("coordinateUncertaintyInMeters", `*,${maxUncertainty}`);
    }

    // Paginate through GBIF API (max 300 per request)
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

    let allResults: GbifRecord[] = [];
    let totalCount = 0;
    let offset = 0;

    while (allResults.length < limit) {
      const pageSize = Math.min(GBIF_PAGE_LIMIT, limit - allResults.length);
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
      allResults = allResults.concat(data.results);
      offset += pageSize;

      // Stop if we've fetched all available records
      if (data.endOfRecords || allResults.length >= totalCount) {
        break;
      }
    }

    // Convert to GeoJSON
    const features = allResults
      .filter((r) => r.decimalLatitude && r.decimalLongitude)
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
        total: totalCount,
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
