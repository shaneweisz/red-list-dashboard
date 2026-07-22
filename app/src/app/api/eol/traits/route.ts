import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const EOL_CYPHER_API = "https://eol.org/service/cypher";

// In-memory cache (1 hour) — trait data changes infrequently, and this is an
// authenticated TraitBank call, so we're extra conservative about re-querying.
const traitsCache = new Map<number, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

const MAX_TRAITS = 30;

interface CypherResponse {
  columns: string[];
  data: (string | number | null)[][];
}

interface Trait {
  predicate: string;
  value: string;
  source: string | null;
  traitId: string | null;
}

/**
 * GET /api/eol/traits?pageId=<eol_page_id>
 *
 * Fetches a bounded set of TraitBank records for a single EOL page via the
 * authenticated Cypher endpoint. Scoped to one species per request (never a
 * bulk/crawl query) to stay well within EOL's fair-use expectations for the
 * token issued to this project — see EOL_TOKEN in .env.example.
 */
export async function GET(request: NextRequest) {
  const pageIdParam = request.nextUrl.searchParams.get("pageId");
  const pageId = pageIdParam ? Number(pageIdParam) : NaN;
  if (!Number.isInteger(pageId) || pageId <= 0) {
    return NextResponse.json({ error: "pageId parameter must be a positive integer" }, { status: 400 });
  }

  const cached = traitsCache.get(pageId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ ...cached.data, cached: true }, { headers: CACHE_1H });
  }

  const token = process.env.EOL_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "EOL_TOKEN environment variable not set" }, { status: 500 });
  }

  // pageId is validated as a positive integer above, so it's safe to inline
  // directly into the Cypher query string (the EOL cypher service only takes
  // a single raw `query` CGI param — no parameterized-query support).
  const query = `
    MATCH (p:Page {page_id: ${pageId}})-[:trait|inferred_trait]->(t:Trait)-[:predicate]->(pred:Term)
    OPTIONAL MATCH (t)-[:object_term]->(obj:Term)
    OPTIONAL MATCH (t)-[:normal_units_term]->(units:Term)
    RETURN pred.name AS predicate, t.normal_measurement AS measurement, units.name AS units,
           obj.name AS value, t.source AS source, t.eol_pk AS traitId
    LIMIT ${MAX_TRAITS}
  `.trim();

  try {
    const url = `${EOL_CYPHER_API}?${new URLSearchParams({ query, format: "cypher" })}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `JWT ${token}`,
        "User-Agent": "RedListDashboard/1.0 (+https://github.com/shaneweisz/redlist-dashboard)",
      },
    });
    if (!resp.ok) {
      return NextResponse.json({ error: `EOL TraitBank error: ${resp.status}` }, { status: resp.status });
    }
    const body: CypherResponse = await resp.json();
    const cols = body.columns || [];
    const idx = (name: string) => cols.indexOf(name);
    const predicateIdx = idx("predicate");
    const measurementIdx = idx("measurement");
    const unitsIdx = idx("units");
    const valueIdx = idx("value");
    const sourceIdx = idx("source");
    const traitIdIdx = idx("traitId");

    const seen = new Set<string>();
    const traits: Trait[] = [];
    for (const row of body.data || []) {
      const predicate = row[predicateIdx] as string | null;
      const measurement = row[measurementIdx] as string | number | null;
      const units = row[unitsIdx] as string | null;
      const categorical = row[valueIdx] as string | null;
      if (!predicate) continue;

      const value = measurement != null ? `${measurement}${units ? ` ${units}` : ""}` : categorical;
      if (!value) continue; // skip rows with no displayable value (e.g. literal-only records)

      const dedupeKey = `${predicate}:${value}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      traits.push({
        predicate,
        value,
        source: (row[sourceIdx] as string | null) || null,
        traitId: (row[traitIdIdx] as string | null) || null,
      });
    }

    const result = {
      found: traits.length > 0,
      traits,
      dataUrl: `https://eol.org/pages/${pageId}/data`,
    };

    traitsCache.set(pageId, { data: result, timestamp: Date.now() });
    return NextResponse.json(result, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching EOL trait data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
