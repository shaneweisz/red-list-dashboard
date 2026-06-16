import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

// NOTE: This hits the CITES Trade DB web interface's JSON endpoint, not an
// official API. It may break if CITES changes their frontend. No stable public
// API exists for this data at present.
const TRADE_API = "https://trade.cites.org/en/cites_trade/shipments";

// Cache for trade summaries (1 hour)
const tradeCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

// CITES entered into force in 1975, so there is no trade data before then.
const FETCH_START_YEAR = 1975;
// The CITES endpoint returns inconsistent / partially-truncated results when a
// single request spans the full history (a 50-year pull for a heavily-traded
// species can silently drop thousands of rows, including whole recent years).
// We therefore fetch in small year-windows and concatenate — each window is
// small enough to return complete, reproducible data.
const FETCH_CHUNK_YEARS = 5;

/** Error that carries the upstream HTTP status so the route can propagate it. */
class CitesTradeError extends Error {
  status: number;
  constructor(status: number) {
    super(`CITES Trade DB error: ${status}`);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


interface TradeRow {
  Year: number;
  "App.": string;
  Taxon: string;
  Importer: string;
  Exporter: string;
  Origin: string | null;
  "Importer reported quantity": string | null;
  "Exporter reported quantity": string | null;
  Term: string;
  Unit: string | null;
  Purpose: string;
  Source: string;
}

// CITES purpose codes → human-readable labels
const PURPOSE_LABELS: Record<string, string> = {
  B: "Breeding in captivity",
  E: "Educational",
  G: "Botanical garden",
  H: "Hunting trophy",
  L: "Law enforcement",
  M: "Medical/biomedical",
  N: "Reintroduction",
  P: "Personal",
  Q: "Circus/exhibition",
  S: "Scientific",
  T: "Commercial",
  Z: "Zoo",
};

// CITES source codes → human-readable labels
const SOURCE_LABELS: Record<string, string> = {
  A: "Artificially propagated",
  C: "Captive-bred",
  D: "Appendix I captive-bred",
  F: "F1 captive-born",
  I: "Confiscated/seized",
  O: "Pre-Convention",
  R: "Ranched",
  U: "Unknown",
  W: "Wild",
  X: "Marine",
};

/** Compact per-shipment record for client-side filtering */
interface CompactRecord {
  y: number;   // year
  s: string;   // source code
  p: string;   // purpose code
  t: string;   // term
  u: string;   // unit (empty string = unit-less / "number of specimens")
  q: number;   // quantity (exporter-reported preferred, per CITES guide)
  e: string;   // exporter country code
  i: string;   // importer country code
  o: string;   // origin country code (for re-export pathways; empty if same as exporter)
}

interface TradeSummary {
  totalRecords: number;
  yearRange: [number, number];
  /** Total quantities by year (exporter-reported preferred) */
  byYear: { year: number; quantity: number; records: number }[];
  /** Top traded terms (e.g. "live", "skins", "trophies") */
  topTerms: { term: string; quantity: number; records: number }[];
  /** Top purposes */
  topPurposes: { code: string; label: string; records: number }[];
  /** Top sources */
  topSources: { code: string; label: string; records: number }[];
  /** Top exporting countries */
  topExporters: { code: string; records: number; quantity: number }[];
  /** Top importing countries */
  topImporters: { code: string; records: number; quantity: number }[];
  /** Top bilateral trade flows (exporter → importer) */
  topFlows: { from: string; to: string; records: number; quantity: number }[];
  /** Compact per-shipment records for client-side filtering */
  shipments: CompactRecord[];
  /** All unique source codes with labels */
  allSources: { code: string; label: string; records: number }[];
  /** All unique purpose codes with labels */
  allPurposes: { code: string; label: string; records: number }[];
  /** All unique terms with record counts */
  allTerms: { term: string; records: number }[];
  /**
   * Terms grouped by term + unit. Quantities are NEVER aggregated across
   * different units (kg, m³, pieces, unit-less) — each term+unit is its own row.
   */
  allTermsByUnit: { term: string; unit: string; records: number; quantity: number }[];
}

function parseQty(val: string | null): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Pick the reported quantity for a row. The CITES Trade Database Guide treats
 * importer- and exporter-reported figures as two independent reports of the
 * same trade — they must never be summed. We prefer the exporter-reported
 * quantity (the re-exporter is the authority on what left their territory),
 * falling back to the importer figure only when the exporter did not report.
 */
function pickQty(r: TradeRow): number {
  const exporter = parseQty(r["Exporter reported quantity"]);
  if (exporter > 0) return exporter;
  return parseQty(r["Importer reported quantity"]);
}

function summarize(rows: TradeRow[]): TradeSummary {
  const years = rows.map((r) => r.Year).filter(Boolean);
  const yearRange: [number, number] = [Math.min(...years), Math.max(...years)];

  // By year
  const yearMap = new Map<number, { quantity: number; records: number }>();
  for (const r of rows) {
    const entry = yearMap.get(r.Year) || { quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += pickQty(r);
    yearMap.set(r.Year, entry);
  }
  const byYear = Array.from(yearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({ year, ...v }));

  // By term
  const termMap = new Map<string, { quantity: number; records: number }>();
  for (const r of rows) {
    const term = r.Term || "unspecified";
    const entry = termMap.get(term) || { quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += pickQty(r);
    termMap.set(term, entry);
  }
  const topTerms = Array.from(termMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([term, v]) => ({ term, ...v }));

  // By purpose
  const purposeMap = new Map<string, number>();
  for (const r of rows) {
    if (r.Purpose) purposeMap.set(r.Purpose, (purposeMap.get(r.Purpose) || 0) + 1);
  }
  const topPurposes = Array.from(purposeMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([code, records]) => ({
      code,
      label: PURPOSE_LABELS[code] || code,
      records,
    }));

  // By source
  const sourceMap = new Map<string, number>();
  for (const r of rows) {
    if (r.Source) sourceMap.set(r.Source, (sourceMap.get(r.Source) || 0) + 1);
  }
  const topSources = Array.from(sourceMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([code, records]) => ({
      code,
      label: SOURCE_LABELS[code] || code,
      records,
    }));

  // Top exporters
  const exporterMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
    if (!r.Exporter) continue;
    const entry = exporterMap.get(r.Exporter) || { records: 0, quantity: 0 };
    entry.records++;
    entry.quantity += pickQty(r);
    exporterMap.set(r.Exporter, entry);
  }
  const topExporters = Array.from(exporterMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  // Top importers
  const importerMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
    if (!r.Importer) continue;
    const entry = importerMap.get(r.Importer) || { records: 0, quantity: 0 };
    entry.records++;
    entry.quantity += pickQty(r);
    importerMap.set(r.Importer, entry);
  }
  const topImporters = Array.from(importerMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  // Bilateral flows (exporter → importer pairs)
  const flowMap = new Map<string, { records: number; quantity: number }>();
  for (const r of rows) {
    if (!r.Exporter || !r.Importer) continue;
    const key = `${r.Exporter}->${r.Importer}`;
    const entry = flowMap.get(key) || { records: 0, quantity: 0 };
    entry.records++;
    entry.quantity += pickQty(r);
    flowMap.set(key, entry);
  }
  const topFlows = Array.from(flowMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 12)
    .map(([key, v]) => {
      const [from, to] = key.split("->");
      return { from, to, ...v };
    });

  // Compact per-shipment records for client-side filtering
  const shipments: CompactRecord[] = rows.map((r) => ({
    y: r.Year,
    s: r.Source || "",
    p: r.Purpose || "",
    t: r.Term || "unspecified",
    u: r.Unit || "",
    q: pickQty(r),
    e: r.Exporter || "",
    i: r.Importer || "",
    // Origin only carried when it's a genuine re-export (origin differs from
    // the exporter); otherwise empty to keep the payload small.
    o: r.Origin && r.Origin !== r.Exporter ? r.Origin : "",
  }));

  // All unique sources (not just top 6)
  const allSources = Array.from(sourceMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({
      code,
      label: SOURCE_LABELS[code] || code,
      records,
    }));

  // All unique purposes (not just top 6)
  const allPurposes = Array.from(purposeMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([code, records]) => ({
      code,
      label: PURPOSE_LABELS[code] || code,
      records,
    }));

  // All unique terms with record counts
  const allTerms = Array.from(termMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .map(([term, v]) => ({ term, records: v.records }));

  // Terms grouped by term + unit — quantities are never summed across units.
  const termUnitMap = new Map<
    string,
    { term: string; unit: string; quantity: number; records: number }
  >();
  for (const r of rows) {
    const term = r.Term || "unspecified";
    const unit = r.Unit || "";
    const key = `${term} ${unit}`;
    const entry = termUnitMap.get(key) || { term, unit, quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += pickQty(r);
    termUnitMap.set(key, entry);
  }
  const allTermsByUnit = Array.from(termUnitMap.values()).sort(
    (a, b) => b.records - a.records
  );

  return {
    totalRecords: rows.length,
    yearRange,
    byYear,
    topTerms,
    topPurposes,
    topSources,
    topExporters,
    topImporters,
    topFlows,
    shipments,
    allSources,
    allPurposes,
    allTerms,
    allTermsByUnit,
  };
}

/**
 * Fetch one year-window of comparative-tabulation rows for a taxon, with a few
 * retries for transient upstream errors.
 */
async function fetchTradeChunk(
  taxonId: string,
  startYear: number,
  endYear: number
): Promise<TradeRow[]> {
  const params = new URLSearchParams({
    "filters[taxon_concepts_ids][]": taxonId,
    "filters[report_type]": "comptab",
    "filters[time_range_start]": String(startYear),
    "filters[time_range_end]": String(endYear),
    "filters[exporters_ids][]": "all_exp",
    "filters[importers_ids][]": "all_imp",
    "filters[sources_ids][]": "all_sou",
    "filters[purposes_ids][]": "all_pur",
    "filters[terms_ids][]": "all_ter",
    "filters[selection_taxon]": "taxonomic_cascade",
  });
  const url = `${TRADE_API}?${params.toString()}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(300 * attempt);
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) throw new CitesTradeError(resp.status);
      const data = await resp.json();
      return (data?.shipment_comptab_export?.rows as TradeRow[]) ?? [];
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("CITES Trade DB request failed");
}

/**
 * GET /api/cites/trade?taxon_id=<citesId>
 *
 * Fetches comparative tabulation data from the CITES Trade Database
 * and returns a pre-summarized overview.
 */
export async function GET(request: NextRequest) {
  const taxonId = request.nextUrl.searchParams.get("taxon_id");

  if (!taxonId || !/^\d+$/.test(taxonId)) {
    return NextResponse.json(
      { error: "taxon_id must be a numeric value" },
      { status: 400 }
    );
  }

  const cacheKey = taxonId;
  const cached = tradeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, { headers: CACHE_1H });
  }

  try {
    // Fetch the full available history (1975 → present) in small year-windows.
    // The upstream endpoint truncates large single-shot pulls non-determinist-
    // ically, so chunking is what makes the recent years (and the totals)
    // reliable — e.g. Panthera leo back to 1977 with complete recent data.
    const currentYear = new Date().getFullYear();

    const ranges: [number, number][] = [];
    for (let s = FETCH_START_YEAR; s <= currentYear; s += FETCH_CHUNK_YEARS) {
      ranges.push([s, Math.min(s + FETCH_CHUNK_YEARS - 1, currentYear)]);
    }

    const chunks = await Promise.all(
      ranges.map(([a, b]) => fetchTradeChunk(taxonId, a, b))
    );
    const rows: TradeRow[] = chunks.flat();

    if (rows.length === 0) {
      const result = { found: false, taxonId };
      tradeCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return NextResponse.json(result, { headers: CACHE_1H });
    }

    const summary = summarize(rows);
    const result = { found: true, taxonId, ...summary };
    tradeCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return NextResponse.json(result, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching CITES trade data:", error);
    const status = error instanceof CitesTradeError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status }
    );
  }
}
