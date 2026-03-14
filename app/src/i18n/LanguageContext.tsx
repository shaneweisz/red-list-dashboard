"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { type Locale, type Translations, translations, LOCALE_NAMES } from "./translations";

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  /** Translate arbitrary text dynamically via AI. Returns translated text or original if English. */
  translateText: (text: string) => Promise<string>;
  /** Whether the current locale is non-English (useful to decide if translation is needed) */
  needsTranslation: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// In-memory cache for dynamic translations to avoid repeated API calls
const translationCache = new Map<string, string>();

function getCacheKey(locale: Locale, text: string): string {
  return `${locale}:${text.slice(0, 200)}`;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Load saved locale from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("locale") as Locale | null;
    if (saved && saved in LOCALE_NAMES) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
    // Clear cache when language changes
    translationCache.clear();
  }, []);

  const t = translations[locale];
  const needsTranslation = locale !== "en";

  const translateText = useCallback(async (text: string): Promise<string> => {
    if (locale === "en" || !text.trim()) return text;

    const cacheKey = getCacheKey(locale, text);
    const cached = translationCache.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetLanguage: LOCALE_NAMES[locale] }),
      });
      if (!res.ok) return text;
      const data = await res.json();
      const translated = data.translatedText || text;
      translationCache.set(cacheKey, translated);
      return translated;
    } catch {
      return text;
    }
  }, [locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, translateText, needsTranslation }}>
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
