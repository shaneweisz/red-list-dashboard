import { NextRequest, NextResponse } from "next/server";
import { getTaxonConfig } from "@/config/taxa";
import { CACHE_1H } from "@/lib/cache-headers";
import { gbifOccurrenceParams } from "@/lib/gbif";

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
    return NextResponse.json({ stats: cachedStats[cacheKey], cached: true }, { headers: CACHE_1H });
  }

  try {
    // One GBIF query per taxon key making up this group, combined by country.
    //
    // Used to branch on which rank of key the config happened to carry
    // (kingdomKey vs classKey vs classKeys vs orderKeys), because the GBIF
    // Backbone needed a different parameter for each. Under Catalogue of Life
    // every rank is just taxonKey, so the branching is gone — and with it a bug
    // where a group defined by order keys (Fishes) silently fell back to
    // querying its entire kingdom.
    const taxonKeys = taxonConfig.gbifTaxonKeys ?? [];
    const stats: CountryStats = {};

    const results = await Promise.all(
      taxonKeys.map(async (taxonKey) => {
        const params = gbifOccurrenceParams({
          taxonKey,
          facet: "country",
          facetLimit: "300",
          limit: "0",
        });
        const response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
        if (!response.ok) return null;
        return response.json();
      })
    );

    for (const result of results) {
      if (!result) continue;
      const countryFacets = result.facets?.find(
        (f: { field: string }) => f.field === "COUNTRY"
      );
      if (!countryFacets?.counts) continue;
      for (const facet of countryFacets.counts) {
        if (!stats[facet.name]) stats[facet.name] = { occurrences: 0, species: 0 };
        stats[facet.name].occurrences += facet.count;
      }
    }

    // Cache the results by taxon
    cachedStats[cacheKey] = stats;
    cacheTime[cacheKey] = Date.now();

    return NextResponse.json({ stats, cached: false }, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching country stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
