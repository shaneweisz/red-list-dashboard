/**
 * CORE — aggregated open-access repository content: theses, institutional
 * reports and preprints that never got a DOI and so never reached OpenAlex.
 *
 * Needs a free key (https://core.ac.uk/services/api). Without `CORE_API_KEY`
 * the adapter reports "unconfigured" and the rest of the timeline still works.
 */

import {
  cleanAbstract,
  cleanText,
  formatAuthors,
  mapWorkType,
  normalizeDoi,
  parseDate,
  toSortStamp,
} from "../normalize";
import type { LiteratureWork, SourceAdapter, SourceQuery, SourceResult } from "../types";
import { failed, fetchJson, quotedOrQuery, unconfigured } from "./http";

interface CoreWork {
  id?: number | string;
  title?: string | null;
  doi?: string | null;
  abstract?: string | null;
  publishedDate?: string | null;
  yearPublished?: number | null;
  publisher?: string | null;
  documentType?: string | null;
  downloadUrl?: string | null;
  authors?: Array<{ name?: string | null }> | null;
  links?: Array<{ type?: string | null; url?: string | null }> | null;
}

interface CoreResponse {
  totalHits?: number;
  results?: CoreWork[];
}

export const coreSource: SourceAdapter = {
  id: "core",
  label: "CORE",
  homepage: "https://core.ac.uk",

  async fetch({ nameVariants, limit, signal }: SourceQuery): Promise<SourceResult> {
    const apiKey = process.env.CORE_API_KEY;
    if (!apiKey) return unconfigured("CORE_API_KEY");

    const url =
      `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(quotedOrQuery(nameVariants))}` +
      `&limit=${Math.max(1, Math.min(limit, 100))}&sort=publishedDate:desc`;

    try {
      const data = await fetchJson<CoreResponse>(url, {
        signal,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      // No local name filter: a regional Red Data Book or a multi-species
      // thesis is exactly the grey literature CORE is here for, and its title
      // and abstract will rarely name one of the species it covers. The quoted
      // phrase query is what keeps results on-species.
      const works = (data.results ?? [])
        .map(toWork)
        .filter((w): w is LiteratureWork => w !== null);
      return { status: "ok", works, upstreamTotal: data.totalHits ?? null, note: null };
    } catch (error) {
      return failed(error);
    }
  },
};

function toWork(raw: CoreWork): LiteratureWork | null {
  const title = cleanText(raw.title);
  if (!title) return null;

  const doi = normalizeDoi(raw.doi);
  const parsed = parseDate(raw.publishedDate) ?? parseDate(raw.yearPublished);
  const landing =
    cleanText(raw.links?.find((l) => l.type === "display")?.url) ??
    cleanText(raw.downloadUrl) ??
    (raw.id ? `https://core.ac.uk/works/${raw.id}` : null);

  return {
    key: `core:${raw.id ?? title}`,
    title,
    url: doi ? `https://doi.org/${doi}` : (landing ?? "https://core.ac.uk"),
    doi,
    date: parsed?.date ?? null,
    datePrecision: parsed?.precision ?? null,
    year: parsed?.year ?? raw.yearPublished ?? null,
    sortStamp: toSortStamp(parsed?.date ?? null, parsed?.precision ?? null),
    authors: formatAuthors((raw.authors ?? []).map((a) => a.name)),
    venue: cleanText(raw.publisher),
    citations: null,
    type: mapWorkType(raw.documentType),
    // Everything CORE indexes is open access by definition.
    openAccessUrl: cleanText(raw.downloadUrl) ?? landing,
    abstract: cleanAbstract(raw.abstract),
    sources: [{ id: "core", label: "CORE", url: landing }],
  };
}
