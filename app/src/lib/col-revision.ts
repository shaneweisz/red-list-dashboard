/**
 * The "possible taxonomic revision" vocabulary — one place for the signals the
 * dashboard flags on an assessed species, and everything the UI says about them.
 *
 * Two independent signals live on one flag:
 *
 *  1. `reason` — this species has no clean 1:1 Catalogue of Life match, and why
 *     (emitted by classifyNoMatch, lib/data/col-breakdown.ts).
 *  2. `splitInto` — Catalogue of Life now recognises species that were likely
 *     split out of this one. Its CoL match is usually clean; the revision is
 *     that CoL has carved new species off it.
 *
 * They are near-disjoint in practice (151 of ~9.7k flagged species carry both),
 * but they ARE independent, so the filter chart's bars do not partition the
 * flagged set — a species with both counts toward two bars, the same way the
 * Criteria and Habitat charts already work.
 *
 * Two surfaces read the wording:
 *  - the SSC-group view's per-group "No 1:1 CoL Match" panel (TaxaSummary.tsx),
 *    which shows the explanation in a narrow table cell, beside a column that
 *    already names the species (it has its own, separate split display);
 *  - the main assessed dashboard's "Possible Taxonomic Revision" filter chart +
 *    per-row flag (RedListView.tsx), where the explanation stands alone in a
 *    tooltip and so has to name the species itself.
 *
 * Hence noMatchSentence's `subject`: one switch, one set of verbs and nouns, two
 * framings — rather than two independently-drifting sets of wording.
 */

/** The "split" pseudo-reason: not a no-match reason (those come from
 *  classifyNoMatch), but it sits alongside them as a bar and a filter value. */
export const SPLIT_REASON = "split";

/** Reason codes, in the order the filter chart lists them: most likely to
 *  reflect a real taxonomic revision first, bookkeeping gaps last. */
export const REVISION_REASONS = [
  SPLIT_REASON,
  "lumped",
  "synonym_of",
  "infraspecific",
  "not_in_base",
  "provisional",
  "extinct_unconfirmed",
  "no_link",
  "missing_from_backbone",
  "classified_elsewhere",
] as const;

export type RevisionReasonCode = (typeof REVISION_REASONS)[number];

/** Short label for a chart axis / filter chip. Kept to a couple of words —
 *  the sentence below is what a tooltip or table cell shows. */
export const REVISION_REASON_SHORT: Record<string, string> = {
  split: "Split",
  lumped: "Lumped",
  synonym_of: "Renamed",
  infraspecific: "Subspecies",
  not_in_base: "Not in checklist",
  provisional: "Provisional",
  extinct_unconfirmed: "Extinct flag",
  no_link: "Unmatched",
  missing_from_backbone: "Dangling link",
  classified_elsewhere: "Reclassified",
};

/** One line of context for the short label, for the bar chart's own tooltip. */
export const REVISION_REASON_SUMMARY: Record<string, string> = {
  split: "Catalogue of Life recognises species likely split out of this one",
  lumped: "Catalogue of Life merges this with another assessed species",
  synonym_of: "Catalogue of Life's checklist files this name under another species",
  infraspecific: "Catalogue of Life now ranks this as a subspecies",
  not_in_base: "recognised, but not yet in Catalogue of Life's curated checklist",
  provisional: "listed by Catalogue of Life only provisionally",
  extinct_unconfirmed: "Catalogue of Life marks the name extinct; the assessment doesn't",
  no_link: "not matched to a Catalogue of Life name yet",
  missing_from_backbone: "its Catalogue of Life record no longer resolves",
  classified_elsewhere: "Catalogue of Life files it under a different group",
};

/** The per-species flag the dashboard carries on every assessed row (null when
 *  the species has neither signal — the large majority). */
export interface ColRevision {
  /** Why it has no clean 1:1 CoL match. Absent when the match IS clean and the
   *  only signal is `splitInto`. */
  reason?: string;
  /** The species it's lumped with / demoted under ("lumped"/"infraspecific"). */
  detail?: string;
  /** That species' own SIS id, when it's itself IUCN-assessed. */
  detailId?: number;
  /** The CoL id to deep-link to: the record that disagrees with the assessment,
   *  or — for a split-only flag — this species' own CoL record. */
  colId?: string;
  /** The CoL record for `detail`, so that name can link to CoL as well. */
  detailColId?: string;
  /** CoL's own accepted name for that col_id, when it's neither this species
   *  nor `detail` (i.e. the two were merged under some third name). */
  colName?: string;
  /** Species CoL now recognises that were likely split out of this one, each
   *  with its own CoL record. Never empty when present. */
  splitInto?: { name: string; colId?: string }[];
}

/** Does this species carry any revision signal at all? */
export function isFlagged(flag: ColRevision | null | undefined): boolean {
  return flag != null && (flag.reason != null || (flag.splitInto?.length ?? 0) > 0);
}

/** Every reason bar this species belongs in — one per signal it carries, so a
 *  species with both a no-match reason and splits counts toward both. */
