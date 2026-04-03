import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock next/server — provide lightweight NextRequest / NextResponse stand-ins
vi.mock("next/server", () => {
  class MockNextRequest {
    nextUrl: URL;
    constructor(url: string) {
      this.nextUrl = new URL(url);
    }
  }
  return {
    NextRequest: MockNextRequest,
    NextResponse: {
      json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
        return {
          _body: body,
          status: init?.status ?? 200,
          headers: new Map(Object.entries(init?.headers ?? {})),
          async json() {
            return body;
          },
        };
      },
    },
  };
});

vi.mock("@/lib/cache-headers", () => ({
  CACHE_1H: { "Cache-Control": "public, s-maxage=3600" },
}));

// Helpers to build mock fetch responses
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCEPTED_CONCEPT = {
  id: 11136,
  full_name: "Manis gigantea",
  author_year: "Illiger, 1815",
  rank: "SPECIES",
  name_status: "A",
  active: true,
  cites_listing: "I",
  higher_taxa: {
    kingdom: "Animalia",
    phylum: "Chordata",
    class: "Mammalia",
    order: "Pholidota",
    family: "Manidae",
  },
  common_names: [
    { name: "Giant Pangolin", language: "EN" },
    { name: "Pangolin géant", language: "FR" },
  ],
  cites_listings: [
    {
      id: 25760,
      is_current: true,
      appendix: "I",
      change_type: "+",
      effective_at: "2017-01-02",
      annotation: null,
    },
  ],
};

const SYNONYM_CONCEPT = {
  id: 32887,
  full_name: "Smutsia gigantea",
  author_year: "(Illiger, 1815)",
  rank: "SPECIES",
  name_status: "S",
  active: true,
  accepted_names: [
    { id: 11136, full_name: "Manis gigantea", author_year: "Illiger, 1815", rank: "SPECIES" },
  ],
};

const LEGISLATION = {
  cites_listings: [
    {
      id: 25760,
      is_current: true,
      appendix: "I",
      change_type: "+",
      effective_at: "2017-01-02",
      annotation: null,
    },
    {
      id: 100,
      is_current: false,
      appendix: "II",
      change_type: "+",
      effective_at: "1995-02-16",
      annotation: null,
    },
  ],
  cites_quotas: [
    {
      quota: 0,
      publication_date: "2023-01-01",
      notes: "Zero quota",
      url: null,
      is_current: true,
      unit: null,
      geo_entity: { iso_code2: "CM", name: "Cameroon", type: "COUNTRY" },
    },
  ],
  cites_suspensions: [
    {
      id: 1,
      notes: "Suspended",
      start_date: "2020-06-01",
      is_current: true,
      applies_to_import: true,
      geo_entity: { iso_code2: "GN", name: "Guinea", type: "COUNTRY" },
      start_notification: { name: "Notif 2020/030", date: "2020-01-01", url: "https://example.com" },
    },
  ],
};

