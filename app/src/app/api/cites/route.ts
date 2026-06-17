import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const SPECIES_PLUS_API = "https://api.speciesplus.net/api/v1";

// Cache for CITES data (1 hour)
const citesCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

function getApiKey(): string | null {
  return process.env.SPECIES_PLUS_API_KEY || null;
}

async function fetchCites(path: string, apiKey: string): Promise<Response> {
  return fetch(`${SPECIES_PLUS_API}${path}`, {
    headers: { "X-Authentication-Token": apiKey },
  });
}

interface CitesTaxonConcept {
  id: number;
  full_name: string;
  author_year: string | null;
  rank: string;
  name_status: string;
  active: boolean;
  cites_listing: string | null;
  higher_taxa: {
    kingdom?: string;
    phylum?: string;
    class?: string;
    order?: string;
    family?: string;
  };
  accepted_names?: { id: number; full_name: string; author_year: string; rank: string }[];
  common_names?: { name: string; language: string }[];
  cites_listings?: {
    id: number;
    is_current: boolean;
    appendix: string;
    change_type: string;
    effective_at: string;
    annotation: string | null;
  }[];
}

interface CitesLegislation {
  cites_listings: {
    id: number;
    is_current: boolean;
    appendix: string;
    // "+", "-" mark appendix additions/removals; "R+", "R-" mark country
    // reservations entered/withdrawn against a listing.
    change_type: string;
    effective_at: string;
    annotation: string | null;
    party?: { iso_code2: string; name: string; type: string | null } | null;
  }[];
  cites_quotas: {
    quota: number;
    publication_date: string;
    notes: string | null;
    url: string | null;
    is_current: boolean;
    // Species+ returns this as an object ({ code, name }), occasionally a
    // string or null.
    unit: { code?: string; name?: string } | string | null;
    geo_entity: { iso_code2: string; name: string; type: string };
  }[];
  cites_suspensions: {
    id: number;
    notes: string | null;
    start_date: string;
    is_current: boolean;
    applies_to_import: boolean;
    geo_entity: { iso_code2: string; name: string; type: string };
    start_notification: { name: string; date: string; url: string | null } | null;
  }[];
}

interface CitesDistribution {
  iso_code2: string;
  name: string;
  type: string;
  tags: string[];
}