export function revisionReasons(flag: ColRevision): string[] {
  const out: string[] = [];
  if (flag.splitInto?.length) out.push(SPLIT_REASON);
  if (flag.reason != null) out.push(flag.reason);
  return out;
}

/**
 * The dashboard's filter predicate. `colMatch` is the coarse toggle
 * ("flagged"/"clean"/no filter); `reasons` narrows the flagged bucket, and
 * implies flagged on its own, so it wins when both are set.
 */
export function matchesRevisionFilter(
  flag: ColRevision | null | undefined,
  colMatch: "flagged" | "clean" | null,
  reasons: Set<string>,
): boolean {
  if (reasons.size > 0) return flag != null && revisionReasons(flag).some((r) => reasons.has(r));
  if (colMatch === "flagged") return isFlagged(flag);
  if (colMatch === "clean") return !isFlagged(flag);
  return true;
}

/**
 * Running totals behind the filter chart.
 *
 * The six no-match reasons DO partition their own set — classifyNoMatch's
 * if-else chain gives a species exactly one — but `split` is an orthogonal
 * property, so the seven bars together do not partition the flagged species.
 * Forcing them to would mean either demoting split for the ~1.5% carrying both
 * (making the Split bar disagree with the rows clicking it returns, which is the
 * worse lie) or dropping a true fact about those species.
 *
 * So the bars stay honest and the arithmetic is made explicit instead:
 * `noMatch + split - both === flagged`, asserted in the tests and surfaced under
 * the chart whenever `both` is non-zero.
 */
export interface RevisionTally {
  /** Species per signal — what each bar shows, and exactly what clicking it selects. */
  counts: Record<string, number>;
  /** Distinct species carrying at least one signal. */
  flagged: number;
  /** Species carrying neither. flagged + clean === every species tallied. */
  clean: number;
  /** Species with a no-match reason (any of the six). */
  noMatch: number;
  /** Species with at least one split-off species. */
  split: number;
  /** Species counted in BOTH noMatch and split — the overlap the bars double-count. */
  both: number;
}

export function newRevisionTally(): RevisionTally {
  return { counts: {}, flagged: 0, clean: 0, noMatch: 0, split: 0, both: 0 };
}

/** Fold one species' flag into a tally. Mutates — this runs once per species in
 *  a memo over the whole in-view list, so it deliberately allocates nothing. */
