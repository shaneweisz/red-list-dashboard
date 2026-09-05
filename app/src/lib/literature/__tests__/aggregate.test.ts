import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearLiteratureCache, getLiteraturePool, SOURCES } from "../aggregate";

/**
 * These exercise the fan-out end to end with a routed `fetch` mock: the real
 * adapters run, so this covers the parts that only show up once several sources
 * are in play — cross-source dedupe, per-source reporting, caching and
 * in-flight coalescing.
 */

const OPENALEX_WORK = {
  id: "https://openalex.org/W1",
  doi: "https://doi.org/10.1234/shared",
  title: "Lions of the Serengeti",
  publication_year: 2021,
  publication_date: "2021-04-02",
  cited_by_count: 7,
  type: "article",
  primary_location: { source: { display_name: "Oryx" } },
};

const EUROPEPMC_WORK = {
  id: "999",
  source: "MED",
  doi: "10.1234/SHARED",
  title: "Lions of the Serengeti",
  pubYear: "2021",
  firstPublicationDate: "2021-04-02",
  citedByCount: 9,
  abstractText: "An abstract only Europe PMC has.",
};

const EUROPEPMC_UNIQUE = {
  id: "1000",
  source: "MED",
  doi: "10.1234/other",
  title: "An older note on lions",
  pubYear: "2005",
  firstPublicationDate: "2005-02-01",
};

interface RouteOptions {
  openAlexStatus?: number;
  semanticScholarStatus?: number;
}

function routedFetch(options: RouteOptions = {}) {
  return vi.fn(async (url: string) => {
    const respond = (data: unknown, status = 200) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => data }) as unknown as Response;

    if (url.includes("api.openalex.org")) {
      if (options.openAlexStatus) return respond({}, options.openAlexStatus);
      return respond({ meta: { count: 40 }, results: [OPENALEX_WORK] });
    }
    if (url.includes("ebi.ac.uk")) {
      return respond({
        hitCount: 12,
        resultList: { result: [EUROPEPMC_WORK, EUROPEPMC_UNIQUE] },
      });
    }
    if (url.includes("semanticscholar.org")) {
      if (options.semanticScholarStatus) return respond({}, options.semanticScholarStatus);
      return respond({ total: 0, data: [] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  clearLiteratureCache();
  // Key-gated sources stay off, so only the keyless three make requests.
  delete process.env.BHL_API_KEY;
  delete process.env.CORE_API_KEY;
  delete process.env.GOOGLE_BOOKS_API_KEY;
  delete process.env.SEMANTIC_SCHOLAR_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getLiteraturePool", () => {
  it("merges across sources and reports each one", async () => {
    vi.stubGlobal("fetch", routedFetch());

    const { pool, cached } = await getLiteraturePool("Panthera leo");

    expect(cached).toBe(false);
    // The shared DOI collapses two records into one, newest first.
    expect(pool.works.map((w) => w.title)).toEqual([
      "Lions of the Serengeti",
      "An older note on lions",
    ]);
    expect(pool.works[0].sources.map((s) => s.id)).toEqual(["openalex", "europepmc"]);
    // Each source's best contribution survives the merge.
    expect(pool.works[0].citations).toBe(9);
    expect(pool.works[0].abstract).toBe("An abstract only Europe PMC has.");
    expect(pool.works[0].venue).toBe("Oryx");

    expect(pool.sources).toHaveLength(SOURCES.length);
    expect(pool.sources.map((s) => [s.id, s.status])).toEqual([
      ["openalex", "ok"],
      ["europepmc", "ok"],
      ["semanticscholar", "ok"],
      ["bhl", "unconfigured"],
      ["core", "unconfigured"],
      ["googlebooks", "unconfigured"],
    ]);
    expect(pool.sources[0]).toMatchObject({ fetched: 1, upstreamTotal: 40 });
    expect(pool.sources[1]).toMatchObject({ fetched: 2, upstreamTotal: 12 });
  });

  it("includes the Latin gender variants in the query", async () => {
    vi.stubGlobal("fetch", routedFetch());
    const { pool } = await getLiteraturePool("Stenocephalemys albocaudata");
    expect(pool.nameVariants).toContain("Stenocephalemys albocaudata");
    expect(pool.nameVariants).toContain("Stenocephalemys albocaudatus");
  });

  it("serves a repeat request from cache without touching the network", async () => {
    const fetchSpy = routedFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await getLiteraturePool("Panthera leo");
    const callsAfterFirst = fetchSpy.mock.calls.length;
    const second = await getLiteraturePool("Panthera leo");

    expect(second.cached).toBe(true);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("is case- and whitespace-insensitive when caching", async () => {
    const fetchSpy = routedFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await getLiteraturePool("Panthera leo");
    const calls = fetchSpy.mock.calls.length;
    expect((await getLiteraturePool("  panthera LEO ")).cached).toBe(true);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });

  it("coalesces concurrent requests for the same species into one fan-out", async () => {
    const fetchSpy = routedFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const [a, b, c] = await Promise.all([
      getLiteraturePool("Panthera leo"),
      getLiteraturePool("Panthera leo"),
      getLiteraturePool("Panthera leo"),
    ]);

    // Three keyless sources, queried once between the three callers.
    expect(fetchSpy.mock.calls.length).toBe(3);
    expect(a.pool.works).toBe(b.pool.works);
    expect(b.pool.works).toBe(c.pool.works);
  });

  it("degrades a failing source instead of failing the whole pool", async () => {
    vi.stubGlobal("fetch", routedFetch({ openAlexStatus: 500 }));

    const { pool } = await getLiteraturePool("Panthera leo");

    expect(pool.sources.find((s) => s.id === "openalex")).toMatchObject({
      status: "error",
      fetched: 0,
    });
    // Europe PMC's two records still make it through.
    expect(pool.works).toHaveLength(2);
  });

  it("retries a throttled source sooner than a healthy one", async () => {
    // A rate limit shortens the TTL, so the gap doesn't stick for six hours.
    vi.useFakeTimers();
    try {
      const fetchSpy = routedFetch({ semanticScholarStatus: 429 });
      vi.stubGlobal("fetch", fetchSpy);

      await getLiteraturePool("Panthera leo");
      const callsAfterFirst = fetchSpy.mock.calls.length;

      vi.advanceTimersByTime(11 * 60 * 1000);
      const second = await getLiteraturePool("Panthera leo");

      expect(second.cached).toBe(false);
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });
});
