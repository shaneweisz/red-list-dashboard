import { NextRequest, NextResponse } from "next/server";
import { getSpeciesData, countNeSpecies } from "../_shared/data";
import { TAXA } from "@/config/taxa";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxaParam = searchParams.get("taxa"); // comma-separated taxon IDs

  // Load all species data
  const data = getSpeciesData("all");
  if (!data) {
    return NextResponse.json(
      { error: "Species data not available" },
      { status: 503 }
    );
  }

  // Filter by selected taxa if specified
  const selectedTaxa = taxaParam
    ? new Set(taxaParam.split(",").filter(Boolean))
    : null;

  const species = selectedTaxa
    ? data.species.filter(s => s.taxon_id && selectedTaxa.has(s.taxon_id))
    : data.species;

  // Compute category counts
  const categoryCounts: Record<string, number> = {};
  // Compute year range counts
  const currentYear = new Date().getFullYear();
  const yearRangeCounts: Record<string, number> = {
    "0-1 years": 0,
    "2-5 years": 0,
    "6-10 years": 0,
    "11-20 years": 0,
    "20+ years": 0,
  };
  // Compute country counts
  const countryCounts: Record<string, number> = {};

  for (const s of species) {
    // Category counts (exclude NE)
    if (s.category !== "NE") {
      categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
    }

    // Year range counts (exclude NE, require assessment_date)
    if (s.assessment_date && s.category !== "NE") {
      const yr = new Date(s.assessment_date).getFullYear();
      const diff = currentYear - yr;
      if (diff <= 1) yearRangeCounts["0-1 years"]++;
      else if (diff <= 5) yearRangeCounts["2-5 years"]++;
      else if (diff <= 10) yearRangeCounts["6-10 years"]++;
      else if (diff <= 20) yearRangeCounts["11-20 years"]++;
      else yearRangeCounts["20+ years"]++;
    }

    // Country counts
    for (const code of s.countries) {
      countryCounts[code] = (countryCounts[code] || 0) + 1;
    }
  }

  // Count NE species
  const redListNames = new Set(
    data.species.map(s => s.scientific_name?.toLowerCase?.() || "").filter(Boolean)
  );

  let neCount = 0;
  if (selectedTaxa) {
    // Count NE species only for selected taxa
    const topLevelTaxa = TAXA.filter(t => t.id !== "all" && selectedTaxa.has(t.id));
    for (const taxon of topLevelTaxa) {
      neCount += countNeSpecies(taxon.id, redListNames);
    }
  } else {
    neCount = countNeSpecies("all", redListNames);
  }

  const totalAssessed = species.filter(s => s.category !== "NE").length;

  return NextResponse.json({
    categoryCounts,
    yearRangeCounts,
    countryCounts,
    totalAssessed,
    neCount,
  });
}
