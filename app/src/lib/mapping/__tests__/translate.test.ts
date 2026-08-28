import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  translateText,
  knownTranslation,
  knownTranslationFailure,
  resetTranslations,
  browserLanguage,
  languageName,
  TRANSLATION_PROVIDERS,
  translationProvider,
  setTranslationProvider,
} from "../translate";

const LOCALITY = "Vereda El Cedral, bosque intervenido";

const answer = (body: Record<string, unknown>, ok = true) =>
  vi.fn(async (_url: string) => ({ ok, status: 200, json: async () => body }));

const ok = (translatedText: string, detectedLanguage = "es") =>
  answer({ responseStatus: 200, responseData: { translatedText, detectedLanguage } });

describe("translateText", () => {
  beforeEach(() => resetTranslations());
  afterEach(() => vi.unstubAllGlobals());

  it("translates a locality and says what language it read it as", async () => {
    vi.stubGlobal("fetch", ok("Vereda El Cedral, disturbed forest"));
    const result = await translateText(LOCALITY, "en");
    expect(result.text).toBe("Vereda El Cedral, disturbed forest");
    expect(result.detected).toBe("es");
    expect(result.target).toBe("en");
    expect(result.truncated).toBe(false);
  });

  it("lets the service detect the source language rather than guessing it", async () => {
    const fetchMock = ok("disturbed forest");
    vi.stubGlobal("fetch", fetchMock);
    await translateText(LOCALITY, "en");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain("langpair=Autodetect|en");
  });

  it("asks once per string and language, however many times it's clicked", async () => {
    const fetchMock = ok("disturbed forest");
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([translateText(LOCALITY, "en"), translateText(LOCALITY, "en")]);
    await translateText(LOCALITY, "en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(knownTranslation(LOCALITY, "en", "mymemory")?.text).toBe("disturbed forest");
  });

  it("asks again for the same string in a different language", async () => {
    const fetchMock = ok("bosque perturbado");
    vi.stubGlobal("fetch", fetchMock);
    await translateText(LOCALITY, "en");
    await translateText(LOCALITY, "fr");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores the leading and trailing space a cell carries", async () => {
    const fetchMock = ok("disturbed forest");
    vi.stubGlobal("fetch", fetchMock);
    await translateText(LOCALITY, "en");
    await translateText(`  ${LOCALITY}  `, "en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the first 500 characters of a long locality, and says so", async () => {
    const fetchMock = ok("a long description");
    vi.stubGlobal("fetch", fetchMock);
    const long = "Bosque muy húmedo premontano, cerca del río. ".repeat(20);
    const result = await translateText(long, "en");
    expect(result.truncated).toBe(true);
    const sent = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("q") ?? "";
    expect(sent).toHaveLength(TRANSLATION_PROVIDERS.mymemory.maxChars);
  });

  it("passes on the service's own reason for saying no", async () => {
    vi.stubGlobal("fetch", answer({
      responseStatus: 403,
      responseDetails: "YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY",
      responseData: { translatedText: "" },
    }));
    await expect(translateText(LOCALITY, "en")).rejects.toThrow(
      "YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"
    );
  });

  it("treats a spent quota as a failure even when the answer looks fine", async () => {
    vi.stubGlobal("fetch", answer({
      responseStatus: 200,
      quotaFinished: true,
      responseData: { translatedText: "disturbed forest" },
    }));
    await expect(translateText(LOCALITY, "en")).rejects.toThrow(/quota/i);
  });

  it("remembers a refusal rather than spending another request on it", async () => {
    const fetchMock = answer({ responseStatus: 403, responseDetails: "NO" });
    vi.stubGlobal("fetch", fetchMock);
    await expect(translateText(LOCALITY, "en")).rejects.toThrow("NO");
    await expect(translateText(LOCALITY, "en")).rejects.toThrow("NO");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(knownTranslationFailure(LOCALITY, "en", "mymemory")).toBe("NO");
  });

  it("survives the service being unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    await expect(translateText(LOCALITY, "en")).rejects.toThrow("network");
  });

  it("refuses an empty string without asking anyone", async () => {
    const fetchMock = ok("");
    vi.stubGlobal("fetch", fetchMock);
    await expect(translateText("   ", "en")).rejects.toThrow(/nothing/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't remember an abort as a failure — the pointer just left", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }));
    await expect(translateText(LOCALITY, "en")).rejects.toThrow();
    expect(knownTranslationFailure(LOCALITY, "en", "mymemory")).toBeUndefined();
  });
});

describe("Google, the other service", () => {
  // The endpoint Google Translate's own widget calls: positional JSON, one
  // entry per segment, with the detected language third from the top.
  const googleAnswer = (segments: string[], detected = "es") =>
    vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => [segments.map((t) => [t, "", null, null, 3]), null, detected],
    }));

  beforeEach(() => resetTranslations());
  afterEach(() => vi.unstubAllGlobals());

  it("reads the translation and the detected language out of its answer", async () => {
    vi.stubGlobal("fetch", googleAnswer(["On the banks of the Hollín River"]));
    const result = await translateText(LOCALITY, "en", "google");
    expect(result.text).toBe("On the banks of the Hollín River");
    expect(result.detected).toBe("es");
    expect(result.provider).toBe("google");
  });

  it("joins the segments a long locality comes back in", async () => {
    vi.stubGlobal("fetch", googleAnswer(["Steep ridge above the river. ", "Cattle pasture below it."]));
    const result = await translateText(LOCALITY, "en", "google");
    expect(result.text).toBe("Steep ridge above the river. Cattle pasture below it.");
  });

  it("asks it to detect the source, in the target language", async () => {
    const fetchMock = googleAnswer(["disturbed forest"]);
    vi.stubGlobal("fetch", fetchMock);
    await translateText(LOCALITY, "fr", "google");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("sl")).toBe("auto");
    expect(url.searchParams.get("tl")).toBe("fr");
  });

  it("says what a rate-limited answer means", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string) => ({ ok: false, status: 429, json: async () => ({}) })));
    await expect(translateText(LOCALITY, "en", "google")).rejects.toThrow(/rate-limits/);
  });

  it("doesn't mistake an empty answer for a translation", async () => {
    vi.stubGlobal("fetch", googleAnswer([]));
    await expect(translateText(LOCALITY, "en", "google")).rejects.toThrow(/no translation/i);
  });

  it("keeps each service's answer apart, so switching asks the other one", async () => {
    vi.stubGlobal("fetch", ok("MyMemory's answer"));
    await translateText(LOCALITY, "en", "mymemory");
    vi.stubGlobal("fetch", googleAnswer(["Google's answer"]));
    await translateText(LOCALITY, "en", "google");
    expect(knownTranslation(LOCALITY, "en", "mymemory")?.text).toBe("MyMemory's answer");
    expect(knownTranslation(LOCALITY, "en", "google")?.text).toBe("Google's answer");
  });
});

