/**
 * Parse an IUCN assessors/reviewers string into individual names.
 *
 * Format: names are "Lastname, Initials" (e.g. "Smith, J.A.") with optional
 * parenthetical affiliations like "(Chiroptera Red List Authority)".
 *
 * Names are separated by:
 *   - " & " (ampersand)
 *   - ", " followed by an uppercase letter that starts a new last name
 *     (but NOT ", " that introduces initials like ", J.")
 *
 * The heuristic: after a ", ", if the next non-space char is uppercase and
 * the preceding token looks like initials (ends with "." or ")"), it's a
 * new name. Otherwise it's initials belonging to the current name.
 */
/**
 * Known duplicate name mappings: variant → canonical form.
 * "Cox, N." and "Cox, N.A." refer to the same person (Neil Cox).
 */
const CANONICAL_NAMES: Record<string, string> = {
  "Cox, N.": "Cox, N.A.",
};

export function parseAssessors(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];

  // First split on " & "
  const ampersandParts = raw.split(" & ");
  const names: string[] = [];

  for (const part of ampersandParts) {
    // Now we need to split on ", " that separates names (not initials).
    // Strategy: split on ", " then reassemble "Lastname" + ", " + "Initials" pairs.
    const segments = part.split(", ");

    let current = segments[0];
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      // Does this segment look like initials/affiliation belonging to current name?
      // Initials: start with uppercase, are short (≤4 chars without parens), contain dots
      // OR it starts with a '(' (affiliation)
      const isInitialsOrAffiliation =
        seg.startsWith("(") ||
        /^[A-Z]\./.test(seg) ||  // "J." or "J.A." etc.
        /^[A-Z]$/.test(seg);     // single letter like "A"

      if (isInitialsOrAffiliation) {
        // This is part of the current name
        current += ", " + seg;
      } else {
        // This starts a new name — push current and start fresh
        names.push(current.trim());
        current = seg;
      }
    }
    if (current.trim()) {
      names.push(current.trim());
    }
  }

  return names.filter(Boolean).map(n => CANONICAL_NAMES[n] ?? n);
}

/**
 * Parse an Institutions credit line into individual organisations.
 *
 * These are organisation names, not "Lastname, Initials" — parseAssessors'
 * comma heuristic would cut "Royal Botanic Gardens, Kew" in half, and a name
 * like "Centro Nacional de Conservação da Flora (CNCFlora)" has none of the
 * shape it looks for. Only " & " actually separates two institutions on one
 * assessment, so that is the only thing split on.
 *
 * Shared by the dashboard filter and the /browse + MCP filter so a link built
 * on one surface selects the same species on the other.
 *
 * KNOWN LIMIT: a minority of lines (33 distinct strings) separate institutions
 * with ", " instead of " & ", and those are not split — because the separator is
 * genuinely ambiguous. "Royal Botanic Gardens, Kew, Botanic Gardens Conservation
 * International" uses ", " BOTH inside an organisation name and between two of
 * them, and nothing in the string says which is which. Splitting on commas would
 * invent "Kew" as an institution on the thousands of rows that name Kew properly;
 * not splitting leaves those few as one long compound entry in the chart. The
 * filter itself is unaffected either way: it substring-matches, so searching
 * "Kew" still finds them. This is why the chart's count for an institution can
 * read slightly below the filtered species total (10,664 vs 10,704 for BGCI in
 * flowering plants) — the compound rows match the filter without being counted
 * under the bare name.
 */
export function parseInstitutions(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(" & ").map((x) => x.trim()).filter(Boolean);
}
