"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { type Locale, type Translations, staticTranslations, getStaticTranslations } from "./translations";
import { GOOGLE_TRANSLATE_LANGUAGES } from "./languages";

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  /** Translate arbitrary text dynamically via API. Returns translated text or original if English. */
  translateText: (text: string) => Promise<string>;
  /** Whether the current locale is non-English (useful to decide if translation is needed) */
  needsTranslation: boolean;
  /** Whether the UI translation is being loaded for a new non-static locale */
  loadingUITranslation: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// In-memory cache for dynamic translations to avoid repeated API calls
const translationCache = new Map<string, string>();
// Cache for fully-translated UI strings per locale
const uiTranslationCache = new Map<string, Translations>();

function getCacheKey(locale: Locale, text: string): string {
  return `${locale}:${text.slice(0, 200)}`;
}

// All supported locales by code
export const ALL_LOCALE_CODES = GOOGLE_TRANSLATE_LANGUAGES.map(([code]) => code);

// Native name for any locale
export function getLocaleName(locale: string): string {
  const entry = GOOGLE_TRANSLATE_LANGUAGES.find(([code]) => code === locale);
  return entry ? entry[1] : locale;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>("en");
  const [dynamicTranslations, setDynamicTranslations] = useState<Translations | null>(null);
  const [loadingUITranslation, setLoadingUITranslation] = useState(false);
  const currentLocaleRef = useRef<string>("en");

  // Load saved locale from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("locale");
    if (saved && ALL_LOCALE_CODES.includes(saved)) {
      setLocaleState(saved);
      currentLocaleRef.current = saved;
    }
  }, []);

  const translateTextDirect = useCallback(async (text: string, targetLocale: string): Promise<string> => {
    if (targetLocale === "en" || !text.trim()) return text;

    const cacheKey = getCacheKey(targetLocale, text);
    const cached = translationCache.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetLocale }),
      });
      if (!res.ok) return text;
      const data = await res.json();
      const translated = data.translatedText || text;
      translationCache.set(cacheKey, translated);
      return translated;
    } catch {
      return text;
    }
  }, []);

  // When locale changes to a non-static locale, batch-translate the entire UI
  useEffect(() => {
    currentLocaleRef.current = locale;

    // If we have static translations, use them directly
    if (getStaticTranslations(locale)) {
      setDynamicTranslations(null);
      setLoadingUITranslation(false);
      return;
    }

    // Check the UI translation cache
    if (uiTranslationCache.has(locale)) {
      setDynamicTranslations(uiTranslationCache.get(locale)!);
      setLoadingUITranslation(false);
      return;
    }

    // Need to dynamically translate the entire UI
    setLoadingUITranslation(true);
    const englishStrings = staticTranslations["en"];
    const keys = Object.keys(englishStrings) as (keyof Translations)[];
    const values = keys.map((k) => englishStrings[k] as string);

    const localeAtStart = locale;

    // Translate all strings concurrently
    Promise.all(values.map((v) => translateTextDirect(v, locale)))
      .then((translated) => {
        if (currentLocaleRef.current !== localeAtStart) return; // Locale changed while translating
        const result = {} as Translations;
        keys.forEach((k, i) => {
          (result as unknown as Record<string, string>)[k] = translated[i];
        });
        uiTranslationCache.set(localeAtStart, result);
        setDynamicTranslations(result);
      })
      .finally(() => {
        if (currentLocaleRef.current === localeAtStart) {
          setLoadingUITranslation(false);
        }
      });
  }, [locale, translateTextDirect]);

  const setLocale = useCallback((newLocale: string) => {
    setLocaleState(newLocale);
    currentLocaleRef.current = newLocale;
    localStorage.setItem("locale", newLocale);
    // Clear per-text cache when language changes
    translationCache.clear();
  }, []);

  const t = getStaticTranslations(locale) || dynamicTranslations || staticTranslations["en"];
  const needsTranslation = locale !== "en";

  const translateText = useCallback(
    async (text: string): Promise<string> => translateTextDirect(text, locale),
    [locale, translateTextDirect]
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, translateText, needsTranslation, loadingUITranslation }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
