import { NextRequest, NextResponse } from "next/server";

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

interface TradeSummary {
  totalRecords: number;
  yearRange: [number, number];
  /** Total quantities by year (max of importer/exporter reported) */
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
}

function parseQty(val: string | null): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function summarize(rows: TradeRow[]): TradeSummary {
  const years = rows.map((r) => r.Year).filter(Boolean);
  const yearRange: [number, number] = [Math.min(...years), Math.max(...years)];

  // By year
  const yearMap = new Map<number, { quantity: number; records: number }>();
  for (const r of rows) {
    const entry = yearMap.get(r.Year) || { quantity: 0, records: 0 };
    entry.records++;
    entry.quantity += Math.max(
      parseQty(r["Importer reported quantity"]),
      parseQty(r["Exporter reported quantity"])
    );
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
    entry.quantity += Math.max(
      parseQty(r["Importer reported quantity"]),
      parseQty(r["Exporter reported quantity"])
    );
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
    entry.quantity += Math.max(
      parseQty(r["Importer reported quantity"]),
      parseQty(r["Exporter reported quantity"])
    );
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
    entry.quantity += Math.max(
      parseQty(r["Importer reported quantity"]),
      parseQty(r["Exporter reported quantity"])
    );
    importerMap.set(r.Importer, entry);
  }
  const topImporters = Array.from(importerMap.entries())
    .sort(([, a], [, b]) => b.records - a.records)
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));

  return {
    totalRecords: rows.length,
    yearRange,
    byYear,
    topTerms,
    topPurposes,
    topSources,
    topExporters,
    topImporters,
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

  if (!taxonId) {
    return NextResponse.json(
      { error: "taxon_id parameter is required" },
      { status: 400 }
    );
  }

  const cacheKey = taxonId;
  const cached = tradeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data);
  }

  try {
    // Fetch last 10 years of comparative tabulation data
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 10;

    const params = new URLSearchParams({
      "filters[taxon_concepts_ids][]": taxonId,
      "filters[report_type]": "comptab",
      "filters[time_range_start]": String(startYear),
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
      return NextResponse.json(result);
    }

    const summary = summarize(rows);
    const result = { found: true, taxonId, ...summary };
    tradeCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching CITES trade data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
