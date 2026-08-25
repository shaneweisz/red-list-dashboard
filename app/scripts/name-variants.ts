/**
 * Orthographic name variants: when do two spellings name the same species?
 *
 * The Red List and Catalogue of Life routinely publish the same species under
 * spellings that differ only in a Latin termination:
 *
 *   Ochotona pallasii    / Ochotona pallasi        (patronymic -ii vs -i)
 *   Sminthopsis fuliginosa / Sminthopsis fuliginosus (gender agreement)
 *   Allium lefkadensis   / Allium lefkadense       (third-declension gender)
 *   Acacia verricula     / Acacia verriculum
 *
 * Both codes treat these as the SAME name rather than as competing ones — ICZN
 * Art. 58 (species-group names differing only in specified terminations are
 * deemed identical) and ICN Art. 53.3 (names differing only in termination are
 * treated as homonyms, i.e. one name). So equating them is what the codes
 * prescribe, not a fuzzy-matching liberty.
 *
 * ── How this is used, and why that makes it safe ──────────────────────────
 *
 * NEVER as a lookup. build-matching does not search the backbone for names that
 * normalise alike — that would let a congener with a coincidentally similar
 * epithet claim an assessment, which is the failure mode that starves species of
 * their occurrence data.
 *
 * Only as a CHECK on a candidate someone else proposed. GBIF's occurrence index
 * is built on Catalogue of Life's extended release, so a Red List species'
 * `gbif_species_key` IS a CoL id — already resolved, by GBIF's own matcher,
 * against the same checklist we are trying to join to. `sameSpeciesName` asks
 * one question about that specific candidate: is the name it points at the same
 * name we started from? One id in, one yes/no out. There is no search space for
 * a collision to hide in.
 *
 * Deliberately NOT handled, because each needs evidence this check doesn't have:
 *  - doubled consonants (Aframomum elliotii / elliottii, Annesorhiza burttii /
 *    burtii) — a correction of a misspelling, not a termination;
 *  - patronymic gender (Acrogomphus walshi / walshae) — legitimate under ICZN
 *    Art. 31.1.3, but -i/-ae is a bigger step than a termination and wants the
 *    original description to confirm it;
 *  - -er/-ra/-rum (ruber/rubra) — a real gender triple, but stripping "er" also
 *    strips the tail of ordinary epithets, so it needs its own stem test.
 * Those stay unmatched rather than being guessed at.
 */

/**
 * Terminations the codes deem variants of one another: the Latin gender triple
 * (-us / -um / -a), the third-declension pair (-is / -e), and the Greek pair
 * (-os / -on). Two-letter endings are listed first so a longer one is never
 * missed because a shorter suffix of it matched.
 *
 * "-ae" is absent on purpose. It would pair with "-a", which is not a gender
 * variant of it, and it is the ending that would quietly enable the -i/-ae
 * patronymic gender change this check declines to make.
 */
const GENDER_TERMINATIONS = ["us", "um", "is", "os", "on", "a", "e"];

/**
 * One species name → [genus, epithet], lowercased, with the notation that
 * carries no nomenclatural weight removed:
 *  - a parenthesised subgenus, which CoL prints and the Red List doesn't
 *    ("Ochotona (Pika) pallasi" → "ochotona pallasi");
 *  - the hybrid sign, which marks a nothospecies rather than changing the name
 *    ("Agave × peacockii" → "agave peacockii"). Only the Unicode × is stripped:
 *    a bare ASCII "x" is a normal letter and removing it would corrupt epithets.
 *
 * Returns null for anything that isn't a binomial — a monomial, or a trinomial
 * (a subspecies is a different rank, and this is only ever asked about species).
 */
export function speciesNameParts(name: string): [genus: string, epithet: string] | null {
  const tokens = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/×/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length !== 2) return null;
  return [tokens[0], tokens[1]];
}

/**
 * An epithet reduced to the stem the codes compare on: doubled terminal "i"
 * collapsed (pallasii → pallasi), then one gender termination removed
 * (fuliginosus / fuliginosa → fuligino).
 *
 * Order matters. The "i" collapse runs first so that a patronym keeps its "i"
 * and is not then read as a gender ending; "i" is deliberately absent from
 * GENDER_TERMINATIONS for the same reason.
 *
 * A termination is only removed when something is left behind — "Ovis ovis"-style
 * short epithets must not normalise to the empty string, which would make every
 * one of them equal to every other.
 */
export function canonicalEpithet(epithet: string): string {
  const collapsed = epithet.replace(/i{2,}$/, "i");
  for (const t of GENDER_TERMINATIONS) {
    if (collapsed.endsWith(t) && collapsed.length > t.length + 1) {
      return collapsed.slice(0, -t.length);
    }
  }
  return collapsed;
}

/**
 * Do these two binomials name the same species, allowing only the termination
 * differences the codes deem identical?
 *
 * The genus must match exactly. A differing genus is a real taxonomic act — a
 * transfer, as in Agrochola kindermannii → Anchoscelis kindermanni — and belongs
 * to the synonym passes of the matching ladder, which have evidence for it. This
 * check has none, so it declines.
 */
export function sameSpeciesName(a: string, b: string): boolean {
  const left = speciesNameParts(a);
  const right = speciesNameParts(b);
  if (!left || !right) return false;
  if (left[0] !== right[0]) return false;
  if (left[1] === right[1]) return true;
  return canonicalEpithet(left[1]) === canonicalEpithet(right[1]);
}
