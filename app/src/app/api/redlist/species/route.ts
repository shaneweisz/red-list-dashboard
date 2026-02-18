import { NextRequest, NextResponse } from "next/server";
import { TAXA, getTaxonConfig, CATEGORY_ORDER } from "@/config/taxa";
import {
  getSpeciesData,
  loadGbifCsvLookup,
  getNeSpecies,
  type Species,
} from "../_shared/data";

// Get list of available taxa with their data status
function getAvailableTaxa(): { id: string; name: string; available: boolean; speciesCount: number }[] {
  return TAXA.map((taxon) => {
    let available = false;
    let speciesCount = 0;

    try {
      const data = getSpeciesData(taxon.id);
      if (data) {
        available = true;
        speciesCount = data.species.length;
      }
    } catch {
      // File doesn't exist or can't be read
    }

    return {
      id: taxon.id,
      name: taxon.name,
      available,
      speciesCount,
    };
  });
}

/** Check if a species matches a set of year range filters */
function matchesYearRangeFilter(assessmentDate: string | null, selectedYearRanges: Set<string>): boolean {
  if (selectedYearRanges.size === 0) return true;
  if (!assessmentDate) return false;
  const currentYear = new Date().getFullYear();
  const assessmentYear = new Date(assessmentDate).getFullYear();
  const yearsSince = currentYear - assessmentYear;

  for (const range of selectedYearRanges) {
    switch (range) {
      case "0-1 years": if (yearsSince <= 1) return true; break;
      case "2-5 years": if (yearsSince >= 2 && yearsSince <= 5) return true; break;
      case "6-10 years": if (yearsSince >= 6 && yearsSince <= 10) return true; break;
      case "11-20 years": if (yearsSince >= 11 && yearsSince <= 20) return true; break;
      case "20+ years": if (yearsSince > 20) return true; break;
    }
  }
  return false;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Special case: return list of available taxa
  if (searchParams.get("list") === "taxa") {
    return NextResponse.json({
      taxa: getAvailableTaxa(),
    });
  }

  // --- Server-side paginated endpoint ---
  const taxaParam = searchParams.get("taxa");
  const categoriesParam = searchParams.get("categories");
  const yearsParam = searchParams.get("years");
  const countriesParam = searchParams.get("countries");
  const search = searchParams.get("search")?.toLowerCase();
  const sortParam = searchParams.get("sort");
  const sortField = (sortParam === "none" ? null : sortParam) as "year" | "category" | "newGbif" | null;
  const sortDir = (searchParams.get("dir") || "desc") as "asc" | "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "10", 10)));
  const pinnedParam = searchParams.get("pinned");

  // Load all species
  const data = getSpeciesData("all");
  if (!data) {
    return NextResponse.json(
      { error: "Species data not available", species: [], total: 0 },
      { status: 503 }
    );
  }

  // Parse filter sets
  const selectedTaxa = taxaParam
    ? new Set(taxaParam.split(",").filter(Boolean))
    : null;
  const selectedCategories = categoriesParam
    ? new Set(categoriesParam.split(",").filter(Boolean))
    : null;
  const selectedYearRanges = yearsParam
    ? new Set(yearsParam.split(",").filter(Boolean))
    : null;
  const selectedCountries = countriesParam
    ? new Set(countriesParam.split(",").filter(Boolean))
    : null;
  const pinnedIds = pinnedParam
    ? new Set(pinnedParam.split(",").map(id => parseInt(id, 10)).filter(n => !isNaN(n)))
    : null;

  // 1. Filter by taxa
  let filtered: Species[] = selectedTaxa
    ? data.species.filter(s => s.taxon_id && selectedTaxa.has(s.taxon_id))
    : data.species;

  // 2. If categories includes NE, merge NE species
  const includesNE = selectedCategories?.has("NE");
  if (includesNE) {
    const redListNames = new Set(
      data.species.map(s => s.scientific_name.toLowerCase().trim())
    );
    const neSpecies = getNeSpecies("all", redListNames);
    // Filter NE species by selected taxa if applicable
    const filteredNe = selectedTaxa
      ? neSpecies.filter(s => s.taxon_id && selectedTaxa.has(s.taxon_id))
      : neSpecies;
    filtered = [...filtered, ...filteredNe];
  }

  // 3. Apply category filter
  if (selectedCategories && selectedCategories.size > 0) {
    filtered = filtered.filter(s => selectedCategories.has(s.category));
  }

  // 4. Apply year range filter (NE species skip year filter)
  if (selectedYearRanges && selectedYearRanges.size > 0) {
    filtered = filtered.filter(s =>
      s.category === "NE" || matchesYearRangeFilter(s.assessment_date, selectedYearRanges)
    );
  }

  // 5. Apply country filter
  if (selectedCountries && selectedCountries.size > 0) {
    filtered = filtered.filter(s =>
      s.countries.some(c => selectedCountries.has(c))
    );
  }

  // 6. Apply search filter
  if (search) {
    filtered = filtered.filter(s =>
      s.scientific_name.toLowerCase().includes(search) ||
      s.common_name?.toLowerCase().includes(search)
    );
  }

  // 7. If pinned param provided, filter to only those IDs and preserve pinned order
  if (pinnedIds && pinnedIds.size > 0) {
    filtered = filtered.filter(s => pinnedIds.has(s.sis_taxon_id));
  }

  const total = filtered.length;

  // 8. Load GBIF lookup (cached in memory) - needed for sort by newGbif and page enrichment
  const gbifLookup = loadGbifCsvLookup("all");

  // Helper to get GBIF after-assessment count for sorting (avoids enriching all 170k species)
  const getGbifAfterAssessment = (s: Species): number => {
    if (s.gbif_observations_after_assessment_year != null) return s.gbif_observations_after_assessment_year;
    const row = gbifLookup.get(s.scientific_name.toLowerCase().trim());
    return row ? row.observationsAfterAssessment : -1;
  };

  // 9. Sort
  const sorted = [...filtered].sort((a, b) => {
    // When pinned IDs are provided (starred mode), sort by pinned order
    if (pinnedIds && pinnedIds.size > 0) {
      const pinnedArr = pinnedParam!.split(",").map(id => parseInt(id, 10));
      const aIdx = pinnedArr.indexOf(a.sis_taxon_id);
      const bIdx = pinnedArr.indexOf(b.sis_taxon_id);
      return aIdx - bIdx;
    }

    if (!sortField) {
      // Stable tiebreaker only
      return a.sis_taxon_id - b.sis_taxon_id;
    }

    let comparison = 0;
    if (sortField === "year") {
      const dateA = a.assessment_date ? new Date(a.assessment_date).getTime() : 0;
      const dateB = b.assessment_date ? new Date(b.assessment_date).getTime() : 0;
      comparison = dateA - dateB;
    } else if (sortField === "category") {
      comparison = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
    } else if (sortField === "newGbif") {
      if (a.category === "NE" || b.category === "NE") {
        comparison = (a.gbif_occurrence_count ?? -1) - (b.gbif_occurrence_count ?? -1);
      } else {
        comparison = getGbifAfterAssessment(a) - getGbifAfterAssessment(b);
      }
    }

    // Stable tiebreaker
    if (comparison === 0) {
      comparison = a.sis_taxon_id - b.sis_taxon_id;
    }

    return sortDir === "asc" ? comparison : -comparison;
  });

  // 10. Paginate
  const start = (page - 1) * pageSize;
  const pageSpecies = sorted.slice(start, start + pageSize);

  // 11. GBIF-enrich only the returned page
  const enriched = gbifLookup.size > 0
    ? pageSpecies.map(s => {
        if (s.gbif_species_key) return s; // Already enriched (NE species)
        const row = gbifLookup.get(s.scientific_name.toLowerCase().trim());
        if (!row) return s;
        return {
          ...s,
          gbif_species_key: row.speciesKey,
          gbif_occurrence_count: row.observationsTotal,
          gbif_observations_after_assessment_year: row.observationsAfterAssessment,
        };
      })
    : pageSpecies;

  return NextResponse.json({
    species: enriched,
    total,
    page,
    pageSize,
  });
}
