import { NextRequest, NextResponse } from "next/server";
import { getTaxonConfig, CATEGORY_COLORS, CATEGORY_NAMES } from "@/config/taxa";
import { CACHE_1H } from "@/lib/cache-headers";
import { supabase } from "@/lib/supabase/server";
import { getTaxonGroups } from "@/lib/supabase/taxon-groups";

// Category order for display (most threatened first, NE last)
const CATEGORY_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD", "NE"];

interface CategoryStats {
  code: string;
  name: string;
  count: number;
  color: string;
}

interface SpeciesRow {
  sis_taxon_id: number | null;
  gbif_species_key: number | null;
  iucn_category: string | null;
  assessment_date: string | null;
  gbif_total_count: number | null;
  countries: string[] | null;
}

async function fetchAllSpecies(taxonId: string): Promise<SpeciesRow[]> {
  const groups = getTaxonGroups(taxonId);
  const allRows: SpeciesRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("species")
      .select("sis_taxon_id, gbif_species_key, iucn_category, assessment_date, gbif_total_count, countries")
      .in("table1a_taxon_group", groups)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    allRows.push(...(data as SpeciesRow[]));

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "plantae";
  const taxon = getTaxonConfig(taxonId);

  let allSpecies: SpeciesRow[];
  try {
    allSpecies = await fetchAllSpecies(taxonId);
  } catch (error) {
    console.error(`Error fetching species from Supabase for ${taxonId}:`, error);
    return NextResponse.json(
      {
        error: `Species data not available for ${taxon.name}.`,
        taxon: {
          id: taxon.id,
          name: taxon.name,
          estimatedDescribed: taxon.estimatedDescribed,
          estimatedSource: taxon.estimatedSource,
        },
      },
      { status: 503 }
    );
  }

  // Red List species: have a sis_taxon_id
  const redListSpecies = allSpecies.filter((s) => s.sis_taxon_id !== null);
  // NE species: in GBIF but not Red List (gbif_species_key set, sis_taxon_id null)
  const neSpecies = allSpecies.filter(
    (s) => s.sis_taxon_id === null && s.gbif_species_key !== null
  );

  const totalAssessed = redListSpecies.length;
  const neCount = neSpecies.length;

  // Build category counts from Red List species
  const byCategoryData: Record<string, number> = { NE: neCount };
  for (const s of redListSpecies) {
    const cat = s.iucn_category || "DD";
    byCategoryData[cat] = (byCategoryData[cat] || 0) + 1;
  }

  const byCategory: CategoryStats[] = CATEGORY_ORDER.map((code) => ({
    code,
    name: CATEGORY_NAMES[code],
    count: byCategoryData[code] || 0,
    color: CATEGORY_COLORS[code],
  }));

  const sampleSize = totalAssessed + neCount;

  // Compute year-range distribution (Red List species only, skip NE category)
  const currentYear = new Date().getFullYear();
  const yearRanges = [
    { range: "0-1 years", shortRange: "0-1y", count: 0 },
    { range: "2-5 years", shortRange: "2-5y", count: 0 },
    { range: "6-10 years", shortRange: "6-10y", count: 0 },
    { range: "11-20 years", shortRange: "11-20y", count: 0 },
    { range: "20+ years", shortRange: ">20y", count: 0 },
  ];
  for (const s of redListSpecies) {
    if (!s.assessment_date) continue;
    const yr = new Date(s.assessment_date).getFullYear();
    const diff = currentYear - yr;
    if (diff <= 1) yearRanges[0].count++;
    else if (diff <= 5) yearRanges[1].count++;
    else if (diff <= 10) yearRanges[2].count++;
    else if (diff <= 20) yearRanges[3].count++;
    else yearRanges[4].count++;
  }

  // Compute GBIF observation distribution (Red List species only)
  const obsRanges = [
    { range: "0", shortRange: "0", count: 0 },
    { range: "1-10", shortRange: "1-10", count: 0 },
    { range: "11-100", shortRange: "11-100", count: 0 },
    { range: "101-1K", shortRange: "101-1K", count: 0 },
    { range: "1K-10K", shortRange: "1K-10K", count: 0 },
    { range: "10K+", shortRange: "10K+", count: 0 },
  ];
  for (const s of redListSpecies) {
    const obs = s.gbif_total_count ?? 0;
    if (obs === 0) obsRanges[0].count++;
    else if (obs <= 10) obsRanges[1].count++;
    else if (obs <= 100) obsRanges[2].count++;
    else if (obs <= 1000) obsRanges[3].count++;
    else if (obs <= 10000) obsRanges[4].count++;
    else obsRanges[5].count++;
  }

  // Compute country counts (Red List species only)
  const countryCounts: Record<string, number> = {};
  for (const s of redListSpecies) {
    if (s.countries) {
      for (const code of s.countries) {
        countryCounts[code] = (countryCounts[code] || 0) + 1;
      }
    }
  }

  return NextResponse.json(
    {
      totalAssessed,
      byCategory,
      sampleSize,
      taxon: {
        id: taxon.id,
        name: taxon.name,
        estimatedDescribed: taxon.estimatedDescribed,
        estimatedSource: taxon.estimatedSource,
        color: taxon.color,
      },
      // Pre-computed chart distributions
      yearRanges,
      obsRanges,
      countryCounts,
    },
    { headers: CACHE_1H }
  );
}
