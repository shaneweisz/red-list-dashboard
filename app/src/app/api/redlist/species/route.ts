import { NextRequest, NextResponse } from "next/server";
import { TAXA, getTaxonConfig } from "@/config/taxa";
import { CACHE_1H } from "@/lib/cache-headers";
import { supabase } from "@/lib/supabase/server";
import { getTaxonGroups } from "@/lib/supabase/taxon-groups";

// Maps a DB table1a_taxon_group value to the display taxon ID used in the "all" view
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

function dbGroupToTaxonId(group: string): string {
  return DB_GROUP_TO_TAXON_ID[group] ?? group;
}

/** Fetch all rows from a Supabase query by paginating with `.range()`. */
async function fetchAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>
): Promise<Record<string, unknown>[]> {
  const PAGE_SIZE = 1000;
  const results: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return results;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "plantae";
  const category = searchParams.get("category");
  const search = searchParams.get("search");

  // ── Mode 1: ?list=taxa ──────────────────────────────────────────────────────
  if (searchParams.get("list") === "taxa") {
    const taxaWithCounts = await Promise.all(
      TAXA.map(async (taxon) => {
        const groups = getTaxonGroups(taxon.id);
        const { count, error } = await supabase
          .from("species")
          .select("*", { count: "exact", head: true })
          .in("table1a_taxon_group", groups)
          .not("sis_taxon_id", "is", null);

        return {
          id: taxon.id,
          name: taxon.name,
          available: !error && count !== null && count > 0,
          speciesCount: count ?? 0,
        };
      })
    );

    return NextResponse.json({ taxa: taxaWithCounts }, { headers: CACHE_1H });
  }

  const taxon = getTaxonConfig(taxonId);
  const groups = getTaxonGroups(taxonId);

  // ── Mode 2: ?category=NE ────────────────────────────────────────────────────
  if (category === "NE") {
    try {
      const rows = await fetchAllRows((from, to) => {
        let q = supabase
          .from("species")
          .select(
            "gbif_species_key, scientific_name, common_name, table1a_taxon_group, gbif_total_count"
          )
          .is("sis_taxon_id", null)
          .not("gbif_species_key", "is", null)
          .in("table1a_taxon_group", groups)
          .range(from, to);

        if (search) {
          q = q.or(
            `scientific_name.ilike.%${search}%,common_name.ilike.%${search}%`
          );
        }

        return q;
      });

      const neSpecies = rows.map((row: Record<string, unknown>) => ({
        sis_taxon_id: row.gbif_species_key as number,
        assessment_id: 0,
        scientific_name: row.scientific_name as string,
        common_name: (row.common_name as string | null) ?? null,
        family: null,
        category: "NE",
        assessment_date: null,
        year_published: "",
        url: `https://www.gbif.org/species/${row.gbif_species_key}`,
        population_trend: null,
        countries: [],
        assessment_count: 0,
        previous_assessments: [],
        gbif_species_key: row.gbif_species_key as number,
        gbif_occurrence_count: (row.gbif_total_count as number | null) ?? 0,
        taxon_id: dbGroupToTaxonId(row.table1a_taxon_group as string),
      }));

      return NextResponse.json(
        {
          species: neSpecies,
          total: neSpecies.length,
          taxon: {
            id: taxon.id,
            name: taxon.name,
            estimatedDescribed: taxon.estimatedDescribed,
            estimatedSource: taxon.estimatedSource,
            color: taxon.color,
          },
        },
        { headers: CACHE_1H }
      );
    } catch (error) {
      console.error("Error loading NE species from Supabase:", error);
      return NextResponse.json(
        {
          species: [],
          total: 0,
          taxon: {
            id: taxon.id,
            name: taxon.name,
            estimatedDescribed: taxon.estimatedDescribed,
            estimatedSource: taxon.estimatedSource,
            color: taxon.color,
          },
        },
        { headers: CACHE_1H }
      );
    }
  }

  // ── Mode 3: Normal (Red List species) ───────────────────────────────────────
  try {
    const rows = await fetchAllRows((from, to) => {
      let q = supabase
        .from("species")
        .select(
          "sis_taxon_id, assessment_id, scientific_name, common_name, family, " +
          "iucn_category, assessment_date, year_published, population_trend, countries, " +
          "class_name, order_name, table1a_taxon_group, " +
          "gbif_species_key, gbif_total_count, gbif_count_since_assessment"
        )
        .not("sis_taxon_id", "is", null)
        .in("table1a_taxon_group", groups)
        .range(from, to);

      if (category) {
        q = q.eq("iucn_category", category);
      }

      if (search) {
        q = q.or(
          `scientific_name.ilike.%${search}%,common_name.ilike.%${search}%`
        );
      }

      return q;
    });

    const species = rows.map((row: Record<string, unknown>) => ({
      sis_taxon_id: row.sis_taxon_id as number,
      assessment_id: row.assessment_id as number,
      scientific_name: row.scientific_name as string,
      common_name: (row.common_name as string | null) ?? null,
      family: (row.family as string | null) ?? null,
      category: row.iucn_category as string,
      assessment_date: (row.assessment_date as string | null) ?? null,
      year_published: (row.year_published as string) ?? "",
      population_trend: (row.population_trend as string | null) ?? null,
      countries: (row.countries as string[]) ?? [],
      class_name: (row.class_name as string | null) ?? null,
      order_name: (row.order_name as string | null) ?? null,
      previous_assessments: [],
      taxon_id: dbGroupToTaxonId(row.table1a_taxon_group as string),
      gbif_species_key: (row.gbif_species_key as number | null) ?? null,
      gbif_occurrence_count: (row.gbif_total_count as number | null) ?? null,
      gbif_observations_after_assessment_year:
        (row.gbif_count_since_assessment as number | null) ?? null,
    }));

    return NextResponse.json(
      {
        species,
        total: species.length,
        taxon: {
          id: taxon.id,
          name: taxon.name,
          estimatedDescribed: taxon.estimatedDescribed,
          estimatedSource: taxon.estimatedSource,
          color: taxon.color,
        },
      },
      { headers: CACHE_1H }
    );
  } catch (error) {
    console.error("Error loading species from Supabase:", error);
    return NextResponse.json(
      {
        error: `Species data not available for ${taxon.name}.`,
        species: [],
        total: 0,
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
}
