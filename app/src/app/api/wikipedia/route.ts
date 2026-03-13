import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const WIKIPEDIA_API = "https://en.wikipedia.org/api/rest_v1";

interface WikiSection {
  id: number;
  title: string;
  level: number;
  html: string;
}

interface WikiResponse {
  found: boolean;
  title?: string;
  pageUrl?: string;
  summary?: string;
  thumbnail?: { source: string; width: number; height: number };
  sections?: WikiSection[];
  error?: string;
}

/**
 * GET /api/wikipedia?name=Panthera+leo
 *
 * Fetches the Wikipedia page for a species. Returns the summary (extract)
 * and all remaining sections with their HTML content.
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json(
      { found: false, error: "Missing name parameter" },
      { status: 400 }
    );
  }

  try {
    // Step 1: Get summary via the REST API (includes extract + thumbnail)
    const summaryRes = await fetch(
      `${WIKIPEDIA_API}/page/summary/${encodeURIComponent(name)}`,
      {
        headers: {
          "Api-User-Agent": "RedListDashboard/1.0 (https://github.com/red-list-dashboard)",
        },
      }
    );

    if (summaryRes.status === 404) {
      return NextResponse.json({ found: false } satisfies WikiResponse, {
        headers: CACHE_1H,
      });
    }

    if (!summaryRes.ok) {
      return NextResponse.json(
        { found: false, error: `Wikipedia API returned ${summaryRes.status}` } satisfies WikiResponse,
        { status: 502 }
      );
    }

    const summaryData = await summaryRes.json();

    // Step 2: Get the mobile-sections to parse out individual sections
    const sectionsRes = await fetch(
      `${WIKIPEDIA_API}/page/mobile-sections/${encodeURIComponent(summaryData.title)}`,
      {
        headers: {
          "Api-User-Agent": "RedListDashboard/1.0 (https://github.com/red-list-dashboard)",
        },
      }
    );

    let sections: WikiSection[] = [];
    if (sectionsRes.ok) {
      const sectionsData = await sectionsRes.json();
      sections = (sectionsData.remaining?.sections || []).map(
        (s: { id: number; line: string; toclevel: number; text: string }) => ({
          id: s.id,
          title: s.line,
          level: s.toclevel,
          html: s.text,
        })
      );
    }

    const result: WikiResponse = {
      found: true,
      title: summaryData.title,
      pageUrl: summaryData.content_urls?.desktop?.page,
      summary: summaryData.extract_html || summaryData.extract,
      thumbnail: summaryData.thumbnail
        ? {
            source: summaryData.thumbnail.source,
            width: summaryData.thumbnail.width,
            height: summaryData.thumbnail.height,
          }
        : undefined,
      sections,
    };

    return NextResponse.json(result, { headers: CACHE_1H });
  } catch (err) {
    return NextResponse.json(
      {
        found: false,
        error: err instanceof Error ? err.message : "Unknown error",
      } satisfies WikiResponse,
      { status: 500 }
    );
  }
}
