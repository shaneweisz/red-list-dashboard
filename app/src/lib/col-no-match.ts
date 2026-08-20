/**
 * The "no clean 1:1 Catalogue of Life match" vocabulary — one place for the
 * reason codes classifyNoMatch (lib/data/col-breakdown.ts) emits and everything
 * the UI says about them.
 *
 * Two surfaces read this:
 *  - the SSC-group view's per-group "No 1:1 CoL Match" panel (TaxaSummary.tsx),
 *    which shows the explanation in a narrow table cell, beside a column that
 *    already names the species;
 *  - the main assessed dashboard's "Possible Taxonomic Revision" filter chart +
 *    per-row flag (RedListView.tsx), where the explanation stands alone in a
 *    tooltip and so has to name the species itself.
 *
 * Hence noMatchSentence's `subject`: one switch, one set of verbs and nouns, two
 * framings — rather than two independently-drifting sets of wording.
 */

/** Reason codes, in the order the filter chart lists them: most likely to
 *  reflect a real taxonomic revision first, bookkeeping gaps last. */
export const NO_MATCH_REASONS = [
  "lumped",
  "infraspecific",
  "not_in_base",
  "provisional",
  "extinct_unconfirmed",
  "no_link",
  "missing_from_backbone",
  "classified_elsewhere",
] as const;

export type NoMatchReasonCode = (typeof NO_MATCH_REASONS)[number];

/** Short label for a chart axis / filter chip. Kept to a couple of words —
 *  the sentence below is what a tooltip or table cell shows. */
export const NO_MATCH_REASON_SHORT: Record<string, string> = {
  lumped: "Lumped",
  infraspecific: "Subspecies",
  not_in_base: "Not in checklist",
  provisional: "Provisional",
  extinct_unconfirmed: "Extinct flag",
  no_link: "Unmatched",
  missing_from_backbone: "Dangling link",
  classified_elsewhere: "Reclassified",
};

/** One line of context for the short label, for the bar chart's own tooltip. */
export const NO_MATCH_REASON_SUMMARY: Record<string, string> = {
  lumped: "Catalogue of Life merges this with another assessed species",
  infraspecific: "Catalogue of Life now ranks this as a subspecies",
  not_in_base: "recognised, but not yet in Catalogue of Life's curated checklist",
  provisional: "listed by Catalogue of Life only provisionally",
  extinct_unconfirmed: "Catalogue of Life marks the name extinct; the assessment doesn't",
  no_link: "not matched to a Catalogue of Life name yet",
  missing_from_backbone: "its Catalogue of Life record no longer resolves",
  classified_elsewhere: "Catalogue of Life files it under a different group",
};

/** The per-species flag the dashboard carries on every assessed row (null when
 *  the species has a clean 1:1 match — the overwhelming majority). */
export interface ColNoMatch {
  reason: string;
  /** The species it's lumped with / demoted under ("lumped"/"infraspecific"). */
  detail?: string;
  /** That species' own SIS id, when it's itself IUCN-assessed. */
  detailId?: number;
  /** The CoL id this assessment links to — what the ⚑ deep-links to. */
  colId?: string;
  /** CoL's own accepted name for that col_id, when it's neither this species
   *  nor `detail` (i.e. the two were merged under some third name). */
  colName?: string;
}

/**
 * The explanation split into parts, so the SAME wording serves a plain-text
 * tooltip and a rendering where `detail` is a link to that species. `detail` is
 * the only part that is ever a species the app can link to.
 */
export interface NoMatchSentence {
  before: string;
  detail?: string;
  after: string;
}

/**
 * Plain-language "what did Catalogue of Life actually do to this species".
 *
 * `subject` is the species name for a standalone tooltip, or null where the
 * surrounding UI already names it (the SSC panel's table cell), which drops the
 * sentence to its verb phrase.
 */
export function noMatchSentence(flag: ColNoMatch, subject: string | null): NoMatchSentence {
  const s = subject ? `${subject} ` : "";
  const col = "Catalogue of Life";
  switch (flag.reason) {
    case "lumped": {
      // The interesting sub-case is a lump under a THIRD name — both assessed
      // species merged into a CoL name that is neither of them (e.g. IUCN's
      // Epimyrma ravouxi + this one → CoL's Temnothorax ravouxi). Only 241 of
      // the ~2.1k lumps do that, so naming it unconditionally would mostly
      // repeat `detail` back at the reader.
      const merged = flag.colName ? ` — both are now called ${flag.colName}` : "";
      return subject
        ? { before: `According to ${col}, ${s}is the same species as `, detail: flag.detail, after: `${merged}.` }
        : { before: "Same species as ", detail: flag.detail, after: merged };
    }
    case "infraspecific":
      return subject
        ? { before: `According to ${col}, ${s}is no longer a species of its own — it is now a subspecies of `, detail: flag.detail, after: "." }
        : { before: "Now a subspecies of ", detail: flag.detail, after: "" };
    case "not_in_base":
      return subject
        ? { before: `${col} recognises ${s}but hasn't added it to its curated checklist yet.`, after: "" }
        : { before: `Recognised, but not yet in ${col}'s curated checklist`, after: "" };
    case "provisional":
      return subject
        ? { before: `${col} lists ${s}only provisionally, not as a fully accepted species.`, after: "" }
        : { before: `Listed by ${col} only provisionally`, after: "" };
    // Usually a species-boundary disagreement, not a data error: e.g. Equus ferus
    // (wild horse) — CoL treats it and Equus przewalskii as two species, one of
    // them (the true wild tarpan) extinct; this IUCN assessment lumps them as one,
    // which is why IUCN doesn't call it Extinct/Extinct in the Wild even though
    // CoL's record for this exact name is flagged extinct. Verified case by case
    // — see TaxaSummary.tsx's git history (2026-07-21) to re-check a given species.
    case "extinct_unconfirmed":
      return subject
        ? { before: `${col} marks ${s}extinct, but this assessment doesn't.`, after: "" }
        : { before: `${col} marks the name extinct; this assessment doesn't`, after: "" };
    case "no_link":
      return subject
        ? { before: `${s}hasn't been matched to a ${col} name yet.`, after: "" }
        : { before: `Not yet matched to a ${col} name`, after: "" };
    case "missing_from_backbone":
      return subject
        ? { before: `${s}links to a ${col} record that no longer resolves.`, after: "" }
        : { before: `Links to a ${col} record that no longer resolves`, after: "" };
    case "classified_elsewhere":
      return subject
        ? { before: `${col} classifies ${s}under a different group here.`, after: "" }
        : { before: `${col} classifies it under a different group here`, after: "" };
    default:
      // An unrecognised code renders as itself rather than as "undefined" — the
      // col-no-match test asserts this can't happen for any shipped reason.
      return { before: flag.reason, after: "" };
  }
}

/** The sentence as one plain string, for a `title`/tooltip that can't hold a link. */
export function noMatchExplanation(flag: ColNoMatch, subject: string | null = null): string {
  const { before, detail, after } = noMatchSentence(flag, subject);
  return `${before}${detail ?? ""}${after}`;
}

/**
 * Where the ⚑ sends you: the CoL record that disagrees with this assessment.
 * Falls back to a CoL name search for "no_link", the one reason with no col_id
 * (there is no record to link to — that IS the finding).
 */
export function colTaxonUrl(flag: ColNoMatch, scientificName: string): string {
  return flag.colId
    ? `https://www.catalogueoflife.org/data/taxon/${flag.colId}`
    : `https://www.catalogueoflife.org/data/search?q=${encodeURIComponent(scientificName)}`;
}
