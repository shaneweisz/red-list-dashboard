import { NextRequest, NextResponse } from "next/server";
import { getTaxonConfig } from "@/config/taxa";

interface CountryStats {
  [countryCode: string]: {
    occurrences: number;
    species: number;
  };
}

// Cache the results for 1 hour, keyed by taxon
const cachedStats: Record<string, CountryStats> = {};
const cacheTime: Record<string, number> = {};
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taxonId = searchParams.get("taxon") || "plantae";
  const taxonConfig = getTaxonConfig(taxonId);

  const cacheKey = taxonId;

  // Return cached data if still valid
  if (cachedStats[cacheKey] && Date.now() - (cacheTime[cacheKey] || 0) < CACHE_DURATION) {
    return NextResponse.json({ stats: cachedStats[cacheKey], cached: true });
  }

  try {
    // Build query params based on taxon configuration
    const occurrenceParams = new URLSearchParams({
      facet: "country",
      facetLimit: "300",
      limit: "0",
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
    });

    // Add appropriate taxon filter
    if (taxonConfig.gbifKingdomKey && !taxonConfig.gbifClassKey && !taxonConfig.gbifClassKeys && !taxonConfig.gbifOrderKeys) {
      // Simple kingdom filter (e.g., Plantae, Fungi)
      occurrenceParams.set("kingdomKey", taxonConfig.gbifKingdomKey.toString());
    } else if (taxonConfig.gbifClassKey) {
      // Single class filter (e.g., Mammalia, Aves, Amphibia)
      occurrenceParams.set("classKey", taxonConfig.gbifClassKey.toString());
    } else if (taxonConfig.gbifClassKeys && taxonConfig.gbifClassKeys.length > 0) {
      // Multiple classes - need to fetch each separately and combine
      // For now, use the first class key; we'll combine results below
    } else if (taxonConfig.gbifOrderKeys && taxonConfig.gbifOrderKeys.length > 0) {
      // Order-based filtering (complex taxa like Fishes)
      // This requires multiple queries which is slow, so we'll use the kingdom and estimate
      occurrenceParams.set("kingdomKey", (taxonConfig.gbifKingdomKey || 1).toString());
    }

    // Handle multiple class keys (e.g., Reptilia, Invertebrates, Fishes)
    const hasMultipleClasses = taxonConfig.gbifClassKeys && taxonConfig.gbifClassKeys.length > 0;
    const stats: CountryStats = {};

    if (hasMultipleClasses) {
      // Fetch data for each class and combine
      const allClassKeys = taxonConfig.gbifClassKeys || [];

      // Also include order keys if present (for fishes)
      const classPromises = allClassKeys.map(async (classKey) => {
        const params = new URLSearchParams({
          classKey: classKey.toString(),
          facet: "country",
          facetLimit: "300",
          limit: "0",
          hasCoordinate: "true",
          hasGeospatialIssue: "false",
        });

        const response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
        if (!response.ok) return null;
        return response.json();
      });

      const results = await Promise.all(classPromises);

      // Combine counts from all classes
      for (const result of results) {
        if (!result) continue;
        const countryFacets = result.facets?.find(
          (f: { field: string }) => f.field === "COUNTRY"
        );
        if (countryFacets?.counts) {
          for (const facet of countryFacets.counts) {
            if (!stats[facet.name]) {
              stats[facet.name] = { occurrences: 0, species: 0 };
            }
            stats[facet.name].occurrences += facet.count;
          }
        }
      }
    } else {
      // Simple single query
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

      if (countryFacets?.counts) {
        for (const facet of countryFacets.counts) {
          stats[facet.name] = {
            occurrences: facet.count,
            species: 0,
          };
        }
      }
    }

    // Cache the results by taxon
    cachedStats[cacheKey] = stats;
    cacheTime[cacheKey] = Date.now();

    return NextResponse.json({ stats, cached: false });
  } catch (error) {
    console.error("Error fetching country stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
