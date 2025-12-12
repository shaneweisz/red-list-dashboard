import { NextRequest, NextResponse } from "next/server";
import { getTaxonConfig } from "@/config/taxa";

interface GBIFSpeciesResult {
  key: number;
  scientificName: string;
  canonicalName: string;
  vernacularName?: string;
  kingdom: string;
  family: string;
  genus: string;
  rank: string;
  numOccurrences?: number;
}

interface GBIFMedia {
  type?: string;
  identifier?: string;
}

interface GBIFOccurrence {
  media?: GBIFMedia[];
}

// Search for species in GBIF based on selected taxon
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  const taxonId = request.nextUrl.searchParams.get("taxon");

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Build taxon filter based on selected taxon
  let taxonFilter = "";
  if (taxonId) {
    const taxonConfig = getTaxonConfig(taxonId);
    if (taxonConfig.gbifClassKey) {
      // Single class key
      taxonFilter = `&highertaxonKey=${taxonConfig.gbifClassKey}`;
    } else if (taxonConfig.gbifClassKeys && taxonConfig.gbifClassKeys.length > 0) {
      // Multiple class keys - use the first one for simplicity (GBIF doesn't support OR in highertaxonKey)
      // For comprehensive search, we'd need to make multiple requests
      taxonFilter = `&highertaxonKey=${taxonConfig.gbifClassKeys[0]}`;
    } else if (taxonConfig.gbifKingdomKey) {
      // Fall back to kingdom key
      taxonFilter = `&highertaxonKey=${taxonConfig.gbifKingdomKey}`;
    }
  }

  try {
    // Search GBIF species API with appropriate taxon filter
    const searchResponse = await fetch(
      `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(query)}&rank=SPECIES${taxonFilter}&limit=10`
    );

    if (!searchResponse.ok) {
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }

    const searchData = await searchResponse.json();
    const species: GBIFSpeciesResult[] = searchData.results || [];

    // Fetch images and vernacular names for each species in parallel
    const enrichedResults = await Promise.all(
      species.map(async (s) => {
        const [vernacularResponse, imageResponse, occurrenceCountResponse] = await Promise.all([
          fetch(`https://api.gbif.org/v1/species/${s.key}/vernacularNames?limit=50`),
          fetch(`https://api.gbif.org/v1/occurrence/search?taxonKey=${s.key}&mediaType=StillImage&datasetKey=50c9509d-22c7-4a22-a47d-8c48425ef4a7&limit=1`),
          fetch(`https://api.gbif.org/v1/occurrence/count?taxonKey=${s.key}`),
        ]);

        let vernacularName: string | undefined;
        if (vernacularResponse.ok) {
          const vernacularData = await vernacularResponse.json();
          if (vernacularData.results?.length > 0) {
            // Prefer English names
            const englishName = vernacularData.results.find(
              (v: { language?: string; vernacularName: string }) => v.language === "eng"
            );
            vernacularName = englishName?.vernacularName || s.vernacularName;
          }
        }
        if (!vernacularName) {
          vernacularName = s.vernacularName;
        }

        let imageUrl: string | undefined;
        if (imageResponse.ok) {
          const imageData = await imageResponse.json();
          if (imageData.results?.length > 0) {
            const occurrence: GBIFOccurrence = imageData.results[0];
            const stillImage = occurrence.media?.find(
              (m: GBIFMedia) => m.type === "StillImage" && m.identifier
            );
            if (stillImage) {
              imageUrl = stillImage.identifier;
            }
          }
        }

        let occurrenceCount: number | undefined;
        if (occurrenceCountResponse.ok) {
          const countText = await occurrenceCountResponse.text();
          occurrenceCount = parseInt(countText, 10);
        }

        return {
          key: s.key,
          scientificName: s.scientificName,
          canonicalName: s.canonicalName,
          vernacularName,
          kingdom: s.kingdom,
          family: s.family,
          genus: s.genus,
          gbifUrl: `https://www.gbif.org/species/${s.key}`,
          imageUrl,
          occurrenceCount,
        };
      })
    );

    return NextResponse.json({ results: enrichedResults });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
