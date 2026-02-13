import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  outdated: number;
  percentOutdated: number;
  lastUpdated: string | null;
  byCategory: Record<string, number>;
}

interface SummaryFile {
  taxa: TaxonSummary[];
  generatedAt: string;
}

// In-memory cache
let cachedSummary: SummaryFile | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function loadSummary(): SummaryFile | null {
  const summaryPath = path.join(process.cwd(), "data", "taxa-summary.json");

  try {
    if (!fs.existsSync(summaryPath)) {
      return null;
    }
    const content = fs.readFileSync(summaryPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function GET() {
  // Check cache
  if (cachedSummary && Date.now() - cacheTime < CACHE_TTL) {
    return NextResponse.json({ taxa: cachedSummary.taxa, cached: true });
  }

  // Load pre-computed summary file (~2KB instead of ~110MB)
  const summary = loadSummary();

  if (!summary) {
    return NextResponse.json(
      { error: "Taxa summary not found. Run: npx tsx scripts/generate-taxa-summary.ts" },
      { status: 500 }
    );
  }

  // Cache it
  cachedSummary = summary;
  cacheTime = Date.now();

  return NextResponse.json({ taxa: summary.taxa, cached: false });
}
