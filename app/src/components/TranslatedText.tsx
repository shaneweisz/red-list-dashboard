"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/i18n/LanguageContext";

/**
 * TranslatedText - Dynamically translates arbitrary text content via API.
 * Shows the original text immediately, then swaps in the translation when ready.
 * Uses the language context to determine if translation is needed.
 */
export function TranslatedText({
  text,
  as: Component = "span",
  className,
}: {
  text: string;
  as?: "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "li" | "td";
  className?: string;
}) {
  const { translateText, needsTranslation } = useLanguage();
  const [translated, setTranslated] = useState(text);

  useEffect(() => {
    if (!needsTranslation) {
      setTranslated(text);
      return;
    }

    let cancelled = false;
    translateText(text).then((result) => {
      if (!cancelled) setTranslated(result);
    });

    return () => { cancelled = true; };
  }, [text, needsTranslation, translateText]);

  return <Component className={className}>{translated}</Component>;
}

/**
 * Hook version for cases where you need the translated string directly.
 */
export function useTranslatedText(text: string): string {
  const { translateText, needsTranslation } = useLanguage();
  const [translated, setTranslated] = useState(text);

  useEffect(() => {
    if (!needsTranslation) {
      setTranslated(text);
      return;
    }

    let cancelled = false;
    translateText(text).then((result) => {
      if (!cancelled) setTranslated(result);
    });

    return () => { cancelled = true; };
  }, [text, needsTranslation, translateText]);

  return translated;
}
