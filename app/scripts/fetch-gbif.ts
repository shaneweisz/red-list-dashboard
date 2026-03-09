/**
 * fetch-gbif: GBIF API → CSV
 *
 * Fetches per-species observation counts from GBIF and writes to gbif-species.csv.
 *
 * Modes:
 *   --counts-only             Fetch + write total counts only
 *   --since-assessment-only   Compute count_after_assessment_year using local CSVs
 *   (no flags)                Run both phases
 *
 * Prerequisites:
 *   For --since-assessment-only: redlist-species.csv and species-links.csv must exist
 *
 * Usage:
 *   npx tsx scripts/fetch-gbif.ts <taxon> [--counts-only|--since-assessment-only]
 *   npx tsx scripts/fetch-gbif.ts [--counts-only|--since-assessment-only]
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  writeCsv,
  readCsv,
  DATA_DIR,
  delay,
  mapConcurrent,
  toTitleCase,
} from "./utils";

// =============================================================================
// GBIF TAXA CONFIGURATION
// =============================================================================

export interface GbifQuery {
  keyType: "kingdomKey" | "classKey" | "orderKey";
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
  invertebrates: {
    id: "invertebrates", name: "Invertebrates",
    queries: [
      { keyType: "classKey", keyValue: 216, taxonGroup: "insecta" },
      { keyType: "classKey", keyValue: 367, taxonGroup: "arachnida" },
      { keyType: "classKey", keyValue: 225, taxonGroup: "mollusca" },
      { keyType: "classKey", keyValue: 137, taxonGroup: "mollusca" },
      { keyType: "classKey", keyValue: 229, taxonGroup: "crustacea" },
      { keyType: "classKey", keyValue: 206, taxonGroup: "corals" },
      { keyType: "classKey", keyValue: 351, taxonGroup: "horseshoe_crabs" },
      { keyType: "classKey", keyValue: 222, taxonGroup: "other_invertebrates" }, // Holothuroidea
      { keyType: "classKey", keyValue: 255, taxonGroup: "other_invertebrates" }, // Clitellata
      { keyType: "classKey", keyValue: 361, taxonGroup: "other_invertebrates" }, // Diplopoda
      { keyType: "classKey", keyValue: 10713444, taxonGroup: "other_invertebrates" }, // Collembola
      { keyType: "classKey", keyValue: 360, taxonGroup: "other_invertebrates" }, // Chilopoda
      { keyType: "classKey", keyValue: 199, taxonGroup: "other_invertebrates" }, // Demospongiae
      { keyType: "classKey", keyValue: 205, taxonGroup: "other_invertebrates" }, // Hydrozoa
      { keyType: "classKey", keyValue: 214, taxonGroup: "other_invertebrates" }, // Asteroidea
      { keyType: "classKey", keyValue: 308, taxonGroup: "other_invertebrates" }, // Calcarea
      { keyType: "classKey", keyValue: 256, taxonGroup: "other_invertebrates" }, // Polychaeta
      { keyType: "classKey", keyValue: 341, taxonGroup: "other_invertebrates" }, // Turbellaria
      { keyType: "classKey", keyValue: 221, taxonGroup: "other_invertebrates" }, // Echinoidea
      { keyType: "classKey", keyValue: 63, taxonGroup: "other_invertebrates" },  // Nemertea
      { keyType: "classKey", keyValue: 62, taxonGroup: "velvet_worms" },         // Onychophora
    ],
  },
  plantae: {
    id: "plantae", name: "Plants",
    queries: [{ keyType: "kingdomKey", keyValue: 6, taxonGroup: "plantae" }],
  },
  fungi: {
    id: "fungi", name: "Fungi",
    queries: [{ keyType: "kingdomKey", keyValue: 5, taxonGroup: "fungi" }],
  },
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const FACET_LIMIT = 100000;
const REQUEST_DELAY = 200; // ms between GBIF requests
const SPECIES_VALIDATION_BATCH_SIZE = 1000;
const CURRENT_YEAR = new Date().getFullYear();
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

// =============================================================================
// HELPERS
// =============================================================================

let rateLimitHits = 0;
const YEAR_BUCKET_CONCURRENCY = 30;

// =============================================================================
// GBIF API FUNCTIONS
// =============================================================================

async function fetchFacets(
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
        rateLimitHits++;
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
// SINCE-ASSESSMENT PHASE (reads from local CSVs)
// =============================================================================

export interface GbifSpecies {
  gbif_species_key: number;
  scientific_name: string;
  common_name: string;
  taxon_group_table1a: string;
  total_count: number;
  count_after_assessment_year: number | null;
}

function loadGbifCsv(): Map<number, GbifSpecies> {
  const csvPath = path.join(DATA_DIR, "gbif-species.csv");
  const rows = readCsv<GbifSpecies>(csvPath, (r) => ({
    gbif_species_key: parseInt(r.gbif_species_key, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name,
    taxon_group_table1a: r.taxon_group_table1a,
    total_count: parseInt(r.total_count, 10) || 0,
    count_after_assessment_year: r.count_after_assessment_year ? parseInt(r.count_after_assessment_year, 10) : null,
  }));
  const map = new Map<number, GbifSpecies>();
  for (const row of rows) map.set(row.gbif_species_key, row);
  return map;
}

function loadAssessmentYears(taxonGbifKeys: Set<number>): Map<number, number> {
  const redlistPath = path.join(DATA_DIR, "redlist-species.csv");
  const linksPath = path.join(DATA_DIR, "species-links.csv");

  const assessmentDates = new Map<number, string>();
  readCsv(redlistPath, (r) => {
    if (r.assessment_date) {
      assessmentDates.set(parseInt(r.sis_taxon_id, 10), r.assessment_date);
    }
    return null;
  });

  const speciesAssessmentYear = new Map<number, number>();
  readCsv(linksPath, (r) => {
    const gbifKey = r.gbif_species_key ? parseInt(r.gbif_species_key, 10) : null;
    const sisTaxonId = parseInt(r.sis_taxon_id, 10);
    if (gbifKey && taxonGbifKeys.has(gbifKey)) {
      const date = assessmentDates.get(sisTaxonId);
      if (date) {
        const year = parseInt(date.slice(0, 4), 10);
        if (!isNaN(year)) speciesAssessmentYear.set(gbifKey, year);
      }
    }
    return null;
  });

  return speciesAssessmentYear;
}

export async function fetchCountsSinceAssessment(
  taxon: GbifTaxon,
  gbifSpeciesMap: Map<number, GbifSpecies>,
): Promise<number> {
  const taxonGbifKeys = new Set<number>();
  gbifSpeciesMap.forEach((row, key) => {
    if (row.taxon_group_table1a === taxon.id) taxonGbifKeys.add(key);
  });

  const speciesAssessmentYear = loadAssessmentYears(taxonGbifKeys);
  console.log(`  ${speciesAssessmentYear.size} linked species with assessment dates`);

  if (speciesAssessmentYear.size === 0) return 0;

  const uniqueYears = Array.from(new Set(Array.from(speciesAssessmentYear.values()))).sort((a, b) => a - b);
  const yearBuckets = uniqueYears.filter((y) => y + 1 <= CURRENT_YEAR);

  const speciesByYear = new Map<number, Set<number>>();
  speciesAssessmentYear.forEach((year, speciesKey) => {
    if (!speciesByYear.has(year)) speciesByYear.set(year, new Set());
    speciesByYear.get(year)!.add(speciesKey);
  });

  const sinceAssessmentCounts = new Map<number, number>();
  speciesAssessmentYear.forEach((_year, speciesKey) => {
    sinceAssessmentCounts.set(speciesKey, 0);
  });

  console.log(`  ${yearBuckets.length} year buckets x ${taxon.queries.length} queries`);

  for (let qi = 0; qi < taxon.queries.length; qi++) {
    const q = taxon.queries[qi];
    let completedBuckets = 0;

    await mapConcurrent(yearBuckets, YEAR_BUCKET_CONCURRENCY, async (assessmentYear) => {
      const yearRange = `${assessmentYear + 1},${CURRENT_YEAR}`;
      const results = await fetchFacets(q.keyType, q.keyValue, yearRange);
      const bucketSpecies = speciesByYear.get(assessmentYear);

      if (bucketSpecies) {
        for (const r of results) {
          if (bucketSpecies.has(r.speciesKey)) {
            sinceAssessmentCounts.set(r.speciesKey, sinceAssessmentCounts.get(r.speciesKey)! + r.count);
          }
        }
      }

      completedBuckets++;
      process.stdout.write(`\r  Query ${qi + 1}/${taxon.queries.length}: ${completedBuckets}/${yearBuckets.length} year buckets`);
    });
  }
  if (yearBuckets.length > 0) console.log("");

  sinceAssessmentCounts.forEach((count, key) => {
    const row = gbifSpeciesMap.get(key);
    if (row) row.count_after_assessment_year = count;
  });

  return sinceAssessmentCounts.size;
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
    .sort((a, b) => b.total_count - a.total_count)
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
  const flags = args.filter((a) => a.startsWith("--"));
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const taxonArg = positionalArgs[0]?.toLowerCase();

  const countsOnly = flags.includes("--counts-only");
  const sinceAssessmentOnly = flags.includes("--since-assessment-only");

  const taxaToSync = taxonArg
    ? (GBIF_TAXA[taxonArg] ? [GBIF_TAXA[taxonArg]] : [])
    : Object.values(GBIF_TAXA);

  if (taxonArg && taxaToSync.length === 0) {
    console.error(`Unknown taxon: ${taxonArg}`);
    console.error("Available:", Object.keys(GBIF_TAXA).join(", "));
    process.exit(1);
  }

  console.log("fetch-gbif: GBIF API → CSV");
  if (countsOnly) console.log("Mode: --counts-only");
  if (sinceAssessmentOnly) console.log("Mode: --since-assessment-only");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const logger = new SyncLogger("fetch-gbif");

  try {
    logger.log("sync_start", {
      taxa: taxaToSync.map((t) => t.id),
      taxa_count: taxaToSync.length,
      mode: countsOnly ? "counts-only" : sinceAssessmentOnly ? "since-assessment-only" : "full",
    });

    const gbifSpeciesMap: Map<number, GbifSpecies> = sinceAssessmentOnly
      ? loadGbifCsv()
      : new Map();

    let totalFetched = 0;
    let totalSinceAssessment = 0;

    for (const taxon of taxaToSync) {
      const taxonStart = Date.now();
      console.log(`\n${taxon.name} (${taxon.id}):`);

      if (!sinceAssessmentOnly) {
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

        totalFetched += validSpecies.size;
        logger.log("taxon_counts_complete", {
          taxon_id: taxon.id, raw_species: rawResults.length,
          valid_species: validSpecies.size,
        });
      }

      if (!countsOnly) {
        console.log("  Computing since-assessment counts...");
        const count = await fetchCountsSinceAssessment(taxon, gbifSpeciesMap);
        totalSinceAssessment += count;

        logger.log("taxon_since_assessment_complete", {
          taxon_id: taxon.id, linked_species: count,
        });
      }

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      logger.log("taxon_complete", { taxon_id: taxon.id, duration_seconds: Number(taxonDuration) });
    }

    const outputPath = path.join(DATA_DIR, "gbif-species.csv");
    writeGbifCsv(gbifSpeciesMap, outputPath);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", { total_species: gbifSpeciesMap.size, since_assessment: totalSinceAssessment, rate_limit_retries: rateLimitHits, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("fetch-gbif complete:");
    if (!sinceAssessmentOnly) {
      console.log(`  Species:                    ${totalFetched.toLocaleString()}`);
    }
    if (!countsOnly) {
      console.log(`  Since-assessment computed:  ${totalSinceAssessment.toLocaleString()}`);
    }
    if (rateLimitHits > 0) {
      console.log(`  Rate limit retries (429s):  ${rateLimitHits}`);
    }
    console.log(`  Output:  ${outputPath}`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch-gbif.ts") || process.argv[1]?.endsWith("fetch-gbif.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
