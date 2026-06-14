import { NextRequest, NextResponse } from "next/server";
import { expandSearchNames } from "@/lib/nameVariants";
import { getSynonyms } from "@/lib/data/species-duckdb";
import { CACHE_1H } from "@/lib/cache-headers";

/**
 * Literature Since Assessment API
 *
 * Automatically finds literature published AFTER a species' last assessment date.
 * Combines results from:
 * - OpenAlex (primary): Scientific papers with DOIs, citations, abstracts
 * - Nosible (supplementary): Grey literature, news, NGO reports
 *
 * See: Weeknotes/Subpages/Nosible API Evaluation.md for comparison details
 */

interface OpenAlexWork {
  id: string;
  doi: string | null;
  title: string;
  publication_year: number | null;
  publication_date: string | null;
  cited_by_count: number;
  type: string;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{
    author: {
      display_name: string;
    };
  }>;
}

interface OpenAlexResponse {
  meta: {
    count: number;
  };
  results: OpenAlexWork[];
}

interface LiteratureResult {
  title: string;
  url: string;
  doi: string | null;
  year: number | null;
  date: string | null;
  citations: number | null;
  source: string;
  sourceType: "academic" | "grey";
  abstract: string | null;
  authors: string | null;
}

// Cache for literature results (1 hour)
const literatureCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Cap on how many synonyms we fold into the OpenAlex query. Some taxa carry
// dozens of synonyms; ORing them all would bloat the query URL with little
// marginal recall, so we take the first (alphabetical) batch.
const MAX_SYNONYM_NAMES = 30;

// Fetch a species' taxonomic synonyms (Catalogue of Life) so they can be folded
// into the literature search alongside the accepted name. Returns [] when no
// CoL identifier is available or the lookup fails — the search then falls back
// to just the accepted name and its gender variants.
async function fetchSynonymNames(col: string | null, sis: number | null): Promise<string[]> {
  if (!col && sis == null) return [];
  try {
    const data = await getSynonyms({ col, sis });
    return data.synonyms.map((s) => s.name).filter(Boolean).slice(0, MAX_SYNONYM_NAMES);
  } catch (error) {
    console.error("Literature synonym lookup error:", error);
    return [];
  }
}

// Reconstruct abstract from OpenAlex inverted index
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined, maxWords = 100): string | null {
  if (!invertedIndex) return null;

  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);

  const reconstructed = words.slice(0, maxWords).map(([, word]) => word).join(" ");
  return reconstructed + (words.length > maxWords ? "..." : "");
}

// Search OpenAlex for papers published after a given year
async function searchOpenAlexSinceYear(
  searchNames: string[],
  sinceYear: number,
  limit: number = 5
): Promise<{ count: number; results: LiteratureResult[] }> {
  // OpenAlex filter: use quoted default.search for exact phrase matching
  // OR together the accepted name's gender variants and the species' synonyms
  // (e.g. "albocaudata"|"albocaudatus"|"albocaudatum"|"<synonym>")
  // publication_year > sinceYear, exclude datasets (GBIF occurrence downloads)
  // Sorted by most recent first
  // Note: per_page must be >= 1 for the API to work, even for count-only requests
  const searchTerms = searchNames.map(v => `"${v}"`).join("|");
  const filter = encodeURIComponent(`default.search:${searchTerms},publication_year:>${sinceYear},type:!dataset`);
  const url = `https://api.openalex.org/works?filter=${filter}&sort=publication_date:desc&per_page=${Math.max(1, limit)}&mailto=sw984@cam.ac.uk`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error("OpenAlex API error:", response.status);
    return { count: 0, results: [] };
  }

  const data: OpenAlexResponse = await response.json();

  const results = data.results.map((work) => ({
    title: work.title,
    url: work.doi ? `https://doi.org/${work.doi.replace("https://doi.org/", "")}` : work.id,
    doi: work.doi,
    year: work.publication_year,
    date: work.publication_date,
    citations: work.cited_by_count,
    source: work.primary_location?.source?.display_name || "Unknown",
    sourceType: "academic" as const,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: work.authorships?.slice(0, 3).map(a => a.author.display_name).join(", ") || null,
  }));

  return { count: data.meta.count, results };
}

