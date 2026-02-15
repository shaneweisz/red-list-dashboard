/**
 * GBIF Species Observation Count Fetcher
 * =======================================
 *
 * Pre-computes per-species observation counts from GBIF and saves to CSV.
 * Also computes observations_after_assessment_year using year-bucketed facet
 * queries matched against IUCN Red List assessment dates.
 *
 * Output format:
 *   species_key,observations_total,scientific_name,common_name,observations_after_assessment_year
 *
 * ## What It Does
 *
 * 1. Fetches species occurrence facets from GBIF (wild observations only)
 * 2. Validates each speciesKey against the GBIF Species API (rank=SPECIES, status=ACCEPTED)
 * 3. Loads assessment years from Red List JSON files
 * 4. For each assessment-year bucket, queries GBIF for observations after that year
 * 5. Writes a single CSV with both total and post-assessment counts
 *
 * ## Basis of Record Filter
 *
 * Only wild observation records are counted. Excluded:
 *   - FOSSIL_SPECIMEN: Extinct species, not relevant for current biodiversity
 *   - MATERIAL_CITATION: Literature references, often duplicate or unverified
 *   - PRESERVED_SPECIMEN: Museum collections, not wild observations
 *   - LIVING_SPECIMEN: Zoos/gardens, not wild observations
 *
 * ## Post-Assessment Approximation
 *
 * The year filter ignores the assessment month. A species assessed in March 2016
 * gets counted from 2017 onwards, missing ~9 months of 2016 data. For sorting
 * and ranking purposes this is negligible.
 *
 * ## Expected Runtimes (Feb 2026)
 *
 * | Taxon         | Species | Runtime |
 * |---------------|---------|---------|
 * | Mammals       | 4,832   | ~2 min  |
 * | Birds         | 11,192  | ~3 min  |
 * | Reptiles      | 9,116   | ~4 min  |
 * | Amphibians    | 5,839   | ~2 min  |
 * | Fishes        | 22,945  | ~7 min  |
 * | Fungi         | 52,066  | ~5 min  |
 * | Plants        | 200,419 | ~20 min |
 * | Invertebrates | 325,941 | ~30 min |
 *
 * Bottleneck is species validation (one GBIF API call per species key).
 *
 * ## Re-runnability
 *
 * The script is idempotent — it overwrites the CSV from scratch on each run.
 * Safe for cron: `npx tsx scripts/fetch-gbif-species.ts mammalia`
 *
 * Usage:
 *   npx tsx scripts/fetch-gbif-species.ts <taxon>
 *
 * Examples:
 *   npx tsx scripts/fetch-gbif-species.ts mammalia
 *   npx tsx scripts/fetch-gbif-species.ts plantae
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// TAXA CONFIGURATION (inline to avoid import issues with tsx)
// =============================================================================

interface TaxonConfig {
  id: string;
  name: string;
  gbifDataFile: string;
  redListFiles: string[]; // Red List JSON files to load assessment dates from
  gbifKingdomKey: number;
  gbifClassKey?: number;
  gbifClassKeys?: number[];
  gbifOrderKeys?: number[];
}

// Fishes span multiple GBIF classes (Actinopterygii, Chondrichthyes) and have no
// single parent taxon key. We query by individual order keys for ray-finned fishes
// and by class keys for sharks/rays, then deduplicate.
const FISH_ORDER_KEYS = [389,391,427,428,446,494,495,496,497,498,499,537,538,547,548,549,550,587,588,589,590,696,708,742,752,753,772,773,774,781,836,848,857,860,861,888,889,890,898,929,975,976,1067,1153,1313];

const TAXA_CONFIG: Record<string, TaxonConfig> = {
  plantae: {
    id: "plantae", name: "Plants",
    gbifDataFile: "gbif-plantae.csv",
    redListFiles: ["redlist-plantae.json"],
    gbifKingdomKey: 6,
  },
  fungi: {
    id: "fungi", name: "Fungi",
    gbifDataFile: "gbif-fungi.csv",
    redListFiles: ["redlist-ascomycota.json", "redlist-basidiomycota.json"],
    gbifKingdomKey: 5,
  },
  mammalia: {
    id: "mammalia", name: "Mammals",
    gbifDataFile: "gbif-mammalia.csv",
    redListFiles: ["redlist-mammalia.json"],
    gbifKingdomKey: 1, gbifClassKey: 359,
  },
  aves: {
    id: "aves", name: "Birds",
    gbifDataFile: "gbif-aves.csv",
    redListFiles: ["redlist-aves.json"],
    gbifKingdomKey: 1, gbifClassKey: 212,
  },
  reptilia: {
    id: "reptilia", name: "Reptiles",
    gbifDataFile: "gbif-reptilia.csv",
    redListFiles: ["redlist-reptilia.json"],
    gbifKingdomKey: 1, gbifClassKeys: [11592253, 11493978, 11418114],
  },
  amphibia: {
    id: "amphibia", name: "Amphibians",
    gbifDataFile: "gbif-amphibia.csv",
    redListFiles: ["redlist-amphibia.json"],
    gbifKingdomKey: 1, gbifClassKey: 131,
  },
  fishes: {
    id: "fishes", name: "Fishes",
    gbifDataFile: "gbif-fishes.csv",
    redListFiles: ["redlist-actinopterygii.json", "redlist-chondrichthyes.json"],
    gbifKingdomKey: 1, gbifOrderKeys: FISH_ORDER_KEYS, gbifClassKeys: [121, 120],
  },
  invertebrates: {
    id: "invertebrates", name: "Invertebrates",
    gbifDataFile: "gbif-invertebrates.csv",
    redListFiles: ["redlist-insecta.json", "redlist-arachnida.json", "redlist-gastropoda.json", "redlist-bivalvia.json", "redlist-malacostraca.json", "redlist-anthozoa.json"],
    gbifKingdomKey: 1, gbifClassKeys: [216, 367, 225, 137, 229, 206],
  },
  // Individual sub-taxa (for separate fetching if needed)
  mollusca: {
    id: "mollusca", name: "Molluscs",
    gbifDataFile: "gbif-mollusca.csv",
    redListFiles: ["redlist-gastropoda.json", "redlist-bivalvia.json"],
    gbifKingdomKey: 1, gbifClassKeys: [225, 137],
  },
  actinopterygii: {
    id: "actinopterygii", name: "Ray-finned Fishes",
    gbifDataFile: "gbif-actinopterygii.csv",
    redListFiles: ["redlist-actinopterygii.json"],
    gbifKingdomKey: 1, gbifOrderKeys: FISH_ORDER_KEYS,
  },
  chondrichthyes: {
    id: "chondrichthyes", name: "Sharks & Rays",
    gbifDataFile: "gbif-chondrichthyes.csv",
    redListFiles: ["redlist-chondrichthyes.json"],
    gbifKingdomKey: 1, gbifClassKeys: [121, 120],
  },
  gastropoda: {
    id: "gastropoda", name: "Snails & Slugs",
    gbifDataFile: "gbif-gastropoda.csv",
    redListFiles: ["redlist-gastropoda.json"],
    gbifKingdomKey: 1, gbifClassKey: 225,
  },
  bivalvia: {
    id: "bivalvia", name: "Bivalves",
    gbifDataFile: "gbif-bivalvia.csv",
    redListFiles: ["redlist-bivalvia.json"],
    gbifKingdomKey: 1, gbifClassKey: 137,
  },
  arachnida: {
    id: "arachnida", name: "Arachnids",
    gbifDataFile: "gbif-arachnida.csv",
    redListFiles: ["redlist-arachnida.json"],
    gbifKingdomKey: 1, gbifClassKey: 367,
  },
  malacostraca: {
    id: "malacostraca", name: "Crustaceans",
    gbifDataFile: "gbif-malacostraca.csv",
    redListFiles: ["redlist-malacostraca.json"],
    gbifKingdomKey: 1, gbifClassKey: 229,
  },
  anthozoa: {
    id: "anthozoa", name: "Corals & Anemones",
    gbifDataFile: "gbif-anthozoa.csv",
    redListFiles: ["redlist-anthozoa.json"],
    gbifKingdomKey: 1, gbifClassKey: 206,
  },
  insecta: {
    id: "insecta", name: "Insects",
    gbifDataFile: "gbif-insecta.csv",
    redListFiles: ["redlist-insecta.json"],
    gbifKingdomKey: 1, gbifClassKey: 216,
  },
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const FACET_LIMIT = 100000; // Max species per faceted occurrence query (GBIF limit)
const REQUEST_DELAY = 200; // ms between GBIF API requests to avoid rate limits
const SPECIES_VALIDATION_BATCH_SIZE = 500; // Concurrent species lookups per batch
const SPECIES_VALIDATION_DELAY = 50; // ms between validation batches
const CURRENT_YEAR = new Date().getFullYear();

// Wild observation records only (excludes specimens and literature)
const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",    // iNaturalist, eBird, etc.
  "MACHINE_OBSERVATION",  // Camera traps, acoustic sensors
  "OCCURRENCE",           // Generic occurrence record
  "MATERIAL_SAMPLE",      // DNA/tissue samples
  "OBSERVATION",          // Generic observation
];

// =============================================================================
// TYPES
// =============================================================================

interface SpeciesCount {
  speciesKey: number;
  count: number;
}

interface FacetResponse {
  count: number;
  facets: Array<{
    field: string;
    counts: Array<{ name: string; count: number }>;
  }>;
}

interface ValidatedSpecies {
  key: number;
  canonicalName: string;
  vernacularName: string;
}

interface SpeciesResult {
  speciesKey: number;
  observationsTotal: number;
  observationsAfterAssessmentYear: number | null;
  scientificName: string;
  commonName: string;
}

// =============================================================================
// HELPERS
// =============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// =============================================================================
// GBIF SPECIES VALIDATION
// =============================================================================

/**
 * Validate species keys against the GBIF Species API.
 *
 * GBIF occurrence facets return keys for ALL taxonomic levels — not just species.
 * This includes genera, subspecies, varieties, and synonyms. We filter to only
 * rank=SPECIES + taxonomicStatus=ACCEPTED to get clean species-level data.
 * Also retrieves canonical names and English vernacular names.
 */
