import { NextRequest, NextResponse } from "next/server";

/**
 * Dynamic translation API endpoint using Google Translate's free API.
 * Accepts a locale code (e.g. "fr", "zh", "de") as targetLocale.
 * Falls back to returning original text if translation fails.
 */

async function translateOne(text: string, targetLocale: string): Promise<string> {
  if (targetLocale === "en" || !text.trim()) return text;

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(targetLocale)}&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) return text;

  const data = await res.json();
  // Google Translate returns nested arrays: [[["translated text","original text",...],...],...]
  return data?.[0]?.map((segment: [string]) => segment[0]).join("") || text;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { targetLocale } = body;

    if (!targetLocale) {
      return NextResponse.json({ error: "Missing targetLocale" }, { status: 400 });
    }

    if (targetLocale === "en") {
      if (body.texts) {
        return NextResponse.json({ translatedTexts: body.texts });
      }
      return NextResponse.json({ translatedText: body.text });
    }

    // Batch mode: { texts: string[], targetLocale: string }
    if (body.texts && Array.isArray(body.texts)) {
      const translated = await Promise.all(
        body.texts.map((t: string) => translateOne(t, targetLocale).catch(() => t))
      );
      return NextResponse.json({ translatedTexts: translated });
    }

    // Single mode: { text: string, targetLocale: string }
    if (!body.text) {
      return NextResponse.json({ error: "Missing text or texts" }, { status: 400 });
    }

    const translatedText = await translateOne(body.text, targetLocale).catch(() => body.text);
    return NextResponse.json({ translatedText });
  } catch {
    return NextResponse.json({ translatedText: "" }, { status: 500 });
  }
}
