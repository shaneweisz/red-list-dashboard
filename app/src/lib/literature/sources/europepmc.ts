/**
 * Europe PMC — life-science literature, including preprints, books and theses
 * that OpenAlex indexes patchily. No key, no registration, and it supports
 * quoted phrase search with `OR`, so it stays precise on binomials.
 */

import {
  cleanAbstract,
  cleanText,
  mapWorkType,
  normalizeDoi,
  parseDate,
  toSortStamp,
} from "../normalize";
import type { LiteratureWork, SourceAdapter, SourceQuery, SourceResult } from "../types";
import { failed, fetchJson, quotedOrQuery } from "./http";

interface EuropePmcResult {
  id?: string;
  source?: string;
  doi?: string | null;
  title?: string | null;
  authorString?: string | null;
  pubYear?: string | null;
  firstPublicationDate?: string | null;
  electronicPublicationDate?: string | null;
  citedByCount?: number | null;
  abstractText?: string | null;
  isOpenAccess?: string | null;
  journalInfo?: { journal?: { title?: string | null } | null } | null;
  bookOrReportDetails?: { publisher?: string | null } | null;
  pubTypeList?: { pubType?: string[] | string | null } | null;
  fullTextUrlList?: {
    fullTextUrl?: Array<{ availabilityCode?: string; url?: string; documentStyle?: string }> | null;
  } | null;
}

interface EuropePmcResponse {
  hitCount?: number;
  resultList?: { result?: EuropePmcResult[] };
}

export const europePmcSource: SourceAdapter = {
  id: "europepmc",
  label: "Europe PMC",
  homepage: "https://europepmc.org",

  async fetch({ nameVariants, limit, signal }: SourceQuery): Promise<SourceResult> {
    const query = encodeURIComponent(quotedOrQuery(nameVariants));
    const url =
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}` +
      `&format=json&resultType=core&pageSize=${Math.max(1, limit)}` +
      `&sort=${encodeURIComponent("P_PDATE_D desc")}`;

    try {
      const data = await fetchJson<EuropePmcResponse>(url, { signal });
      const works = (data.resultList?.result ?? [])
        .map(toWork)
        .filter((w): w is LiteratureWork => w !== null);
      return { status: "ok", works, upstreamTotal: data.hitCount ?? null, note: null };
    } catch (error) {
      return failed(error);
    }
  },
};

function toWork(raw: EuropePmcResult): LiteratureWork | null {
  const title = cleanText(raw.title);
  if (!title) return null;

  const doi = normalizeDoi(raw.doi);
  const parsed =
    parseDate(raw.firstPublicationDate) ??
    parseDate(raw.electronicPublicationDate) ??
    parseDate(raw.pubYear);
  const landing =
    raw.source && raw.id ? `https://europepmc.org/article/${raw.source}/${raw.id}` : null;

  const pubTypes = raw.pubTypeList?.pubType;
  const typeText = Array.isArray(pubTypes) ? pubTypes.join(" ") : (pubTypes ?? null);

  const openAccessUrl =
    raw.fullTextUrlList?.fullTextUrl?.find(
      (u) => u.availabilityCode === "OA" && u.documentStyle === "pdf",
    )?.url ?? null;

  return {
    key: `europepmc:${raw.source ?? "?"}:${raw.id ?? title}`,
    title,
    url: doi ? `https://doi.org/${doi}` : (landing ?? "https://europepmc.org"),
    doi,
    date: parsed?.date ?? null,
    datePrecision: parsed?.precision ?? null,
    year: parsed?.year ?? null,
    sortStamp: toSortStamp(parsed?.date ?? null, parsed?.precision ?? null),
    // Europe PMC pre-joins authors ("Rasethe MT, Semenya SS, Maroyi A.").
    authors: cleanText(raw.authorString)?.replace(/\.$/, "") ?? null,
    venue: cleanText(raw.journalInfo?.journal?.title) ?? cleanText(raw.bookOrReportDetails?.publisher),
    citations: raw.citedByCount ?? null,
    type: mapWorkType(typeText),
    openAccessUrl: cleanText(openAccessUrl),
    abstract: cleanAbstract(raw.abstractText),
    sources: [{ id: "europepmc", label: "Europe PMC", url: landing }],
  };
}
