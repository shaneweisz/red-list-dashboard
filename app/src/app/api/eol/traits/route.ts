import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

const EOL_CYPHER_API = "https://eol.org/service/cypher";

// In-memory cache (1 hour) — trait data changes infrequently, and this is an
// authenticated TraitBank call, so we're extra conservative about re-querying.
const traitsCache = new Map<number, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

const MAX_RECORDS = 200;

// Substrings (checked against the lowercased predicate name) of traits
// relevant to a Red List assessor — generation length and longevity feed
// directly into Criterion A/E timeframes, body size/density/reproduction
// feed into population and habitat-specificity judgments. We only ever show
// this subset (matched directly in the Cypher WHERE, not filtered after the
// fact), for two reasons: it's what an assessor actually wants, and it keeps
// the query itself narrow. EOL's Cypher endpoint has no ORDER BY guarantee,
// so a broad unfiltered query (e.g. every trait a well-studied predator has,
// including hundreds of "eat"/"prey on" association records) can have LIMIT
// applied to an arbitrary ordering — flooding the window with irrelevant
// records before it ever reaches, say, "age at maturity". Filtering by
// keyword in the WHERE clause avoids that entirely, and also means every
// record for a matched predicate is fetched (nothing partial).
//
// Order here is also the display order (most decision-relevant first).
const ASSESSOR_PRIORITY = [
  "generation length",
  "longevity",
  "life span",
  "lifespan",
  "age at maturity",
  "age at first reproduction",
  "sexual maturity",
  "population density",
  "body mass",
  "body length",
  "wingspan",
  "snout-vent length",
  "litter size",
  "clutch size",
  "brood size",
  "litters per year",
  "clutches per year",
  "inter-birth interval",
  "gestation",
  // Plant-specific analogs of the animal size/life-history traits above.
  "growth form", // catches "plant growth form" and "primary growth form"
  "growth habit",
  "life cycle habit", // annual/biennial/perennial — the plant equivalent of a lifeform/habit classification
  "plant height",
  "seed mass",
  "wood density",
  "habitat",
  "trophic guild",
  "diet",
  "movement",
  "migrat",
  "dispersal",
  "drought tolerance",
  "shade tolerance",
  "salt tolerance",
  "fire tolerance",
  "low temperature tolerance",
];

interface CypherResponse {
  columns: string[];
  data: (string | number | null)[][];
}

interface TraitRecord {
  predicate: string;
  definition: string | null;
  source: string | null;
  measurement: number | null; // set for numeric records, null for categorical
  unit: string; // "" if none/not applicable
  text: string; // categorical value, or the numeric value pre-formatted as a fallback
}

interface TraitGroup {
  predicate: string;
  definition: string | null;
  value: string;
  recordCount: number;
  source: string | null;
}

function priorityRank(predicate: string): number {
  const lower = predicate.toLowerCase();
  const i = ASSESSOR_PRIORITY.findIndex((p) => lower.includes(p));
  return i === -1 ? Infinity : i;
}

/** Round to a sensible number of decimals for display given the value's magnitude. */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  if (abs >= 1 || abs === 0) return n.toFixed(2);
  return n.toPrecision(2); // small magnitudes (e.g. daily growth rates) need more than 2 decimals
}

// Grams read awkwardly at mammal/bird body-mass scale (e.g. "61700 g"); EOL's
// normalized units are almost always grams, so this single case covers the
// vast majority of body-mass/weight traits.
function normalizeUnit(value: number, unit: string): { value: number; unit: string } {
  if (unit === "g" && Math.abs(value) >= 1000) return { value: value / 1000, unit: "kg" };
  // Home range / territory size areas are normalized to m^2, which reads as
  // an unreadable string of digits at animal-territory scale (e.g. "79520000
  // m^2" for a lion pride).
  if (unit === "m^2" && Math.abs(value) >= 1_000_000) return { value: value / 1_000_000, unit: "km²" };
  // Plant height is normalized to cm, which reads oddly for trees (e.g.
  // "3500 cm" for a 35m oak).
  if (unit === "cm" && Math.abs(value) >= 100) return { value: value / 100, unit: "m" };
  return { value, unit };
}

/**
 * Collapse a group's raw records into one clean display value. Numeric
 * records (e.g. repeated "body mass" measurements from different sources)
 * collapse to their median — a single representative number rather than a
 * noisy list of every reported figure. Categorical records (e.g. "habitat",
 * "diet includes") collapse to a deduped, comma-joined list — every distinct
 * value is shown, since silently truncating a list is worse than a long row.
 */
