import { NextRequest, NextResponse } from "next/server";

interface AssessmentHabitat {
  code: string;
  habitat: string;
  suitability?: string;
  major_importance?: boolean;
}

interface AssessmentThreat {
  code: string;
  title: string;
  timing?: string;
  scope?: string;
  severity?: string;
  score?: string;
}

interface ConservationAction {
  code: string;
  title: string;
}

interface AssessmentLocation {
  code: string;
  origin: string;
  presence: string;
}

interface PopulationTrend {
  description?: {
    en?: string;
  };
}

interface RedListCategory {
  code: string;
  name?: string;
}

interface RawAssessment {
  assessment_id?: number;
  assessment_date?: string;
  year_published?: string;
  criteria?: string;
  population_trend?: PopulationTrend;
  red_list_category?: RedListCategory;
  possibly_extinct?: boolean;
  possibly_extinct_in_the_wild?: boolean;
  habitats?: AssessmentHabitat[];
  threats?: AssessmentThreat[];
  conservation_actions?: ConservationAction[];
  locations?: AssessmentLocation[];
  rationale?: { en?: string };
  use_and_trade?: { en?: string };
  population?: { en?: string };
  range?: { en?: string };
  habitat_and_ecology?: { en?: string };
}

export interface AssessmentDetail {
  assessment_id: number;
  assessment_date: string | null;
  year_published: string | null;
  category: string | null;
  criteria: string | null;
  population_trend: string | null;
  possibly_extinct: boolean;
  possibly_extinct_in_the_wild: boolean;
  habitats: { code: string; name: string; suitability: string | null; major_importance: boolean }[];
  threats: { code: string; title: string; timing: string | null; scope: string | null; severity: string | null }[];
  conservation_actions: { code: string; title: string }[];
  countries: string[];
  rationale: string | null;
  population: string | null;
  range: string | null;
  habitat_and_ecology: string | null;
  use_and_trade: string | null;
}

// Cache for assessment details (1 hour)
const assessmentCache = new Map<number, { data: AssessmentDetail; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

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

function parseAssessment(assessmentId: number, data: RawAssessment): AssessmentDetail {
  const countries = data.locations
    ? [...new Set(
        data.locations
          .filter((loc) => loc.origin === "Native" && loc.presence === "Extant")
          .map((loc) => loc.code)
          .filter((code) => code.length === 2)
      )].sort()
    : [];

  return {
    assessment_id: assessmentId,
    assessment_date: data.assessment_date?.split("T")[0] || null,
    year_published: data.year_published || null,
    category: data.red_list_category?.code || null,
    criteria: data.criteria || null,
    population_trend: data.population_trend?.description?.en || null,
    possibly_extinct: data.possibly_extinct || false,
    possibly_extinct_in_the_wild: data.possibly_extinct_in_the_wild || false,
    habitats: (data.habitats || []).map((h) => ({
      code: h.code,
      name: h.habitat,
      suitability: h.suitability || null,
      major_importance: h.major_importance || false,
    })),
    threats: (data.threats || []).map((t) => ({
      code: t.code,
      title: t.title,
      timing: t.timing || null,
      scope: t.scope || null,
      severity: t.severity || null,
    })),
    conservation_actions: (data.conservation_actions || []).map((a) => ({
      code: a.code,
      title: a.title,
    })),
    countries,
    rationale: data.rationale?.en || null,
    population: data.population?.en || null,
    range: data.range?.en || null,
    habitat_and_ecology: data.habitat_and_ecology?.en || null,
    use_and_trade: data.use_and_trade?.en || null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const assessmentId = parseInt(id);

  if (isNaN(assessmentId)) {
    return NextResponse.json({ error: "Invalid assessment ID" }, { status: 400 });
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
        return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
      }
      throw new Error(`IUCN API error: ${response.statusText}`);
    }

    const data: RawAssessment = await response.json();
    const result = parseAssessment(assessmentId, data);

    // Cache the result
    assessmentCache.set(assessmentId, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching assessment details:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
