/**
 * Reading a locality description written in someone else's language.
 *
 * A herbarium label is written in the language of whoever collected the
 * specimen, and the locality is the field an assessor reads hardest: it is
 * what a georeference is made from. "Quebrada abajo del cruce, potrero con
 * rastrojo alto" is a place you can find on a map once you can read it, and a
 * wall of unfamiliar words until then.
 *
 * A link out to Google Translate rather than a translation in place. Two free
 * services were tried in the panel and neither earned its keep: MyMemory,
 * which is documented but metered by the day and reads "Comisaría del Vaupés"
 * as a police station, and Google's undocumented endpoint, which rate-limits
 * by IP after a handful of calls and runs an older model than
 * translate.google.com does. What you actually want, when a locality doesn't
 * parse, is Google's own page — today's model, the alternatives, the
 * dictionary entries — and none of that fits in a hover bubble.
 */

/**
 * The language to read it in: this browser's own, falling back to English.
 *
 * The region is dropped — "pt-BR" and "pt" are the same request as far as this
 * is concerned, and Google takes either.
 */
export function browserLanguage(): string {
  const tag = typeof navigator === "undefined" ? "" : navigator.language;
  const base = (tag || "en").split("-")[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(base) ? base : "en";
}

/** "es" → "Spanish", where the browser can say; the code itself where it can't. */
export function languageName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames([browserLanguage(), "en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The locality, open in Google Translate.
 *
 * `sl=auto` because the labels on one species' sheets are rarely all in the
 * same language, and asking the assessor which this one is means asking them
 * to know before they read it.
 */
export function googleTranslateUrl(text: string, target: string): string {
  const params = new URLSearchParams({ sl: "auto", tl: target, text: text.trim(), op: "translate" });
  return `https://translate.google.com/?${params}`;
}
