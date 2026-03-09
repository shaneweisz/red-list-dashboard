/**
 * match-species: GBIF Species Match API → species-links.csv
 *
 * Resolves Red List scientific names to GBIF species keys using
 * GBIF's fuzzy matching API, then writes species-links.csv.
 *
 * Prerequisites:
 *   1. redlist-species.csv exists (from sync-redlist)
 *   2. gbif-species.csv exists (from sync-gbif)
 *
 * Usage:
 *   npx tsx scripts/match-species.ts
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  readCsv,
  writeCsv,
  DATA_DIR,
  delay,
  mapConcurrent,
} from "./config";

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

export interface LinkResult {
  sis_taxon_id: number;
  gbif_species_key: number | null;
  match_type: string;
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
// MATCHING FROM CSVs
// =============================================================================

export async function matchAllSpecies(
  logger: SyncLogger
): Promise<LinkResult[]> {
  const redlistPath = path.join(DATA_DIR, "redlist-species.csv");
  const gbifPath = path.join(DATA_DIR, "gbif-species.csv");

  const redlistSpecies = readCsv(redlistPath, (r) => ({
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    scientific_name: r.scientific_name,
  }));

  const gbifKeys = new Set(
    readCsv(gbifPath, (r) => parseInt(r.gbif_species_key, 10))
  );

  console.log(`  ${redlistSpecies.length} Red List species to match`);
  console.log(`  ${gbifKeys.size} GBIF species keys available`);

  const claimedGbifKeys = new Set<number>();
  const results: LinkResult[] = [];
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
      results.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: null, match_type: matchType });
    } else if (!gbifKeys.has(key)) {
      noGbifData++;
      results.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: null, match_type: "NO_GBIF_DATA" });
    } else if (claimedGbifKeys.has(key)) {
      alreadyLinked++;
      results.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: null, match_type: "DUPLICATE" });
    } else {
      claimedGbifKeys.add(key);
      results.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: key, match_type: matchType });
      if (matchType === "EXACT") exact++;
      else fuzzy++;
    }
  }

  const linked = exact + fuzzy;
  console.log(`  Linked: ${linked} (${exact} exact, ${fuzzy} fuzzy)`);
  console.log(`  Unlinked: ${noMatch + noGbifData + alreadyLinked} (${noMatch} no match, ${noGbifData} no GBIF data, ${alreadyLinked} duplicate)`);

  return results;
}

// =============================================================================
// CSV OUTPUT
// =============================================================================

const LINKS_CSV_COLUMNS = ["sis_taxon_id", "gbif_species_key", "match_type"];

export function writeLinksCsv(results: LinkResult[], outputPath: string): void {
  const rows = results
    .sort((a, b) => a.sis_taxon_id - b.sis_taxon_id)
    .map((r) => ({
      sis_taxon_id: r.sis_taxon_id,
      gbif_species_key: r.gbif_species_key,
      match_type: r.match_type,
    }));

  writeCsv(rows, LINKS_CSV_COLUMNS, outputPath);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  console.log("match-species: GBIF Match API → species-links.csv");
  console.log("=".repeat(50));

  const startTime = Date.now();
  const logger = new SyncLogger("match-species");

  try {
    logger.log("match_start", {});

    const results = await matchAllSpecies(logger);

    const outputPath = path.join(DATA_DIR, "species-links.csv");
    writeLinksCsv(results, outputPath);

    const linkedCount = results.filter((r) => r.gbif_species_key !== null).length;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("match_complete", { total: results.length, linked: linkedCount, duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(50));
    console.log("match-species complete:");
    console.log(`  Total:   ${results.length.toLocaleString()}`);
    console.log(`  Linked:  ${linkedCount.toLocaleString()}`);
    console.log(`  Output:  ${outputPath}`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("match-species.ts") || process.argv[1]?.endsWith("match-species.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
