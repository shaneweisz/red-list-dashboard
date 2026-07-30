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
  /**
   * When a resolution was refused, the taxon CoL wanted to fold this species
   * into. Recorded so the blanked species can be audited from this file instead
   * of by re-querying GBIF one at a time, which is how the last round of review
   * had to do it.
   */
  lumped_into?: string;
  /**
   * A key that resolved but that the facet enumeration never emitted — a
   * subspecies, or a synonym kept after a lump was refused. Kept in its own
   * column rather than in gbif_species_key, because that field means "this
   * species is linked to GBIF data" and a species with no counts must not read
   * as linked. fetch-lumped-own-counts counts these directly.
   */
  unfetched_key?: string | null;
}

/**
 * GBIF v2 match response. `usage` is the name that matched; when that name is a
 * synonym, `acceptedUsage` carries the taxon CoL considers current.
 */
interface GbifMatchResponse {
  usage?: { key?: string; canonicalName?: string; rank?: string; status?: string; authorship?: string };
  acceptedUsage?: { key?: string; canonicalName?: string; rank?: string; authorship?: string };
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
 * The epithet that identifies the organism: the last word of the name.
 *
 * Not the second word. Catalogue of Life demotes plenty of species to subspecies
 * of a relative — Fringilla polatzeki becomes Fringilla teydea polatzeki — and
 * taking word two compares "polatzeki" against "teydea", concludes they are
 * different organisms, and discards a species' records. The terminal epithet is
 * the one that survives a rank change, because it is the one that names the
 * organism rather than its parent.
 */
function terminalEpithet(name: string): string {
  const parts = name.trim().toLowerCase().split(/\s+/).filter((w) => w !== "x" && w !== "×");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

/**
 * The author and year a name was published, normalised for comparison.
 *
 * Brackets are dropped deliberately. Botanical and zoological convention wraps
 * the original author in parentheses once a species is moved to another genus, so
 * "(Shaw, 1802)" and "Shaw, 1802" are the same attribution seen before and after
 * a transfer — which is exactly the case that must compare equal.
 */
function normaliseAuthorship(authorship: string | undefined): string {
  if (!authorship) return "";
  return authorship
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[.,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a resolution should be followed to the taxon Catalogue of Life points at.
 *
 * Two very different things arrive looking the same. A NOMENCLATURAL change is
 * the same organism under a different name — a genus move, a gender agreement, an
 * orthographic correction, a demotion to subspecies. The records are this
 * species'. A TAXONOMIC change is CoL deciding two species the Red List assesses
 * separately are one, and following that puts a common species' records under a
 * threatened one.
 *
 * Authorship decides it, and does so by definition rather than by resemblance: a
 * name that keeps its original author and year is the same name reworded, while a
 * lump under a different author is somebody else's species. Compare:
 *
 *   Pica nutalli      (Audubon, 1837)   -> Pica nutallii  (Audubon, 1837)   follow
 *   Fringilla polatzeki Hartert, 1905   -> F. teydea polatzeki Hartert, 1905 follow
 *   Acacia koaia      Hillebr.          -> Acacia koa     A.Gray            refuse
 *   Pieris segonzaci  Le Cerf, 1923     -> Pieris napi    (Linnaeus, 1758)  refuse
 *   Malus sieversii   (Ledeb.) M.Roem.  -> Malus domestica (Suckow) Borkh.  refuse
 *
 * This replaced an edit distance on the epithet, which needed two tuned constants
 * and still got Acacia koaia wrong — koaia and koa are three characters apart, so
 * a Hawaiian endemic listed VU was handed the common tree's records. Authorship
 * needs no threshold and no second guess.
 *
 * The epithet comparison survives only as a fallback for records with no
 * authorship on one side, where there is nothing else to go on.
 */
export function shouldFollowSynonym(
  fromName: string,
  toName: string,
  fromAuthorship?: string,
  toAuthorship?: string,
): boolean {
  const a = normaliseAuthorship(fromAuthorship);
  const b = normaliseAuthorship(toAuthorship);
  if (a && b) return a === b;

  // No authorship to compare — fall back to the name itself. Same terminal
  // epithet means the same organism renamed or re-ranked; anything further apart
  // is treated as a different species, which is the safe direction to err.
  const from = terminalEpithet(fromName);
  const to = terminalEpithet(toName);
  if (!from || !to) return false;
  return from === to;
}

// =============================================================================
// GBIF MATCH API
// =============================================================================

export async function matchGbifSpecies(
  name: string,
  context: MatchContext = {},
  /**
   * The Red List species this name belongs to. When the name searched is one of
   * the species' listed synonyms, GBIF can resolve it to an accepted usage of an
   * entirely different species and report synonym=false — nothing looks wrong,
   * and the species inherits a stranger's records. Comparing what came back with
   * the species' own name closes that route.
   */
  speciesName: string = name,
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
  const landedOn = accepted?.canonicalName ?? data.usage.canonicalName;
  if (landedOn && !shouldFollowSynonym(speciesName, landedOn, data.usage.authorship, accepted?.authorship)) {
    // Refusing the lump does not have to mean refusing everything. The name we
    // searched has a usage of its own, and GBIF holds the records identified
    // under that name against it — a small number, but the species' own.
    //
    // Malus sieversii is the case that makes this worth doing: the wild apple
    // displayed 146,340 records, of which 8,135 are its own and the rest belong
    // to the cultivated apple CoL folds it into. Blanking it outright trades one
    // wrong number for no number, when the right number is available.
    //
    // Counts for these keys come from fetch-lumped-own-counts, not from the facet
    // enumeration, which only ever emits accepted usages.
    // Keep a key only when the usage GBIF returned really is this species' own
    // name. Searching one of its Red List synonyms can resolve straight to the
    // accepted usage of a different species, in which case usage.key IS that
    // species' key — Catapodium borgesii (VU, Azores endemic) came back with
    // Catapodium marinum's key and 19,901 records of a widespread European grass.
    // Handing that over as "its own records" is the exact defect this policy
    // exists to prevent, so an unrecognisable usage yields no key at all.
    const ownUsage = data.usage.canonicalName
      ? shouldFollowSynonym(speciesName, data.usage.canonicalName, data.usage.authorship, data.usage.authorship)
      : false;
    return {
      key: ownUsage ? data.usage.key ?? null : null,
      matchType: "LUMPED",
      lumpedInto: landedOn,
    };
  }

  return { key: accepted?.key || data.usage.key || null, matchType };
}

const MAPPING_CSV_PATH = path.join(DATA_DIR, "mapping.csv");
const MAPPING_CSV_COLUMNS = ["sis_taxon_id", "gbif_species_key", "match_type", "name_source", "lumped_into", "unfetched_key"];

export function writeMappingCsv(entries: MappingEntry[]): void {
  const rows = entries.map((e) => ({
    sis_taxon_id: e.sis_taxon_id,
    gbif_species_key: e.gbif_species_key,
    match_type: e.match_type,
    name_source: e.name_source,
    lumped_into: e.lumped_into ?? null,
    unfetched_key: e.unfetched_key ?? null,
  }));
  writeCsv(rows, MAPPING_CSV_COLUMNS, MAPPING_CSV_PATH);
}

export interface MappingLink {
  gbif_species_key: string | null;
  unfetched_key: string | null;
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
    unfetched_key: r.unfetched_key || null,
  }));
  const map = new Map<number, MappingLink[]>();
  for (const e of entries) {
    let list = map.get(e.sis_taxon_id);
    if (!list) {
      list = [];
      map.set(e.sis_taxon_id, list);
    }
    list.push({
      gbif_species_key: e.gbif_species_key,
      // Required, not optional: fetch-lumped-own-counts keys the entire phase off
      // this field, and dropping it here made that phase silently find 0 species
      // to count while the column sat populated on 115,837 rows of the file.
      unfetched_key: e.unfetched_key ?? null,
      match_type: e.match_type,
      name_source: e.name_source,
    });
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

export type MatchFn = (name: string, context?: MatchContext, speciesName?: string) => Promise<MatchOutcome>;

/** GBIF kingdom names by the kingdomKey each Table 1a group carries. */
const KINGDOM_NAME: Record<string, string> = {
  N: "Animalia",
  C: "Chromista",
  F: "Fungi",
  P: "Plantae",
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
  /** The taxon CoL folded this name into, when the resolution was refused. */
  lumpedInto?: string;
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
        const { key, matchType, lumpedInto } = await matchFn(task.name, task.species.context, task.species.scientific_name);
        progress++;
        if (progress % 1000 === 0) {
          process.stdout.write(`\r  Matched ${progress}/${tasks.length}`);
        }
        return { ...task, key, matchType, lumpedInto };
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
    // A lumped species' own key never appears in the facet enumeration, because
    // facets emit accepted usages and this one is a synonym. Its counts are
    // fetched separately, so absence here is expected rather than disqualifying.
    if (matchType !== "LUMPED" && !gbifKeys.has(key)) return "no_gbif_data";

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
      gbif_species_key: matchType === "LUMPED" ? null : key,
      match_type: matchType,
      name_source: r.source,
      // Only carried when they mean something, so an ordinary linked row keeps
      // the shape it has always had.
      ...(r.lumpedInto ? { lumped_into: r.lumpedInto } : {}),
      ...(matchType === "LUMPED" ? { unfetched_key: key } : {}),
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
    const lumpedInto = candidates.find((r) => r.matchType === "LUMPED")?.lumpedInto;
    // A key that resolved but is absent from the facet enumeration is not a dead
    // end — facets only emit species-rank accepted usages, so a subspecies key
    // lands here despite being perfectly real. Fringilla polatzeki (EN) is one:
    // CoL ranks it a subspecies of Fringilla teydea. Keeping the key lets
    // fetch-lumped-own-counts count it directly instead of the species showing
    // nothing.
    const unfetchedKey = candidates.find((r) => r.key !== null && !gbifKeys.has(r.key))?.key ?? null;
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
      ...(lumpedInto ? { lumped_into: lumpedInto } : {}),
      ...(bestType === "NO_GBIF_DATA" && unfetchedKey ? { unfetched_key: unfetchedKey } : {}),
    });
  }

  const lumped = entries.filter((e) => e.match_type === "LUMPED").length;
  const linked = exact + fuzzy;
  console.log(`  Linked: ${linked} (${exact} exact, ${fuzzy} fuzzy)`);
  if (lumped > 0) {
    console.log(`  Lumped: ${lumped} species CoL folds into another species — no counts attributed`);
  }
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
