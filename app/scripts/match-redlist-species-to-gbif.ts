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
import { GBIF_CHECKLIST_KEY } from "../src/lib/gbif";

// =============================================================================
// CONFIGURATION
// =============================================================================

const MATCH_CONCURRENCY = 50;
const MAX_RETRIES = 5;

// =============================================================================
// TYPES
// =============================================================================

export type NameSource = "canonical" | "synonym";

export interface MappingEntry {
  sis_taxon_id: number;
  gbif_species_key: string | null;
  match_type: string;
  /** Whether the GBIF key was found via the species's canonical name or via a synonym. */
  name_source: NameSource | "";
}

/**
 * GBIF v2 match response. `usage` is the name that matched; when that name is a
 * synonym, `acceptedUsage` carries the taxon CoL considers current.
 */
interface GbifMatchResponse {
  usage?: { key?: string; canonicalName?: string; rank?: string; status?: string };
  acceptedUsage?: { key?: string; canonicalName?: string; rank?: string };
  diagnostics?: { matchType?: string; confidence?: number };
  synonym?: boolean;
}

/** Classification GBIF uses to disambiguate a name. Comes from the Red List row. */
export interface MatchContext {
  kingdom?: string | null;
  class_name?: string | null;
  order_name?: string | null;
  family?: string | null;
}

export interface MatchOutcome {
  key: string | null;
  matchType: string;
  /** Set when CoL folds this name into a different species — see shouldFollowSynonym. */
  lumpedInto?: string;
}

/**
 * Distance between two specific epithets, used to tell a nomenclatural change
 * from a taxonomic one.
 */
function epithetDistance(a: string, b: string): number {
  const ea = (a.split(" ")[1] ?? "").toLowerCase();
  const eb = (b.split(" ")[1] ?? "").toLowerCase();
  if (ea === eb) return 0;
  const d: number[][] = Array.from({ length: ea.length + 1 }, (_, i) =>
    Array.from({ length: eb.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= ea.length; i++) {
    for (let j = 1; j <= eb.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ea[i - 1] === eb[j - 1] ? 0 : 1));
    }
  }
  return d[ea.length][eb.length];
}

/**
 * Whether a synonym resolution should be followed to the accepted taxon.
 *
 * Two very different things arrive as "synonym". A NOMENCLATURAL change is the
 * same organism under a different name — a genus move (Aquarana catesbeianus →
 * Lithobates catesbeianus), a gender agreement, an orthographic correction (Pica
 * nutalli → Pica nutallii). Following those is right: the records are this
 * species'.
 *
 * A TAXONOMIC change is CoL deciding two things the Red List assesses separately
 * are one species — Pieris segonzaci into Pieris napi, Sus bucculentus into Sus
 * scrofa. Following those puts a common species' records under a threatened one:
 * it is how a VU Moroccan endemic came to display 2.9M records of a widespread
 * European butterfly. On a conservation dashboard a blank beats a wrong number,
 * so those are not followed.
 *
 * The epithet separates them. Orthographic variants differ by a letter or two;
 * distinct species do not.
 */
const MAX_ORTHOGRAPHIC_DISTANCE = 2;

export function shouldFollowSynonym(fromName: string, toName: string): boolean {
  return epithetDistance(fromName, toName) <= MAX_ORTHOGRAPHIC_DISTANCE;
}

// =============================================================================
// GBIF MATCH API
// =============================================================================

