/**
 * The taxonomic-difference vocabulary — one place for the signals the
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
 *  - the main assessed dashboard's "Taxonomic differences from Catalogue of
 *    Life" filter chart + per-row flag (RedListView.tsx), where the explanation
 *    stands alone in a tooltip and so has to name the species itself.
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
  "no_link",
  "missing_from_backbone",
  "classified_elsewhere",
] as const;

/**
 * Diagnosed by classifyNoMatch but deliberately NOT flagged on the dashboard.
 *
 * "extinct_unconfirmed" means CoL's record for the name is flagged extinct
 * while the IUCN category isn't EX/EW. Two things disqualify it from a card
 * about taxonomic differences:
 *
 *  - It isn't a taxonomic difference. It is a disagreement about whether the
 *    species still exists, which is a data-quality observation about CoL.
 *  - It is mostly wrong. Of the 60 it caught, 25 were Least Concern or Near
 *    Threatened — species that by definition are not extinct — and 14 of those
 *    were Columba, where CoL flags 16 of the genus's 35 accepted species
 *    extinct, including the common and abundant C. arquatrix and C. elphinstonii.
 *    That is one contaminated upstream block, not a signal.
 *
 * The reason still exists and the SSC group view still reports it: there it
 * sits in a panel explicitly about CoL-match diagnostics, which is the right
 * home for "CoL says something odd here".
 *
 * Worth knowing separately: a false extinct flag also drops the species from
 * col_described, since the extant universe is `extinct IS NOT TRUE OR IUCN says
 * EX/EW`. 103 assessed species are excluded that way — a real undercount that
 * predates this feature and wants its own fix.
 */
export const UNFLAGGED_REASONS = ["extinct_unconfirmed"] as const;

export type RevisionReasonCode = (typeof REVISION_REASONS)[number];

/** Short label for a chart axis / filter chip. Kept to a couple of words —
 *  the sentence below is what a tooltip or table cell shows. */
export const REVISION_REASON_SHORT: Record<string, string> = {
  // These two, alone among the labels, name an action rather than a state, so
  // bare they leave the agent open — a reader can as easily hear "the Red List
  // split this" as "CoL did". The card title names Catalogue of Life, but a
  // filter chip carries the label away from the title, so it has to stand up
  // by itself. The other five are already unmistakably CoL's vocabulary
  // ("In XR, not Base", "Provisionally accepted") and don't need the suffix —
  // and the y-axis is 130px, so spending it where it isn't needed costs a
  // second line.
  split: "Split on CoL",
  lumped: "Lumped on CoL",
  // Not "Renamed": two thirds are genus transfers, which a rename describes
  // well, but the rest are synonymies onto a different species (Dalbergia
  // campenonii -> D. emirnensis), where nothing was renamed. "Different name"
  // covers both, and summarises the sentence — CoL's accepted name is not the
  // one this assessment was published under.
  synonym_of: "Different name",
  // Not "Subspecies" (reads as a count of subspecies) and not "Demoted"
  // (accurate, but nobody says it) — the label mirrors the sentence.
  infraspecific: "Now a subspecies",
  // CoL's own two products, named as CoL names them. "Not in checklist" invited
  // the reading that CoL has nothing at all, when the record is in XR.
  not_in_base: "In XR, not Base",
  // CoL's exact status wording, which the sentence now quotes.
  provisional: "Provisionally accepted",
  // "Unmatched" left open what it failed to match. This is also what the SSC
  // group view has always called it ("No 1:1 CoL Match").
  no_link: "No CoL match",
  // Diagnosed but not a dashboard bar (UNFLAGGED_REASONS); the SSC panel uses it.
  extinct_unconfirmed: "Extinct flag",
  missing_from_backbone: "Dangling link",
  classified_elsewhere: "Reclassified",
};

/** One line of context for the short label, for the bar chart's own tooltip. */
export const REVISION_REASON_SUMMARY: Record<string, string> = {
  split: "Catalogue of Life recognises species likely split out of this one",
  lumped: "Catalogue of Life merges this with another assessed species",
  synonym_of: "Catalogue of Life's checklist files this name under another species",
  infraspecific: "Catalogue of Life now ranks this as a subspecies",
  not_in_base: "in Catalogue of Life's extended release only, not its curated checklist",
  provisional: "listed by Catalogue of Life only provisionally",
  extinct_unconfirmed: "Catalogue of Life marks the name extinct; the assessment doesn't",
  no_link: "not matched to a Catalogue of Life name yet",
  missing_from_backbone: "its Catalogue of Life record no longer resolves",
  classified_elsewhere: "Catalogue of Life files it under a different group",
};