describe("the remembered choice of service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is MyMemory until someone says otherwise", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} } });
    expect(translationProvider()).toBe("mymemory");
  });

  it("survives the session that made it", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      },
    });
    setTranslationProvider("google");
    expect(translationProvider()).toBe("google");
  });

  it("ignores a stored name it doesn't recognise", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "babelfish", setItem: () => {} } });
    expect(translationProvider()).toBe("mymemory");
  });
});

describe("what survives a refresh", () => {
  const store = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      raw: data,
    };
  };

  // Reset before as well as after: an earlier block may have left this very
  // string cached, and a cache hit never writes to the store.
  beforeEach(() => resetTranslations());
  afterEach(() => {
    resetTranslations();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps a translation, so reloading the page doesn't spend the quota again", async () => {
    const localStorage = store();
    vi.stubGlobal("window", { localStorage });
    const fetchMock = ok("disturbed forest");
    vi.stubGlobal("fetch", fetchMock);
    await translateText(LOCALITY, "en");
    expect(localStorage.raw.size).toBe(1);

    // A reload is a new module with the same store behind it.
    vi.resetModules();
    const reloaded = await import("../translate");
    expect(reloaded.knownTranslation(LOCALITY, "en", "mymemory")?.text).toBe("disturbed forest");
    expect(await reloaded.translateText(LOCALITY, "en")).toMatchObject({ text: "disturbed forest" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again rather than trusting a store written by another version", async () => {
    const localStorage = store();
    localStorage.setItem(
      "redlist-translations:v2",
      JSON.stringify({
        version: 99,
        entries: {
          [`mymemory::en::${LOCALITY}`]: {
            text: "nope",
            target: "en",
            provider: "mymemory",
            truncated: false,
          },
        },
      })
    );
    vi.stubGlobal("window", { localStorage });
    vi.resetModules();
    const reloaded = await import("../translate");
    expect(reloaded.knownTranslation(LOCALITY, "en", "mymemory")).toBeUndefined();
  });

  it("survives a store that isn't JSON at all", async () => {
    const localStorage = store();
    localStorage.setItem("redlist-translations:v2", "{not json");
    vi.stubGlobal("window", { localStorage });
    vi.resetModules();
    const reloaded = await import("../translate");
    expect(reloaded.knownTranslation(LOCALITY, "en", "mymemory")).toBeUndefined();
  });

  it("keeps failures out of it — a spent quota is true for today only", async () => {
    const localStorage = store();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("fetch", answer({ responseStatus: 403, responseDetails: "QUOTA" }));
    await expect(translateText(LOCALITY, "en")).rejects.toThrow("QUOTA");
    expect(localStorage.raw.size).toBe(0);
  });

  it("carries on when storage is disabled, as it is in a private window", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {},
      },
    });
    vi.stubGlobal("fetch", ok("disturbed forest"));
    expect((await translateText(LOCALITY, "en")).text).toBe("disturbed forest");
  });
});

describe("browserLanguage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops the region: pt-BR and pt are the same request", () => {
    vi.stubGlobal("navigator", { language: "pt-BR" });
    expect(browserLanguage()).toBe("pt");
  });

  it("falls back to English where the browser says nothing usable", () => {
    vi.stubGlobal("navigator", { language: "" });
    expect(browserLanguage()).toBe("en");
  });
});

describe("languageName", () => {
  it("names the language the service detected", () => {
    expect(languageName("es")?.toLowerCase()).toContain("spanish");
  });

  it("says nothing where there is nothing to say", () => {
    expect(languageName(undefined)).toBeUndefined();
  });
});
