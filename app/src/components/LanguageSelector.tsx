"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/i18n/LanguageContext";
import { GOOGLE_TRANSLATE_LANGUAGES } from "@/i18n/languages";

export function LanguageSelector() {
  const { locale, setLocale, loadingUITranslation } = useLanguage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 0);
    } else if (!open) {
      setSearch("");
    }
  }, [open]);

  const currentEntry = GOOGLE_TRANSLATE_LANGUAGES.find(([code]) => code === locale);
  const currentNativeName = currentEntry ? currentEntry[1] : locale.toUpperCase();

  const filtered = search.trim()
    ? GOOGLE_TRANSLATE_LANGUAGES.filter(
        ([code, native, english]) =>
          native.toLowerCase().includes(search.toLowerCase()) ||
          english.toLowerCase().includes(search.toLowerCase()) ||
          code.toLowerCase() === search.toLowerCase()
      )
    : GOOGLE_TRANSLATE_LANGUAGES;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex items-center gap-1 text-sm"
        aria-label="Change language"
        title={`Language: ${currentNativeName}`}
        disabled={loadingUITranslation}
      >
        {loadingUITranslation ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
        )}
        <span className="text-xs hidden sm:inline max-w-[80px] truncate">{currentNativeName}</span>
        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 w-56 flex flex-col">
          {/* Search box */}
          <div className="p-2 border-b border-zinc-100 dark:border-zinc-700">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search languages..."
              className="w-full px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          {/* Language list */}
          <div className="overflow-y-auto max-h-60 py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-zinc-400 text-center">No languages found</div>
            )}
            {filtered.map(([code, native, english]) => (
              <button
                key={code}
                onClick={() => {
                  setLocale(code);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 transition-colors ${
                  code === locale
                    ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
                }`}
              >
                <span>{native}</span>
                {code !== locale && (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">{english}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
