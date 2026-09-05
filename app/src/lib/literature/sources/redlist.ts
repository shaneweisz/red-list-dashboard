/**
 * The Red List assessment's own reference list.
 *
 * This is the highest-signal literature there is for a species: an assessor has
 * already decided these works are the evidence base. Pulling them into the same
 * table means a row can say "OpenAlex, Red List assessment" — i.e. this is a
 * paper the last assessment actually cited — while everything without that tag
 * is material that has appeared, or was missed, since.
 *
 * Unlike the other sources this one is not a search: it is a lookup keyed on the
 * assessment id, so it contributes nothing for a Not Evaluated species.
 */

import { cleanText, formatAuthors, parseDate, toSortStamp } from "../normalize";
import type { LiteratureWork, SourceAdapter, SourceQuery, SourceResult } from "../types";
import { failed, fetchJson, unconfigured } from "./http";

interface RedListReference {
  author?: string | null;
  citation?: string | null;
  citation_short?: string | null;
  title?: string | null;
  year?: string | null;
}

interface RedListAssessment {
  url?: string | null;
  references?: RedListReference[] | null;
}

/** Red List citations carry inline `<i>` markup around scientific names. */
function stripMarkup(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return cleanText(raw.replace(/<[^>]*>/g, " "));
}

export const redListSource: SourceAdapter = {
  id: "redlist",
  label: "Red List assessment",
  homepage: "https://www.iucnredlist.org",

  async fetch({ assessmentId, signal }: SourceQuery): Promise<SourceResult> {
    if (!assessmentId) {
      return {
        status: "ok",
        works: [],
        upstreamTotal: 0,
        note: "No assessment to take references from",
      };
    }

    const apiKey = process.env.RED_LIST_API_KEY;
    if (!apiKey) return unconfigured("RED_LIST_API_KEY");

    try {
      const data = await fetchJson<RedListAssessment>(
        `https://api.iucnredlist.org/api/v4/assessment/${encodeURIComponent(assessmentId)}`,
        { signal, headers: { Authorization: apiKey } },
      );
      const references = data.references ?? [];
      const works = references
        .map((reference, index) => toWork(reference, index, assessmentId, data.url ?? null))
        .filter((w): w is LiteratureWork => w !== null);
      return { status: "ok", works, upstreamTotal: references.length, note: null };
    } catch (error) {
      return failed(error);
    }
  },
};

function toWork(
  raw: RedListReference,
  index: number,
  assessmentId: string,
  assessmentUrl: string | null,
): LiteratureWork | null {
  // Some references carry only a formatted citation, with no separate title.
  const title = stripMarkup(raw.title) ?? stripMarkup(raw.citation);
  if (!title) return null;

  const parsed = parseDate(raw.year);
  const citation = stripMarkup(raw.citation);

  return {
    key: `redlist:${assessmentId}:${index}`,
    title,
    // References carry no link of their own; point at the assessment that cites
    // them, which is where a reader would go to see it in context.
    url: assessmentUrl ?? `https://www.iucnredlist.org/search?query=${encodeURIComponent(title)}`,
    doi: null,
    date: parsed?.date ?? null,
    datePrecision: parsed?.precision ?? null,
    year: parsed?.year ?? null,
    sortStamp: toSortStamp(parsed?.date ?? null, parsed?.precision ?? null),
    authors: formatAuthors([raw.author]),
    // The Red List does not break the citation into a venue.
    venue: null,
    citations: null,
    type: "other",
    openAccessUrl: null,
    // The full formatted citation is the most useful thing to show on expand.
    abstract: citation && citation !== title ? citation : null,
    sources: [{ id: "redlist", label: "Red List assessment", url: assessmentUrl }],
  };
}
