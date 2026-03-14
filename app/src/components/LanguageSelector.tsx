"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/i18n/LanguageContext";
import { type Locale, LOCALE_NAMES } from "@/i18n/translations";

const FLAG_EMOJI: Record<Locale, string> = {
  en: "🇬🇧",
  fr: "🇫🇷",
  es: "🇪🇸",
  pt: "🇧🇷",
};

export function LanguageSelector() {
  const { locale, setLocale } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex items-center gap-1 text-sm"
        aria-label="Change language"
        title={`Language: ${LOCALE_NAMES[locale]}`}
      >
        <span className="text-base">{FLAG_EMOJI[locale]}</span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 min-w-[140px] py-1">
          {(Object.keys(LOCALE_NAMES) as Locale[]).map((loc) => (
            <button
              key={loc}
              onClick={() => {
                setLocale(loc);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                loc === locale
                  ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
              }`}
            >
              <span>{FLAG_EMOJI[loc]}</span>
              <span>{LOCALE_NAMES[loc]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
