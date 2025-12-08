import { NextRequest, NextResponse } from "next/server";

interface CommonName {
  name: string;
  language?: string;
  main?: boolean;
}

interface IUCNAssessment {
  criteria: string | null;
  taxon?: {
    common_names?: CommonName[];
  };
}

interface IUCNTaxon {
  assessments?: { assessment_id: number }[];
  taxon?: {
    common_names?: CommonName[];
  };
}

// Cache for species details (1 hour)
const detailsCache = new Map<number, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

async function fetchWithAuth(url: string): Promise<Response> {
  const apiKey = process.env.RED_LIST_API_KEY;
  if (!apiKey) {
    throw new Error("RED_LIST_API_KEY environment variable not set");
  }

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  const assessmentId = searchParams.get("assessmentId");
  const scientificName = searchParams.get("name");

  const cacheKey = parseInt(id);

  // Check cache
  const cached = detailsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  try {
    // Fetch IUCN taxon details (for assessment count and common name) and GBIF data in parallel
    const promises: Promise<Response>[] = [
      // IUCN taxon details (for assessment count and common name)
      fetchWithAuth(`https://api.iucnredlist.org/api/v4/taxa/sis/${cacheKey}`),
      // GBIF species search by name (for GBIF link and taxon key)
      ...(scientificName ? [fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}&kingdom=Plantae`)] : []),
    ];

    // Also fetch assessment details for criteria if we have assessmentId
    if (assessmentId) {
      promises.push(
        fetchWithAuth(`https://api.iucnredlist.org/api/v4/assessment/${assessmentId}`)
      );
    }

    const responses = await Promise.all(promises);

    let criteria: string | null = null;
    let commonName: string | null = null;
    let gbifUrl: string | null = null;
    let gbifOccurrences: number | null = null;
    let assessmentCount = 1;

    // Parse IUCN taxon response (for assessment count and common name)
    if (responses[0]?.ok) {
      const taxonData: IUCNTaxon = await responses[0].json();
      assessmentCount = taxonData.assessments?.length || 1;

      // Get common name from taxon data
      if (taxonData.taxon?.common_names && taxonData.taxon.common_names.length > 0) {
        const names = taxonData.taxon.common_names;
        const englishName = names.find((n) => n.language === "eng" || n.language === "en");
        const mainName = names.find((n) => n.main);
        commonName = englishName?.name || mainName?.name || names[0]?.name || null;
      }
    }

    // Parse GBIF response and fetch occurrence count
    const gbifIndex = 1;
    if (scientificName && responses[gbifIndex]?.ok) {
      const gbifMatch = await responses[gbifIndex].json();
      if (gbifMatch.usageKey) {
        gbifUrl = `https://www.gbif.org/species/${gbifMatch.usageKey}`;

        // Fetch occurrence count from GBIF
        try {
          const occResponse = await fetch(
            `https://api.gbif.org/v1/occurrence/count?taxonKey=${gbifMatch.usageKey}`
          );
          if (occResponse.ok) {
            gbifOccurrences = await occResponse.json();
          }
        } catch {
          // Ignore occurrence fetch errors
        }
      }
    }

    // Parse assessment details for criteria
    const assessmentIndex = scientificName ? 2 : 1;
    if (assessmentId && responses[assessmentIndex]?.ok) {
      const assessmentData: IUCNAssessment = await responses[assessmentIndex].json();
      criteria = assessmentData.criteria;
    }

    const result = {
      sis_taxon_id: cacheKey,
      criteria,
      commonName,
      gbifUrl,
      gbifOccurrences,
      assessmentCount,
    };

    // Cache the result
    detailsCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching species details:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
