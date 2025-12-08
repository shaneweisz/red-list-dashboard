import { NextRequest, NextResponse } from "next/server";

interface Species {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  category: string;
  year_published: string;
  url: string;
  assessment_count: number;
  previous_assessments: string[]; // years of previous assessments
}

interface CachedSpecies {
  species: Species[];
  lastUpdated: string;
}

// Cache for 24 hours
let cachedSpecies: CachedSpecies | null = null;
let cacheTime: number = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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

interface Assessment {
  sis_taxon_id: number;
  assessment_id: number;
  taxon_scientific_name: string;
  red_list_category_code: string;
  year_published: string;
  url: string;
}

interface ApiResponse {
  assessments: Assessment[];
}

interface TaxonAssessment {
  assessment_id: number;
  year_published: string;
  latest: boolean;
}

interface TaxonResponse {
  assessments?: TaxonAssessment[];
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const search = searchParams.get("search")?.toLowerCase();

  // Return cached data if still valid
  if (!cachedSpecies || Date.now() - cacheTime > CACHE_DURATION) {
    try {
      // Fetch 1 page of species
      const response = await fetchWithAuth(
        `https://api.iucnredlist.org/api/v4/taxa/kingdom/Plantae?latest=true&page=400`
      );

      if (!response.ok) {
        throw new Error(`IUCN API error: ${response.statusText}`);
      }

      const data: ApiResponse = await response.json();
      const assessments = data.assessments || [];

      // Fetch assessment counts for each species in batches
      const speciesWithCounts: Species[] = [];

      // Process in batches of 10 to respect rate limits
      for (let i = 0; i < assessments.length; i += 10) {
        const batch = assessments.slice(i, i + 10);
        const batchPromises = batch.map(async (a) => {
          try {
            const taxonRes = await fetchWithAuth(
              `https://api.iucnredlist.org/api/v4/taxa/sis/${a.sis_taxon_id}`
            );
            if (taxonRes.ok) {
              const taxonData: TaxonResponse = await taxonRes.json();
              const allAssessments = taxonData.assessments || [];
              // Get previous assessment years (not the latest one)
              const previousAssessments = allAssessments
                .filter((assess) => !assess.latest)
                .map((assess) => assess.year_published)
                .sort((a, b) => parseInt(b) - parseInt(a)); // Sort descending
              return {
                sis_taxon_id: a.sis_taxon_id,
                assessment_id: a.assessment_id,
                scientific_name: a.taxon_scientific_name,
                category: a.red_list_category_code,
                year_published: a.year_published,
                url: a.url,
                assessment_count: allAssessments.length,
                previous_assessments: previousAssessments,
              };
            }
          } catch {
            // Fall back to count of 1 if fetch fails
          }
          return {
            sis_taxon_id: a.sis_taxon_id,
            assessment_id: a.assessment_id,
            scientific_name: a.taxon_scientific_name,
            category: a.red_list_category_code,
            year_published: a.year_published,
            url: a.url,
            assessment_count: 1,
            previous_assessments: [],
          };
        });

        const batchResults = await Promise.all(batchPromises);
        speciesWithCounts.push(...batchResults);

        // Small delay between batches
        if (i + 10 < assessments.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      cachedSpecies = {
        species: speciesWithCounts,
        lastUpdated: new Date().toISOString(),
      };
      cacheTime = Date.now();
    } catch (error) {
      console.error("Error fetching Red List species:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  }

  // Filter by category if specified
  let filtered = cachedSpecies.species;

  if (category) {
    filtered = filtered.filter((s) => s.category === category);
  }

  if (search) {
    filtered = filtered.filter((s) =>
      s.scientific_name.toLowerCase().includes(search)
    );
  }

  return NextResponse.json({
    species: filtered,
    total: filtered.length,
    cached: true,
  });
}