async function validateSpeciesKeys(speciesKeys: number[]): Promise<Map<number, ValidatedSpecies>> {
  const validSpecies = new Map<number, ValidatedSpecies>();
  const invalidKeys: Array<{ key: number; reason: string }> = [];

  console.log(`\nValidating ${speciesKeys.length} species keys...`);

  for (let i = 0; i < speciesKeys.length; i += SPECIES_VALIDATION_BATCH_SIZE) {
    const batch = speciesKeys.slice(i, i + SPECIES_VALIDATION_BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (key) => {
        try {
          const response = await fetch(`https://api.gbif.org/v1/species/${key}`, {
            headers: { "Accept-Language": "en" },
          });
          if (!response.ok) {
            return { key, rank: "UNKNOWN", taxonomicStatus: "UNKNOWN", canonicalName: "", vernacularName: "" };
          }
          const data = await response.json();
          return {
            key,
            rank: data.rank || "UNKNOWN",
            taxonomicStatus: data.taxonomicStatus || "UNKNOWN",
            canonicalName: data.canonicalName || data.scientificName || "",
            vernacularName: data.vernacularName || "",
          };
        } catch {
          return { key, rank: "ERROR", taxonomicStatus: "ERROR", canonicalName: "", vernacularName: "" };
        }
      })
    );

    for (const info of results) {
      if (info.rank === "SPECIES" && info.taxonomicStatus === "ACCEPTED") {
        validSpecies.set(info.key, { key: info.key, canonicalName: info.canonicalName, vernacularName: info.vernacularName });
      } else {
        invalidKeys.push({ key: info.key, reason: `rank=${info.rank}, status=${info.taxonomicStatus}` });
      }
    }

    const progress = Math.min(i + SPECIES_VALIDATION_BATCH_SIZE, speciesKeys.length);
    process.stdout.write(`\r  Validated ${progress}/${speciesKeys.length} (${validSpecies.size} valid, ${invalidKeys.length} filtered)`);

    if (i + SPECIES_VALIDATION_BATCH_SIZE < speciesKeys.length) {
      await delay(SPECIES_VALIDATION_DELAY);
    }
  }

  console.log(`\n  Filtered out ${invalidKeys.length} non-species or non-accepted taxa`);
  if (invalidKeys.length > 0) {
    console.log(`  Examples of filtered taxa:`);
    invalidKeys.slice(0, 5).forEach((item) => {
      console.log(`    - Key ${item.key}: ${item.reason}`);
    });
  }

  return validSpecies;
}

