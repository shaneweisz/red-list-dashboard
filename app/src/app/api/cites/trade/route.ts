import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

// NOTE: This hits the CITES Trade DB web interface's JSON endpoint, not an
// official API. It may break if CITES changes their frontend. No stable public
// API exists for this data at present.
const TRADE_API = "https://trade.cites.org/en/cites_trade/shipments";

// Cache for trade summaries (1 hour)
const tradeCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

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
  u: string;   // unit (kg, m3, pieces, etc. — empty string for count/unspecified)
  q: number;   // quantity (exporter reported, falling back to importer reported per CITES guide)
  e: string;   // exporter country code
  i: string;   // importer country code
  o: string;   // origin country code (non-empty when re-export: origin ≠ exporter)
}

interface TradeSummary {
  totalRecords: number;
  yearRange: [number, number];
  /** Record counts (and approximate quantities) by year */
  byYear: { year: number; quantity: number; records: number }[];
  /** Top traded term+unit combinations */
  topTerms: { term: string; unit: string; quantity: number; records: number }[];
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
  /** All unique term+unit combinations with record counts */
  allTerms: { term: string; unit: string; records: number }[];
}

function parseQty(val: string | null): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

/** Per CITES Trade Database Guide: prefer exporter reported quantity, fall back to importer. */
function preferredQty(r: TradeRow): number {
  const exQty = parseQty(r["Exporter reported quantity"]);
  const imQty = parseQty(r["Importer reported quantity"]);
  return exQty > 0 ? exQty : imQty;
}

function summarize(rows: TradeRow[]): TradeSummary {
  const years = rows.map((r) => r.Year).filter(Boolean);
  const yearRange: [number, number] = [Math.min(...years), Math.max(...years)];

  // By year — use exporter-preferred quantity
  const yearMap = new Map<number, { quantity: number; records: number }>();
  for (const r of rows) {
    const entry = yearMap.get(r.Year) || { quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += preferredQty(r);
    yearMap.set(r.Year, entry);
  }
  const byYear = Array.from(yearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({ year, ...v }));

  // By term+unit — quantities must not be aggregated across different units (CITES guide)
  const termUnitMap = new Map<string, { term: string; unit: string; quantity: number; records: number }>();
  for (const r of rows) {
    const term = r.Term || "unspecified";
    const unit = r.Unit || "";
    const key = `${term}::${unit}`;
    const entry = termUnitMap.get(key) || { term, unit, quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += preferredQty(r);
    termUnitMap.set(key, entry);
  }
  const topTerms = Array.from(termUnitMap.values())
    .sort((a, b) => b.records - a.records)
    .slice(0, 8);

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
    entry.quantity += preferredQty(r);
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
    entry.quantity += preferredQty(r);
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
    entry.quantity += preferredQty(r);
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
    q: preferredQty(r),
    e: r.Exporter || "",
    i: r.Importer || "",
    o: r.Origin || "",
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

  // All unique term+unit combinations with record counts
  const allTerms = Array.from(termUnitMap.values())
    .sort((a, b) => b.records - a.records)
    .map(({ term, unit, records }) => ({ term, unit, records }));

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
  };
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
    // Fetch full trade history — CITES data goes back to 1975 when the Convention entered into force
    const currentYear = new Date().getFullYear();

    const params = new URLSearchParams({
      "filters[taxon_concepts_ids][]": taxonId,
      "filters[report_type]": "comptab",
      "filters[time_range_start]": "1975",
      "filters[time_range_end]": String(currentYear),
      "filters[exporters_ids][]": "all_exp",
      "filters[importers_ids][]": "all_imp",
      "filters[sources_ids][]": "all_sou",
      "filters[purposes_ids][]": "all_pur",
      "filters[terms_ids][]": "all_ter",
      "filters[selection_taxon]": "taxonomic_cascade",
    });

    const resp = await fetch(`${TRADE_API}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `CITES Trade DB error: ${resp.status}` },
        { status: resp.status }
      );
    }

    const data = await resp.json();
    const rows: TradeRow[] = data?.shipment_comptab_export?.rows || [];

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
