import { NextResponse } from "next/server";

// GBIF kingdom key for Plantae
const PLANTAE_KINGDOM_KEY = 6;

interface CountryStats {
  [countryCode: string]: {
    occurrences: number;
    species: number;
  };
}

// Cache the results for 1 hour
let cachedStats: CountryStats | null = null;
let cacheTime: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export async function GET() {
  // Return cached data if still valid
  if (cachedStats && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json({ stats: cachedStats, cached: true });
  }

  try {
    // Get occurrence counts per country using facets (single fast query)
    const occurrenceParams = new URLSearchParams({
      kingdomKey: PLANTAE_KINGDOM_KEY.toString(),
      facet: "country",
      facetLimit: "300",
      limit: "0",
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
    });

    const occurrenceResponse = await fetch(
      `https://api.gbif.org/v1/occurrence/search?${occurrenceParams}`
    );

    if (!occurrenceResponse.ok) {
      throw new Error(`GBIF API error: ${occurrenceResponse.statusText}`);
    }

    const occurrenceData = await occurrenceResponse.json();
    const countryFacets = occurrenceData.facets?.find(
      (f: { field: string }) => f.field === "COUNTRY"
    );

    // Build stats object
    const stats: CountryStats = {};

    if (countryFacets?.counts) {
      for (const facet of countryFacets.counts) {
        stats[facet.name] = {
          occurrences: facet.count,
          species: 0, // Will be populated below for top countries
        };
      }
    }

    // For species counts, we need to query each country individually
    // But that's slow, so we'll estimate based on occurrence count
    // Or we can fetch species count for top N countries
    // For now, let's just use occurrence count for the heatmap
    // Species count can be fetched on-demand when clicking a country

    // Cache the results
    cachedStats = stats;
    cacheTime = Date.now();

    return NextResponse.json({ stats, cached: false });
  } catch (error) {
    console.error("Error fetching country stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
