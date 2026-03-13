import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const WIKIPEDIA_REST = "https://en.wikipedia.org/api/rest_v1";
const WIKIPEDIA_ACTION = "https://en.wikipedia.org/w/api.php";

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

  const userAgent =
    "RedListDashboard/1.0 (https://github.com/red-list-dashboard)";

  try {
    // Step 1: Get summary via the REST API (includes extract + thumbnail)
    const summaryRes = await fetch(
      `${WIKIPEDIA_REST}/page/summary/${encodeURIComponent(name)}`,
      { headers: { "Api-User-Agent": userAgent } }
    );

    if (summaryRes.status === 404) {
      return NextResponse.json({ found: false } satisfies WikiResponse, {
        headers: CACHE_1H,
      });
    }

    if (!summaryRes.ok) {
      return NextResponse.json(
        {
          found: false,
          error: `Wikipedia API returned ${summaryRes.status}`,
        } satisfies WikiResponse,
        { status: 502 }
      );
    }

    const summaryData = await summaryRes.json();
    const title: string = summaryData.title;

    // Step 2: Use the MediaWiki action API to get parsed sections
    // action=parse returns the full page broken into sections
    const parseUrl = new URL(WIKIPEDIA_ACTION);
    parseUrl.searchParams.set("action", "parse");
    parseUrl.searchParams.set("page", title);
    parseUrl.searchParams.set("prop", "sections|text");
    parseUrl.searchParams.set("format", "json");
    parseUrl.searchParams.set("disabletoc", "true");

    const parseRes = await fetch(parseUrl.toString(), {
      headers: { "Api-User-Agent": userAgent },
    });

    let sections: WikiSection[] = [];
    if (parseRes.ok) {
      const parseData = await parseRes.json();
      const parsedSections: {
        index: string;
        line: string;
        toclevel: number;
        byteoffset: number;
      }[] = parseData?.parse?.sections || [];
      const fullHtml: string = parseData?.parse?.text?.["*"] || "";

      if (fullHtml && parsedSections.length > 0) {
        sections = extractSections(fullHtml, parsedSections);
      }
    }

    const result: WikiResponse = {
      found: true,
      title,
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

/**
 * Extract individual section HTML from the full parsed page HTML.
 *
 * MediaWiki wraps each section in heading tags (h2, h3, etc.) with
 * id attributes matching the section anchor. We split on these headings
 * to isolate each section's content.
 */
function extractSections(
  fullHtml: string,
  tocSections: {
    index: string;
    line: string;
    toclevel: number;
  }[]
): WikiSection[] {
  const results: WikiSection[] = [];

  // Filter out pseudo-sections (like "References", "External links" that are mostly just links)
  const skipTitles = new Set([
    "References",
    "External links",
    "Further reading",
    "Notes",
    "See also",
    "Bibliography",
  ]);

  for (let i = 0; i < tocSections.length; i++) {
    const sec = tocSections[i];
    if (skipTitles.has(sec.line)) continue;

    const headingLevel = sec.toclevel + 1; // toclevel 1 = h2, 2 = h3, etc.
    const headingTag = `h${headingLevel}`;

    // Find this section's heading in the HTML
    // MediaWiki uses <h2><span class="mw-headline" id="...">Title</span>...
    const headingPattern = new RegExp(
      `<${headingTag}[^>]*>\\s*<span[^>]*id="[^"]*"[^>]*>\\s*${escapeRegExp(sec.line)}`,
      "i"
    );
    const headingMatch = headingPattern.exec(fullHtml);
    if (!headingMatch) continue;

    // Content starts after the closing heading tag
    const afterHeading = fullHtml.indexOf(
      `</${headingTag}>`,
      headingMatch.index
    );
    if (afterHeading === -1) continue;
    const contentStart = afterHeading + `</${headingTag}>`.length;

    // Content ends at the next heading of equal or higher level (h2 for toclevel 1, etc.)
    // or at the end of the HTML
    let contentEnd = fullHtml.length;
    for (let level = 2; level <= headingLevel; level++) {
      const nextHeading = fullHtml.indexOf(`<h${level}`, contentStart);
      if (nextHeading !== -1 && nextHeading < contentEnd) {
        contentEnd = nextHeading;
      }
    }

    const html = fullHtml.slice(contentStart, contentEnd).trim();
    if (!html) continue;

    results.push({
      id: parseInt(sec.index, 10),
      title: sec.line,
      level: sec.toclevel,
      html,
    });
  }

  return results;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
