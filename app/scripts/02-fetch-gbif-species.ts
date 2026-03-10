/**
 * fetch-gbif-species: GBIF API → CSV
 *
 * Fetches per-species observation counts from GBIF and writes to gbif-species.csv.
 *
 * Usage:
 *   npx tsx scripts/02-fetch-gbif-species.ts [taxon]   # Fetch one taxon (e.g. mammalia)
 *   npx tsx scripts/02-fetch-gbif-species.ts            # Fetch all taxa
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  writeCsv,
  DATA_DIR,
  delay,
  toTitleCase,
} from "./utils";

// =============================================================================
// GBIF TAXA CONFIGURATION
// =============================================================================

export interface GbifQuery {
  keyType: "kingdomKey" | "phylumKey" | "classKey" | "orderKey";
  keyValue: number;
  taxonGroup: string;
}

export interface GbifTaxon {
  id: string;
  name: string;
  queries: GbifQuery[];
}

const FISH_ORDER_KEYS = [389,391,427,428,446,494,495,496,497,498,499,537,538,547,548,549,550,587,588,589,590,696,708,742,752,753,772,773,774,781,836,848,857,860,861,888,889,890,898,929,975,976,1067,1153,1313];

export const GBIF_TAXA: Record<string, GbifTaxon> = {
  // ── Vertebrates ──
  mammalia: {
    id: "mammalia", name: "Mammals",
    queries: [{ keyType: "classKey", keyValue: 359, taxonGroup: "mammalia" }],
  },
  aves: {
    id: "aves", name: "Birds",
    queries: [{ keyType: "classKey", keyValue: 212, taxonGroup: "aves" }],
  },
  reptilia: {
    id: "reptilia", name: "Reptiles",
    queries: [
      { keyType: "classKey", keyValue: 11592253, taxonGroup: "reptilia" },
      { keyType: "classKey", keyValue: 11493978, taxonGroup: "reptilia" },
      { keyType: "classKey", keyValue: 11418114, taxonGroup: "reptilia" },
    ],
  },
  amphibia: {
    id: "amphibia", name: "Amphibians",
    queries: [{ keyType: "classKey", keyValue: 131, taxonGroup: "amphibia" }],
  },
  fishes: {
    id: "fishes", name: "Fishes",
    queries: [
      ...FISH_ORDER_KEYS.map((k) => ({ keyType: "orderKey" as const, keyValue: k, taxonGroup: "fishes" })),
      { keyType: "classKey" as const, keyValue: 121, taxonGroup: "fishes" },
      { keyType: "classKey" as const, keyValue: 120, taxonGroup: "fishes" },
    ],
  },
  // ── Invertebrates ──
  insecta: {
    id: "insecta", name: "Insects",
    queries: [{ keyType: "classKey", keyValue: 216, taxonGroup: "insecta" }],
  },
  mollusca: {
    id: "mollusca", name: "Molluscs",
    queries: [
      { keyType: "classKey", keyValue: 225, taxonGroup: "mollusca" },
      { keyType: "classKey", keyValue: 137, taxonGroup: "mollusca" },
    ],
  },
  crustacea: {
    id: "crustacea", name: "Crustaceans",
    queries: [{ keyType: "classKey", keyValue: 229, taxonGroup: "crustacea" }],
  },
  arachnida: {
    id: "arachnida", name: "Arachnids",
    queries: [{ keyType: "classKey", keyValue: 367, taxonGroup: "arachnida" }],
  },
  corals: {
    id: "corals", name: "Corals",
    queries: [{ keyType: "classKey", keyValue: 206, taxonGroup: "corals" }],
  },
  velvet_worms: {
    id: "velvet_worms", name: "Velvet Worms",
    queries: [{ keyType: "classKey", keyValue: 62, taxonGroup: "velvet_worms" }],
  },
  horseshoe_crabs: {
    id: "horseshoe_crabs", name: "Horseshoe Crabs",
    queries: [{ keyType: "classKey", keyValue: 351, taxonGroup: "horseshoe_crabs" }],
  },
  other_invertebrates: {
    id: "other_invertebrates", name: "Other Invertebrates",
    queries: [
      { keyType: "classKey", keyValue: 222, taxonGroup: "other_invertebrates" },    // Holothuroidea
      { keyType: "classKey", keyValue: 255, taxonGroup: "other_invertebrates" },    // Clitellata
      { keyType: "classKey", keyValue: 361, taxonGroup: "other_invertebrates" },    // Diplopoda
      { keyType: "classKey", keyValue: 10713444, taxonGroup: "other_invertebrates" }, // Collembola
      { keyType: "classKey", keyValue: 360, taxonGroup: "other_invertebrates" },    // Chilopoda
      { keyType: "classKey", keyValue: 199, taxonGroup: "other_invertebrates" },    // Demospongiae
      { keyType: "classKey", keyValue: 205, taxonGroup: "other_invertebrates" },    // Hydrozoa
      { keyType: "classKey", keyValue: 214, taxonGroup: "other_invertebrates" },    // Asteroidea
      { keyType: "classKey", keyValue: 308, taxonGroup: "other_invertebrates" },    // Calcarea
      { keyType: "classKey", keyValue: 256, taxonGroup: "other_invertebrates" },    // Polychaeta
      { keyType: "classKey", keyValue: 341, taxonGroup: "other_invertebrates" },    // Turbellaria
      { keyType: "classKey", keyValue: 221, taxonGroup: "other_invertebrates" },    // Echinoidea
      { keyType: "classKey", keyValue: 63, taxonGroup: "other_invertebrates" },     // Nemertea
    ],
  },
  // ── Plants ──
  mosses: {
    id: "mosses", name: "Mosses",
    queries: [
      { keyType: "phylumKey", keyValue: 35, taxonGroup: "mosses" },  // Bryophyta
      { keyType: "phylumKey", keyValue: 13, taxonGroup: "mosses" },  // Anthocerotophyta
      { keyType: "phylumKey", keyValue: 9, taxonGroup: "mosses" },   // Marchantiophyta
    ],
  },
  ferns_and_allies: {
    id: "ferns_and_allies", name: "Ferns and Allies",
    queries: [
      { keyType: "classKey", keyValue: 245, taxonGroup: "ferns_and_allies" },     // Lycopodiopsida
      { keyType: "classKey", keyValue: 7228684, taxonGroup: "ferns_and_allies" },  // Polypodiopsida
    ],
  },
  gymnosperms: {
    id: "gymnosperms", name: "Gymnosperms",
    queries: [
      { keyType: "classKey", keyValue: 194, taxonGroup: "gymnosperms" },  // Pinopsida
      { keyType: "classKey", keyValue: 228, taxonGroup: "gymnosperms" },  // Cycadopsida
      { keyType: "classKey", keyValue: 244, taxonGroup: "gymnosperms" },  // Ginkgoopsida
      { keyType: "classKey", keyValue: 282, taxonGroup: "gymnosperms" },  // Gnetopsida
    ],
  },
  flowering_plants: {
    id: "flowering_plants", name: "Flowering Plants",
    queries: [
      { keyType: "classKey", keyValue: 220, taxonGroup: "flowering_plants" },  // Magnoliopsida
      { keyType: "classKey", keyValue: 196, taxonGroup: "flowering_plants" },  // Liliopsida
    ],
  },
  green_algae: {
    id: "green_algae", name: "Green Algae",
    queries: [
      { keyType: "phylumKey", keyValue: 36, taxonGroup: "green_algae" },      // Chlorophyta
      { keyType: "phylumKey", keyValue: 7819616, taxonGroup: "green_algae" },  // Charophyta
    ],
  },
  red_algae: {
    id: "red_algae", name: "Red Algae",
    queries: [{ keyType: "phylumKey", keyValue: 106, taxonGroup: "red_algae" }],  // Rhodophyta
  },
  // ── Fungi & Protists ──
  mushrooms: {
    id: "mushrooms", name: "Mushrooms, etc.",
    queries: [
      { keyType: "phylumKey", keyValue: 34, taxonGroup: "mushrooms" },  // Basidiomycota
      { keyType: "phylumKey", keyValue: 95, taxonGroup: "mushrooms" },  // Ascomycota
    ],
  },
  brown_algae: {
    id: "brown_algae", name: "Brown Algae",
    queries: [{ keyType: "phylumKey", keyValue: 98, taxonGroup: "brown_algae" }],  // Ochrophyta
  },
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const FACET_LIMIT = 100000;
const REQUEST_DELAY = 200; // ms between GBIF requests
const SPECIES_VALIDATION_BATCH_SIZE = 1000;
const MAX_RETRIES = 5;

const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OCCURRENCE",
  "MATERIAL_SAMPLE",
  "OBSERVATION",
];

// =============================================================================
// TYPES
// =============================================================================

interface SpeciesCount {
  speciesKey: number;
  count: number;
  taxonGroup: string;
}

interface ValidatedSpecies {
  key: number;
  canonicalName: string;
  vernacularName: string;
  className: string;
  orderName: string;
}

export interface GbifSpecies {
  gbif_species_key: number;
  scientific_name: string;
  common_name: string;
  taxon_group_table1a: string;
  total_count: number;
  count_after_assessment_year: number | null;
}

// =============================================================================
// GBIF API FUNCTIONS
// =============================================================================

export async function fetchFacets(
  keyType: string,
  keyValue: number,
  yearRange?: string,
): Promise<Array<{ speciesKey: number; count: number }>> {
  const allResults: Array<{ speciesKey: number; count: number }> = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
      facet: "speciesKey",
      facetLimit: FACET_LIMIT.toString(),
      facetOffset: offset.toString(),
      limit: "0",
      [keyType]: keyValue.toString(),
    });

    if (yearRange) params.set("year", yearRange);
    INCLUDED_BASIS_OF_RECORD.forEach((bor) => params.append("basisOfRecord", bor));

    let response: Response | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const wait = Math.pow(2, attempt + 1) * 1000;
          await delay(wait);
          continue;
        }
        throw err;
      }
      if (response.status === 429) {
        const wait = Math.pow(2, attempt + 1) * 1000;
        await delay(wait);
        continue;
      }
      break;
    }
    if (!response || !response.ok) throw new Error(`GBIF API error: ${response?.statusText}`);

    const data = await response.json();
    const facet = data.facets?.find((f: { field: string }) => f.field === "SPECIES_KEY");

    if (!facet || facet.counts.length === 0) break;

    for (const c of facet.counts) {
      allResults.push({ speciesKey: parseInt(c.name, 10), count: c.count });
    }

    hasMore = facet.counts.length >= FACET_LIMIT;
    if (hasMore) {
      offset += FACET_LIMIT;
      await delay(REQUEST_DELAY);
    }
  }

  return allResults;
}

export async function fetchGbifCounts(taxon: GbifTaxon): Promise<SpeciesCount[]> {
  const allResults: SpeciesCount[] = [];

  for (let i = 0; i < taxon.queries.length; i++) {
    const q = taxon.queries[i];
    process.stdout.write(`\r  Query ${i + 1}/${taxon.queries.length}`);
    const results = await fetchFacets(q.keyType, q.keyValue);
    for (const r of results) {
      allResults.push({ speciesKey: r.speciesKey, count: r.count, taxonGroup: q.taxonGroup });
    }
    if (i < taxon.queries.length - 1) await delay(REQUEST_DELAY);
  }
  console.log("");

  // Deduplicate: keep highest count per speciesKey
  const seen = new Map<number, SpeciesCount>();
  for (const r of allResults) {
    if (!seen.has(r.speciesKey) || seen.get(r.speciesKey)!.count < r.count) {
      seen.set(r.speciesKey, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.count - a.count);
}

export async function validateSpeciesKeys(speciesKeys: number[]): Promise<Map<number, ValidatedSpecies>> {
  const valid = new Map<number, ValidatedSpecies>();

  for (let i = 0; i < speciesKeys.length; i += SPECIES_VALIDATION_BATCH_SIZE) {
    const batch = speciesKeys.slice(i, i + SPECIES_VALIDATION_BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (key) => {
        try {
          const res = await fetch(`https://api.gbif.org/v1/species/${key}`, {
            headers: { "Accept-Language": "en" },
          });
          if (!res.ok) return { key, rank: "UNKNOWN", status: "UNKNOWN", canonicalName: "", vernacularName: "", className: "", orderName: "" };
          const data = await res.json();
          return {
            key,
            rank: data.rank || "UNKNOWN",
            status: data.taxonomicStatus || "UNKNOWN",
            canonicalName: data.canonicalName || data.scientificName || "",
            vernacularName: data.vernacularName || "",
            className: data.class || "",
            orderName: data.order || "",
          };
        } catch {
          return { key, rank: "ERROR", status: "ERROR", canonicalName: "", vernacularName: "", className: "", orderName: "" };
        }
      })
    );

    for (const info of results) {
      if (info.rank === "SPECIES" && info.status === "ACCEPTED") {
        valid.set(info.key, { key: info.key, canonicalName: info.canonicalName, vernacularName: info.vernacularName, className: info.className, orderName: info.orderName });
      }
    }

    const progress = Math.min(i + SPECIES_VALIDATION_BATCH_SIZE, speciesKeys.length);
    process.stdout.write(`\r  Validated ${progress}/${speciesKeys.length} (${valid.size} valid)`);
  }

  console.log("");
  return valid;
}

// =============================================================================
// CSV OUTPUT
// =============================================================================

const GBIF_CSV_COLUMNS = [
  "gbif_species_key", "scientific_name", "common_name", "taxon_group_table1a",
  "total_count", "count_after_assessment_year",
];

export function writeGbifCsv(speciesMap: Map<number, GbifSpecies>, outputPath: string): void {
  const rows = Array.from(speciesMap.values())
    .map((s) => ({
      gbif_species_key: s.gbif_species_key,
      scientific_name: s.scientific_name,
      common_name: s.common_name || null,
      taxon_group_table1a: s.taxon_group_table1a,
      total_count: s.total_count,
      count_after_assessment_year: s.count_after_assessment_year,
    }));

  writeCsv(rows, GBIF_CSV_COLUMNS, outputPath);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const taxonArg = args[0]?.toLowerCase();

  const taxaToSync = taxonArg
    ? (GBIF_TAXA[taxonArg] ? [GBIF_TAXA[taxonArg]] : [])
    : Object.values(GBIF_TAXA);

  if (taxonArg && taxaToSync.length === 0) {
    console.error(`Unknown taxon: ${taxonArg}`);
    console.error("Available:", Object.keys(GBIF_TAXA).join(", "));
    process.exit(1);
  }

  console.log("fetch-gbif-species: GBIF API → CSV");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const logger = new SyncLogger("fetch-gbif-species");

  try {
    logger.log("sync_start", {
      taxa: taxaToSync.map((t) => t.id),
      taxa_count: taxaToSync.length,
    });

    const gbifSpeciesMap = new Map<number, GbifSpecies>();

    for (const taxon of taxaToSync) {
      const taxonStart = Date.now();
      console.log(`\n${taxon.name} (${taxon.id}):`);

      console.log("  Fetching species observation counts from GBIF...");
      const rawResults = await fetchGbifCounts(taxon);
      console.log(`  Raw species: ${rawResults.length}`);

      console.log("  Validating species keys...");
      const speciesKeys = rawResults.map((r) => r.speciesKey);
      const validSpecies = await validateSpeciesKeys(speciesKeys);
      console.log(`  Valid species: ${validSpecies.size}`);

      for (const r of rawResults) {
        const info = validSpecies.get(r.speciesKey);
        if (!info) continue;
        gbifSpeciesMap.set(r.speciesKey, {
          gbif_species_key: r.speciesKey,
          scientific_name: info.canonicalName,
          common_name: info.vernacularName ? toTitleCase(info.vernacularName) : "",
          taxon_group_table1a: r.taxonGroup,
          total_count: r.count,
          count_after_assessment_year: null,
        });
      }

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      logger.log("taxon_complete", { taxon_id: taxon.id, raw: rawResults.length, valid: validSpecies.size, duration_seconds: Number(taxonDuration) });
    }

    const outputPath = path.join(DATA_DIR, "gbif-species.csv");
    writeGbifCsv(gbifSpeciesMap, outputPath);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", { total_species: gbifSpeciesMap.size, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("fetch-gbif complete:");
    console.log(`  Species: ${gbifSpeciesMap.size.toLocaleString()}`);
    console.log(`  Output:  ${outputPath}`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch-gbif-species.ts") || process.argv[1]?.endsWith("fetch-gbif-species.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
