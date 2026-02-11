import { NextRequest, NextResponse } from "next/server";

// Cache for assessment details (1 hour)
const assessmentCache = new Map<
  number,
  { data: object; timestamp: number }
>();
const CACHE_DURATION = 60 * 60 * 1000;

async function fetchWithAuth(url: string): Promise<Response> {
  const apiKey = process.env.RED_LIST_API_KEY;
  if (!apiKey) {
    throw new Error("RED_LIST_API_KEY environment variable not set");
  }
  return fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const assessmentId = parseInt(id, 10);

  if (isNaN(assessmentId)) {
    return NextResponse.json(
      { error: "Invalid assessment ID" },
      { status: 400 }
    );
  }

  // Check cache
  const cached = assessmentCache.get(assessmentId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  try {
    const response = await fetchWithAuth(
      `https://api.iucnredlist.org/api/v4/assessment/${assessmentId}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: "Assessment not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `IUCN API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Extract the fields we need from the assessment response
    const result = {
      assessment_id: data.assessment_id,
      sis_taxon_id: data.sis_taxon_id,
      url: data.url,
      // Category & criteria
      red_list_category: data.red_list_category,
      criteria: data.criteria,
      assessment_date: data.assessment_date,
      year_published: data.year_published,
      possibly_extinct: data.possibly_extinct,
      possibly_extinct_in_the_wild: data.possibly_extinct_in_the_wild,
      // Narratives
      rationale: data.rationale,
      population: data.population,
      habitat: data.habitat,
      threats: data.threats,
      conservation_actions: data.conservation_actions,
      use_trade: data.use_trade,
      range: data.range,
      // Population trend
      population_trend: data.population_trend,
      // Structured data
      habitats: data.habitats,
      threat_classification: data.threats_classification,
      conservation_actions_classification:
        data.conservation_actions_classification,
      // Systems (marine, freshwater, terrestrial)
      systems: data.systems,
      // Scopes
      scopes: data.scopes,
    };

    // Cache the result
    assessmentCache.set(assessmentId, {
      data: result,
      timestamp: Date.now(),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching assessment:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
