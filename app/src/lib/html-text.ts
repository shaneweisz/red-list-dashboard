// Helpers for turning the HTML fragments the IUCN Red List API returns in its
// narrative fields (rationale, population, habitat, ...) into plain text.

// Named entities that actually show up in IUCN narrative text. Anything not
// listed is left as-is rather than guessed at.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  middot: "·",
  bull: "•",
  dagger: "†",
  prime: "′",
  Prime: "″",
  sup2: "²",
  sup3: "³",
  frac12: "½",
  le: "≤",
  ge: "≥",
  ne: "≠",
  asymp: "≈",
  alpha: "α",
  beta: "β",
  micro: "µ",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  ntilde: "ñ",
  copy: "©",
  reg: "®",
};

// Decode HTML character references in a single pass, so that already-decoded
// text isn't decoded twice (e.g. "&amp;#160;" stays the literal "&#160;").
// Numeric references (&#160;, &#xA0;) are what the IUCN API mostly emits.
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const isHex = entity[1] === "x" || entity[1] === "X";
        const codePoint = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
        if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
        // Lone surrogates aren't valid text; leave the reference untouched.
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
        return String.fromCodePoint(codePoint);
      }
      const named = NAMED_ENTITIES[entity];
      return named ?? match;
    }
  );
}

// Strip HTML tags and decode entities from narrative text returned by the IUCN API.
export function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
  )
    // Non-breaking spaces (literal, or decoded from &#160;/&nbsp;) render as odd
    // gaps and break word wrapping — normalise them to ordinary spaces.
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Cut plain text down to at most `limit` words, preserving the whitespace
 * (paragraph breaks included) between the words that are kept. Returns the
 * text unchanged, with `truncated: false`, when it is already short enough.
 */
export function truncateWords(
  text: string,
  limit: number
): { text: string; truncated: boolean } {
  // Split keeping the separators, so a paragraph break inside the kept part
  // survives instead of collapsing to a single space.
  const parts = text.split(/(\s+)/);
  let words = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 || parts[i] === "") continue; // odd indices are separators
    words++;
    if (words > limit) {
      return { text: parts.slice(0, i).join("").trimEnd(), truncated: true };
    }
  }
  return { text, truncated: false };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Spend one shared word budget across a run of sections, in order. Sections are
 * kept whole until the budget runs out; the section that exhausts it is cut
 * (`truncated: true`) and every section after it is dropped entirely.
 *
 * The returned `truncated` says whether anything was withheld at all — either
 * the last kept section was cut, or sections below it were dropped — so the
 * caller can offer the full text in one place.
 */
export function truncateSections<T extends { text: string }>(
  sections: T[],
  limit: number
): { sections: (T & { truncated: boolean })[]; truncated: boolean } {
  const kept: (T & { truncated: boolean })[] = [];
  let remaining = limit;

  for (const section of sections) {
    // Budget spent, but there is still a section to show: it's withheld.
    if (remaining <= 0) return { sections: kept, truncated: true };
    const { text, truncated } = truncateWords(section.text, remaining);
    kept.push({ ...section, text, truncated });
    if (truncated) return { sections: kept, truncated: true };
    remaining -= countWords(text);
  }

  return { sections: kept, truncated: false };
}
