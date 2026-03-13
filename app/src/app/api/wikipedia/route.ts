import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const WIKIPEDIA_API = "https://en.wikipedia.org/api/rest_v1";

// In-memory cache (1 hour)
const wikiCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

/**
 * GET /api/wikipedia?name=<scientific_name>
 *
 * Fetches the full Wikipedia article for a species by its scientific name.
 * Uses the Wikipedia REST API mobile-sections endpoint to get all sections.
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
    const title = name.trim().replace(/ /g, "_");

    // Fetch summary (for thumbnail, description, URLs) and full sections in parallel
    const [summaryResp, sectionsResp] = await Promise.all([
      fetch(`${WIKIPEDIA_API}/page/summary/${encodeURIComponent(title)}`, {
        headers: { Accept: "application/json" },
      }),
      fetch(`${WIKIPEDIA_API}/page/mobile-sections/${encodeURIComponent(title)}`, {
        headers: { Accept: "application/json" },
      }),
    ]);

    if (summaryResp.status === 404 || sectionsResp.status === 404) {
      const result = { found: false, scientificName: name };
      wikiCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return NextResponse.json(result, { headers: CACHE_1H });
    }

    if (!summaryResp.ok) {
      return NextResponse.json(
        { error: `Wikipedia API error: ${summaryResp.status}` },
        { status: summaryResp.status }
      );
    }

    const [summaryData, sectionsData] = await Promise.all([
      summaryResp.json(),
      sectionsResp.ok ? sectionsResp.json() : null,
    ]);

    // Extract lead section HTML
    const leadHtml = sectionsData?.lead?.sections?.[0]?.text || summaryData.extract_html || null;

    // Extract remaining sections (title + HTML content)
    const sections: { title: string; html: string; toclevel: number }[] = [];
    if (sectionsData?.remaining?.sections) {
      for (const s of sectionsData.remaining.sections) {
        if (s.text && s.line) {
          sections.push({
            title: s.line,
            html: s.text,
            toclevel: s.toclevel ?? 1,
          });
        }
      }
    }

    const result = {
      found: true,
      scientificName: name,
      title: summaryData.title,
      description: summaryData.description || null,
      leadHtml,
      sections,
      thumbnail: summaryData.thumbnail
        ? {
            source: summaryData.thumbnail.source,
            width: summaryData.thumbnail.width,
            height: summaryData.thumbnail.height,
          }
        : null,
      originalImage: summaryData.originalimage
        ? {
            source: summaryData.originalimage.source,
            width: summaryData.originalimage.width,
            height: summaryData.originalimage.height,
          }
        : null,
      pageUrl: summaryData.content_urls?.desktop?.page || null,
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
