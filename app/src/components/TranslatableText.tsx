"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "@/i18n";

interface TranslatableTextProps {
  /** The original text (in English) */
  text: string;
  /** Optional className for the text container */
  className?: string;
}

/**
 * Wraps text content with an optional "Translate" button.
 * When the user's language is not English, shows a button to translate the text
 * via the /api/translate endpoint. Caches translations client-side.
 */
export function TranslatableText({ text, className = "" }: TranslatableTextProps) {
  const { language, t } = useTranslation();
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  const handleTranslate = useCallback(async () => {
    if (translatedText) {
      setShowTranslation(!showTranslation);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, targetLang: language }),
      });
      if (res.ok) {
        const data = await res.json();
        setTranslatedText(data.translatedText);
        setShowTranslation(true);
      }
    } catch {
      // Fail silently
    } finally {
      setLoading(false);
    }
  }, [text, language, translatedText, showTranslation]);

  // Don't show translate button for English
  if (language === "en") {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {showTranslation && translatedText ? translatedText : text}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleTranslate();
        }}
        className="ml-2 inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium align-baseline"
        disabled={loading}
      >
        {loading ? (
          <>
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t("translate.translating")}
          </>
        ) : showTranslation && translatedText ? (
          t("translate.showOriginal")
        ) : (
          t("translate.button")
        )}
      </button>
    </span>
  );
}