const DISTRIBUTIONS = [
  { iso_code2: "CM", name: "Cameroon", type: "COUNTRY", tags: [] },
  { iso_code2: "GH", name: "Ghana", type: "COUNTRY", tags: ["extinct"] },
  { iso_code2: "XX", name: "Some Territory", type: "TERRITORY", tags: [] },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// We need to dynamically import the route after mocks are set up, and reset
// the module between tests to clear the in-memory cache.
async function importRoute() {
  return import("../route");
}

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/cites");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

describe("/api/cites", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.SPECIES_PLUS_API_KEY = "test-api-key";
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it("returns 400 when name parameter is missing", async () => {
    const { GET } = await importRoute();
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/name parameter is required/);
  });

  it("returns 500 when API key is not set", async () => {
    delete process.env.SPECIES_PLUS_API_KEY;
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Panthera leo" }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/SPECIES_PLUS_API_KEY/);
  });

  // -------------------------------------------------------------------------
  // Species+ API errors
  // -------------------------------------------------------------------------

  it("propagates Species+ API error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Panthera leo" }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toMatch(/Species\+ API error: 503/);
  });

  // -------------------------------------------------------------------------
  // No results
  // -------------------------------------------------------------------------

  it("returns found:false when no taxon concepts match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ taxon_concepts: [] })
      )
    );
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Nonexistent species" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.found).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Accepted name — happy path
  // -------------------------------------------------------------------------

  it("returns full data for an accepted species name", async () => {
    const fetchMock = vi.fn()
      // 1st call: taxon_concepts search
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [ACCEPTED_CONCEPT] }))
      // 2nd call: cites_legislation
      .mockResolvedValueOnce(jsonResponse(LEGISLATION))
      // 3rd call: distributions
      .mockResolvedValueOnce(jsonResponse(DISTRIBUTIONS));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Manis gigantea" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.scientificName).toBe("Manis gigantea");
    expect(body.citesListing).toBe("I");
    expect(body.citesId).toBe(11136);
    expect(body.englishName).toBe("Giant Pangolin");
    expect(body.taxonomy.family).toBe("Manidae");

    // Only current listings
    expect(body.currentListings).toHaveLength(1);
    expect(body.currentListings[0].appendix).toBe("I");

    // Suspensions
    expect(body.suspensions).toHaveLength(1);
    expect(body.suspensions[0].country).toBe("Guinea");
    expect(body.suspensions[0].appliesTo).toBe("import");

    // Quotas
    expect(body.quotas).toHaveLength(1);
    expect(body.quotas[0].country).toBe("Cameroon");

    // Distributions — only COUNTRYs, filtered by tags
    expect(body.nativeCountries).toHaveLength(1);
    expect(body.nativeCountries[0].code).toBe("CM");
    expect(body.extinctCountries).toHaveLength(1);
    expect(body.extinctCountries[0].code).toBe("GH");
  });

  // -------------------------------------------------------------------------
  // Synonym resolution (the #178 bug fix)
  // -------------------------------------------------------------------------

  it("follows synonym to accepted name when search returns only synonyms", async () => {
    const fetchMock = vi.fn()
      // 1st call: search for "Smutsia gigantea" → returns synonym
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [SYNONYM_CONCEPT] }))
      // 2nd call: follow-up search for "Manis gigantea" → accepted
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [ACCEPTED_CONCEPT] }))
      // 3rd call: cites_legislation (for accepted concept id 11136)
      .mockResolvedValueOnce(jsonResponse(LEGISLATION))
      // 4th call: distributions
      .mockResolvedValueOnce(jsonResponse(DISTRIBUTIONS));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Smutsia gigantea" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    // Should resolve to the accepted name
    expect(body.scientificName).toBe("Manis gigantea");
    expect(body.citesListing).toBe("I");
    expect(body.citesId).toBe(11136);
    expect(body.englishName).toBe("Giant Pangolin");

    // Verify the follow-up search used the accepted name
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain("name=Manis%20gigantea");
  });

  it("falls back to synonym when accepted name lookup fails", async () => {
    const fetchMock = vi.fn()
      // 1st call: search → synonym
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [SYNONYM_CONCEPT] }))
      // 2nd call: follow-up search fails
      .mockResolvedValueOnce(jsonResponse({}, 503))
      // 3rd call: legislation (using synonym id 32887)
      .mockResolvedValueOnce(jsonResponse({ cites_listings: [], cites_quotas: [], cites_suspensions: [] }))
      // 4th call: distributions
      .mockResolvedValueOnce(jsonResponse([]));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Smutsia gigantea" }));
    const body = await res.json();

    // Still works — falls back to synonym data
    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.scientificName).toBe("Smutsia gigantea");
  });

  it("handles synonym without accepted_names field gracefully", async () => {
    const synonymNoAccepted = { ...SYNONYM_CONCEPT, accepted_names: undefined };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [synonymNoAccepted] }))
      // legislation
      .mockResolvedValueOnce(jsonResponse({ cites_listings: [], cites_quotas: [], cites_suspensions: [] }))
      // distributions
      .mockResolvedValueOnce(jsonResponse([]));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Smutsia gigantea" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    // No follow-up search attempted — only 3 fetch calls (search + legislation + distributions)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Defensive null checks
  // -------------------------------------------------------------------------

  it("does not crash when common_names is missing", async () => {
    const conceptNoCommonNames = { ...ACCEPTED_CONCEPT, common_names: undefined };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [conceptNoCommonNames] }))
      .mockResolvedValueOnce(jsonResponse({ cites_listings: [], cites_quotas: [], cites_suspensions: [] }))
      .mockResolvedValueOnce(jsonResponse([]));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Manis gigantea" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.englishName).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Match priority
  // -------------------------------------------------------------------------

  it("prefers accepted+active+SPECIES over other matches", async () => {
    const genusMatch = {
      ...ACCEPTED_CONCEPT,
      id: 999,
      full_name: "Manis",
      rank: "GENUS",
    };
    const speciesMatch = { ...ACCEPTED_CONCEPT };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [genusMatch, speciesMatch] }))
      .mockResolvedValueOnce(jsonResponse({ cites_listings: [], cites_quotas: [], cites_suspensions: [] }))
      .mockResolvedValueOnce(jsonResponse([]));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Manis gigantea" }));
    const body = await res.json();

    expect(body.citesId).toBe(11136); // species match, not genus
    expect(body.rank).toBe("SPECIES");
  });

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  it("returns cached data on repeated requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [ACCEPTED_CONCEPT] }))
      .mockResolvedValueOnce(jsonResponse({ cites_listings: [], cites_quotas: [], cites_suspensions: [] }))
      .mockResolvedValueOnce(jsonResponse([]));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();

    // First request — hits the API
    const res1 = await GET(makeRequest({ name: "Manis gigantea" }));
    const body1 = await res1.json();
    expect(body1.found).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Second request — should be cached (no additional fetch calls)
    const res2 = await GET(makeRequest({ name: "Manis gigantea" }));
    const body2 = await res2.json();
    expect(body2.found).toBe(true);
    expect(body2.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3); // no new calls
  });

  // -------------------------------------------------------------------------
  // Legislation & distributions edge cases
  // -------------------------------------------------------------------------

  it("handles failed legislation and distribution fetches gracefully", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ taxon_concepts: [ACCEPTED_CONCEPT] }))
      // legislation fails
      .mockResolvedValueOnce(jsonResponse({}, 500))
      // distributions fail
      .mockResolvedValueOnce(jsonResponse({}, 500));

    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ name: "Manis gigantea" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.currentListings).toEqual([]);
    expect(body.suspensions).toEqual([]);
    expect(body.quotas).toEqual([]);
    expect(body.nativeCountries).toEqual([]);
    expect(body.extinctCountries).toEqual([]);
  });
});
