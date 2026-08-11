import { NextRequest, NextResponse } from "next/server";
import { CACHE_5M } from "@/lib/cache-headers";
import { getQualityFlags } from "@/lib/coordinate-cleaning";
import { GBIF_CHECKLIST_KEY } from "@/lib/gbif";

export const dynamic = "force-dynamic";

const GBIF_PAGE_LIMIT = 300; // GBIF API max per request
const GBIF_MAX_RETRIES = 4;
const GBIF_BACKOFF_MS = 300;

type GbifRecord = {
  key: number;
  species?: string;
  scientificName?: string;
  eventDate?: string;
  recordedBy?: string;
  decimalLongitude: number;
  decimalLatitude: number;
  country?: string;
  countryCode?: string;
  basisOfRecord?: string;
  datasetKey?: string;
  datasetName?: string;
  publishingOrgKey?: string;
  coordinateUncertaintyInMeters?: number;
  year?: number;
  month?: number;
  institutionCode?: string;
  // Extra Darwin Core fields — only surfaced in the list (table) view, which
  // shows one row per record rather than one dot per record.
  locality?: string;
  verbatimLocality?: string;
  stateProvince?: string;
  elevation?: number;
  depth?: number;
  identifiedBy?: string;
  collectionCode?: string;
  catalogNumber?: string;
  establishmentMeans?: string;
};

/**
 * Fetch paginated records from GBIF up to the given limit, starting from startOffset.
 * Returns { results, totalCount }.
 */
async function fetchPaginated(
  baseParams: URLSearchParams,
  fetchLimit: number,
  startOffset = 0
): Promise<{ results: GbifRecord[]; totalCount: number }> {
  let results: GbifRecord[] = [];
  let totalCount = 0;
  let offset = startOffset;

  while (results.length < fetchLimit) {
    const pageSize = Math.min(GBIF_PAGE_LIMIT, fetchLimit - results.length);
    const params = new URLSearchParams(baseParams);
    params.set("limit", pageSize.toString());
    params.set("offset", offset.toString());

    // Retried, because this pages in a tight loop and GBIF throttles the burst.
    // Reproduced on every run of the browser check: the map for a species with
    // 130,322 records 500s while the same requests issued sequentially by hand
    // all return 200. Naming a non-default checklistKey appears to make each
    // request more expensive for GBIF to answer, so this got easier to trigger
    // after the Catalogue of Life migration.
    //
    // The status goes in the message because response.statusText is empty over
    // HTTP/2, which is what Node's fetch negotiates — the original error read
    // "GBIF API error: " with nothing after it, and hid the 429 for two rounds
    // of debugging.
    let response: Response | undefined;
    for (let attempt = 0; attempt <= GBIF_MAX_RETRIES; attempt++) {
      response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`, {
        cache: "no-store",
      });
      if (response.ok) break;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === GBIF_MAX_RETRIES) {
        throw new Error(`GBIF API error: HTTP ${response.status} ${response.statusText}`.trim());
      }
      await new Promise((r) => setTimeout(r, 2 ** attempt * GBIF_BACKOFF_MS));
    }
    if (!response?.ok) throw new Error("GBIF API error: exhausted retries");

    const data = await response.json();
    totalCount = data.count;
    results = results.concat(data.results);
    offset += pageSize;

    if (data.endOfRecords || offset >= totalCount) {
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
  // Optional: fetch more records of just one basis-of-record category (e.g. "load
  // more Preserved specimen records" from the Basis of Record dropdown), starting
  // after the given offset within that category's own GBIF result set.
  const basisOfRecord = searchParams.get("basisOfRecord");
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));

  if (!speciesKey) {
    return NextResponse.json(
      { error: "speciesKey parameter is required" },
      { status: 400 }
    );
  }

  try {
    const baseParams = new URLSearchParams({
      speciesKey,
      checklistKey: GBIF_CHECKLIST_KEY,
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
    });

    if (country) {
      baseParams.set("country", country.toUpperCase());
    }

    if (maxUncertainty) {
      baseParams.set("coordinateUncertaintyInMeters", `*,${maxUncertainty}`);
    }

    if (basisOfRecord) {
      baseParams.set("basisOfRecord", basisOfRecord);
    }

    // GBIF default order: year descending, then month ascending within each year,
    // then by gbifID ascending. No custom sort is available via the API.
    const { results: allResults, totalCount } = await fetchPaginated(baseParams, limit, offset);

    // Convert to GeoJSON
    const validResults = allResults.filter(
      (r) => r.decimalLatitude != null && r.decimalLongitude != null
    );
    // Computed over this request's result set (a single species, per cc_dupl's species
    // key), not the species' full GBIF record — this route is paginated per-request and
    // never sees a species' complete point set.
    const qualityFlags = getQualityFlags(
      validResults.map((r) => ({ lon: r.decimalLongitude, lat: r.decimalLatitude, countryCode: r.countryCode }))
    );
    const features = validResults.map((r, i) => ({
      type: "Feature",
      properties: {
        gbifID: r.key,
        species: r.species || r.scientificName,
        eventDate: r.eventDate,
        recordedBy: r.recordedBy,
        country: r.country,
        countryCode: r.countryCode,
        basisOfRecord: r.basisOfRecord,
        datasetKey: r.datasetKey,
        datasetName: r.datasetName,
        publishingOrgKey: r.publishingOrgKey,
        coordinateUncertaintyInMeters: r.coordinateUncertaintyInMeters ?? null,
        year: r.year ?? null,
        month: r.month ?? null,
        institutionCode: r.institutionCode,
        qualityFlags: qualityFlags[i],
        // List-view-only fields. `locality` is often empty on aggregator records
        // (iNaturalist, for one, only ships verbatimLocality), so both are sent
        // and the client falls back.
        locality: r.locality,
        verbatimLocality: r.verbatimLocality,
        stateProvince: r.stateProvince,
        elevation: r.elevation ?? null,
        depth: r.depth ?? null,
        identifiedBy: r.identifiedBy,
        collectionCode: r.collectionCode,
        catalogNumber: r.catalogNumber,
        establishmentMeans: r.establishmentMeans,
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
        speciesKey,
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
