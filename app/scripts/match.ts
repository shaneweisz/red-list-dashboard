/**
 * match: GBIF Species Match API → redlist-species.csv
 *
 * Resolves Red List scientific names to GBIF species keys using
 * GBIF's fuzzy matching API, then writes gbif_species_key and
 * match_type back to redlist-species.csv.
 *
 * Prerequisites:
 *   1. redlist-species.csv exists (from fetch-redlist)
 *   2. gbif-species.csv exists (from fetch-gbif)
 *
 * Usage:
 *   npx tsx scripts/match.ts
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  readCsv,
  DATA_DIR,
  delay,
  mapConcurrent,
} from "./utils";
import {
  RedlistSpecies,
  writeRedlistCsv,
} from "./fetch-redlist";

// =============================================================================
// CONFIGURATION
// =============================================================================

const MATCH_CONCURRENCY = 50;
const MAX_RETRIES = 5;

// =============================================================================
// TYPES
// =============================================================================

interface GbifMatchResponse {
  usageKey?: number;
  acceptedUsageKey?: number;
  canonicalName?: string;
  matchType?: string; // EXACT, FUZZY, HIGHERRANK, NONE
  rank?: string;
  confidence?: number;
  synonym?: boolean;
}

// =============================================================================
// GBIF MATCH API
// =============================================================================

export async function matchGbifSpecies(
  name: string
): Promise<{ key: number | null; matchType: string }> {
  const params = new URLSearchParams({ name, strict: "true" });

  let response: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    response = await fetch(`https://api.gbif.org/v1/species/match?${params}`);
    if (response.status === 429) {
      const wait = Math.pow(2, attempt + 1) * 1000;
      await delay(wait);
      continue;
    }
    break;
  }
  if (!response || !response.ok) {
    throw new Error(`GBIF Match API error: ${response?.status} ${response?.statusText}`);
  }

  const data: GbifMatchResponse = await response.json();

  if (!data.matchType || data.matchType === "NONE" || data.matchType === "HIGHERRANK") {
    return { key: null, matchType: data.matchType || "NONE" };
  }

  if (data.rank !== "SPECIES") {
    return { key: null, matchType: "WRONG_RANK" };
  }

  const resolvedKey = data.acceptedUsageKey || data.usageKey || null;
  return { key: resolvedKey, matchType: data.matchType };
}

// =============================================================================
// MATCHING
// =============================================================================

function loadRedlistCsv(): RedlistSpecies[] {
  const csvPath = path.join(DATA_DIR, "redlist-species.csv");
  return readCsv<RedlistSpecies>(csvPath, (r) => ({
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    assessment_id: parseInt(r.assessment_id, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || null,
    class_name: r.class_name || null,
    order_name: r.order_name || null,
    family: r.family || null,
    category: r.iucn_category || "",
    assessment_date: r.assessment_date || null,
    year_published: r.year_published || "",
    population_trend: r.population_trend || null,
    countries: r.countries ? r.countries.split(";").filter(Boolean) : [],
    taxon_group_table1a: r.taxon_group_table1a,
    gbif_species_key: r.gbif_species_key ? parseInt(r.gbif_species_key, 10) : null,
    match_type: r.match_type || null,
  }));
}

export async function matchAllSpecies(
  logger: SyncLogger
): Promise<RedlistSpecies[]> {
  const gbifPath = path.join(DATA_DIR, "gbif-species.csv");

  const redlistSpecies = loadRedlistCsv();

  const gbifKeys = new Set(
    readCsv(gbifPath, (r) => parseInt(r.gbif_species_key, 10))
  );

  console.log(`  ${redlistSpecies.length} Red List species to match`);
  console.log(`  ${gbifKeys.size} GBIF species keys available`);

  const claimedGbifKeys = new Set<number>();
  let matched = 0;
  let exact = 0, fuzzy = 0, noMatch = 0, noGbifData = 0, alreadyLinked = 0;

  const matchResults = await mapConcurrent(
    redlistSpecies,
    MATCH_CONCURRENCY,
    async (species) => {
      try {
        const { key, matchType } = await matchGbifSpecies(species.scientific_name);
        matched++;
        if (matched % 1000 === 0) {
          process.stdout.write(`\r  Matched ${matched}/${redlistSpecies.length}`);
        }
        return { species, key, matchType };
      } catch (err) {
        logger.log("error", { sis_taxon_id: species.sis_taxon_id, name: species.scientific_name, error: String(err) });
        return { species, key: null, matchType: "ERROR" };
      }
    }
  );
  process.stdout.write(`\r  Matched ${redlistSpecies.length}/${redlistSpecies.length}\n`);

  for (const { species, key, matchType } of matchResults) {
    if (key === null) {
      noMatch++;
      species.gbif_species_key = null;
      species.match_type = matchType;
    } else if (!gbifKeys.has(key)) {
      noGbifData++;
      species.gbif_species_key = null;
      species.match_type = "NO_GBIF_DATA";
    } else if (claimedGbifKeys.has(key)) {
      alreadyLinked++;
      species.gbif_species_key = null;
      species.match_type = "DUPLICATE";
    } else {
      claimedGbifKeys.add(key);
      species.gbif_species_key = key;
      species.match_type = matchType;
      if (matchType === "EXACT") exact++;
      else fuzzy++;
    }
  }

  const linked = exact + fuzzy;
  console.log(`  Linked: ${linked} (${exact} exact, ${fuzzy} fuzzy)`);
  console.log(`  Unlinked: ${noMatch + noGbifData + alreadyLinked} (${noMatch} no match, ${noGbifData} no GBIF data, ${alreadyLinked} duplicate)`);

  return redlistSpecies;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  console.log("match: GBIF Match API → redlist-species.csv");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const logger = new SyncLogger("match");

  try {
    logger.log("match_start", {});

    const redlistSpecies = await matchAllSpecies(logger);

    const outputPath = path.join(DATA_DIR, "redlist-species.csv");
    writeRedlistCsv(redlistSpecies, outputPath);

    const linkedCount = redlistSpecies.filter((r) => r.gbif_species_key !== null).length;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("match_complete", { total: redlistSpecies.length, linked: linkedCount, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("match complete:");
    console.log(`  Total:   ${redlistSpecies.length.toLocaleString()}`);
    console.log(`  Linked:  ${linkedCount.toLocaleString()}`);
    console.log(`  Output:  ${outputPath}`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("match.ts") || process.argv[1]?.endsWith("match.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