/**
 * The standing caveat, shown on the chart and in every flag tooltip.
 *
 * This feature reports what Catalogue of Life says, and CoL is demonstrably
 * wrong sometimes — it recognises two Dasycercus species where the 2023
 * revision, the Mammal Diversity Database and IUCN itself all recognise six,
 * and it flags Columba arquatrix extinct. A reader who takes a flag as a
 * correction to an assessment has misread it, so the UI says so rather than
 * relying on them to infer it.
 */
export const REVISION_CAVEAT =
  "Flagged for information only — Catalogue of Life can be out of date or incorrect.";

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
  /** The OTHER IUCN assessments filed under the same CoL record — the whole
   *  lump group, of which `detail` names only the one that won the tie-break.
   *  Each carries its own synonym record under the shared species (the
   *  checkable evidence, present for ~62%) and its IUCN category, which is
   *  where the awkwardness shows: one CoL species assessed both EX and LC. */
  lumpedWith?: { name: string; colId?: string; category?: string }[];
  /** CoL's accepted name for the shared record — what the group is filed under. */
  lumpedUnder?: string;
  /** Species CoL now recognises that were likely split out of this one, each
   *  with its own CoL record and — as the evidence for the split — the old
   *  infraspecific name that now resolves to it ("Vallonia costata var. montana
   *  Sterki, 1893"). Never empty when present. */
  splitInto?: SplitEntry[];
}

/** Does this species carry any revision signal at all? */
export function isFlagged(flag: ColRevision | null | undefined): boolean {
  return flag != null && (flag.reason != null || (flag.splitInto?.length ?? 0) > 0 || (flag.lumpedWith?.length ?? 0) > 0);
}

/**
 * Every bar this species belongs in — one per signal it carries, so a species
 * with more than one counts toward each.
 *
 * Three independent signals: it has been split, it shares a CoL record with
 * other assessments (lumped), and it has no clean 1:1 match for some other
 * reason. Lumping is derived from the group rather than from `reason` on
 * purpose: EVERY assessment sharing the record is equally affected, and which
 * one the classifier happens to call "lumped" is an accepted-name tie-break, not
 * a fact about the taxonomy — CoL's 347N2 is both Dasycercus cristicauda (EX)
 * and Dasycercus hillieri (LC), and neither assessment is the odd one out.
 */
