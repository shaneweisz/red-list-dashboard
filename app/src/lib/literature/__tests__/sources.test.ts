import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bhlSource } from "../sources/bhl";
import { coreSource } from "../sources/core";
import { europePmcSource } from "../sources/europepmc";
import { googleBooksSource } from "../sources/google-books";
import { openAlexSource, reconstructAbstract } from "../sources/openalex";
import { semanticScholarSource } from "../sources/semantic-scholar";
import { USER_AGENT } from "../sources/http";
import type { SourceQuery } from "../types";

const QUERY: SourceQuery = {
  scientificName: "Panthera leo",
  nameVariants: ["Panthera leo"],
  limit: 5,
  signal: new AbortController().signal,
};

/** Stand-in for a `fetch` Response, enough for `fetchJson`. */
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response;
}

let lastUrl = "";
let lastInit: RequestInit | undefined;

function mockFetch(data: unknown, status = 200) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    return jsonResponse(data, status);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  lastUrl = "";
  lastInit = undefined;
  delete process.env.BHL_API_KEY;
  delete process.env.CORE_API_KEY;
  delete process.env.GOOGLE_BOOKS_API_KEY;
  delete process.env.SEMANTIC_SCHOLAR_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reconstructAbstract", () => {
  it("rebuilds running text from OpenAlex's inverted index", () => {
    expect(
      reconstructAbstract({ The: [0], lion: [1], is: [2], large: [3] }),
    ).toBe("The lion is large");
  });

  it("handles a word appearing more than once", () => {
    expect(reconstructAbstract({ a: [0, 2], b: [1] })).toBe("a b a");
  });

  it("returns null for a missing or empty index", () => {
    expect(reconstructAbstract(null)).toBeNull();
    expect(reconstructAbstract({})).toBeNull();
  });
});

