import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const WIKIPEDIA_API = "https://en.wikipedia.org/api/rest_v1";

// In-memory cache (1 hour)
const wikiCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

/**
 * GET /api/wikipedia?name=<scientific_name>
 *
 * Fetches the Wikipedia summary for a species by its scientific name.
 * Uses the Wikipedia REST API to get the page summary (extract, thumbnail, URL).
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");

  if (!name) {
    return NextResponse.json(
      { error: "name parameter is required" },
      { status: 400 }
    );
  }

  const cacheKey = name.toLowerCase().trim();
  const cached = wikiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ ...cached.data, cached: true }, { headers: CACHE_1H });
  }

  try {
    // Wikipedia titles use underscores for spaces
    const title = name.trim().replace(/ /g, "_");

    const resp = await fetch(`${WIKIPEDIA_API}/page/summary/${encodeURIComponent(title)}`, {
      headers: { "Accept": "application/json" },
    });

    if (resp.status === 404) {
      const result = { found: false, scientificName: name };
      wikiCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return NextResponse.json(result, { headers: CACHE_1H });
    }

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Wikipedia API error: ${resp.status}` },
        { status: resp.status }
      );
    }

    const data = await resp.json();

    const result = {
      found: true,
      scientificName: name,
      title: data.title,
      extract: data.extract,
      extractHtml: data.extract_html,
      description: data.description || null,
      thumbnail: data.thumbnail
        ? {
            source: data.thumbnail.source,
            width: data.thumbnail.width,
            height: data.thumbnail.height,
          }
        : null,
      originalImage: data.originalimage
        ? {
            source: data.originalimage.source,
            width: data.originalimage.width,
            height: data.originalimage.height,
          }
        : null,
      pageUrl: data.content_urls?.desktop?.page || null,
      mobileUrl: data.content_urls?.mobile?.page || null,
    };

    wikiCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return NextResponse.json(result, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching Wikipedia data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
