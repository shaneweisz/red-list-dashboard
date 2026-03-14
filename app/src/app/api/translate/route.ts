import { NextRequest, NextResponse } from "next/server";

/**
 * Dynamic translation API endpoint.
 * Uses a simple translation approach with the Google Translate API (free tier).
 * Falls back to returning original text if translation fails.
 */

const LANGUAGE_CODES: Record<string, string> = {
  "Français": "fr",
  "Español": "es",
  "Português": "pt",
  "English": "en",
};

export async function POST(request: NextRequest) {
  try {
    const { text, targetLanguage } = await request.json();

    if (!text || !targetLanguage) {
      return NextResponse.json(
        { error: "Missing text or targetLanguage" },
        { status: 400 }
      );
    }

    const langCode = LANGUAGE_CODES[targetLanguage] || targetLanguage.toLowerCase().slice(0, 2);

    if (langCode === "en") {
      return NextResponse.json({ translatedText: text });
    }

    // Use Google Translate free API
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${langCode}&dt=t&q=${encodeURIComponent(text)}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      return NextResponse.json({ translatedText: text });
    }

    const data = await res.json();
    // Google Translate returns nested arrays: [[["translated text","original text",...],...],...]
    const translatedText = data?.[0]
      ?.map((segment: [string]) => segment[0])
      .join("") || text;

    return NextResponse.json({ translatedText });
  } catch {
    return NextResponse.json(
      { translatedText: "" },
      { status: 500 }
    );
  }
}