// =============================================================================
// GBIF OCCURRENCE FACET QUERIES
// =============================================================================

/**
 * Fetch species occurrence facets for a single taxon key, with optional year filter.
 *
 * Uses GBIF's faceted search: instead of fetching individual occurrences, we ask
 * GBIF to group by speciesKey and return counts. This is much faster than iterating
 * over individual records. The facet limit is 100K species per request; we paginate
 * with facetOffset if a taxon has more.
 *
 * When yearRange is provided (e.g. "2017,2026"), only occurrences within those years
 * are counted — used for computing observations_after_assessment_year.
 */
async function fetchForTaxonKey(
  keyType: string,
  keyValue: number,
  label: string,
  yearRange?: string
): Promise<SpeciesCount[]> {
  const allResults: SpeciesCount[] = [];
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

    if (yearRange) {
      params.set("year", yearRange);
    }

    INCLUDED_BASIS_OF_RECORD.forEach((bor) => params.append("basisOfRecord", bor));

    const url = `https://api.gbif.org/v1/occurrence/search?${params}`;
    if (!yearRange) {
      console.log(`Fetching ${label} offset ${offset}...`);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GBIF API error: ${response.statusText}`);
    }

    const data: FacetResponse = await response.json();
    const speciesFacet = data.facets.find((f) => f.field === "SPECIES_KEY");

    if (!speciesFacet || speciesFacet.counts.length === 0) {
      hasMore = false;
      break;
    }

    for (const c of speciesFacet.counts) {
      allResults.push({ speciesKey: parseInt(c.name, 10), count: c.count });
    }

    if (!yearRange) {
      console.log(`  -> Got ${speciesFacet.counts.length} species (total: ${allResults.length})`);
    }

    if (speciesFacet.counts.length < FACET_LIMIT) {
      hasMore = false;
    } else {
      offset += FACET_LIMIT;
      await delay(REQUEST_DELAY);
    }
  }

  return allResults;
}

/**
 * Deduplicate species that appear in multiple queries (e.g. fishes queried by
 * multiple order keys). Keeps the highest count for each speciesKey.
 */
function deduplicateAndSort(allResults: SpeciesCount[]): SpeciesCount[] {
  const seen = new Map<number, SpeciesCount>();
  for (const r of allResults) {
    if (!seen.has(r.speciesKey) || seen.get(r.speciesKey)!.count < r.count) {
      seen.set(r.speciesKey, r);
    }
  }
  const deduped = Array.from(seen.values());
  deduped.sort((a, b) => b.count - a.count);
  return deduped;
}

/**
 * Fetch all species observation counts for a taxon (no year filter).
 * Handles multiple class/order keys with deduplication.
 */
async function fetchAllSpeciesCounts(taxon: TaxonConfig): Promise<SpeciesCount[]> {
  const allResults: SpeciesCount[] = [];

  if (taxon.gbifOrderKeys && taxon.gbifOrderKeys.length > 0) {
    let orderIndex = 0;
    for (const orderKey of taxon.gbifOrderKeys) {
      orderIndex++;
      console.log(`\nFetching orderKey ${orderKey} (${orderIndex}/${taxon.gbifOrderKeys.length})...`);
      const results = await fetchForTaxonKey("orderKey", orderKey, `order ${orderKey}`);
      for (const r of results) allResults.push(r);
      await delay(REQUEST_DELAY);
    }
  }

  if (taxon.gbifClassKeys && taxon.gbifClassKeys.length > 0) {
    for (const classKey of taxon.gbifClassKeys) {
      console.log(`\nFetching classKey ${classKey}...`);
      const results = await fetchForTaxonKey("classKey", classKey, `class ${classKey}`);
      for (const r of results) allResults.push(r);
      await delay(REQUEST_DELAY);
    }
  }

  if (allResults.length > 0) {
    return deduplicateAndSort(allResults);
  }

  // Single class key or kingdom key
  if (taxon.gbifClassKey) {
    const results = await fetchForTaxonKey("classKey", taxon.gbifClassKey, `class ${taxon.gbifClassKey}`);
    for (const r of results) allResults.push(r);
  } else {
    const results = await fetchForTaxonKey("kingdomKey", taxon.gbifKingdomKey, `kingdom ${taxon.gbifKingdomKey}`);
    for (const r of results) allResults.push(r);
  }

  allResults.sort((a, b) => b.count - a.count);
  return allResults;
}

/**
 * Fetch observation counts per speciesKey for a given taxon and year range.
 * Used for computing observations_after_assessment_year.
 */
async function fetchFacetsForYearRange(
  taxon: TaxonConfig,
  startYear: number,
  endYear: number
): Promise<Map<number, number>> {
  const yearRange = `${startYear},${endYear}`;
  const allCounts = new Map<number, number>();

  // Build the list of key-type/key-value pairs to query
  const queries: Array<{ keyType: string; keyValue: number; label: string }> = [];

  if (taxon.gbifOrderKeys && taxon.gbifOrderKeys.length > 0) {
    for (const orderKey of taxon.gbifOrderKeys) {
      queries.push({ keyType: "orderKey", keyValue: orderKey, label: `order ${orderKey}` });
    }
  }
  if (taxon.gbifClassKeys && taxon.gbifClassKeys.length > 0) {
    for (const classKey of taxon.gbifClassKeys) {
      queries.push({ keyType: "classKey", keyValue: classKey, label: `class ${classKey}` });
    }
  }
  if (queries.length === 0) {
    if (taxon.gbifClassKey) {
      queries.push({ keyType: "classKey", keyValue: taxon.gbifClassKey, label: `class ${taxon.gbifClassKey}` });
    } else {
      queries.push({ keyType: "kingdomKey", keyValue: taxon.gbifKingdomKey, label: `kingdom ${taxon.gbifKingdomKey}` });
    }
  }

  for (const q of queries) {
    const results = await fetchForTaxonKey(q.keyType, q.keyValue, q.label, yearRange);
    for (const r of results) {
      const existing = allCounts.get(r.speciesKey) || 0;
      allCounts.set(r.speciesKey, existing + r.count);
    }
    await delay(REQUEST_DELAY);
  }

  return allCounts;
}

// =============================================================================
// RED LIST ASSESSMENT YEARS
// =============================================================================

interface RedListSpecies {
  scientific_name: string;
  assessment_date: string | null;
}

/**
 * Load assessment years from Red List JSON files.
 * Returns a map of lowercase scientific_name → assessment_year.
 */
function loadAssessmentYears(redListFiles: string[], dataDir: string): Map<string, number> {
  const lookup = new Map<string, number>();

  for (const file of redListFiles) {
    const filePath = path.join(dataDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  Warning: Red List file not found: ${file}`);
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    const species: RedListSpecies[] = data.species || [];

    for (const s of species) {
      if (s.scientific_name && s.assessment_date) {
        const year = parseInt(s.assessment_date.slice(0, 4), 10);
        if (!isNaN(year)) {
          lookup.set(s.scientific_name.toLowerCase().trim(), year);
        }
      }
    }
  }

  return lookup;
}

