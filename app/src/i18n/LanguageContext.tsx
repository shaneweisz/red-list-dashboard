"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import en, { type TranslationKey, type Translations } from "./en";
import fr from "./fr";
import pt from "./pt";
import es from "./es";

export type Language = "en" | "fr" | "pt" | "es";
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  fr: "Français",
  pt: "Português",
  es: "Español",
};

const translations: Record<Language, Translations> = { en, fr, pt, es };

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  languages: { code: Language; label: string }[];
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "redlist-language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  // Load saved language on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
      if (saved && translations[saved]) {
        setLanguageState(saved);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore localStorage errors
    }
    // Update the html lang attribute
    document.documentElement.lang = lang;
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      let text = translations[language]?.[key] || translations.en[key] || key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [language]
  );

  const languages = Object.entries(LANGUAGE_LABELS).map(([code, label]) => ({
    code: code as Language,
    label,
  }));

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, languages }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useTranslation must be used within LanguageProvider");
  return ctx;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return { language: ctx.language, setLanguage: ctx.setLanguage, languages: ctx.languages };
}
