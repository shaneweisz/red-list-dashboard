/**
 * match-redlist-species-to-gbif: GBIF Species Match API → data/mapping.csv
 *
 * Resolves Red List scientific names to GBIF species keys using
 * GBIF's fuzzy matching API, then writes a single data/mapping.csv
 * with columns: sis_taxon_id, gbif_species_key, match_type.
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
  DATA_DIR,
  REDLIST_DIR,
  GBIF_DIR,
  writeCsv,
  readCsv,
  delay,
  mapConcurrent,
} from "./utils";
import { readRedlistCsv } from "./fetch-redlist-species";
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

export interface MappingEntry {
  sis_taxon_id: number;
  gbif_species_key: number | null;
  match_type: string;
}

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
// MAPPING CSV
// =============================================================================

const MAPPING_CSV_PATH = path.join(DATA_DIR, "mapping.csv");
const MAPPING_CSV_COLUMNS = ["sis_taxon_id", "gbif_species_key", "match_type"];

export function writeMappingCsv(entries: MappingEntry[]): void {
  const rows = entries.map((e) => ({
    sis_taxon_id: e.sis_taxon_id,
    gbif_species_key: e.gbif_species_key,
    match_type: e.match_type,
  }));
  writeCsv(rows, MAPPING_CSV_COLUMNS, MAPPING_CSV_PATH);
}

export function readMappingCsv(): Map<number, { gbif_species_key: number | null; match_type: string }> {
  if (!fs.existsSync(MAPPING_CSV_PATH)) return new Map();
  const entries = readCsv<MappingEntry>(MAPPING_CSV_PATH, (r) => ({
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    gbif_species_key: r.gbif_species_key ? parseInt(r.gbif_species_key, 10) : null,
    match_type: r.match_type || "",
  }));
  const map = new Map<number, { gbif_species_key: number | null; match_type: string }>();
  for (const e of entries) {
    map.set(e.sis_taxon_id, { gbif_species_key: e.gbif_species_key, match_type: e.match_type });
  }
  return map;
}

// =============================================================================
// MATCHING
// =============================================================================

interface SpeciesInput {
  sis_taxon_id: number;
  scientific_name: string;
}

function loadAllRedlistSpecies(): SpeciesInput[] {
  const allSpecies: SpeciesInput[] = [];
  for (const taxon of TAXA) {
    const csvPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    for (const s of readRedlistCsv(taxon.id)) {
      allSpecies.push({ sis_taxon_id: s.sis_taxon_id, scientific_name: s.scientific_name });
    }
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
): Promise<MappingEntry[]> {
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

  const entries: MappingEntry[] = [];

  for (const { species, key, matchType } of matchResults) {
    if (key === null) {
      noMatch++;
      entries.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: null, match_type: matchType });
    } else if (!gbifKeys.has(key)) {
      noGbifData++;
      entries.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: null, match_type: "NO_GBIF_DATA" });
    } else if (claimedGbifKeys.has(key)) {
      alreadyLinked++;
      entries.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: null, match_type: "DUPLICATE" });
    } else {
      claimedGbifKeys.add(key);
      entries.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: key, match_type: matchType });
      if (matchType === "EXACT") exact++;
      else fuzzy++;
    }
  }

  const linked = exact + fuzzy;
  console.log(`  Linked: ${linked} (${exact} exact, ${fuzzy} fuzzy)`);
  console.log(`  Unlinked: ${noMatch + noGbifData + alreadyLinked} (${noMatch} no match, ${noGbifData} no GBIF data, ${alreadyLinked} duplicate)`);

  return entries;
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

  const entries = await matchAllSpecies(logger);

  writeMappingCsv(entries);

  const linkedCount = entries.filter((e) => e.gbif_species_key !== null).length;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;

  logger.log("match_complete", { total: entries.length, linked: linkedCount, duration_seconds: Number(elapsed) });

  console.log("\n" + "=".repeat(50));
  console.log("match complete:");
  console.log(`  Total:   ${entries.length.toLocaleString()}`);
  console.log(`  Linked:  ${linkedCount.toLocaleString()}`);
  console.log(`  Output:  ${MAPPING_CSV_PATH}`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
}

async function main() {
  loadEnvFiles();

  console.log("match-redlist-species-to-gbif: GBIF Match API → data/mapping.csv");
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
