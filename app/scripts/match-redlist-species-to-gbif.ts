/**
 * match-redlist-species-to-gbif: GBIF Species Match API → per-taxon redlist CSVs
 *
 * Resolves Red List scientific names to GBIF species keys using
 * GBIF's fuzzy matching API, then writes gbif_species_key and
 * match_type back to data/redlist/{taxonId}.csv.
 *
 * Prerequisites:
 *   1. Per-taxon redlist CSVs exist in data/redlist/ (from fetch-redlist)
 *   2. Per-taxon GBIF CSVs exist in data/gbif/ (from fetch-gbif)
 *
 * Usage:
 *   npx tsx scripts/match-redlist-species-to-gbif.ts
 */

import * as path from "path";
import * as fs from "fs";
import {
  loadEnvFiles,
  SyncLogger,
  REDLIST_DIR,
  GBIF_DIR,
  delay,
  mapConcurrent,
} from "./utils";
import {
  RedlistSpecies,
  writeRedlistCsv,
  readRedlistCsv,
} from "./fetch-redlist-species";
import { readGbifCsv } from "./fetch-gbif-species";
import { TAXA } from "./taxa";

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
    try {
      response = await fetch(`https://api.gbif.org/v1/species/match?${params}`);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const wait = Math.pow(2, attempt + 1) * 1000;
        await delay(wait);
        continue;
      }
      throw err;
    }
    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
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

function loadAllRedlistSpecies(): RedlistSpecies[] {
  const allSpecies: RedlistSpecies[] = [];
  for (const taxon of TAXA) {
    const csvPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    allSpecies.push(...readRedlistCsv(taxon.id));
  }
  return allSpecies;
}

function loadAllGbifKeys(): Set<number> {
  const keys = new Set<number>();
  for (const taxon of TAXA) {
    const csvPath = path.join(GBIF_DIR, `${taxon.id}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    const map = readGbifCsv(taxon.id);
    for (const key of map.keys()) keys.add(key);
  }
  return keys;
}

export async function matchAllSpecies(
  logger: SyncLogger
): Promise<RedlistSpecies[]> {
  const redlistSpecies = loadAllRedlistSpecies();
  const gbifKeys = loadAllGbifKeys();

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

export async function run(opts: {
  logger?: SyncLogger;
} = {}): Promise<void> {
  const logger = opts.logger ?? SyncLogger.noop();

  const startTime = Date.now();

  logger.log("match_start", {});

  const redlistSpecies = await matchAllSpecies(logger);

  // Group by taxon and write per-taxon CSVs
  const byTaxon = new Map<string, RedlistSpecies[]>();
  for (const s of redlistSpecies) {
    const group = byTaxon.get(s.taxon_group_table1a) || [];
    group.push(s);
    byTaxon.set(s.taxon_group_table1a, group);
  }
  for (const [taxonId, species] of byTaxon) {
    writeRedlistCsv(species, path.join(REDLIST_DIR, `${taxonId}.csv`));
  }

  const linkedCount = redlistSpecies.filter((r) => r.gbif_species_key !== null).length;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;

  logger.log("match_complete", { total: redlistSpecies.length, linked: linkedCount, duration_seconds: Number(elapsed) });

  console.log("\n" + "=".repeat(50));
  console.log("match complete:");
  console.log(`  Total:   ${redlistSpecies.length.toLocaleString()}`);
  console.log(`  Linked:  ${linkedCount.toLocaleString()}`);
  console.log(`  Output:  ${REDLIST_DIR}/`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
}

async function main() {
  loadEnvFiles();

  console.log("match-redlist-species-to-gbif: GBIF Match API → per-taxon redlist CSVs");
  console.log("=".repeat(50));

  const logger = new SyncLogger("match-redlist-species-to-gbif");
  try {
    await run({ logger });
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("match-redlist-species-to-gbif.ts") || process.argv[1]?.endsWith("match-redlist-species-to-gbif.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