describe("openAlexSource", () => {
  it("maps a work and reports the upstream total", async () => {
    mockFetch({
      meta: { count: 312 },
      results: [
        {
          id: "https://openalex.org/W1",
          doi: "https://doi.org/10.1234/ABC",
          title: "Lions of the Serengeti",
          publication_year: 2021,
          publication_date: "2021-04-02",
          cited_by_count: 7,
          type: "article",
          primary_location: { source: { display_name: "Oryx" } },
          abstract_inverted_index: { Lions: [0], roar: [1] },
          authorships: [{ author: { display_name: "A One" } }],
          best_oa_location: { pdf_url: "https://example.org/paper.pdf" },
        },
      ],
    });

    const result = await openAlexSource.fetch(QUERY);

    expect(result.status).toBe("ok");
    expect(result.upstreamTotal).toBe(312);
    expect(result.works[0]).toMatchObject({
      title: "Lions of the Serengeti",
      doi: "10.1234/abc",
      url: "https://doi.org/10.1234/abc",
      date: "2021-04-02",
      datePrecision: "day",
      sortStamp: "2021-04-02",
      citations: 7,
      venue: "Oryx",
      type: "article",
      authors: "A One",
      abstract: "Lions roar",
      openAccessUrl: "https://example.org/paper.pdf",
    });
  });

  it("asks for exact phrases, excludes datasets and joins the polite pool", async () => {
    mockFetch({ meta: { count: 0 }, results: [] });
    await openAlexSource.fetch({ ...QUERY, nameVariants: ["Aloe vera", "Aloe verum"] });

    const filter = decodeURIComponent(new URL(lastUrl).searchParams.get("filter")!);
    expect(filter).toContain('"Aloe vera"|"Aloe verum"');
    expect(filter).toContain("type:!dataset");
    expect(lastUrl).toContain("mailto=");
    expect((lastInit?.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
  });

  it("drops records with no title rather than rendering a blank row", async () => {
    mockFetch({ meta: { count: 1 }, results: [{ id: "W2", title: null, display_name: null }] });
    const result = await openAlexSource.fetch(QUERY);
    expect(result.works).toHaveLength(0);
  });

  it("reports an error status instead of throwing", async () => {
    mockFetch({}, 500);
    const result = await openAlexSource.fetch(QUERY);
    expect(result).toMatchObject({ status: "error", works: [], note: "HTTP 500" });
  });

  it("reports rate limiting distinctly from other failures", async () => {
    mockFetch({}, 429);
    expect((await openAlexSource.fetch(QUERY)).status).toBe("rate_limited");
  });
});

describe("europePmcSource", () => {
  it("maps a record, including its open-access PDF", async () => {
    mockFetch({
      hitCount: 3,
      resultList: {
        result: [
          {
            id: "31118951",
            source: "MED",
            doi: "10.1155/2019/2609532",
            title: "Medicinal Plants Traded in Limpopo.",
            authorString: "Rasethe MT, Semenya SS.",
            pubYear: "2019",
            firstPublicationDate: "2019-04-16",
            citedByCount: 14,
            abstractText: "<p>An abstract.</p>",
            journalInfo: { journal: { title: "Evidence-based Complementary Medicine" } },
            pubTypeList: { pubType: ["research-article", "Journal Article"] },
            fullTextUrlList: {
              fullTextUrl: [
                { availabilityCode: "S", documentStyle: "doi", url: "https://doi.org/x" },
                { availabilityCode: "OA", documentStyle: "pdf", url: "https://example.org/a.pdf" },
              ],
            },
          },
        ],
      },
    });

    const result = await europePmcSource.fetch(QUERY);

    expect(result.upstreamTotal).toBe(3);
    expect(result.works[0]).toMatchObject({
      doi: "10.1155/2019/2609532",
      date: "2019-04-16",
      // The trailing full stop Europe PMC appends to author strings is dropped.
      authors: "Rasethe MT, Semenya SS",
      venue: "Evidence-based Complementary Medicine",
      type: "article",
      abstract: "An abstract.",
      openAccessUrl: "https://example.org/a.pdf",
    });
    expect(result.works[0].sources[0].url).toBe("https://europepmc.org/article/MED/31118951");
  });

  it("sends the name variants as an OR of quoted phrases", async () => {
    mockFetch({ hitCount: 0, resultList: { result: [] } });
    await europePmcSource.fetch({ ...QUERY, nameVariants: ["Aloe vera", "Aloe verum"] });
    expect(decodeURIComponent(lastUrl)).toContain('query="Aloe vera" OR "Aloe verum"');
  });

  it("falls back to the year when no publication date is given", async () => {
    mockFetch({
      hitCount: 1,
      resultList: { result: [{ id: "1", source: "MED", title: "T", pubYear: "1998" }] },
    });
    const [workRecord] = (await europePmcSource.fetch(QUERY)).works;
    expect(workRecord).toMatchObject({ date: "1998", datePrecision: "year", sortStamp: "1998-07-01" });
  });
});

describe("semanticScholarSource", () => {
  it("filters out relevance matches that never name the species", async () => {
    mockFetch({
      total: 2,
      data: [
        { paperId: "p1", title: "Diet of Panthera leo in Kenya", year: 2020 },
        { paperId: "p2", title: "Diet of Panthera pardus in Kenya", year: 2020 },
      ],
    });

    const result = await semanticScholarSource.fetch(QUERY);

    expect(result.works.map((w) => w.title)).toEqual(["Diet of Panthera leo in Kenya"]);
  });

  it("explains the shared quota when throttled", async () => {
    mockFetch({}, 429);
    const result = await semanticScholarSource.fetch(QUERY);
    expect(result.status).toBe("rate_limited");
    expect(result.note).toContain("SEMANTIC_SCHOLAR_API_KEY");
  });

  it("sends the API key header only when one is configured", async () => {
    mockFetch({ total: 0, data: [] });
    await semanticScholarSource.fetch(QUERY);
    expect((lastInit?.headers as Record<string, string>)["x-api-key"]).toBeUndefined();

    process.env.SEMANTIC_SCHOLAR_API_KEY = "secret";
    await semanticScholarSource.fetch(QUERY);
    expect((lastInit?.headers as Record<string, string>)["x-api-key"]).toBe("secret");
  });
});

describe("key-gated sources", () => {
  it.each([
    ["bhl", bhlSource, "BHL_API_KEY"],
    ["core", coreSource, "CORE_API_KEY"],
    ["googlebooks", googleBooksSource, "GOOGLE_BOOKS_API_KEY"],
  ])("%s reports itself unconfigured without a key, and makes no request", async (_id, source, envVar) => {
    const spy = mockFetch({});
    const result = await source.fetch(QUERY);
    expect(result.status).toBe("unconfigured");
    expect(result.note).toContain(envVar);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("bhlSource", () => {
  beforeEach(() => {
    process.env.BHL_API_KEY = "test-key";
  });

  it("maps a scanned part and keeps its landing page as the free-to-read link", async () => {
    mockFetch({
      Status: "ok",
      Result: [
        {
          BHLType: "Part",
          PartID: 12345,
          Title: "On a new Panthera leo from Somaliland",
          PartUrl: "https://www.biodiversitylibrary.org/part/12345",
          Authors: [{ Name: "Sclater, P. L." }],
          Date: "1898",
          ContainerTitle: "Proceedings of the Zoological Society of London",
          Genre: "Article",
        },
      ],
    });

    const [record] = (await bhlSource.fetch(QUERY)).works;

    expect(record).toMatchObject({
      title: "On a new Panthera leo from Somaliland",
      date: "1898",
      datePrecision: "year",
      sortStamp: "1898-07-01",
      type: "article",
      citations: null,
      openAccessUrl: "https://www.biodiversitylibrary.org/part/12345",
    });
  });

  it("keeps a volume whose title never names the species", async () => {
    // The 1860 flora that mentions the species only in its scanned body text is
    // the record BHL exists to contribute; the quoted full-text query, not a
    // local title filter, is what keeps results on-species.
    mockFetch({
      Status: "ok",
      Result: [{ BHLType: "Item", ItemID: 1, Title: "Flora of the Cape", Date: "1860" }],
    });
    expect((await bhlSource.fetch(QUERY)).works).toHaveLength(1);
  });

  it("searches the name as a quoted phrase", async () => {
    mockFetch({ Status: "ok", Result: [] });
    await bhlSource.fetch(QUERY);
    expect(decodeURIComponent(lastUrl)).toContain('searchterm="Panthera leo"');
  });

  it("surfaces a BHL-level error status", async () => {
    mockFetch({ Status: "error", ErrorMessage: "Invalid API key", Result: null });
    expect(await bhlSource.fetch(QUERY)).toMatchObject({
      status: "error",
      note: "Invalid API key",
    });
  });
});

describe("coreSource", () => {
  beforeEach(() => {
    process.env.CORE_API_KEY = "test-key";
  });

  it("authenticates with a bearer token and maps a repository record", async () => {
    mockFetch({
      totalHits: 4,
      results: [
        {
          id: 99,
          title: "Population survey of Panthera leo",
          doi: "10.5555/xyz",
          publishedDate: "2018-09-30T00:00:00",
          abstract: "Counts of lions.",
          authors: [{ name: "B Two" }],
          publisher: "University of Somewhere",
          documentType: "thesis",
          downloadUrl: "https://core.ac.uk/download/99.pdf",
        },
      ],
    });

    const result = await coreSource.fetch(QUERY);

    expect((lastInit?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(result.works[0]).toMatchObject({
      doi: "10.5555/xyz",
      date: "2018-09-30",
      type: "report",
      openAccessUrl: "https://core.ac.uk/download/99.pdf",
    });
  });
});

describe("googleBooksSource", () => {
  beforeEach(() => {
    process.env.GOOGLE_BOOKS_API_KEY = "test-key";
  });

  it("joins title and subtitle and reads a prose publication date", async () => {
    mockFetch({
      totalItems: 2,
      items: [
        {
          id: "vol1",
          volumeInfo: {
            title: "Mammals of Africa",
            subtitle: "including Panthera leo",
            authors: ["C Three", "D Four"],
            publisher: "Bloomsbury",
            publishedDate: "2013-05",
            description: "A reference work.",
            infoLink: "https://books.google.com/books?id=vol1",
          },
          accessInfo: { viewability: "PARTIAL", webReaderLink: "https://reader" },
        },
      ],
    });

    const [record] = (await googleBooksSource.fetch(QUERY)).works;

    expect(record).toMatchObject({
      title: "Mammals of Africa: including Panthera leo",
      date: "2013-05",
      datePrecision: "month",
      sortStamp: "2013-05-15",
      type: "book",
      authors: "C Three, D Four",
      venue: "Bloomsbury",
      // Only fully viewable volumes count as readable.
      openAccessUrl: null,
    });
  });

  it("keeps a flora that matched on its contents rather than its title", async () => {
    mockFetch({
      totalItems: 1,
      items: [{ id: "vol2", volumeInfo: { title: "Flora of Tropical Africa", publishedDate: "2001" } }],
    });
    expect((await googleBooksSource.fetch(QUERY)).works).toHaveLength(1);
  });

  it("searches the variants as an OR of quoted phrases", async () => {
    mockFetch({ totalItems: 0, items: [] });
    await googleBooksSource.fetch({ ...QUERY, nameVariants: ["Aloe vera", "Aloe verum"] });
    expect(decodeURIComponent(lastUrl)).toContain('q="Aloe vera" OR "Aloe verum"');
  });
});
