import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getTaxonGroups } from "@/lib/supabase/taxon-groups";
import { CACHE_5M } from "@/lib/cache-headers";

// Maps DB table1a_taxon_group → display taxon ID used in the "all" view
const DB_GROUP_TO_TAXON_ID: Record<string, string> = {
  fishes: "fishes",
  insecta: "invertebrates",
  arachnida: "invertebrates",
  mollusca: "invertebrates",
  crustacea: "invertebrates",
  corals: "invertebrates",
  other_invertebrates: "invertebrates",
  velvet_worms: "invertebrates",
  horseshoe_crabs: "invertebrates",
  flowering_plants: "plantae",
  gymnosperms: "plantae",
  ferns_and_allies: "plantae",
  mosses: "plantae",
  green_algae: "plantae",
  red_algae: "plantae",
  brown_algae: "plantae",
  mushrooms: "fungi",
};

function mapTaxonId(group: string): string {
  return DB_GROUP_TO_TAXON_ID[group] ?? group;
}

interface DbSpeciesRow {
  id: number;
  sis_taxon_id: number | null;
  assessment_id: number | null;
  scientific_name: string;
  common_name: string | null;
  family: string | null;
  iucn_category: string | null;
  assessment_date: string | null;
  year_published: string | null;
  population_trend: string | null;
  countries: string[];
  class_name: string | null;
  order_name: string | null;
  table1a_taxon_group: string;
  gbif_species_key: number | null;
  gbif_total_count: number | null;
  gbif_count_since_assessment: number | null;
}

const SELECT_COLUMNS = [
  "id", "sis_taxon_id", "assessment_id", "scientific_name", "common_name",
  "family", "iucn_category", "assessment_date", "year_published",
  "population_trend", "countries", "class_name", "order_name",
  "table1a_taxon_group", "gbif_species_key", "gbif_total_count",
  "gbif_count_since_assessment",
].join(",");

function mapRow(row: DbSpeciesRow) {
  return {
    id: row.id,
    sis_taxon_id: row.sis_taxon_id,
    assessment_id: row.assessment_id,
    scientific_name: row.scientific_name,
    common_name: row.common_name,
    family: row.family,
    category: row.iucn_category ?? "NE",
    assessment_date: row.assessment_date,
    year_published: row.year_published,
    population_trend: row.population_trend,
    countries: row.countries ?? [],
    class_name: row.class_name,
    order_name: row.order_name,
    taxon_group: row.table1a_taxon_group,
    taxon_id: mapTaxonId(row.table1a_taxon_group),
    gbif_species_key: row.gbif_species_key,
    gbif_occurrence_count: row.gbif_total_count,
    gbif_observations_after_assessment_year: row.gbif_count_since_assessment,
  };
}

/**
 * Fetch all species rows for the given taxon groups in batches.
 */
async function fetchAllSpecies(groups: string[], includeNE: boolean) {
  const BATCH_SIZE = 50_000;
  const allRows: DbSpeciesRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("species")
      .select(SELECT_COLUMNS)
      .in("table1a_taxon_group", groups)
      .range(offset, offset + BATCH_SIZE - 1);

    if (!includeNE) {
      query = query.not("sis_taxon_id", "is", null);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as DbSpeciesRow[];
    allRows.push(...rows);

    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return allRows;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "all";
  const category = searchParams.get("category");
  const groups = getTaxonGroups(taxonId);

  try {
    // NE species are fetched separately on demand
    const includeNE = category === "NE";
    const rows = await fetchAllSpecies(groups, includeNE);

    let species = rows.map(mapRow);

    // If requesting NE specifically, filter to only NE
    if (category === "NE") {
      species = species.filter((s) => s.category === "NE");
    }

    return NextResponse.json(
      { species, total: species.length },
      { headers: CACHE_5M }
    );
  } catch (error) {
    console.error("Species query error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Species query failed: ${message}` },
      { status: 500 }
    );
  }
}
