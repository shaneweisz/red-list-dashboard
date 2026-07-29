/**
 * fetch-gbif-species: GBIF API → CSV
 *
 * Fetches per-species observation counts from GBIF and writes per-taxon to data/gbif/{taxonId}.csv.
 *
 * Usage:
 *   npx tsx scripts/fetch-gbif-species.ts [taxon]   # Fetch one taxon (e.g. mammalia)
 *   npx tsx scripts/fetch-gbif-species.ts            # Fetch all taxa
 */

import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  loadEnvFiles,
  SyncLogger,
  writeCsv,
  readCsv,
  DATA_DIR,
  GBIF_DIR,
  delay,
  toTitleCase,
} from "./utils";
import { getTaxa, type Taxon, type GbifQuery } from "./taxa";
import { COL_XR_CHECKLIST_KEY, INCLUDED_BASIS_OF_RECORD } from "../src/lib/gbif";

// =============================================================================
// GBIF TAXA (legacy lookup — used by fetch-gbif-new-counts)
// =============================================================================

export type { Taxon, GbifQuery };

// =============================================================================
// CONFIGURATION
// =============================================================================

const FACET_LIMIT = 100000;
const REQUEST_DELAY = 200; // ms between GBIF requests
const MAX_RETRIES = 5;

// =============================================================================
// TYPES
// =============================================================================

interface SpeciesCount {
  speciesKey: string;
  count: number;
  taxonGroup: string;
}

interface ValidatedSpecies {
  key: string;
  canonicalName: string;
  vernacularName: string;
  className: string;
  orderName: string;
  familyName: string;
}

export interface GbifSpecies {
  gbif_species_key: string;
  scientific_name: string;
  common_name: string;
  taxon_group_table1a: string;
  total_count: number;
  count_after_assessment_year: number | null;
  class_name: string;
  order_name: string;
  family: string;
  countries: string;
}

// =============================================================================
// GBIF API FUNCTIONS
// =============================================================================

export async function fetchFacets(
  taxonKey: string,
  yearRange?: string,
  modifiedRange?: string,
): Promise<Array<{ speciesKey: string; count: number }>> {
  const allResults: Array<{ speciesKey: string; count: number }> = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      checklistKey: COL_XR_CHECKLIST_KEY,
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
      facet: "speciesKey",
      facetLimit: FACET_LIMIT.toString(),
      facetOffset: offset.toString(),
      limit: "0",
      taxonKey,
    });

    if (yearRange) params.set("year", yearRange);
    if (modifiedRange) params.set("modified", modifiedRange);
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
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
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
      allResults.push({ speciesKey: c.name, count: c.count });
    }

    hasMore = facet.counts.length >= FACET_LIMIT;
    if (hasMore) {
      offset += FACET_LIMIT;
      await delay(REQUEST_DELAY);
    }
  }

  return allResults;
}