export async function matchGbifSpecies(
  name: string,
  context: MatchContext = {},
): Promise<MatchOutcome> {
  // Classification context is not optional in practice. Asked for "Agelaius
  // phoeniceus" with nothing else, GBIF answers HIGHERRANK/Animalia — a species
  // with 21 million occurrence records, unmatched. Adding kingdom and class turns
  // the same request into an EXACT match. The Red List row carries all of it.
  const params = new URLSearchParams({ checklistKey: GBIF_CHECKLIST_KEY, scientificName: name });
  if (context.kingdom) params.set("kingdom", context.kingdom);
  if (context.class_name) params.set("class", context.class_name);
  if (context.order_name) params.set("order", context.order_name);
  if (context.family) params.set("family", context.family);

  let response: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(`https://api.gbif.org/v2/species/match?${params}`);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await delay(Math.pow(2, attempt + 1) * 1000);
        continue;
      }
      throw err;
    }
    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      await delay(Math.pow(2, attempt + 1) * 1000);
      continue;
    }
    break;
  }
  if (!response || !response.ok) {
    throw new Error(`GBIF Match API error: ${response?.status} ${response?.statusText}`);
  }

  const data: GbifMatchResponse = await response.json();
  const matchType = data.diagnostics?.matchType;

  if (!matchType || matchType === "NONE" || matchType === "HIGHERRANK") {
    return { key: null, matchType: matchType || "NONE" };
  }
  if (data.usage?.rank !== "SPECIES") {
    return { key: null, matchType: "WRONG_RANK" };
  }

  // An ambiguous synonym points at several accepted taxa and CoL does not say
  // which; a misapplied name points at the taxon the name was wrongly used for.
  // Following either attributes records to a taxon CoL explicitly declines to
  // link the name to.
  const status = (data.usage.status ?? "").toUpperCase();
  if (status.includes("AMBIGUOUS") || status.includes("MISAPPLIED")) {
    return { key: null, matchType: `UNUSABLE_${status}` };
  }

  const accepted = data.acceptedUsage;
  if (data.synonym && accepted?.canonicalName && data.usage.canonicalName) {
    if (!shouldFollowSynonym(data.usage.canonicalName, accepted.canonicalName)) {
      return { key: null, matchType: "LUMPED", lumpedInto: accepted.canonicalName };
    }
  }

  return { key: accepted?.key || data.usage.key || null, matchType };
}

const MAPPING_CSV_PATH = path.join(DATA_DIR, "mapping.csv");
const MAPPING_CSV_COLUMNS = ["sis_taxon_id", "gbif_species_key", "match_type", "name_source"];

export function writeMappingCsv(entries: MappingEntry[]): void {
  const rows = entries.map((e) => ({
    sis_taxon_id: e.sis_taxon_id,
    gbif_species_key: e.gbif_species_key,
    match_type: e.match_type,
    name_source: e.name_source,
  }));
  writeCsv(rows, MAPPING_CSV_COLUMNS, MAPPING_CSV_PATH);
}

export interface MappingLink {
  gbif_species_key: string | null;
  match_type: string;
  name_source: NameSource | "";
}

/**
 * Read mapping.csv into a Map<sis_taxon_id, MappingLink[]>. Each sis_taxon_id
 * may have multiple linked GBIF keys (from canonical + synonym matches), or a
 * single row with a null key for diagnostics (NO_GBIF_DATA, NONE, etc.).
 */
export function readMappingCsv(): Map<number, MappingLink[]> {
  if (!fs.existsSync(MAPPING_CSV_PATH)) return new Map();
  const entries = readCsv<MappingEntry>(MAPPING_CSV_PATH, (r) => ({
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    gbif_species_key: r.gbif_species_key || null,
    match_type: r.match_type || "",
    name_source: (r.name_source as NameSource) || "",
  }));
  const map = new Map<number, MappingLink[]>();
  for (const e of entries) {
    let list = map.get(e.sis_taxon_id);
    if (!list) {
      list = [];
      map.set(e.sis_taxon_id, list);
    }
    list.push({ gbif_species_key: e.gbif_species_key, match_type: e.match_type, name_source: e.name_source });
  }
  return map;
}

// =============================================================================
// MATCHING
// =============================================================================

export interface SpeciesInput {
  sis_taxon_id: number;
  scientific_name: string;
  /** Bare binomials only — status is dropped here since we treat all kept synonyms equally for matching. */
  synonyms: string[];
  /** Passed to GBIF so it can disambiguate the name. */
  context?: MatchContext;
}

function loadAllRedlistSpecies(): SpeciesInput[] {
  const allSpecies: SpeciesInput[] = [];
  for (const taxon of TAXA) {
    const csvPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    for (const s of readRedlistCsv(taxon.id)) {
      allSpecies.push({
        sis_taxon_id: s.sis_taxon_id,
        scientific_name: s.scientific_name,
        synonyms: s.synonyms.map((syn) => syn.name),
        context: {
          kingdom: KINGDOM_NAME[taxon.kingdomKey],
          class_name: s.class_name,
          order_name: s.order_name,
          family: s.family,
        },
      });
    }
  }
  return allSpecies;
}