// =============================================================================
// CSV OUTPUT
// =============================================================================

/**
 * Write results to CSV. The output is consumed by two API routes:
 *   - /api/redlist/species (enriches Red List data with post-assessment counts)
 *   - /api/species (serves NE species not on the Red List)
 *
 * Species without a Red List assessment get an empty observations_after_assessment_year field.
 */
function saveToCsv(results: SpeciesResult[], outputFile: string): void {
  const header = "species_key,observations_total,scientific_name,common_name,observations_after_assessment_year";
  const rows = results.map((r) => {
    const safeName = r.scientificName.includes(",") ? `"${r.scientificName}"` : r.scientificName;
    const commonName = r.commonName ? toTitleCase(r.commonName) : "";
    const safeCommon = commonName.includes(",") ? `"${commonName}"` : commonName;
    const sinceStr = r.observationsAfterAssessmentYear !== null ? r.observationsAfterAssessmentYear.toString() : "";
    return `${r.speciesKey},${r.observationsTotal},${safeName},${safeCommon},${sinceStr}`;
  });
  const content = [header, ...rows].join("\n");
  fs.writeFileSync(outputFile, content);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const taxonId = args[0]?.toLowerCase();

  if (!taxonId) {
    console.error("Usage: npx tsx scripts/fetch-gbif-species.ts <taxon>");
    console.error("\nAvailable taxa:");
    Object.entries(TAXA_CONFIG).forEach(([id, config]) => {
      console.error(`  ${id.padEnd(18)} - ${config.name}`);
    });
    process.exit(1);
  }

  const taxonConfig = TAXA_CONFIG[taxonId];
  if (!taxonConfig) {
    console.error(`Unknown taxon: ${taxonId}`);
    console.error("\nAvailable taxa:");
    Object.keys(TAXA_CONFIG).forEach((id) => console.error(`  ${id}`));
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), "data");
  const OUTPUT_FILE = path.join(dataDir, taxonConfig.gbifDataFile);

  const startTime = Date.now();

  console.log(`GBIF Species Observation Fetcher - ${taxonConfig.name}`);
  console.log("=".repeat(60));
  console.log(`Taxon: ${taxonConfig.name} (${taxonId})`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log("");

  try {
    // =========================================================================
    // STEP 1: Fetch total observation counts
    // =========================================================================
    console.log("Step 1: Fetching species observation counts from GBIF...");
    console.log("(Wild observations only — excluding specimens)");
    const rawResults = await fetchAllSpeciesCounts(taxonConfig);
    console.log(`\nRaw species count (before validation): ${rawResults.length}`);

    // =========================================================================
    // STEP 2: Validate species keys
    // =========================================================================
    console.log("\nStep 2: Validating species keys...");
    const speciesKeys = rawResults.map((r) => r.speciesKey);
    const validSpecies = await validateSpeciesKeys(speciesKeys);

    const validated = rawResults
      .filter((r) => validSpecies.has(r.speciesKey))
      .map((r) => {
        const info = validSpecies.get(r.speciesKey)!;
        return {
          speciesKey: r.speciesKey,
          observationsTotal: r.count,
          scientificName: info.canonicalName,
          commonName: info.vernacularName,
        };
      });

    console.log(`\nValidated species count: ${validated.length}`);

    if (validated.length > 0) {
      console.log(`Top 5 by observation count:`);
      validated.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.scientificName}: ${r.observationsTotal.toLocaleString()}`);
      });
      const totalObs = validated.reduce((sum, r) => sum + r.observationsTotal, 0);
      console.log(`Total observations: ${totalObs.toLocaleString()}`);
    }

    // =========================================================================
    // STEP 3: Compute observations after assessment year
    // =========================================================================
    console.log("\nStep 3: Loading Red List assessment years...");
    const assessmentYears = loadAssessmentYears(taxonConfig.redListFiles, dataDir);
    console.log(`  ${assessmentYears.size} species with assessment dates`);

    // Match validated species to assessment years
    const speciesAssessmentYear = new Map<number, number>();
    let matched = 0;
    for (const sp of validated) {
      const year = assessmentYears.get(sp.scientificName.toLowerCase().trim());
      if (year !== undefined) {
        speciesAssessmentYear.set(sp.speciesKey, year);
        matched++;
      }
    }
    console.log(`  ${matched} matched to GBIF species, ${validated.length - matched} unmatched (NE species)`);

    // Group species by assessment year into "buckets". All species assessed in
    // the same year share a single GBIF faceted query (e.g. year=2017,2026 for
    // species assessed in 2016). This reduces ~170K species to ~17-25 queries.
    const uniqueYears = [...new Set(speciesAssessmentYear.values())].sort((a, b) => a - b);
    const yearBuckets = uniqueYears.filter((y) => y + 1 <= CURRENT_YEAR);
    console.log(`  ${yearBuckets.length} year buckets to query`);

    const sinceAssessmentCounts = new Map<number, number>();

    console.log("\nStep 4: Querying GBIF for post-assessment observations...");
    for (const assessmentYear of yearBuckets) {
      const startYear = assessmentYear + 1;
      const speciesInBucket = [...speciesAssessmentYear.entries()]
        .filter(([, y]) => y === assessmentYear)
        .map(([key]) => key);

      process.stdout.write(`  Year ${assessmentYear} (${speciesInBucket.length} species)...`);

      const counts = await fetchFacetsForYearRange(taxonConfig, startYear, CURRENT_YEAR);

      let found = 0;
      for (const speciesKey of speciesInBucket) {
        const count = counts.get(speciesKey);
        sinceAssessmentCounts.set(speciesKey, count ?? 0);
        if (count !== undefined) found++;
      }

      console.log(` ${found}/${speciesInBucket.length} have new records`);
    }

    // =========================================================================
    // STEP 5: Write CSV
    // =========================================================================
    console.log("\nStep 5: Writing CSV...");
    const results: SpeciesResult[] = validated.map((sp) => ({
      ...sp,
      observationsAfterAssessmentYear: sinceAssessmentCounts.has(sp.speciesKey)
        ? sinceAssessmentCounts.get(sp.speciesKey)!
        : null,
    }));

    // Sort by total observations descending
    results.sort((a, b) => b.observationsTotal - a.observationsTotal);

    saveToCsv(results, OUTPUT_FILE);

    const stats = fs.statSync(OUTPUT_FILE);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`  Written to ${taxonConfig.gbifDataFile} (${sizeMB} MB)`);

    // Summary
    const withNewRecords = [...sinceAssessmentCounts.values()].filter((c) => c > 0).length;
    const totalNewRecords = [...sinceAssessmentCounts.values()].reduce((sum, c) => sum + c, 0);
    console.log(`\nSummary:`);
    console.log(`  ${validated.length} species total`);
    console.log(`  ${sinceAssessmentCounts.size} with assessment dates`);
    console.log(`  ${withNewRecords} have new observations since assessment`);
    console.log(`  ${totalNewRecords.toLocaleString()} total new observations`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;
    console.log(`  Completed in ${minutes}m ${seconds}s`);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
