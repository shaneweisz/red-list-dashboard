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

// IUCN API v4 uses { en: "text" } for description fields
function getLocalizedText(
  desc: { en?: string } | string | null | undefined
): string | null {
  if (!desc) return null;
  if (typeof desc === "string") return desc;
  return desc.en || null;
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
    const doc = data.documentation || {};

    // Extract the fields we need, normalizing the IUCN API v4 structure
    const result = {
      assessment_id: data.assessment_id,
      sis_taxon_id: data.sis_taxon_id,
      url: data.url,
      // Category & criteria - normalize { code, description: { en } } to { code, description }
      red_list_category: data.red_list_category
        ? {
            code: data.red_list_category.code,
            description: getLocalizedText(data.red_list_category.description),
          }
        : null,
      criteria: data.criteria || null,
      assessment_date: data.assessment_date || null,
      year_published: data.year_published || null,
      possibly_extinct: data.possibly_extinct || false,
      possibly_extinct_in_the_wild: data.possibly_extinct_in_the_wild || false,
      // Narratives are under documentation.*
      rationale: doc.rationale || null,
      population: doc.population || null,
      habitat: doc.habitats || null,
      threats: doc.threats || null,
      conservation_actions: doc.measures || null,
      use_trade: doc.use_trade || null,
      range: doc.range || null,
      // Population trend - normalize { code, description: { en } }
      population_trend: data.population_trend
        ? {
            code: data.population_trend.code,
            description: getLocalizedText(data.population_trend.description),
          }
        : null,
      // Structured data: habitats array
      habitats: Array.isArray(data.habitats)
        ? data.habitats.map(
            (h: {
              code?: string;
              description?: { en?: string } | string;
              suitability?: string;
              majorImportance?: string;
            }) => ({
              code: h.code || "",
              name: getLocalizedText(h.description) || h.code || "",
              suitability: h.suitability || null,
              major_importance: h.majorImportance === "Yes",
            })
          )
        : null,
      // Structured data: threats array
      threat_classification: Array.isArray(data.threats)
        ? data.threats.map(
            (t: {
              code?: string;
              description?: { en?: string } | string;
              timing?: string;
              scope?: string;
              severity?: string;
            }) => ({
              code: t.code || "",
              name: getLocalizedText(t.description) || t.code || "",
              timing: t.timing || null,
              scope: t.scope || null,
              severity: t.severity || null,
            })
          )
        : null,
      // Structured data: conservation actions array
      conservation_actions_classification: Array.isArray(
        data.conservation_actions
      )
        ? data.conservation_actions.map(
            (c: {
              code?: string;
              description?: { en?: string } | string;
            }) => ({
              code: c.code || "",
              name: getLocalizedText(c.description) || c.code || "",
            })
          )
        : null,
      // Systems (terrestrial, marine, freshwater)
      systems: Array.isArray(data.systems)
        ? data.systems.map(
            (s: {
              code?: string;
              description?: { en?: string } | string;
            }) => ({
              code: s.code || "",
              description: getLocalizedText(s.description) || s.code || "",
            })
          )
        : null,
      // Scopes
      scopes: Array.isArray(data.scopes)
        ? data.scopes.map(
            (s: {
              code?: string;
              description?: { en?: string } | string;
            }) => ({
              code: s.code || "",
              description: getLocalizedText(s.description) || s.code || "",
            })
          )
        : null,
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