export function tallyRevision(t: RevisionTally, flag: ColRevision | null | undefined): void {
  if (!isFlagged(flag)) { t.clean++; return; }
  t.flagged++;
  const reasons = revisionReasons(flag!);
  for (const reason of reasons) t.counts[reason] = (t.counts[reason] ?? 0) + 1;
  const hasSplit = reasons.includes(SPLIT_REASON);
  const hasReason = flag!.reason != null;
  if (hasSplit) t.split++;
  if (hasReason) t.noMatch++;
  if (hasSplit && hasReason) t.both++;
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

/** The split explanation, with the split-off species kept as their own values so
 *  each can be rendered as a link to its CoL record. */
export interface SplitSentence {
  before: string;
  names: { name: string; colId?: string }[];
  after: string;
}

const COL = "Catalogue of Life";

/**
 * Plain-language "what did Catalogue of Life actually do to this species", for
 * the no-match half of the flag.
 *
 * `subject` is the species name for a standalone tooltip, or null where the
 * surrounding UI already names it (the SSC panel's table cell), which drops the
 * sentence to its verb phrase.
 */
export function noMatchSentence(flag: ColRevision, subject: string | null): NoMatchSentence {
  const s = subject ? `${subject} ` : "";
  switch (flag.reason) {
    case "lumped": {
      // The interesting sub-case is a lump under a THIRD name — both assessed
      // species merged into a CoL name that is neither of them (e.g. IUCN's
      // Epimyrma ravouxi + this one → CoL's Temnothorax ravouxi). Only ~240 of
      // the ~2.1k lumps do that, so naming it unconditionally would mostly
      // repeat `detail` back at the reader.
      const merged = flag.colName ? ` — both are now called ${flag.colName}` : "";
      return subject
        ? { before: `According to ${COL}, ${s}is the same species as `, detail: flag.detail, after: `${merged}.` }
        : { before: "Same species as ", detail: flag.detail, after: merged };
    }
    case "synonym_of":
      // NOT "not in the checklist yet" — the checklist has the name, filed as a
      // synonym of an accepted species. Usually a genus transfer IUCN hasn't
      // adopted (Sorbus minima -> Hedlundia minima).
      return subject
        ? { before: `${COL}'s checklist files ${s}as a synonym of `, detail: flag.detail, after: "." }
        : { before: "Filed as a synonym of ", detail: flag.detail, after: "" };
    case "infraspecific":
      return subject
        ? { before: `According to ${COL}, ${s}is no longer a species of its own — it is now a subspecies of `, detail: flag.detail, after: "." }
        : { before: "Now a subspecies of ", detail: flag.detail, after: "" };
    case "not_in_base":
      return subject
        ? { before: `${COL} recognises ${s}but hasn't added it to its curated checklist yet.`, after: "" }
        : { before: `Recognised, but not yet in ${COL}'s curated checklist`, after: "" };
    case "provisional":
      return subject
        ? { before: `${COL} lists ${s}only provisionally, not as a fully accepted species.`, after: "" }
        : { before: `Listed by ${COL} only provisionally`, after: "" };
    // Usually a species-boundary disagreement, not a data error: e.g. Equus ferus
    // (wild horse) — CoL treats it and Equus przewalskii as two species, one of
    // them (the true wild tarpan) extinct; this IUCN assessment lumps them as one,
    // which is why IUCN doesn't call it Extinct/Extinct in the Wild even though
    // CoL's record for this exact name is flagged extinct. Verified case by case
    // — see TaxaSummary.tsx's git history (2026-07-21) to re-check a given species.
    case "extinct_unconfirmed":
      // Deliberately "its record ... is flagged": the flag is a fact about CoL's
      // record, not about the species. Some are real boundary disagreements
      // (Equus ferus), and some are simply wrong upstream — CoL flags
      // Columba elphinstonii (a Least Concern, extant pigeon) extinct.
      return subject
        ? { before: `${COL}'s record for ${s}is flagged extinct, which this assessment's category contradicts — often a CoL data error.`, after: "" }
        : { before: `${COL}'s record is flagged extinct; this assessment's category contradicts it`, after: "" };
    case "no_link":
      return subject
        ? { before: `${s}hasn't been matched to a ${COL} name yet.`, after: "" }
        : { before: `Not yet matched to a ${COL} name`, after: "" };
    case "missing_from_backbone":
      return subject
        ? { before: `${s}links to a ${COL} record that no longer resolves.`, after: "" }
        : { before: `Links to a ${COL} record that no longer resolves`, after: "" };
    case "classified_elsewhere":
      return subject
        ? { before: `${COL} classifies ${s}under a different group here.`, after: "" }
        : { before: `${COL} classifies it under a different group here`, after: "" };
    default:
      // An unrecognised code renders as itself rather than as "undefined" — the
      // col-revision test asserts this can't happen for any shipped reason.
      return { before: flag.reason ?? "", after: "" };
  }
}

/** How many split-off names to spell out before summarising the rest. Some
 *  aggregates are extreme — Rubus fruticosus alone has 73 — and a tooltip
 *  listing all of them is unreadable. */
const MAX_SPLIT_NAMES = 3;

/**
 * The split half of the flag, in parts so each split-off species can be linked
 * to its own CoL record, or null when there is none.
 *
 * Deliberately hedged ("likely"): the underlying signal is a name-pattern
 * heuristic — CoL keeps the old subspecies name as a synonym when a subspecies
 * is promoted — not a confirmed taxonomic changelog. See SPLIT_CANDIDATES_SQL
 * in col-breakdown.ts.
 */
export function splitSentence(flag: ColRevision, subject: string): SplitSentence | null {
  const names = flag.splitInto ?? [];
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_SPLIT_NAMES);
  const rest = names.length - shown.length;
  return {
    // Leads with the consequence for THIS assessment: it was made against a
    // broader concept than CoL now uses, so part of what it covers may since
    // have been reassigned. "suggests" hedges the heuristic, "may cover" the
    // consequence.
    //
    // The count is names.length + 1 — the species itself is one of the species
    // the old concept split into, and the names listed are the OTHERS. Saying
    // "split into 3" while listing 3 names would quietly lose the parent.
    before: `${COL} suggests ${subject} has been split into ${names.length + 1} separate species`
      + ` — so this assessment may cover populations now assigned to `,
    names: shown,
    after: rest > 0 ? `, and ${rest} more.` : ".",
  };
}

/** The whole flag as plain sentences — one per signal it carries. */
export function revisionSentences(flag: ColRevision, subject: string): string[] {
  const out: string[] = [];
  if (flag.reason != null) {
    const { before, detail, after } = noMatchSentence(flag, subject);
    out.push(`${before}${detail ?? ""}${after}`);
  }
  const split = splitSentence(flag, subject);
  if (split) out.push(`${split.before}${split.names.map((n) => n.name).join(", ")}${split.after}`);
  return out;
}

/** The sentence as one plain string, for a `title`/tooltip that can't hold a link. */
export function noMatchExplanation(flag: ColRevision, subject: string | null = null): string {
  const { before, detail, after } = noMatchSentence(flag, subject);
  return `${before}${detail ?? ""}${after}`;
}

/**
 * Where the ⚑ sends you: the CoL record this flag is about — the one that
 * disagrees with the assessment, or the species' own record for a split-only
 * flag. Falls back to a CoL name search when there's no col_id at all, which is
 * the "no_link" case (there is no record to link to — that IS the finding).
 */
/** A CoL record's public page. */
export function colUrl(colId: string): string {
  return `https://www.catalogueoflife.org/data/taxon/${colId}`;
}

export function colTaxonUrl(flag: ColRevision, scientificName: string): string {
  return flag.colId
    ? colUrl(flag.colId)
    : `https://www.catalogueoflife.org/data/search?q=${encodeURIComponent(scientificName)}`;
}
