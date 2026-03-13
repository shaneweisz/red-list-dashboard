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

  return names.filter(Boolean);
}
