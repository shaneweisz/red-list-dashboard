/**
 * Finding the links in a note.
 *
 * The reasoning an assessor writes about a locality is full of references:
 * the GEOLocate result they settled on, the herbarium's record page, a paper
 * about the collector's route, the gazetteer entry that decided it. Pasted
 * into a note they were dead text, and getting to one meant selecting it and
 * copying it out by hand.
 *
 * Deliberately conservative. Only http(s) and bare www., only where the URL
 * stands on its own, and trailing punctuation is left with the sentence
 * rather than swallowed into the link — "see https://example.org/x." ends in
 * a full stop, not a link to `x.`.
 */
const URL_PATTERN = /\b(https?:\/\/|www\.)[^\s<>"']+/gi;

/** Punctuation that ends a sentence rather than an address. */
const TRAILING = /[.,;:!?'"]+$/;

const count = (text: string, character: string) =>
  text.split(character).length - 1;

export interface LinkPart {
  text: string;
  /** Where it points, for the parts that are links. */
  href?: string;
}

/**
 * Splits a note into the parts that are links and the parts that aren't.
 *
 * One pass, no HTML: the caller renders the pieces, so nothing that came out
 * of a note is ever handed to a parser as markup.
 */
export function linkifyParts(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let index = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    // A bracket the URL itself opened is part of it; one that only closes
    // belongs to the sentence around it. Wikipedia's article titles are the
    // reason this has to be told apart — /wiki/Mitú_(Vaupés) ends in a
    // bracket that matters.
    let found = match[0];
    for (;;) {
      const before = found;
      found = found.replace(TRAILING, "");
      if (found.endsWith(")") && count(found, "(") < count(found, ")")) found = found.slice(0, -1);
      else if (found.endsWith("]") && count(found, "[") < count(found, "]")) found = found.slice(0, -1);
      if (found === before) break;
    }
    if (!found) continue;
    if (start > index) parts.push({ text: text.slice(index, start) });
    parts.push({ text: found, href: found.startsWith("www.") ? `https://${found}` : found });
    index = start + found.length;
  }
  if (index < text.length) parts.push({ text: text.slice(index) });
  return parts;
}

/** Whether there is anything in here to click through to. */
export function hasLink(text: string): boolean {
  return linkifyParts(text).some((part) => part.href != null);
}
