/**
 * Semantic Scholar — supplementary coverage, notably of conference and grey
 * literature that OpenAlex misses, plus its own citation counts.
 *
 * Two caveats drive the shape of this adapter:
 *  - The keyless tier is a *shared* pool and 429s readily. That is expected,
 *    not an error to shout about, so it degrades to a "rate limited" report and
 *    the timeline is served from the other sources. An issued key carries an
 *    explicit "1 request per second, cumulative across all endpoints" ceiling,
 *    which `RATE_LIMIT` keeps us under.
 *  - `/paper/search` is relevance-ranked with no date sort and no phrase
 *    operator, so results are filtered locally against the name variants and
 *    take their place in the timeline via the global merge sort rather than
 *    arriving pre-ordered.
 */

import {
  cleanAbstract,
  cleanText,
  formatAuthors,
  mapWorkType,
  mentionsAnyVariant,
  normalizeDoi,
  parseDate,
  toSortStamp,
} from "../normalize";
import type { LiteratureWork, SourceAdapter, SourceQuery, SourceResult } from "../types";
import { failed, fetchJson, MinIntervalLimiter } from "./http";

interface SemanticScholarPaper {
  paperId?: string;
  title?: string | null;
  abstract?: string | null;
  venue?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  citationCount?: number | null;
  publicationTypes?: string[] | null;
  externalIds?: { DOI?: string | null } | null;
  openAccessPdf?: { url?: string | null } | null;
  url?: string | null;
  authors?: Array<{ name?: string | null }> | null;
}

interface SemanticScholarResponse {
  total?: number;
  data?: SemanticScholarPaper[];
}

const FIELDS = [
  "title",
  "abstract",
  "venue",
  "year",
  "publicationDate",
  "citationCount",
  "publicationTypes",
  "externalIds",
  "openAccessPdf",
  "url",
  "authors",
].join(",");

/**
 * Semantic Scholar's stated ceiling is 1 request per second, and they ask
 * callers to sit below it — hence 1.1s rather than exactly 1s.
 */
const RATE_LIMIT = new MinIntervalLimiter(1_100);

export const semanticScholarSource: SourceAdapter = {
  id: "semanticscholar",
  label: "Semantic Scholar",
  homepage: "https://www.semanticscholar.org",
  // Measured 4-8s on the authenticated endpoint; the default budget was cutting
  // it off. Also covers any time spent waiting for a rate-limit slot.
  timeoutMs: 20_000,

  async fetch({ scientificName, nameVariants, limit, signal }: SourceQuery): Promise<SourceResult> {
    const url =
      `https://api.semanticscholar.org/graph/v1/paper/search` +
      `?query=${encodeURIComponent(scientificName)}&limit=${Math.max(1, Math.min(limit, 100))}` +
      `&fields=${FIELDS}`;

    // Optional: a free key lifts us off the shared rate-limit pool.
    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
    const headers = apiKey ? { "x-api-key": apiKey } : undefined;

    try {
      // The 1 rps ceiling is a condition of an issued key. Unauthenticated
      // callers share a 1000 rps pool that a single request can't breach, so
      // there is nothing to pace there.
      if (apiKey) await RATE_LIMIT.acquire(signal);
      const data = await fetchJson<SemanticScholarResponse>(url, { signal, headers });
      const works = (data.data ?? [])
        .map(toWork)
        .filter((w): w is LiteratureWork => w !== null)
        // Relevance search will happily return a congener; require the actual name.
        .filter((w) => mentionsAnyVariant(nameVariants, w.title, w.abstract, w.venue));
      return { status: "ok", works, upstreamTotal: data.total ?? null, note: null };
    } catch (error) {
      const result = failed(error);
      if (result.status === "rate_limited") {
        // Don't tell someone to set a key they have already set.
        result.note = apiKey
          ? "Rate limit reached"
          : "Shared rate limit reached — set SEMANTIC_SCHOLAR_API_KEY for a private quota";
      }
      return result;
    }
  },
};

function toWork(raw: SemanticScholarPaper): LiteratureWork | null {
  const title = cleanText(raw.title);
  if (!title) return null;

  const doi = normalizeDoi(raw.externalIds?.DOI);
  const parsed = parseDate(raw.publicationDate) ?? parseDate(raw.year);
  const landing =
    cleanText(raw.url) ?? (raw.paperId ? `https://www.semanticscholar.org/paper/${raw.paperId}` : null);

  return {
    key: `semanticscholar:${raw.paperId ?? title}`,
    title,
    url: doi ? `https://doi.org/${doi}` : (landing ?? "https://www.semanticscholar.org"),
    doi,
    date: parsed?.date ?? null,
    datePrecision: parsed?.precision ?? null,
    year: parsed?.year ?? raw.year ?? null,
    sortStamp: toSortStamp(parsed?.date ?? null, parsed?.precision ?? null),
    authors: formatAuthors((raw.authors ?? []).map((a) => a.name)),
    venue: cleanText(raw.venue),
    citations: raw.citationCount ?? null,
    type: mapWorkType((raw.publicationTypes ?? []).join(" ")),
    openAccessUrl: cleanText(raw.openAccessPdf?.url),
    abstract: cleanAbstract(raw.abstract),
    sources: [{ id: "semanticscholar", label: "Semantic Scholar", url: landing }],
  };
}
