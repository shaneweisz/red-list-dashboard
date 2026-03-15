import { NextRequest, NextResponse } from "next/server";

/**
 * Translation API route using MyMemory Translation API (free, no API key required).
 * Translates dynamic text (e.g. IUCN assessment narratives) to FR, PT, ES.
 *
 * MyMemory allows up to 5000 chars per request and is free for reasonable usage.
 * See: https://mymemory.translated.net/doc/spec.php
 */

const LANG_MAP: Record<string, string> = {
  fr: "en|fr",
  pt: "en|pt",
  es: "en|es",
};

// Simple in-memory cache to avoid re-translating the same text
const cache = new Map<string, { text: string; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const MAX_CACHE_SIZE = 500;

function getCacheKey(text: string, targetLang: string): string {
  // Use a hash-like key: first 100 chars + length + lang
  return `${targetLang}:${text.length}:${text.slice(0, 100)}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, targetLang } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing 'text' field" }, { status: 400 });
    }

    if (!targetLang || !LANG_MAP[targetLang]) {
      return NextResponse.json(
        { error: `Unsupported target language: ${targetLang}. Supported: fr, pt, es` },
        { status: 400 }
      );
    }

    // Check cache
    const cacheKey = getCacheKey(text, targetLang);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ translatedText: cached.text, cached: true });
    }

    // MyMemory has a 5000 char limit per request. For longer text, split into chunks.
    const MAX_CHUNK = 4500;
    const langpair = LANG_MAP[targetLang];

    let translatedText: string;

    if (text.length <= MAX_CHUNK) {
      translatedText = await translateChunk(text, langpair);
    } else {
      // Split by paragraphs, then by sentences if still too long
      const paragraphs = text.split(/\n\n+/);
      const chunks: string[] = [];
      let current = "";

      for (const para of paragraphs) {
        if ((current + "\n\n" + para).length > MAX_CHUNK) {
          if (current) chunks.push(current);
          current = para;
        } else {
          current = current ? current + "\n\n" + para : para;
        }
      }
      if (current) chunks.push(current);

      const translated = await Promise.all(
        chunks.map((chunk) => translateChunk(chunk, langpair))
      );
      translatedText = translated.join("\n\n");
    }

    // Store in cache
    if (cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entries
      const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < entries.length / 2; i++) {
        cache.delete(entries[i][0]);
      }
    }
    cache.set(cacheKey, { text: translatedText, timestamp: Date.now() });

    return NextResponse.json({ translatedText, cached: false });
  } catch (err) {
    console.error("Translation error:", err);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}

async function translateChunk(text: string, langpair: string): Promise<string> {
  // Use POST to avoid URL length limits with long texts
  const url = "https://api.mymemory.translated.net/get";

  const params = new URLSearchParams({ q: text, langpair });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "RedListDashboard/1.0",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`MyMemory API returned ${res.status}`);
  }

  const data = await res.json();

  if (data.responseStatus !== 200 && data.responseStatus !== "200") {
    // Fallback: return original text if translation fails
    console.warn("MyMemory translation warning:", data.responseStatus, data.responseDetails);
    return text;
  }

  return data.responseData?.translatedText || text;
}
