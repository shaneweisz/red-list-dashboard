import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { TAXA, getTaxonConfig } from "@/config/taxa";
import { loadTaxonData, SpeciesRecord } from "@/lib/dataLoader";

// ---------- NE species from GBIF CSV ----------

async function loadNESpecies(
  taxonId: string,
  redListSpecies: SpeciesRecord[],
  search?: string,
): Promise<SpeciesRecord[]> {
  const taxon = getTaxonConfig(taxonId);

  try {
    const gbifCsvPath = path.join(process.cwd(), "data", taxon.gbifDataFile);
    const csvContent = await fs.readFile(gbifCsvPath, "utf-8");
    const lines = csvContent.split("\n");
    const header = lines[0];
    if (!header) return [];
    const hasScientificName = header.includes("scientific_name");
    const hasCommonName = header.includes("common_name");
    if (!hasScientificName) return [];

    const redListNames = new Set(
      redListSpecies.map((s) => s.scientific_name.toLowerCase().trim()),
    );

    const neSpecies: SpeciesRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parts = line.split(",");
      const speciesKey = parseInt(parts[0], 10);
      const occurrenceCount = parseInt(parts[1], 10);
      const scientificName = parts[2]?.trim() || "";
      let commonName: string | null = null;
      if (hasCommonName) {
        const raw = parts.slice(3).join(",").trim();
        commonName = raw.replace(/^"|"$/g, "") || null;
      }
      if (scientificName && !redListNames.has(scientificName.toLowerCase())) {
        if (
          search &&
          !scientificName.toLowerCase().includes(search) &&
          !commonName?.toLowerCase().includes(search)
        ) {
          continue;
        }
        neSpecies.push({
          sis_taxon_id: speciesKey,
          assessment_id: 0,
          scientific_name: scientificName,
          common_name: commonName,
          family: null,
          category: "NE",
          assessment_date: null,
          year_published: "",
          url: `https://www.gbif.org/species/${speciesKey}`,
          population_trend: null,
          countries: [],
          assessment_count: 0,
          previous_assessments: [],
          gbif_species_key: speciesKey,
          gbif_occurrence_count: occurrenceCount,
        });
      }
    }

    return neSpecies;
  } catch {
    return [];
  }
}

// ---------- Available taxa list ----------

async function getAvailableTaxa(): Promise<
  { id: string; name: string; available: boolean; speciesCount: number }[]
> {
  const results = await Promise.all(
    TAXA.map(async (taxon) => {
      let available = false;
      let speciesCount = 0;
      try {
        const data = await loadTaxonData(taxon.id);
        if (data) {
          available = true;
          speciesCount = data.species.length;
        }
      } catch {
        // File doesn't exist or can't be read
      }
      return { id: taxon.id, name: taxon.name, available, speciesCount };
    }),
  );
  return results;
}

// ---------- GET handler ----------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "plantae";
  const category = searchParams.get("category");
  const search = searchParams.get("search")?.toLowerCase();

  // Special case: return list of available taxa
  if (searchParams.get("list") === "taxa") {
    return NextResponse.json({ taxa: await getAvailableTaxa() });
  }

  const taxon = getTaxonConfig(taxonId);
  const data = await loadTaxonData(taxonId, { tagSpecies: true });

  if (!data) {
    return NextResponse.json(
      {
        error: `Species data not available for ${taxon.name}. Run: npx tsx scripts/fetch-redlist-species.ts ${taxonId}`,
        species: [],
        total: 0,
        taxon: {
          id: taxon.id,
          name: taxon.name,
          estimatedDescribed: taxon.estimatedDescribed,
          estimatedSource: taxon.estimatedSource,
        },
      },
      { status: 503 },
    );
  }

  // Handle NE category: serve species from GBIF CSV that aren't in Red List
  if (category === "NE") {
    const neSpecies = await loadNESpecies(taxonId, data.species, search);
    return NextResponse.json({
      species: neSpecies,
      total: neSpecies.length,
      metadata: data.metadata,
      taxon: {
        id: taxon.id,
        name: taxon.name,
        estimatedDescribed: taxon.estimatedDescribed,
        estimatedSource: taxon.estimatedSource,
        color: taxon.color,
      },
    });
  }

  // Filter by category and/or search
  let filtered = data.species;

  if (category) {
    filtered = filtered.filter((s) => s.category === category);
  }

  if (search) {
    filtered = filtered.filter(
      (s) =>
        s.scientific_name.toLowerCase().includes(search) ||
        s.common_name?.toLowerCase().includes(search),
    );
  }

  return NextResponse.json({
    species: filtered,
    total: filtered.length,
    metadata: data.metadata,
    taxon: {
      id: taxon.id,
      name: taxon.name,
      estimatedDescribed: taxon.estimatedDescribed,
      estimatedSource: taxon.estimatedSource,
      color: taxon.color,
    },
  });
}
