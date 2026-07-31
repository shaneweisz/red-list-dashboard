/**
 * A name GBIF cannot place below genus is retried once, with IUCN's authorship.
 *
 * Colostygia puengeleri (EN) is the case. Catalogue of Life spells it pungeleri,
 * and asked for the name alone GBIF answers HIGHERRANK — the genus — so the
 * species shows no occurrence data at all. Told who published it, GBIF returns
 * VARIANT and the right key.
 *
 * The authorship has to be its own parameter. Putting it inside the name string
 * does nothing, despite the endpoint documenting that the name "may include the
 * authorship and year".
 *
 * The retry is deliberately second. A name that already resolves must keep
 * taking exactly the path it takes today, so that this can only ever add a
 * match, never move one — the property these tests exist to hold.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { matchGbifSpecies } from "../match-redlist-species-to-gbif";

const HIGHERRANK = {
  diagnostics: { matchType: "HIGHERRANK", confidence: 94 },
  usage: { key: "925SL", canonicalName: "Colostygia", rank: "GENUS", status: "ACCEPTED" },
};
const VARIANT = {
  diagnostics: { matchType: "VARIANT", confidence: 86 },
  usage: { key: "X8JX", canonicalName: "Colostygia pungeleri", rank: "SPECIES",
           status: "ACCEPTED", authorship: "(Stertz, 1902)" },
};
const EXACT = {
  diagnostics: { matchType: "EXACT", confidence: 99 },
  usage: { key: "AAA", canonicalName: "Pica nutalli", rank: "SPECIES",
           status: "ACCEPTED", authorship: "(Audubon, 1837)" },
};

/** Records every URL requested, replying with the queued responses in order. */
function stubFetch(...responses: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url));
    const body = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }));
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

const ctx = { kingdom: "Animalia", class_name: "insecta", family: "geometridae" };

describe("authorship retry", () => {
  it("retries with authorship when nothing below genus matched", async () => {
    const urls = stubFetch(HIGHERRANK, VARIANT);
    const out = await matchGbifSpecies("Colostygia puengeleri", { ...ctx, authorship: "(Stertz, 1902)" });

    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toContain("scientificNameAuthorship");
    // URLSearchParams form-encodes spaces as "+", which decodeURIComponent
    // leaves alone — hence the explicit swap rather than a plain decode.
    const sent = decodeURIComponent(urls[1]).replace(/\+/g, " ");
    expect(sent).toContain("scientificNameAuthorship=(Stertz, 1902)");
    expect(out.key).toBe("X8JX");
  });

  it("does not retry when the first attempt already resolved a species", async () => {
    const urls = stubFetch(EXACT);
    const out = await matchGbifSpecies("Pica nutalli", { ...ctx, authorship: "(Audubon, 1837)" });

    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain("scientificNameAuthorship");
    expect(out.key).toBe("AAA");
  });

  it("does not retry when IUCN gives no authorship", async () => {
    const urls = stubFetch(HIGHERRANK);
    const out = await matchGbifSpecies("Colostygia puengeleri", ctx);

    expect(urls).toHaveLength(1);
    expect(out.key).toBeNull();
    expect(out.matchType).toBe("HIGHERRANK");
  });

  it("retries at most once, so a stubborn name cannot loop", async () => {
    const urls = stubFetch(HIGHERRANK, HIGHERRANK, HIGHERRANK);
    const out = await matchGbifSpecies("Nowhere species", { ...ctx, authorship: "Someone, 1900" });

    expect(urls).toHaveLength(2);
    expect(out.key).toBeNull();
  });

  it("still refuses an ambiguous synonym found only by the retry", async () => {
    // The retry widens retrieval, not what we are willing to accept. An ambiguous
    // synonym points at several accepted taxa and CoL does not say which.
    const ambiguous = {
      diagnostics: { matchType: "EXACT", confidence: 98 },
      usage: { key: "GDHX", canonicalName: "Ardisia oligantha", rank: "SPECIES",
               status: "AMBIGUOUS_SYNONYM" },
      acceptedUsage: { key: "OTHER", canonicalName: "Ardisia marceliana" },
    };
    stubFetch(HIGHERRANK, ambiguous);
    const out = await matchGbifSpecies("Ardisia oligantha", { ...ctx, authorship: "Gilg" });

    expect(out.key).toBeNull();
    expect(out.matchType).toContain("AMBIGUOUS");
  });
});
