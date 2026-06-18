import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const EOL_API = "https://eol.org/api";

// Identify ourselves honestly to EOL (their API Terms ask callers to observe
// rate limits; an identifying UA lets EOL contact/throttle us if needed).
const EOL_HEADERS = {
  "User-Agent": "RedListDashboard/1.0 (+https://github.com/shaneweisz/redlist-dashboard)",
};

// In-memory cache (1 hour) — EOL data changes infrequently.
const eolCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

interface EolSearchResult {
  id: number;
  title: string;
  link: string;
  content: string;
}

interface EolVernacular {
  vernacularName: string;
  language: string;
  eol_preferred?: boolean;
}

interface EolAgent {
  full_name: string;
  homepage?: string | null;
  role?: string;
}

interface EolDataObject {
  dataType?: string;
  dataSubtype?: string;
  language?: string;
  title?: string;
  description?: string;
  license?: string;
  rightsHolder?: string;
  source?: string;
  mediaURL?: string;
  eolMediaURL?: string;
  eolThumbnailURL?: string;
  agents?: EolAgent[];
}

interface EolTaxonProvider {
  nameAccordingTo?: string;
  scientificName?: string;
  taxonRank?: string;
}

interface EolPage {
  identifier: number;
  scientificName: string;
  vernacularNames?: EolVernacular[];
  dataObjects?: EolDataObject[];
  taxonConcepts?: EolTaxonProvider[];
}

const isText = (o: EolDataObject) => (o.dataType || "").includes("Text");
const isImage = (o: EolDataObject) => (o.dataType || "").includes("StillImage");

/** Map a Creative Commons / license URL to a short human label. */
function licenseLabel(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/licenses\/([a-z-]+)\/(\d\.\d)/i);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  if (url.includes("publicdomain")) return "Public Domain";
  return null;
}

const stripHtml = (s: string | null | undefined): string | null =>
  s ? s.replace(/<[^>]*>/g, "").trim() || null : null;

const photographer = (o: EolDataObject): string | null =>
  stripHtml(
    o.agents?.find((a) => a.role === "photographer")?.full_name ||
      o.rightsHolder ||
      o.agents?.[0]?.full_name ||
      null
  );

/** Upgrade an EOL thumbnail (…98x68.jpg) to a larger grid-friendly derivative. */
const gridThumb = (o: EolDataObject): string => {
  const base = o.eolThumbnailURL || o.eolMediaURL || o.mediaURL!;
  return base.replace(/\.\d+x\d+\.(jpg|png|jpeg)$/i, ".260x190.$1");
};

/**
 * GET /api/eol?name=<scientific_name>
 *
 * Looks up a species on the Encyclopedia of Life and returns a normalized
 * payload: the matching EOL page, English vernacular names, an attributed
 * image gallery, a brief summary (when an English article exists) and the
 * taxonomic data providers EOL aggregates.
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name parameter is required" }, { status: 400 });
  }

  const cacheKey = name.toLowerCase().trim();
  const cached = eolCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ ...cached.data, cached: true }, { headers: CACHE_1H });
  }

  try {
    // Step 1: resolve the scientific name to an EOL page id.
    const searchResp = await fetch(
      `${EOL_API}/search/1.0.json?q=${encodeURIComponent(name)}&page=1`,
      { headers: EOL_HEADERS }
    );
    if (!searchResp.ok) {
      return NextResponse.json({ error: `EOL search error: ${searchResp.status}` }, { status: searchResp.status });
    }
    const searchData = await searchResp.json();
    const results: EolSearchResult[] = searchData.results || [];

    // Prefer an exact (case-insensitive) title match, else the first result.
    const target = cacheKey;
    const match =
      results.find((r) => r.title.toLowerCase() === target) ||
      results.find((r) => r.title.toLowerCase().startsWith(target)) ||
      results[0];

    if (!match) {
      const result = { found: false, scientificName: name };
      eolCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return NextResponse.json(result, { headers: CACHE_1H });
    }

    // Step 2: fetch page details (images, texts, vernacular names, providers).
    const pageResp = await fetch(
      `${EOL_API}/pages/1.0/${match.id}.json?details=true&images_per_page=12` +
        `&texts_per_page=20&maps_per_page=0&videos_per_page=0&sounds_per_page=0` +
        `&vetted=0&common_names=true&taxonomy=true&language=en`,
      { headers: EOL_HEADERS }
    );
    if (!pageResp.ok) {
      return NextResponse.json({ error: `EOL pages error: ${pageResp.status}` }, { status: pageResp.status });
    }
    const pageBody = await pageResp.json();
    const page: EolPage = pageBody.taxonConcept || {};
    const objects = page.dataObjects || [];

    // Vernacular names deduped by name+language, English (Latin-script) first
    // so the full multilingual list is browsable. EOL's `eol_preferred` flag is
    // unreliable (it often favours a non-English name), so we ignore it.
    const seen = new Set<string>();
    const englishNames: { name: string; lang: string }[] = [];
    const otherNames: { name: string; lang: string }[] = [];
    for (const v of page.vernacularNames || []) {
      const name = v.vernacularName?.trim();
      const lang = v.language || "";
      if (!name || !lang) continue;
      const key = `${lang}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (lang === "en") {
        // EOL frequently mislabels non-English names (CJK, Cyrillic, etc.) as
        // "en"; keep only Latin-script names in the English bucket.
        if (!/^[\p{Script=Latin}\s'.\-()]+$/u.test(name)) continue;
        englishNames.push({ name, lang });
      } else {
        otherNames.push({ name, lang });
      }
    }
    const commonNames = [...englishNames, ...otherNames];
    const languageCount = new Set(commonNames.map((n) => n.lang)).size;

    // Brief summary: prefer an English "Brief Summary" article, else any English text.
    const englishTexts = objects.filter((o) => isText(o) && o.language === "en" && o.description);
    const summaryObj =
      englishTexts.find((o) => /brief summary/i.test(o.title || "")) || englishTexts[0];
    const summary = summaryObj
      ? {
          html: summaryObj.description!,
          title: summaryObj.title || null,
          source: summaryObj.source || null,
          license: licenseLabel(summaryObj.license),
          rightsHolder: summaryObj.rightsHolder || null,
        }
      : null;

    // Image gallery with attribution.
    const images = objects
      .filter((o) => isImage(o) && (o.eolMediaURL || o.mediaURL))
      .slice(0, 12)
      .map((o) => ({
        url: o.eolMediaURL || o.mediaURL!,
        thumb: gridThumb(o),
        title: stripHtml(o.title),
        rightsHolder: photographer(o),
        license: licenseLabel(o.license),
        source: o.source || null,
      }));

    // Distinct taxonomic data providers EOL aggregates ("according to").
    const providers = Array.from(
      new Set((page.taxonConcepts || []).map((t) => t.nameAccordingTo).filter(Boolean) as string[])
    ).slice(0, 12);

    const result = {
      found: true,
      eolId: page.identifier,
      pageUrl: `https://eol.org/pages/${page.identifier}`,
      scientificName: page.scientificName || match.title,
      commonNames,
      englishNameCount: englishNames.length,
      languageCount,
      summary,
      images,
      providers,
    };

    eolCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return NextResponse.json(result, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching EOL data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
