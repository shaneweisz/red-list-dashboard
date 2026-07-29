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
import { GBIF_CHECKLIST_KEY, INCLUDED_BASIS_OF_RECORD } from "../src/lib/gbif";

// =============================================================================
// GBIF TAXA (legacy lookup — used by fetch-gbif-new-counts)
// =============================================================================

export type { Taxon, GbifQuery };

// =============================================================================
// CONFIGURATION
// =============================================================================

const FACET_LIMIT = 100000;
const REQUEST_DELAY = 200; // ms between GBIF requests
const SPECIES_VALIDATION_BATCH_SIZE = 1000;
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
      checklistKey: GBIF_CHECKLIST_KEY,
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
 * Resolve the species keys GBIF's facets returned to names and lineage.
 *
 * Asked of GBIF rather than of the Catalogue of Life archive this pipeline also
 * downloads, because those are not the same thing. GBIF's occurrence index
 * contains usages the published CoL export does not — Mantis religiosa is VFYZZ
 * there, and VFYZZ 404s in the exact CoL release GBIF reports indexing, which
 * holds both accepted usages of the name where the export holds one. Resolving
 * facet keys locally therefore discards whatever GBIF has and CoL has not:
 * measured at 99.5% of species for Mantodea, 9% for Coleoptera, all silently.
 *
 * One request per key is the price of that correctness, and it is the price the
 * pipeline paid before this migration. Results are cached across runs, so the
 * cost falls on newly-seen keys only.
 */
export async function validateSpeciesKeys(
  speciesKeys: string[],
  opts: { onProgress?: (done: number, total: number, cached: number) => void } = {},
): Promise<Map<string, ValidatedSpecies>> {
  const valid = new Map<string, ValidatedSpecies>();
  if (speciesKeys.length === 0) return valid;

  const cache = loadKeyCache();
  let fromCache = 0;
  let done = 0;

  for (let i = 0; i < speciesKeys.length; i += SPECIES_VALIDATION_BATCH_SIZE) {
    const batch = speciesKeys.slice(i, i + SPECIES_VALIDATION_BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (key): Promise<ValidatedSpecies | null> => {
        const hit = cache[key];
        if (hit !== undefined) {
          fromCache++;
          return hit === null ? null : { key, ...hit };
        }

        const resolved = await resolveSpeciesKey(key);
        cache[key] = resolved;
        return resolved === null ? null : { key, ...resolved };
      })
    );

    for (const info of results) if (info) valid.set(info.key, info);
    done += batch.length;
    opts.onProgress?.(done, speciesKeys.length, fromCache);
  }

  saveKeyCache(cache);
  return valid;
}

type CachedSpecies = Omit<ValidatedSpecies, "key"> | null;

/** One GBIF lookup for a single facet key. Null when it is not an accepted species. */
async function resolveSpeciesKey(key: string): Promise<CachedSpecies> {
  const params = new URLSearchParams({ checklistKey: GBIF_CHECKLIST_KEY, usageKey: key });
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://api.gbif.org/v2/species/match?${params}`, {
        headers: { "Accept-Language": "en" },
      });
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < MAX_RETRIES) {
          await delay(Math.pow(2, attempt + 1) * 1000);
          continue;
        }
        return null;
      }
      if (!res.ok) return null;

      const data = (await res.json()) as {
        usage?: { canonicalName?: string; rank?: string; status?: string };
        classification?: Array<{ name: string; rank: string }>;
      };
      const usage = data.usage;
      if (!usage?.canonicalName || usage.rank !== "SPECIES") return null;
      if ((usage.status ?? "").toUpperCase() !== "ACCEPTED") return null;

      const at = (rank: string) =>
        data.classification?.find((c) => c.rank === rank)?.name ?? "";
      return {
        canonicalName: usage.canonicalName,
        vernacularName: "",
        className: at("CLASS"),
        orderName: at("ORDER"),
        familyName: at("FAMILY"),
      };
    } catch {
      if (attempt < MAX_RETRIES) {
        await delay(Math.pow(2, attempt + 1) * 1000);
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Key → resolution cache, kept beside the data. Facet keys are stable between
 * syncs, so this turns the second and later runs into mostly-local work. Negative
 * results are cached too: a key that is not an accepted species stays that way.
 */
const KEY_CACHE_PATH = path.join(DATA_DIR, "gbif-key-cache.json");

function loadKeyCache(): Record<string, CachedSpecies> {
  try {
    if (fs.existsSync(KEY_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(KEY_CACHE_PATH, "utf-8")) as Record<string, CachedSpecies>;
    }
  } catch {
    console.warn("  key cache unreadable — starting a fresh one");
  }
  return {};
}

function saveKeyCache(cache: Record<string, CachedSpecies>): void {
  fs.writeFileSync(KEY_CACHE_PATH, JSON.stringify(cache));
}

/**
 * Refuse to write a taxon whose keys mostly failed to resolve.
 *
 * Not every facet key becomes a species — synonyms, higher taxa and unplaced
 * names are all expected to drop out, so some loss is normal. What is not normal
 * is most of a group vanishing, and that is exactly what a key-space mismatch
 * looks like: in the first attempt at this migration Mantodea went from 1,110
 * species to 97 and nothing was printed, because the drop had no floor under it.
 *
 * The threshold is deliberately loose. It is here to catch a group collapsing,
 * not to police normal attrition.
 */
const MIN_RESOLUTION_RATE = 0.5;
const RESOLUTION_RATE_FLOOR_SAMPLE = 50;

export function assertResolutionRate(taxonId: string, requested: number, resolved: number): void {
  // Tiny groups are noisy — a group of four species is not evidence of anything.
  if (requested < RESOLUTION_RATE_FLOOR_SAMPLE) return;
  const rate = resolved / requested;
  if (rate >= MIN_RESOLUTION_RATE) return;
  throw new Error(
    `fetch-gbif-species: only ${resolved} of ${requested} keys resolved for "${taxonId}" ` +
    `(${(rate * 100).toFixed(1)}%, floor ${MIN_RESOLUTION_RATE * 100}%). ` +
    `That is the signature of a key-space mismatch rather than normal attrition — ` +
    `writing this file would silently shrink the group.`
  );
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

    console.log("  Resolving species keys...");
    const speciesKeys = rawResults.map((r) => r.speciesKey);
    const validSpecies = await validateSpeciesKeys(speciesKeys, {
      onProgress: (doneCount, total, cached) =>
        process.stdout.write(`\r  Resolved ${doneCount}/${total} (${cached} from cache)`),
    });
    if (speciesKeys.length > 0) console.log("");
    console.log(`  Valid species: ${validSpecies.size}`);

    assertResolutionRate(taxon.id, speciesKeys.length, validSpecies.size);

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