export type MatchFn = (name: string, context?: MatchContext) => Promise<MatchOutcome>;

/** GBIF kingdom names by the kingdomKey each Table 1a group carries. */
const KINGDOM_NAME: Record<number, string> = {
  1: "Animalia",
  4: "Chromista",
  5: "Fungi",
  6: "Plantae",
};

function loadAllGbifKeys(): Set<string> {
  const keys = new Set<string>();
  for (const taxon of TAXA) {
    const csvPath = path.join(GBIF_DIR, `${taxon.id}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    const map = readGbifCsv(taxon.id);
    for (const key of map.keys()) keys.add(key);
  }
  return keys;
}

/**
 * Match Red List species to GBIF backbone keys, including synonyms.
 *
 * Each species is matched on its canonical name **and** every (ambiguity-
 * filtered) synonym from the IUCN taxon_synonyms table. This handles cases
 * where a species has been recently reclassified (e.g. Lithobates → Aquarana
 * catesbeianus) and GBIF observations still arrive under the legacy name.
 *
 * Output is one row per (sis_taxon_id, gbif_species_key) pair. A single
 * sis_taxon_id may produce multiple linked rows when canonical and synonyms
 * resolve to distinct GBIF keys (e.g. for lumps where GBIF still has separate
 * backbone entries for the merged taxa).
 *
 * Duplicate handling runs in two passes:
 *   1. Process all canonical-name matches first. Within each species, allow
 *      multiple keys; across species, reject same-key claims as DUPLICATE.
 *   2. Process all synonym matches. Same rules, but a synonym claim loses to
 *      a prior canonical claim (so canonical wins ties).
 */
export async function matchAllSpecies(
  logger: SyncLogger,
  matchFn: MatchFn = matchGbifSpecies,
  concurrency: number = MATCH_CONCURRENCY,
): Promise<MappingEntry[]> {
  const redlistSpecies = loadAllRedlistSpecies();
  const gbifKeys = loadAllGbifKeys();

  console.log(`  ${redlistSpecies.length} Red List species to match`);
  console.log(`  ${gbifKeys.size} GBIF species keys available`);

  return matchSpeciesList(redlistSpecies, gbifKeys, logger, matchFn, concurrency);
}

interface MatchTask {
  species: SpeciesInput;
  name: string;
  source: NameSource;
}

interface MatchResult extends MatchTask {
  key: string | null;
  matchType: string;
}

/**
 * Pure version of `matchAllSpecies` that takes its inputs explicitly.
 * Exported for unit testing — production callers should use `matchAllSpecies`.
 */
export async function matchSpeciesList(
  redlistSpecies: SpeciesInput[],
  gbifKeys: Set<string>,
  logger: SyncLogger,
  matchFn: MatchFn,
  concurrency: number = MATCH_CONCURRENCY,
): Promise<MappingEntry[]> {
  // Build the flat work list: one task per (species, name) pair.
  const tasks: MatchTask[] = [];
  for (const species of redlistSpecies) {
    tasks.push({ species, name: species.scientific_name, source: "canonical" });
    for (const syn of species.synonyms) {
      tasks.push({ species, name: syn, source: "synonym" });
    }
  }

  let progress = 0;
  const results = await mapConcurrent(
    tasks,
    concurrency,
    async (task): Promise<MatchResult> => {
      try {
        const { key, matchType } = await matchFn(task.name, task.species.context);
        progress++;
        if (progress % 1000 === 0) {
          process.stdout.write(`\r  Matched ${progress}/${tasks.length}`);
        }
        return { ...task, key, matchType };
      } catch (err) {
        logger.log("error", {
          sis_taxon_id: task.species.sis_taxon_id,
          name: task.name,
          source: task.source,
          error: String(err),
        });
        return { ...task, key: null, matchType: "ERROR" };
      }
    },
  );
  if (tasks.length > 0) {
    process.stdout.write(`\r  Matched ${tasks.length}/${tasks.length}\n`);
  }

  // Group results by sis_taxon_id, separated by source so we can run the
  // canonical pass before the synonym pass.
  interface SpeciesResults {
    species: SpeciesInput;
    canonical: MatchResult[];
    synonym: MatchResult[];
  }
  const bySpecies = new Map<number, SpeciesResults>();
  for (const r of results) {
    let bucket = bySpecies.get(r.species.sis_taxon_id);
    if (!bucket) {
      bucket = { species: r.species, canonical: [], synonym: [] };
      bySpecies.set(r.species.sis_taxon_id, bucket);
    }
    if (r.source === "canonical") bucket.canonical.push(r);
    else bucket.synonym.push(r);
  }

  // Iterate species in their original order to keep cross-species duplicate
  // resolution deterministic with the input.
  const orderedSisIds = redlistSpecies.map((s) => s.sis_taxon_id);

  // Track which GBIF key has been claimed by which sis_taxon_id (cross-species DUPLICATE check).
  const claimedBy = new Map<string, number>();
  // Per-species set of accepted keys (so synonyms don't double-add the canonical key).
  const acceptedKeysBySpecies = new Map<number, Set<string>>();

  const entries: MappingEntry[] = [];
  let exact = 0, fuzzy = 0, noMatch = 0, noGbifData = 0, alreadyLinked = 0;

  function tryClaim(
    species: SpeciesInput,
    r: MatchResult,
  ): "linked" | "duplicate" | "no_gbif_data" | "no_match" {
    const { key, matchType } = r;
    if (key === null) return "no_match";
    if (!gbifKeys.has(key)) return "no_gbif_data";

    let accepted = acceptedKeysBySpecies.get(species.sis_taxon_id);
    if (!accepted) {
      accepted = new Set();
      acceptedKeysBySpecies.set(species.sis_taxon_id, accepted);
    }

    // If this species already has the key (e.g. canonical and synonym resolve
    // to the same key), silently dedupe — don't emit a duplicate row.
    if (accepted.has(key)) return "linked";

    // Cross-species claim: rejected as DUPLICATE.
    const owner = claimedBy.get(key);
    if (owner !== undefined && owner !== species.sis_taxon_id) {
      return "duplicate";
    }

    accepted.add(key);
    claimedBy.set(key, species.sis_taxon_id);
    entries.push({
      sis_taxon_id: species.sis_taxon_id,
      gbif_species_key: key,
      match_type: matchType,
      name_source: r.source,
    });
    if (matchType === "EXACT") exact++;
    else fuzzy++;
    return "linked";
  }

  // Pass 1: canonical matches for every species.
  for (const sisId of orderedSisIds) {
    const bucket = bySpecies.get(sisId);
    if (!bucket) continue;
    for (const r of bucket.canonical) {
      tryClaim(bucket.species, r);
    }
  }

  // Pass 2: synonym matches for every species (so canonical wins ties).
  for (const sisId of orderedSisIds) {
    const bucket = bySpecies.get(sisId);
    if (!bucket) continue;
    for (const r of bucket.synonym) {
      tryClaim(bucket.species, r);
    }
  }

  // Pass 3: emit a diagnostic row for every species that ended up with no
  // linked GBIF key. Determine the most informative match_type:
  //   ERROR > DUPLICATE > NO_GBIF_DATA > NONE/other
  // (so an unlinked-due-to-duplicate species is reported as DUPLICATE rather
  // than NONE, matching the old behaviour).
  for (const sisId of orderedSisIds) {
    const bucket = bySpecies.get(sisId);
    if (!bucket) continue;
    if ((acceptedKeysBySpecies.get(sisId)?.size ?? 0) > 0) continue;

    let bestType = "NONE";
    let sawError = false, sawDuplicate = false, sawNoGbifData = false;
    const candidates = [...bucket.canonical, ...bucket.synonym];
    for (const r of candidates) {
      if (r.matchType === "ERROR") sawError = true;
      else if (r.key !== null && !gbifKeys.has(r.key)) sawNoGbifData = true;
      else if (r.key !== null && claimedBy.get(r.key) !== undefined) sawDuplicate = true;
      else if (bestType === "NONE" && r.matchType) bestType = r.matchType;
    }
    if (sawError) bestType = "ERROR";
    else if (sawDuplicate) { bestType = "DUPLICATE"; alreadyLinked++; }
    else if (sawNoGbifData) { bestType = "NO_GBIF_DATA"; noGbifData++; }
    else noMatch++;

    entries.push({
      sis_taxon_id: sisId,
      gbif_species_key: null,
      match_type: bestType,
      name_source: "",
    });
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