export function revisionReasons(flag: ColRevision): string[] {
  const out: string[] = [];
  if (flag.splitInto?.length) out.push(SPLIT_REASON);
  // Either source counts: the group (what the dashboard ships) or the
  // classifier's own label (what the SSC panel's data carries, and what an
  // artifact built before the group was collected would have). Without the
  // fallback such a flag would be flagged but sit in no bar, so nothing could
  // select it.
  if (flag.lumpedWith?.length || flag.reason === "lumped") out.push("lumped");
  if (flag.reason != null && flag.reason !== "lumped") out.push(flag.reason);
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
 * The no-match reasons partition their own set — classifyNoMatch gives a species
 * exactly one — but split and lumped are orthogonal properties, so the bars
 * together do not partition the flagged species. Forcing them to would mean
 * making a bar disagree with the rows clicking it returns, or dropping a true
 * fact about a species. So the bars stay honest and the overlap is stated under
 * the chart instead.
 */
export interface RevisionTally {
  /** Species per signal — what each bar shows, and exactly what clicking it selects. */
  counts: Record<string, number>;
  /** Distinct species carrying at least one signal. */
  flagged: number;
  /** Species carrying neither. flagged + clean === every species tallied. */
  clean: number;
  /** Species carrying more than one signal — the amount by which the bars
   *  over-total `flagged`, which is what the card explains under the chart. */
  multiSignal: number;
}

export function newRevisionTally(): RevisionTally {
  return { counts: {}, flagged: 0, clean: 0, multiSignal: 0 };
}

/** Fold one species' flag into a tally. Mutates — this runs once per species in
 *  a memo over the whole in-view list, so it deliberately allocates nothing. */
export function tallyRevision(t: RevisionTally, flag: ColRevision | null | undefined): void {
  if (!isFlagged(flag)) { t.clean++; return; }
  t.flagged++;
  const reasons = revisionReasons(flag!);
  for (const reason of reasons) t.counts[reason] = (t.counts[reason] ?? 0) + 1;
  if (reasons.length > 1) t.multiSignal++;
}

/** Total across the bars — `flagged` plus one for each extra signal carried. */
export function barTotal(t: RevisionTally): number {
  return Object.values(t.counts).reduce((a, b) => a + b, 0);
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

/** One species in a listed group — a split-off species, or another assessment
 *  sharing a lumped record. */
export interface SplitEntry {
  name: string;
  colId?: string;
  /** The old infraspecific name that now resolves here — the evidence. */
  previousName?: string;
  previousColId?: string;
  /** IUCN category, shown for lump-group members. */
  category?: string;
}

/**
 * The split explanation as a list, so every name in it can be a link to its own
 * CoL record — both the species and the old name behind it. Showing the old name
 * is what makes the inference checkable: CoL's site has no view of "names that
 * used to sit under this species and now resolve elsewhere", so without it a
 * reader has to reconstruct the derivation (see SPLIT_CANDIDATES_SQL's worked
 * example).
 */
export interface SplitSummary {
  lead: string;
  /** Every species split out of this one — not capped. The tooltip scrolls
   *  instead, so a long tail (Rubus fruticosus has 73) stays readable without
   *  the list quietly standing in for names it doesn't show. */
  entries: SplitEntry[];
}

const COL = "Catalogue of Life";

/**
 * Plain-language "what did Catalogue of Life actually do to this species, and
 * what does that mean for this assessment", for the no-match half of the flag.
 *
 * Each standalone sentence carries both halves, matching the split and lump
 * ones: the finding, then what follows from it. Stating only the finding left a
 * reader to work out why it mattered, which is the whole job of a flag.
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
        ? { before: `This assessment is published under ${subject}, but according to ${COL} the accepted name for this species is `, detail: flag.detail, after: "." }
        : { before: "Filed as a synonym of ", detail: flag.detail, after: "" };
    case "infraspecific":
      return subject
        ? { before: `${COL} ranks ${s}as a subspecies of `, detail: flag.detail, after: ", so this assessment covers what it treats as part of another species." }
        : { before: "Now a subspecies of ", detail: flag.detail, after: "" };
    // Deliberately NOT "hasn't added it yet": that implies a backlog the
    // checklist is working through, and for most of these it isn't true. Only
    // ~10% were described since 2015 and 39% are pre-1950, and 80% sit in a genus
    // the curated checklist covers thoroughly (Euphorbia has 2,113 accepted
    // species in it, but not Euphorbia ankarensis) — so the checklist knows the
    // group and has not adopted the name. What IS true is where the record comes
    // from, so say that instead.
    case "not_in_base":
      return subject
        ? { before: `${COL}'s curated checklist doesn't accept ${subject}, so the name survives only in its extended release.`, after: "" }
        : { before: `In ${COL}'s extended release only, not its curated checklist`, after: "" };
    case "provisional":
      return subject
        // Quoting CoL's own two status values rather than paraphrasing them: the
        // distinction between them IS the finding, and a reader who goes to look
        // will see those exact words on the page.
        ? { before: `${COL} currently lists ${subject} as a 'provisionally accepted species', not yet an 'accepted species'.`, after: "" }
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
        ? { before: `${COL} marks ${s}extinct and this assessment doesn't, so one of them is wrong about whether it survives.`, after: "" }
        : { before: `${COL}'s record is flagged extinct; this assessment's category contradicts it`, after: "" };
    case "no_link":
      return subject
        ? { before: `No ${COL} name matches ${subject}, so there is nothing there to check this assessment against.`, after: "" }
        : { before: `Not yet matched to a ${COL} name`, after: "" };
    case "missing_from_backbone":
      return subject
        ? { before: `${s}links to a ${COL} record that no longer resolves, so the match needs redoing.`, after: "" }
        : { before: `Links to a ${COL} record that no longer resolves`, after: "" };
    case "classified_elsewhere":
      return subject
        ? { before: `${COL} files ${s}under a different group, so it won't appear where this assessment places it.`, after: "" }
        : { before: `${COL} classifies it under a different group here`, after: "" };
    default:
      // An unrecognised code renders as itself rather than as "undefined" — the
      // col-revision test asserts this can't happen for any shipped reason.
      return { before: flag.reason ?? "", after: "" };
  }
}

/**
 * The split half of the flag, in parts so each split-off species can be linked
 * to its own CoL record, or null when there is none.
 *
 * Deliberately hedged ("likely"): the underlying signal is a name-pattern
 * heuristic — CoL keeps the old subspecies name as a synonym when a subspecies
 * is promoted — not a confirmed taxonomic changelog. See SPLIT_CANDIDATES_SQL
 * in col-breakdown.ts.
 */
export function splitSummary(flag: ColRevision, subject: string): SplitSummary | null {
  const names = flag.splitInto ?? [];
  if (names.length === 0) return null;
  // The species itself is one of the species the old concept split into, so the
  // count is names.length + 1 even though only the OTHERS are listed — which is
  // what "the other species" / "the others" is doing at the end of the lead.
  const total = names.length + 1;
  return {
    lead: `${COL} suggests ${subject} has been split into ${total} separate species`
      + `, so this assessment may cover populations now assigned to `
      + (names.length === 1 ? "the other species:" : "the others:"),
    entries: names,
  };
}

/** The lump explanation. One sentence, with the assessments kept as their own
 *  values so each can be a link to its CoL record. */
export interface LumpSentence {
  before: string;
  /** Every assessment CoL files under one species, this one first. */
  members: { name: string; colId?: string; category?: string }[];
  mid: string;
  /** CoL's name for the merged species — its own part, so it can be a link. */
  under?: { name: string; colId?: string };
  after: string;
}

/**
 * The lump half of the flag: IUCN assesses several species that CoL files as
 * one. Reads as a single sentence rather than a list, because the finding is one
 * fact — these are the same species to CoL — and the IUCN categories carry it:
 * "Dasycercus cristicauda (EX) and Dasycercus hillieri (LC)" is the whole
 * problem in one line.
 *
 * The subject is included, first, since the sentence is about the group and it
 * is one of them. Returns null when the group isn't known (an older artifact, or
 * the SSC panel's data, which carries only the tie-break winner) — callers fall
 * back to noMatchSentence.
 */
export function lumpSentence(
  flag: ColRevision,
  subject: string,
  subjectCategory?: string,
): LumpSentence | null {
  const others = flag.lumpedWith ?? [];
  if (others.length === 0) return null;
  return {
    before: `${COL} treats `,
    members: [
      { name: subject, colId: flag.colId, ...(subjectCategory ? { category: subjectCategory } : {}) },
      // A member with no synonym record of its own — typically CoL's accepted
      // name — links to the shared record, which IS its record.
      ...others.map((o) => (o.colId ? o : { ...o, colId: flag.colId })),
    ],
    mid: " as a single species",
    // Named even when it repeats one of the members: the first mention is "an
    // assessment", this one is "what CoL calls the merged species".
    ...(flag.lumpedUnder ? { under: { name: flag.lumpedUnder, colId: flag.colId } } : {}),
    after: ".",
  };
}

/** The lump sentence as one plain string, for a context that can't hold links. */
export function flattenLump(l: LumpSentence | null): string | null {
  if (!l) return null;
  const parts = l.members.map((m) => (m.category ? `${m.name} (${m.category})` : m.name));
  const joined = parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : parts[0];
  return `${l.before}${joined}${l.mid}${l.under ? `, ${l.under.name}` : ""}${l.after}`;
}

/** The summary flattened to one plain string, for a context that can't hold links. */
export function splitSentence(flag: ColRevision, subject: string): string | null {
  return flattenSummary(splitSummary(flag, subject));
}

/** A list summary as one plain string, for a context that can't hold links. */
export function flattenSummary(s: SplitSummary | null): string | null {
  if (!s) return null;
  const listed = s.entries.map((e) =>
    e.previousName ? `${e.name} (previously ${e.previousName})`
      : e.category ? `${e.name} (${e.category})`
      : e.name);
  return `${s.lead} ${listed.join("; ")}.`;
}

/** The whole flag as plain sentences — one per signal it carries. */
export function revisionSentences(flag: ColRevision, subject: string): string[] {
  const out: string[] = [];
  const lump = flattenLump(lumpSentence(flag, subject));
  if (lump) out.push(lump);
  else if (flag.reason != null) {
    const { before, detail, after } = noMatchSentence(flag, subject);
    out.push(`${before}${detail ?? ""}${after}`);
  }
  const split = splitSentence(flag, subject);
  if (split) out.push(split);
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

/** A source dataset's page on CoL — where a record came from. */
export function colDatasetUrl(key: number): string {
  return `https://www.catalogueoflife.org/data/dataset/${key}`;
}

export function colTaxonUrl(flag: ColRevision, scientificName: string): string {
  return flag.colId
    ? colUrl(flag.colId)
    : `https://www.catalogueoflife.org/data/search?q=${encodeURIComponent(scientificName)}`;
}