export async function fetchGbifCounts(taxon: Taxon): Promise<SpeciesCount[]> {
  const allResults: SpeciesCount[] = [];

  for (let i = 0; i < taxon.gbif.length; i++) {
    const q = taxon.gbif[i];
    process.stdout.write(`\r  Query ${i + 1}/${taxon.gbif.length}`);
    const results = await fetchFacets(q.taxonKey);
    for (const r of results) {
      allResults.push({ speciesKey: r.speciesKey, count: r.count, taxonGroup: taxon.id });
    }
    if (i < taxon.gbif.length - 1) await delay(REQUEST_DELAY);
  }
  console.log("");

  // Deduplicate: keep highest count per speciesKey
  const seen = new Map<string, SpeciesCount>();
  for (const r of allResults) {
    if (!seen.has(r.speciesKey) || seen.get(r.speciesKey)!.count < r.count) {
      seen.set(r.speciesKey, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.count - a.count);
}

/**
 * Resolve facet species keys to accepted species, with lineage and common name.
 *
 * These keys are Catalogue of Life Extended Release ids, and CoL XR is exactly
 * what data/species/ is built from (build-backbone, phase 9) — so this is a
 * local join, not a network call. It replaces a per-key GBIF lookup that issued
 * one HTTP request for every species in every taxon (millions per full sync);
 * the equivalent GBIF endpoint (v1/species/{key}) does not accept COL XR keys
 * at all, and its v2 replacement returns no vernacular names.
 *
 * Presence in data/species/ IS the validity test: build-backbone writes only
 * accepted species there.
 */
export async function validateSpeciesKeys(speciesKeys: string[]): Promise<Map<string, ValidatedSpecies>> {
  const valid = new Map<string, ValidatedSpecies>();
  if (speciesKeys.length === 0) return valid;

  const speciesGlob = path.join(DATA_DIR, "species", "**", "*.parquet");
  const vernacularParquet = path.join(DATA_DIR, "species-vernaculars.parquet");
  if (!fs.existsSync(path.join(DATA_DIR, "species"))) {
    throw new Error(
      `validateSpeciesKeys: ${path.join(DATA_DIR, "species")} not found. It is written by ` +
      `build-backbone (sync phase 9), which must run before the GBIF phases.`
    );
  }
  const hasVernaculars = fs.existsSync(vernacularParquet);
  if (!hasVernaculars) {
    console.warn("  species-vernaculars.parquet not found — common names will be blank for this run.");
  }

  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();
  try {
    await conn.run(`CREATE TEMP TABLE wanted (col_id VARCHAR);`);
    const appender = await conn.createAppender("wanted");
    for (const k of speciesKeys) {
      appender.appendVarchar(k);
      appender.endRow();
    }
    appender.closeSync();

    const reader = await conn.runAndReadAll(`
      SELECT s.col_id, s.scientific_name, s.class_name, s.order_name, s.family,
             ${hasVernaculars ? "v.vernacular_name" : "NULL AS vernacular_name"}
      FROM wanted w
      JOIN '${speciesGlob}' s ON s.col_id = w.col_id
      ${hasVernaculars ? `LEFT JOIN '${vernacularParquet}' v ON v.col_id = s.col_id` : ""}
    `);

    for (const r of reader.getRowObjects()) {
      const key = String(r.col_id);
      valid.set(key, {
        key,
        canonicalName: String(r.scientific_name ?? ""),
        vernacularName: r.vernacular_name ? String(r.vernacular_name) : "",
        className: String(r.class_name ?? ""),
        orderName: String(r.order_name ?? ""),
        familyName: String(r.family ?? ""),
      });
    }
  } finally {
    conn.closeSync();
    inst.closeSync();
  }

  return valid;
}

// =============================================================================
// CSV OUTPUT
// =============================================================================

const GBIF_CSV_COLUMNS = [
  "gbif_species_key", "scientific_name", "common_name",
  "class_name", "order_name", "family", "taxon_group_table1a",
  "total_count", "count_after_assessment_year", "countries",
];

export function writeGbifCsv(speciesMap: Map<string, GbifSpecies>, outputPath: string): void {
  const rows = Array.from(speciesMap.values())
    .map((s) => ({
      gbif_species_key: s.gbif_species_key,
      scientific_name: s.scientific_name,
      common_name: s.common_name || null,
      taxon_group_table1a: s.taxon_group_table1a,
      total_count: s.total_count,
      count_after_assessment_year: s.count_after_assessment_year,
      class_name: s.class_name || null,
      order_name: s.order_name || null,
      family: s.family || null,
      countries: s.countries || null,
    }));

  writeCsv(rows, GBIF_CSV_COLUMNS, outputPath);
}

export function readGbifCsv(taxonId: string): Map<string, GbifSpecies> {
  const csvPath = path.join(GBIF_DIR, `${taxonId}.csv`);
  const rows = readCsv<GbifSpecies>(csvPath, (r) => ({
    gbif_species_key: r.gbif_species_key,
    scientific_name: r.scientific_name,
    common_name: r.common_name,
    taxon_group_table1a: r.taxon_group_table1a,
    total_count: parseInt(r.total_count, 10) || 0,
    count_after_assessment_year: r.count_after_assessment_year ? parseInt(r.count_after_assessment_year, 10) : null,
    class_name: r.class_name || "",
    order_name: r.order_name || "",
    family: r.family || "",
    countries: r.countries || "",
  }));
  const map = new Map<string, GbifSpecies>();
  for (const row of rows) map.set(row.gbif_species_key, row);
  return map;
}

// =============================================================================
// MAIN
// =============================================================================

export async function run(opts: {
  taxa?: string[];
  logger?: SyncLogger;
} = {}): Promise<void> {
  const taxaToSync = getTaxa(opts.taxa);
  const logger = opts.logger ?? SyncLogger.noop();

  const startTime = Date.now();

  logger.log("fetch_gbif_species_start", {
    taxa: taxaToSync.map((t) => t.id),
    taxa_count: taxaToSync.length,
  });

  let totalSpecies = 0;

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

    const taxonMap = new Map<string, GbifSpecies>();
    for (const r of rawResults) {
      const info = validSpecies.get(r.speciesKey);
      if (!info) continue;
      taxonMap.set(r.speciesKey, {
        gbif_species_key: r.speciesKey,
        scientific_name: info.canonicalName,
        common_name: info.vernacularName ? toTitleCase(info.vernacularName) : "",
        taxon_group_table1a: r.taxonGroup,
        total_count: r.count,
        count_after_assessment_year: null,
        class_name: info.className.toLowerCase(),
        order_name: info.orderName.toLowerCase(),
        family: info.familyName.toLowerCase(),
        countries: "",
      });
    }

    const outputPath = path.join(GBIF_DIR, `${taxon.id}.csv`);
    writeGbifCsv(taxonMap, outputPath);
    console.log(`  Wrote ${taxonMap.size} species → ${outputPath}`);

    totalSpecies += taxonMap.size;
    const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
    logger.log("fetch_gbif_species_taxon", { taxon_id: taxon.id, raw: rawResults.length, valid: validSpecies.size, duration_seconds: Number(taxonDuration) });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(Number(elapsed) / 60);
  const seconds = Number(elapsed) % 60;

  logger.log("fetch_gbif_species_complete", { total_species: totalSpecies, duration_seconds: Number(elapsed) });

  console.log("\n" + "=".repeat(50));
  console.log("fetch-gbif-species complete:");
  console.log(`  Species: ${totalSpecies.toLocaleString()}`);
  console.log(`  Output:  ${GBIF_DIR}/`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const taxonArg = args[0]?.toLowerCase();

  console.log("fetch-gbif-species: GBIF API → CSV");
  console.log("=".repeat(50));

  const logger = new SyncLogger("fetch-gbif-species");
  try {
    await run({ taxa: taxonArg ? [taxonArg] : undefined, logger });
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
