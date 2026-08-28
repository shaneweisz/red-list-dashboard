/**
 * Translating a locality description.
 *
 * A herbarium label is written in the language of whoever collected the
 * specimen, and a locality is the field an assessor reads hardest: it is what
 * a georeference is made from. "Quebrada abajo del cruce, potrero con rastrojo
 * alto" is a place you can find on a map once you can read it, and a wall of
 * unfamiliar words until then.
 *
 * Two services, both free, both callable straight from the browser, and both
 * detecting the source language themselves — the labels on one species' sheets
 * are rarely all in the same language, and asking the assessor to say which is
 * asking them to know before they read it.
 *
 * **MyMemory** is the default: a documented public API with a published free
 * tier, metered per IP by the day.
 *
 * **Google** is the endpoint Google Translate's own web widget calls. It is
 * free and needs no key, and it is undocumented: Google does not publish it,
 * does not promise it, and can rate-limit or change it without notice. It is
 * offered because it is usually the better translation of a locality, and
 * because a second opinion on "Quebrada abajo del cruce" is worth having —
 * but the official route to the same engine is Cloud Translation, which needs
 * an API key and a billing account, and that is what to reach for if this
 * stops working or the licence matters.
 *
 * Nothing is translated until someone asks for it, whichever service is
 * chosen: spending a quota on every locality that scrolled past would exhaust
 * it long before anyone read one.
 */

export type TranslationProvider = "mymemory" | "google";

export const TRANSLATION_PROVIDERS: Record<TranslationProvider, { label: string; maxChars: number }> = {
  // MyMemory rejects anything over 500 characters outright, so a long locality
  // is sent as its first 500 rather than spent on an error. Google's is a URL
  // length limit rather than a documented one, kept well short of it.
  mymemory: { label: "MyMemory", maxChars: 500 },
  google: { label: "Google", maxChars: 1500 },
};

export interface Translation {
  /** The translation itself. */
  text: string;
  /** The language the service decided the source was, as a code — "es". */
  detected?: string;
  /** The language it was translated into. */
  target: string;
  /** Who translated it. */
  provider: TranslationProvider;
  /** Whether the text was too long and only its first part was sent. */
  truncated: boolean;
}

const done = new Map<string, Translation>();
const failures = new Map<string, string>();
const inFlight = new Map<string, Promise<Translation>>();

const cacheKey = (text: string, target: string, provider: TranslationProvider) =>
  `${provider}::${target}::${text.trim()}`;

/**
 * Translations outlive the page.
 *
 * Reading a species' labels is a session that gets reloaded a dozen times, and
 * the same twenty localities would be re-translated on every one of them —
 * against a quota metered by the day, for an answer that cannot have changed.
 * The successful ones are kept, so a locality translated on Tuesday reads
 * translated on Wednesday without anyone being asked again.
 *
 * Only the successes. The commonest failure is the day's quota, which is
 * exactly the thing that stops being true tomorrow.
 */
const STORE_KEY = "redlist-translations:v2";
const STORE_VERSION = 2;
/** Enough for any working session, and small enough not to crowd the store. */
const STORE_LIMIT = 500;

interface StoredTranslations {
  version: number;
  entries: Record<string, Translation>;
}

let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed: StoredTranslations = JSON.parse(raw);
    if (parsed.version !== STORE_VERSION) return;
    for (const [key, value] of Object.entries(parsed.entries ?? {})) {
      if (value && typeof value.text === "string") done.set(key, value);
    }
  } catch {
    // A corrupt store is a cache to rebuild, not work that's been lost. The
    // next translation writes over it.
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    // A Map keeps insertion order, so the tail is what was translated most
    // recently: that's the end worth keeping.
    const entries = [...done.entries()].slice(-STORE_LIMIT);
    window.localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ version: STORE_VERSION, entries: Object.fromEntries(entries) })
    );
  } catch {
    // Full, or storage disabled in a private window. Nothing is lost that
    // can't be asked for again.
  }
}

/** The translation if it's already been asked for, `undefined` if it hasn't. */
export function knownTranslation(
  text: string,
  target: string,
  provider: TranslationProvider
): Translation | undefined {
  load();
  return done.get(cacheKey(text, target, provider));
}

