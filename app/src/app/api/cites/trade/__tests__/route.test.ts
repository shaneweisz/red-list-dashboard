import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

function makeTradeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Year: 2023,
    "App.": "I",
    Taxon: "Manis gigantea",
    Importer: "US",
    Exporter: "CM",
    Origin: null,
    "Importer reported quantity": "10",
    "Exporter reported quantity": "8",
    Term: "specimens",
    Unit: null,
    Purpose: "S",
    Source: "W",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importRoute() {
  return import("../route");
}

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/cites/trade");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/api/cites/trade", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it("returns 400 when taxon_id is missing", async () => {
    const { GET } = await importRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/taxon_id must be a numeric value/);
  });

  it("returns 400 when taxon_id is not numeric", async () => {
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "abc" }));
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // CITES Trade DB errors
  // -------------------------------------------------------------------------

  it("propagates CITES Trade DB error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "11136" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/CITES Trade DB error/);
  });

  // -------------------------------------------------------------------------
  // No data
  // -------------------------------------------------------------------------

  it("returns found:false when no trade rows exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ shipment_comptab_export: { rows: [] } })
      )
    );
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "11136" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.found).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Summarization
  // -------------------------------------------------------------------------

  it("summarizes trade rows correctly", async () => {
    const rows = [
      makeTradeRow({ Year: 2022, Exporter: "CM", Importer: "US", "Importer reported quantity": "5", Purpose: "S", Source: "W", Term: "specimens" }),
      makeTradeRow({ Year: 2022, Exporter: "CM", Importer: "DE", "Importer reported quantity": "3", Purpose: "T", Source: "C", Term: "skins" }),
      makeTradeRow({ Year: 2023, Exporter: "GH", Importer: "US", "Importer reported quantity": "10", Purpose: "S", Source: "W", Term: "specimens" }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ shipment_comptab_export: { rows } })
      )
    );
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "11136" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.totalRecords).toBe(3);
    expect(body.yearRange).toEqual([2022, 2023]);

    // byYear aggregation
    expect(body.byYear).toHaveLength(2);
    expect(body.byYear[0].year).toBe(2022);
    expect(body.byYear[0].records).toBe(2);
    expect(body.byYear[1].year).toBe(2023);
    expect(body.byYear[1].records).toBe(1);

    // topTerms
    expect(body.topTerms[0].term).toBe("specimens");
    expect(body.topTerms[0].records).toBe(2);

    // topExporters
    expect(body.topExporters[0].code).toBe("CM");
    expect(body.topExporters[0].records).toBe(2);

    // topImporters
    expect(body.topImporters[0].code).toBe("US");
    expect(body.topImporters[0].records).toBe(2);

    // topFlows
    expect(body.topFlows.length).toBeGreaterThan(0);

    // shipments (compact records)
    expect(body.shipments).toHaveLength(3);
    expect(body.shipments[0]).toEqual(
      expect.objectContaining({ y: 2022, s: "W", p: "S", t: "specimens", u: "", o: "" })
    );

    // allSources / allPurposes / allTerms / allTermsByUnit present
    expect(body.allSources.length).toBeGreaterThan(0);
    expect(body.allPurposes.length).toBeGreaterThan(0);
    expect(body.allTerms.length).toBeGreaterThan(0);
    expect(body.allTermsByUnit.length).toBeGreaterThan(0);
  });

  it("prefers exporter-reported quantity over importer-reported", async () => {
    const rows = [
      makeTradeRow({
        "Importer reported quantity": "20",
        "Exporter reported quantity": "15",
      }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ shipment_comptab_export: { rows } })
      )
    );
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "11136" }));
    const body = await res.json();

    expect(body.byYear[0].quantity).toBe(15); // exporter-preferred, not max(20, 15)
  });

  it("falls back to importer quantity when the exporter did not report", async () => {
    const rows = [
      makeTradeRow({
        "Importer reported quantity": "20",
        "Exporter reported quantity": null,
      }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ shipment_comptab_export: { rows } })
      )
    );
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "11136" }));
    const body = await res.json();

    expect(body.byYear[0].quantity).toBe(20);
  });

  it("groups terms by unit without aggregating across units", async () => {
    const rows = [
      makeTradeRow({ Term: "tusks", Unit: "kg", "Exporter reported quantity": "100" }),
      makeTradeRow({ Term: "tusks", Unit: null, "Exporter reported quantity": "4" }),
      makeTradeRow({ Term: "leather", Unit: "m", "Exporter reported quantity": "7" }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ shipment_comptab_export: { rows } })
      )
    );
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "11136" }));
    const body = await res.json();

    // "tusks / kg" and "tusks / (no unit)" must be separate rows
    const tusksKg = body.allTermsByUnit.find(
      (t: { term: string; unit: string }) => t.term === "tusks" && t.unit === "kg"
    );
    const tusksNoUnit = body.allTermsByUnit.find(
      (t: { term: string; unit: string }) => t.term === "tusks" && t.unit === ""
    );
    expect(tusksKg?.quantity).toBe(100);
    expect(tusksNoUnit?.quantity).toBe(4);
  });

  it("handles null quantities gracefully", async () => {
    const rows = [
      makeTradeRow({
        "Importer reported quantity": null,
        "Exporter reported quantity": null,
      }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ shipment_comptab_export: { rows } })
      )
    );
    const { GET } = await importRoute();
    const res = await GET(makeRequest({ taxon_id: "11136" }));
    const body = await res.json();

    expect(body.found).toBe(true);
    expect(body.byYear[0].quantity).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  it("caches results on repeated requests", async () => {
    const rows = [makeTradeRow()];
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ shipment_comptab_export: { rows } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await importRoute();

    await GET(makeRequest({ taxon_id: "11136" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await GET(makeRequest({ taxon_id: "11136" }));
    expect(fetchMock).toHaveBeenCalledTimes(1); // no new calls
  });
});
