import { describe, it, expect, vi, afterEach } from "vitest";
import { browserLanguage, googleTranslateUrl, languageName } from "../translate";

describe("googleTranslateUrl", () => {
  it("carries the locality, the language to read it in, and lets Google detect the source", () => {
    const url = new URL(googleTranslateUrl("Raudal de Yuruparí", "en"));
    expect(url.origin + url.pathname).toBe("https://translate.google.com/");
    expect(url.searchParams.get("text")).toBe("Raudal de Yuruparí");
    expect(url.searchParams.get("tl")).toBe("en");
    expect(url.searchParams.get("sl")).toBe("auto");
    expect(url.searchParams.get("op")).toBe("translate");
  });

  it("drops the space a cell carries around its value", () => {
    const url = new URL(googleTranslateUrl("  Mitú  ", "pt"));
    expect(url.searchParams.get("text")).toBe("Mitú");
    expect(url.searchParams.get("tl")).toBe("pt");
  });

  it("escapes a locality with the punctuation these are full of", () => {
    const locality = "Comisaría del Vaupés, alrededores del raudal de Yuruparí; 300 m";
    const url = new URL(googleTranslateUrl(locality, "en"));
    expect(url.searchParams.get("text")).toBe(locality);
  });
});

describe("browserLanguage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops the region: pt-BR and pt are the same page", () => {
    vi.stubGlobal("navigator", { language: "pt-BR" });
    expect(browserLanguage()).toBe("pt");
  });

  it("falls back to English where the browser says nothing usable", () => {
    vi.stubGlobal("navigator", { language: "" });
    expect(browserLanguage()).toBe("en");
  });
});

describe("languageName", () => {
  it("names a language from its code", () => {
    expect(languageName("es")?.toLowerCase()).toContain("spanish");
  });

  it("says nothing where there is nothing to say", () => {
    expect(languageName(undefined)).toBeUndefined();
  });
});