/** Why the last attempt at this one failed, if it did. */
export function knownTranslationFailure(
  text: string,
  target: string,
  provider: TranslationProvider
): string | undefined {
  return failures.get(cacheKey(text, target, provider));
}

/**
 * The language to translate into: this browser's own, falling back to English.
 *
 * The region is dropped — "pt-BR" and "pt" are the same request as far as this
 * is concerned, and both services take either.
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

/** MyMemory's own JSON, which carries the reason it said no where it does. */
async function askMyMemory(q: string, target: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q, langpair: `Autodetect|${target}` });
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal });
  if (!res.ok) throw new Error(`The translation service answered ${res.status}.`);
  const body: {
    responseStatus?: number | string;
    responseDetails?: string;
    quotaFinished?: boolean;
    responseData?: { translatedText?: string; detectedLanguage?: string };
  } = await res.json();
  const translated = body.responseData?.translatedText?.trim();
  if (Number(body.responseStatus) !== 200 || !translated) {
    // responseDetails carries the readable reason; translatedText carries it
    // instead on some of the 403s.
    throw new Error(body.responseDetails?.trim() || translated || "The translation service said no.");
  }
  if (body.quotaFinished) throw new Error("The free translation quota for today is spent.");
  return { text: translated, detected: body.responseData?.detectedLanguage };
}

/**
 * Google's, via the endpoint its own web widget calls.
 *
 * The answer is positional rather than named: `[segments, …, detected, …]`,
 * where each segment is `[translated, source, …]`. A long locality comes back
 * split across several of them, so they are joined rather than read as one.
 */
async function askGoogle(q: string, target: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: target, dt: "t", q });
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, { signal });
  if (!res.ok) throw new Error(`Google answered ${res.status}. It rate-limits this endpoint.`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error("Google answered in a shape this doesn't understand.");
  const segments = Array.isArray(body[0]) ? body[0] : [];
  const text = segments
    .map((segment) => (Array.isArray(segment) ? String(segment[0] ?? "") : ""))
    .join("")
    .trim();
  if (!text) throw new Error("Google returned no translation.");
  return { text, detected: typeof body[2] === "string" ? body[2] : undefined };
}

/**
 * Asks the chosen service, once per string per language per service.
 *
 * Failures are remembered too: the commonest is the day's free quota being
 * spent, and retrying it on every click would only say the same thing slower.
 * Throws with the service's own message where it gives one, which is written
 * to be read ("YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY").
 */
export async function translateText(
  text: string,
  target: string,
  provider: TranslationProvider = "mymemory",
  signal?: AbortSignal
): Promise<Translation> {
  const source = text.trim();
  if (!source) throw new Error("Nothing to translate.");
  load();
  const key = cacheKey(source, target, provider);

  const already = done.get(key);
  if (already) return already;
  const failed = failures.get(key);
  if (failed) throw new Error(failed);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const limit = TRANSLATION_PROVIDERS[provider].maxChars;
  const truncated = source.length > limit;
  const q = truncated ? source.slice(0, limit) : source;

  const request = (async (): Promise<Translation> => {
    const answer = provider === "google" ? await askGoogle(q, target, signal) : await askMyMemory(q, target, signal);
    return { ...answer, target, provider, truncated };
  })();

  inFlight.set(
    key,
    request
      .then((result) => {
        done.set(key, result);
        persist();
        return result;
      })
      .catch((error: unknown) => {
        // An aborted request isn't a failure of the translation — the pointer
        // just left the bubble — so it isn't remembered as one.
        const message = error instanceof Error ? error.message : String(error);
        if (!(error instanceof DOMException && error.name === "AbortError")) failures.set(key, message);
        throw error;
      })
      .finally(() => inFlight.delete(key))
  );
  return inFlight.get(key)!;
}

/** Empties the cache, in memory and in storage. Tests only. */
export function resetTranslations() {
  done.clear();
  failures.clear();
  inFlight.clear();
  loaded = false;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing depends on it having worked.
  }
}