// Search OpenAlex for papers published up to and including a given year
async function searchOpenAlexUpToYear(
  searchNames: string[],
  upToYear: number,
  limit: number = 5
): Promise<{ count: number; results: LiteratureResult[] }> {
  // Use quoted default.search for exact phrase matching
  // OR together the accepted name's gender variants and the species' synonyms
  // Use < (year+1) instead of <= year to avoid encoding issues
  // Sorted by most cited first for pre-assessment papers
  const searchTerms = searchNames.map(v => `"${v}"`).join("|");
  const filter = encodeURIComponent(`default.search:${searchTerms},publication_year:<${upToYear + 1},type:!dataset`);
  const url = `https://api.openalex.org/works?filter=${filter}&sort=cited_by_count:desc&per_page=${Math.max(1, limit)}&mailto=sw984@cam.ac.uk`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error("OpenAlex API error:", response.status);
    return { count: 0, results: [] };
  }

  const data: OpenAlexResponse = await response.json();

  const results = data.results.map((work) => ({
    title: work.title,
    url: work.doi ? `https://doi.org/${work.doi.replace("https://doi.org/", "")}` : work.id,
    doi: work.doi,
    year: work.publication_year,
    date: work.publication_date,
    citations: work.cited_by_count,
    source: work.primary_location?.source?.display_name || "Unknown",
    sourceType: "academic" as const,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: work.authorships?.slice(0, 3).map(a => a.author.display_name).join(", ") || null,
  }));

  return { count: data.meta.count, results };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const scientificName = searchParams.get("scientificName");
  const assessmentYear = searchParams.get("assessmentYear");
  const limit = Math.min(parseInt(searchParams.get("limit") || "5"), 20);
  const mode = searchParams.get("mode") || "after"; // "after" or "before"
  // Optional CoL identifiers used to pull taxonomic synonyms into the search.
  const col = searchParams.get("col");
  const sisRaw = searchParams.get("sis");
  const sis = sisRaw != null && !Number.isNaN(parseInt(sisRaw, 10)) ? parseInt(sisRaw, 10) : null;

  if (!scientificName) {
    return NextResponse.json(
      { error: "Query parameter 'scientificName' is required" },
      { status: 400 }
    );
  }

  if (!assessmentYear) {
    return NextResponse.json(
      { error: "Query parameter 'assessmentYear' is required" },
      { status: 400 }
    );
  }

  const sinceYear = parseInt(assessmentYear);
  if (isNaN(sinceYear)) {
    return NextResponse.json(
      { error: "Invalid assessmentYear" },
      { status: 400 }
    );
  }

  // Check cache (keyed also by col/sis since they change the synonym set used)
  const cacheKey = `${scientificName.toLowerCase()}-${sinceYear}-${limit}-${mode}-${col ?? ""}-${sis ?? ""}`;
  const cached = literatureCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ ...cached.data, cached: true }, { headers: CACHE_1H });
  }

  try {
    // Fold the accepted name's gender variants together with the species'
    // taxonomic synonyms (and their gender variants) into one search-name list.
    const synonymNames = await fetchSynonymNames(col, sis);
    const searchNames = expandSearchNames(scientificName, synonymNames);

    let papers: { count: number; results: LiteratureResult[] };
    let otherCount: number;

    if (mode === "before") {
      // Pre-assessment: fetch papers up to assessment year, and count of post-assessment
      const [prePapers, postPapers] = await Promise.all([
        searchOpenAlexUpToYear(searchNames, sinceYear, limit),
        searchOpenAlexSinceYear(searchNames, sinceYear, 1),
      ]);
      papers = prePapers;
      otherCount = postPapers.count;
    } else {
      // Post-assessment (default): fetch papers after assessment year, and count of pre-assessment
      const [postPapers, prePapers] = await Promise.all([
        searchOpenAlexSinceYear(searchNames, sinceYear, limit),
        searchOpenAlexUpToYear(searchNames, sinceYear, 1),
      ]);
      papers = postPapers;
      otherCount = prePapers.count;
    }

    const result = {
      scientificName,
      assessmentYear: sinceYear,
      mode,
      searchNames,
      totalPapersSinceAssessment: mode === "after" ? papers.count : otherCount,
      papersAtAssessment: mode === "before" ? papers.count : otherCount,
      totalPapers: papers.count,
      topPapers: papers.results,
    };

    // Cache the result
    literatureCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return NextResponse.json(result, { headers: CACHE_1H });
  } catch (error) {
    console.error("Literature search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
