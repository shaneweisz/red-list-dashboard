import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getTaxonGroups } from "@/lib/supabase/taxon-groups";
import { CACHE_1H } from "@/lib/cache-headers";

interface YearRange {
  range: string;
  count: number;
  minYear: number;
  maxYear: number;
}

function getYearRange(yearsSince: number): string {
  if (yearsSince <= 1) return "0-1 years";
  if (yearsSince <= 5) return "2-5 years";
  if (yearsSince <= 10) return "6-10 years";
  if (yearsSince <= 20) return "11-20 years";
  return "20+ years";
}

const PAGE_SIZE = 10_000;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "plantae";
  const groups = getTaxonGroups(taxonId);

  // Fetch all assessment_date values for the taxon, paginating past Supabase's default limit
  const allDates: (string | null)[] = [];
  let from = 0;
  let totalCount: number | null = null;

  while (true) {
    const { data, error, count } = await supabase
      .from("species")
      .select("assessment_date", { count: "exact" })
      .not("sis_taxon_id", "is", null)
      .in("table1a_taxon_group", groups)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Supabase error fetching assessments:", error);
      return NextResponse.json(
        { error: "Failed to fetch species data from database." },
        { status: 503 }
      );
    }

    if (totalCount === null) {
      totalCount = count ?? 0;
    }

    if (data && data.length > 0) {
      for (const row of data) {
        allDates.push((row as { assessment_date: string | null }).assessment_date);
      }
    }

    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const sampleSize = totalCount ?? allDates.length;

  const currentYear = new Date().getFullYear();
  const yearCounts: Record<string, number> = {
    "0-1 years": 0,
    "2-5 years": 0,
    "6-10 years": 0,
    "11-20 years": 0,
    "20+ years": 0,
  };

  for (const assessmentDate of allDates) {
    if (assessmentDate) {
      const assessmentYear = new Date(assessmentDate).getFullYear();
      if (!isNaN(assessmentYear)) {
        const yearsSince = currentYear - assessmentYear;
        const range = getYearRange(yearsSince);
        yearCounts[range]++;
      }
    }
  }

  const yearRanges: YearRange[] = [
    { range: "0-1 years", count: yearCounts["0-1 years"], minYear: 0, maxYear: 1 },
    { range: "2-5 years", count: yearCounts["2-5 years"], minYear: 2, maxYear: 5 },
    { range: "6-10 years", count: yearCounts["6-10 years"], minYear: 6, maxYear: 10 },
    { range: "11-20 years", count: yearCounts["11-20 years"], minYear: 11, maxYear: 20 },
    { range: "20+ years", count: yearCounts["20+ years"], minYear: 21, maxYear: 999 },
  ];

  return NextResponse.json(
    {
      yearsSinceAssessment: yearRanges,
      sampleSize,
      lastUpdated: new Date().toISOString(),
      cached: true,
    },
    { headers: CACHE_1H }
  );
}