function summarizeGroup(records: TraitRecord[]): string {
  const numeric = records.filter((r) => r.measurement != null);
  if (numeric.length === records.length && numeric.length > 0) {
    const units = new Set(numeric.map((r) => r.unit));
    const unit = units.size === 1 ? numeric[0].unit : "";
    const nums = numeric.map((r) => r.measurement as number).sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    const median = nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    const normalized = normalizeUnit(median, unit);
    return `${formatNumber(normalized.value)}${normalized.unit ? ` ${normalized.unit}` : ""}`;
  }

  return Array.from(new Set(records.map((r) => r.text))).join(", ");
}

/**
 * GET /api/eol/traits?pageId=<eol_page_id>
 *
 * Fetches the subset of TraitBank records relevant to a Red List assessor
 * for a single EOL page via the authenticated Cypher endpoint, and groups
 * repeated predicates (e.g. multiple "habitat" records) into one row.
 * Scoped to one species per request (never a bulk/crawl query) to stay well
 * within EOL's fair-use expectations for the token issued to this project
 * — see EOL_TOKEN in .env.example.
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

  // pageId is validated as a positive integer above, and ASSESSOR_PRIORITY is
  // a fixed literal array of lowercase alphabetic strings, so it's safe to
  // inline both directly into the Cypher query string (the EOL cypher
  // service only takes a single raw `query` CGI param — no parameterized
  // query support).
  //
  // A single regex alternation is used instead of Cypher's
  // `ANY(kw IN [...] WHERE pred.name CONTAINS kw)` list form: the latter got
  // 502'd by EOL's WAF once ASSESSOR_PRIORITY grew past ~37 entries (adding
  // plant-tolerance traits pushed it over) even though the query is still
  // scoped to one page and well-formed — apparently a length/complexity
  // ceiling, not a rate limit. The regex form encodes to meaningfully fewer
  // characters for the same keyword set, giving headroom to keep growing
  // this list.
  const pattern = ASSESSOR_PRIORITY.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const query = `
    MATCH (p:Page {page_id: ${pageId}})-[:trait|inferred_trait]->(t:Trait)-[:predicate]->(pred:Term)
    WHERE pred.name =~ "(?i).*(${pattern}).*"
    OPTIONAL MATCH (t)-[:object_term]->(obj:Term)
    OPTIONAL MATCH (t)-[:normal_units_term]->(units:Term)
    RETURN pred.name AS predicate, pred.definition AS predicateDefinition,
           t.normal_measurement AS measurement, units.name AS units,
           obj.name AS value, t.literal AS literal, t.source AS source
    LIMIT ${MAX_RECORDS}
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
    const definitionIdx = idx("predicateDefinition");
    const measurementIdx = idx("measurement");
    const unitsIdx = idx("units");
    const valueIdx = idx("value");
    const literalIdx = idx("literal");
    const sourceIdx = idx("source");

    const records: TraitRecord[] = [];
    for (const row of body.data || []) {
      const predicate = row[predicateIdx] as string | null;
      if (!predicate) continue;

      const rawMeasurement = row[measurementIdx] as string | number | null;
      const measurement = rawMeasurement != null ? Number(rawMeasurement) : null;
      const unit = (row[unitsIdx] as string | null) || "";
      // Prefer the ontology term name; some predicates (e.g. "population
      // trend") record free text via t.literal instead of an object_term.
      const categorical = (row[valueIdx] as string | null) || (row[literalIdx] as string | null);
      if (measurement == null && !categorical) continue; // no displayable value
      if (measurement != null && Number.isNaN(measurement)) continue;

      records.push({
        predicate,
        definition: (row[definitionIdx] as string | null) || null,
        source: (row[sourceIdx] as string | null) || null,
        measurement,
        unit,
        text: measurement != null ? `${formatNumber(measurement)}${unit ? ` ${unit}` : ""}` : (categorical as string),
      });
    }

    // Group repeated predicates (e.g. 8 separate "habitat" records) into one row.
    const groupRecords = new Map<string, TraitRecord[]>();
    for (const r of records) {
      const key = r.predicate.toLowerCase();
      if (!groupRecords.has(key)) groupRecords.set(key, []);
      groupRecords.get(key)!.push(r);
    }

    const traits: TraitGroup[] = Array.from(groupRecords.values())
      .map((recs) => ({
        predicate: recs[0].predicate,
        definition: recs.find((r) => r.definition)?.definition || null,
        value: summarizeGroup(recs),
        recordCount: recs.length,
        source: recs.find((r) => r.source)?.source || null,
      }))
      .sort((a, b) => priorityRank(a.predicate) - priorityRank(b.predicate) || a.predicate.localeCompare(b.predicate));

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