/**
 * GET /api/cites?name=<scientific_name>
 *
 * Searches the Species+ API for a species by name and returns:
 * - taxon concept info (CITES listing, taxonomy)
 * - CITES legislation (current listings, quotas, suspensions)
 * - distribution countries
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");

  if (!name) {
    return NextResponse.json(
      { error: "name parameter is required" },
      { status: 400 }
    );
  }

  const cacheKey = name.toLowerCase().trim();
  const cached = citesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ ...cached.data, cached: true }, { headers: CACHE_1H });
  }

  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "SPECIES_PLUS_API_KEY environment variable not set" },
        { status: 500 }
      );
    }

    // Step 1: Search for the taxon concept by name
    const searchResp = await fetchCites(
      `/taxon_concepts?name=${encodeURIComponent(name)}`,
      apiKey
    );
    if (!searchResp.ok) {
      return NextResponse.json(
        { error: `Species+ API error: ${searchResp.status}` },
        { status: searchResp.status }
      );
    }

    const searchData = await searchResp.json();
    const concepts: CitesTaxonConcept[] = searchData.taxon_concepts || [];

    // Find the best match: prefer accepted (A), active, species-rank
    let match =
      concepts.find(
        (c) =>
          c.name_status === "A" && c.active && c.rank === "SPECIES"
      ) ||
      concepts.find((c) => c.name_status === "A" && c.active) ||
      concepts[0];

    // If we only found synonyms, follow the accepted_names reference
    if (match && match.name_status === "S" && match.accepted_names?.length) {
      const acceptedName = match.accepted_names[0].full_name;
      const acceptedResp = await fetchCites(
        `/taxon_concepts?name=${encodeURIComponent(acceptedName)}`,
        apiKey
      );
      if (acceptedResp.ok) {
        const acceptedData = await acceptedResp.json();
        const acceptedConcepts: CitesTaxonConcept[] =
          acceptedData.taxon_concepts || [];
        const acceptedMatch =
          acceptedConcepts.find(
            (c) =>
              c.name_status === "A" && c.active && c.rank === "SPECIES"
          ) ||
          acceptedConcepts.find((c) => c.name_status === "A" && c.active);
        if (acceptedMatch) {
          match = acceptedMatch;
        }
      }
    }

    if (!match) {
      const result = { found: false, scientificName: name };
      citesCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return NextResponse.json(result, { headers: CACHE_1H });
    }

    // Step 2: Fetch legislation and distributions in parallel
    const [legislationResp, distributionsResp] = await Promise.all([
      fetchCites(`/taxon_concepts/${match.id}/cites_legislation`, apiKey),
      fetchCites(`/taxon_concepts/${match.id}/distributions`, apiKey),
    ]);

    let legislation: CitesLegislation | null = null;
    if (legislationResp.ok) {
      legislation = await legislationResp.json();
    }

    let distributions: CitesDistribution[] = [];
    if (distributionsResp.ok) {
      const distBody = await distributionsResp.json();
      if (Array.isArray(distBody)) distributions = distBody;
    }

    // Get English common name
    const englishName = (match.common_names || []).find(
      (n) => n.language === "EN"
    )?.name;

    // Split current legislation entries into appendix listings vs country
    // reservations. Reservations (R+) share an appendix with the parent
    // listing, so without this split a newly-listed taxon with several
    // reservations is shown as having many duplicate appendix entries.
    const currentLegislation = (legislation?.cites_listings || []).filter(
      (l) => l.is_current
    );
    const isReservation = (changeType: string) =>
      changeType === "R+" || changeType === "R-";
    const currentListings = currentLegislation.filter(
      (l) => !isReservation(l.change_type)
    );
    const currentReservations = currentLegislation.filter(
      (l) => l.change_type === "R+"
    );

    const currentSuspensions = (legislation?.cites_suspensions || []).filter(
      (s) => s.is_current
    );

    const currentQuotas = (legislation?.cites_quotas || []).filter(
      (q) => q.is_current
    );

    // Separate countries by tag
    const countries = distributions.filter((d) => d.type === "COUNTRY");
    const nativeCountries = countries.filter(
      (d) => !d.tags.includes("extinct") && !d.tags.includes("introduced")
    );
    const extinctCountries = countries.filter((d) =>
      d.tags.includes("extinct")
    );

    const result = {
      found: true,
      scientificName: match.full_name,
      authorYear: match.author_year,
      rank: match.rank,
      citesListing: match.cites_listing,
      citesId: match.id,
      englishName,
      taxonomy: match.higher_taxa,
      currentListings: currentListings.map((l) => ({
        appendix: l.appendix,
        effectiveAt: l.effective_at,
        annotation: l.annotation,
      })),
      reservations: currentReservations.map((l) => ({
        appendix: l.appendix,
        effectiveAt: l.effective_at,
        annotation: l.annotation,
        country: l.party?.name ?? null,
        countryCode: l.party?.iso_code2 ?? null,
      })),
      suspensions: currentSuspensions.map((s) => ({
        country: s.geo_entity.name,
        countryCode: s.geo_entity.iso_code2,
        notes: s.notes,
        startDate: s.start_date,
        appliesTo: s.applies_to_import ? "import" : "export",
        notification: s.start_notification
          ? { name: s.start_notification.name, url: s.start_notification.url }
          : null,
      })),
      quotas: currentQuotas.map((q) => ({
        country: q.geo_entity.name,
        countryCode: q.geo_entity.iso_code2,
        quota: q.quota,
        unit:
          q.unit && typeof q.unit === "object"
            ? q.unit.name ?? q.unit.code ?? null
            : q.unit,
        notes: q.notes,
        publicationDate: q.publication_date,
      })),
      nativeCountries: nativeCountries.map((d) => ({
        name: d.name,
        code: d.iso_code2,
      })),
      extinctCountries: extinctCountries.map((d) => ({
        name: d.name,
        code: d.iso_code2,
      })),
    };

    citesCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return NextResponse.json(result, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching CITES data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
