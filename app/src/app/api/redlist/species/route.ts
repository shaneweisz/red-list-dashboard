import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getTaxonGroups } from "@/lib/supabase/taxon-groups";
import { CACHE_5M } from "@/lib/cache-headers";

interface RedListSpeciesRequest {
  taxonId?: string;
  categories?: string[];
  yearRanges?: string[];
  countries?: string[];
  search?: string;
  obsRanges?: string[];
  sortField?: string;
  sortDirection?: string;
  page?: number;
  pageSize?: number;
}

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

export async function POST(request: NextRequest) {
  let body: RedListSpeciesRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const taxonId = body.taxonId || "all";
  const groups = getTaxonGroups(taxonId);

  const { data, error } = await supabase.rpc("redlist_species_query", {
    p_taxon_groups: groups,
    p_categories: body.categories?.length ? body.categories : null,
    p_year_ranges: body.yearRanges?.length ? body.yearRanges : null,
    p_countries: body.countries?.length ? body.countries : null,
    p_search: body.search || null,
    p_obs_ranges: body.obsRanges?.length ? body.obsRanges : null,
    p_sort_field: body.sortField || "priority",
    p_sort_direction: body.sortDirection || "desc",
    p_page: Math.max(1, Math.floor(body.page || 1)),
    p_page_size: Math.min(100, Math.max(1, Math.floor(body.pageSize || 10))),
  });

  if (error) {
    console.error("redlist_species_query error:", error);
    return NextResponse.json(
      { error: `Species query failed: ${error.message}` },
      { status: 500 }
    );
  }

  // Add taxon_id (display ID) to each species
  if (data?.species) {
    for (const s of data.species) {
      s.taxon_id = mapTaxonId(s.taxon_group);
    }
  }

  return NextResponse.json(data, { headers: CACHE_5M });
}
