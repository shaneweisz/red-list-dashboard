/**
 * The "no clean 1:1 Catalogue of Life match" vocabulary — one place for the
 * reason codes classifyNoMatch (lib/data/col-breakdown.ts) emits and the two
 * things the UI needs to say about each one.
 *
 * Two surfaces read this:
 *  - the SSC-group view's per-group "No 1:1 CoL Match" panel (TaxaSummary.tsx),
 *    which has always shown the long explanation inline in a table cell;
 *  - the main assessed dashboard's "Possible Taxonomic Revision" filter chart +
 *    per-row flag (RedListView.tsx), which needs a short bar label as well.
 *
 * They must agree on what each reason means, so the labels live here rather
 * than beside either one.
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
 *  the long-form sentence below is what a tooltip or table cell shows. */
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

/** One line of context for the short label — what this reason is telling you,
 *  shown under the bar chart and in the flag tooltip's heading. */
export const NO_MATCH_REASON_SUMMARY: Record<string, string> = {
  lumped: "Catalogue of Life treats this as the same species as another assessed one",
  infraspecific: "Catalogue of Life ranks this as a subspecies of another species",
  not_in_base: "recognised, but not yet in Catalogue of Life's curated checklist",
  provisional: "matched only to a provisionally accepted Catalogue of Life name",
  extinct_unconfirmed: "Catalogue of Life flags the name extinct; this assessment doesn't",
  no_link: "no Catalogue of Life name has been matched to it at all",
  missing_from_backbone: "its Catalogue of Life id resolves to nothing",
  classified_elsewhere: "Catalogue of Life files it under a different group",
};

// The long-form explanation shown inline (SSC panel) or in the flag tooltip.
// Written to read as a continuation of the species name, and — for "lumped" /
// "infraspecific" — to be followed by the species it's lumped with or demoted
// under (NoMatchDetail.detail).
export const NO_MATCH_REASON_LABEL: Record<string, string> = {
  no_link: "not yet matched to any Catalogue of Life name",
  missing_from_backbone: "its Catalogue of Life match isn't in the current backbone",
  infraspecific: "Catalogue of Life doesn't recognize this as a distinct species — it's currently classified as part of",
  provisional: "matched to a Catalogue of Life name that's only provisionally accepted, not yet fully accepted",
  lumped: "Catalogue of Life treats this as the same species as",
  not_in_base: "not yet in Catalogue of Life's curated checklist",
  // Usually a species-boundary disagreement, not a data error: e.g. Equus ferus
  // (wild horse) — CoL treats it and Equus przewalskii (Przewalski's horse) as two
  // separate species, one of them (the true wild tarpan) extinct; this IUCN
  // assessment lumps them as one species, which is why IUCN doesn't call it
  // Extinct/Extinct in the Wild even though CoL's own record for this exact name
  // is flagged extinct. Verified case-by-case, not assumed — see the CoL/IUCN
  // record comparison in TaxaSummary.tsx's git history (2026-07-21) if this needs
  // re-checking for a different species.
  extinct_unconfirmed: "Catalogue of Life's record for this exact name is flagged extinct, but this IUCN assessment (a living-species category) isn't Extinct/Extinct in the Wild — usually because the two databases draw the species boundary differently here (e.g. IUCN's assessment covers a broader concept that includes a still-living population Catalogue of Life treats as its own separate species)",
  classified_elsewhere: "Catalogue of Life classifies this under a different name here",
};

/** The per-species flag the dashboard carries on every assessed row (null when
 *  the species has a clean 1:1 match — the overwhelming majority). */
export interface ColNoMatch {
  reason: string;
  /** The species it's lumped with / demoted under ("lumped"/"infraspecific"). */
  detail?: string;
  /** That species' own SIS id, when it's itself IUCN-assessed. */
  detailId?: number;
}

/** Full sentence for a flag tooltip: the long-form reason plus, where there is
 *  one, the species it points at. */
export function noMatchExplanation(flag: ColNoMatch): string {
  const base = NO_MATCH_REASON_LABEL[flag.reason] ?? flag.reason;
  return flag.detail ? `${base} ${flag.detail}` : base;
}
