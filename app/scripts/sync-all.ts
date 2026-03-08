/**
 * sync-all: Full pipeline orchestrator
 *
 * Processes each taxon group end-to-end:
 *   1. Fetch Red List species from IUCN DB
 *   2. Fetch GBIF occurrence counts
 *   3. Link Red List → GBIF via Match API
 *   4. Compute since-assessment counts
 *
 * Then writes all 3 CSVs and optionally pushes to Supabase.
 *
 * Prerequisites:
 *   1. SSH tunnel to IUCN DB (port 5433)
 *   2. Environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/sync-all.ts                    # Full sync, all taxa
 *   npx tsx scripts/sync-all.ts mammalia aves       # Specific taxa only
 *   npx tsx scripts/sync-all.ts --push              # Sync + push to Supabase
 *   npx tsx scripts/sync-all.ts --skip-gbif         # Red List only (no GBIF/link)
 */

import * as path from "path";
import { Client } from "pg";
import {
  loadEnvFiles,
  SyncLogger,
  IUCN_TAXA,
  IucnTaxonConfig,
  DATA_DIR,
} from "./sync-utils";
import {
  fetchFromIucnDb,
  writeRedlistCsv,
  IucnSpeciesRow,
} from "./sync-redlist";
import {
  GBIF_TAXA,
  GbifTaxonConfig,
  GbifSpeciesCsvRow,
  fetchAllSpeciesCounts,
  validateSpeciesKeys,
  computeSinceAssessment,
  writeGbifCsv,
  toTitleCase,
} from "./sync-gbif";
import {
  matchGbifSpecies,
  writeLinksCsv,
} from "./link-gbif";

// =============================================================================
// TAXA MAPPING: unified groups that align IUCN and GBIF configs
// =============================================================================

interface TaxonGroup {
  id: string;
  name: string;
  iucnTaxa: IucnTaxonConfig[];
  gbifTaxon: GbifTaxonConfig | null; // null if --skip-gbif
}

/** Map of IUCN taxon_group IDs to their parent GBIF taxon key */
const IUCN_TO_GBIF: Record<string, string> = {
  mammalia: "mammalia",
  aves: "aves",
  reptilia: "reptilia",
  amphibia: "amphibia",
  fishes: "fishes",
  insecta: "invertebrates",
  mollusca: "invertebrates",
  crustacea: "invertebrates",
  arachnida: "invertebrates",
  corals: "invertebrates",
  velvet_worms: "invertebrates",
  horseshoe_crabs: "invertebrates",
  other_invertebrates: "invertebrates",
  plantae: "plantae",
  fungi: "fungi",
};

function buildTaxonGroups(taxonFilter?: string[]): TaxonGroup[] {
  // Work at the GBIF taxon level (8 groups)
  const gbifKeys = taxonFilter || Object.keys(GBIF_TAXA);
  const groups: TaxonGroup[] = [];

  for (const gbifKey of gbifKeys) {
    const gbifTaxon = GBIF_TAXA[gbifKey];
    if (!gbifTaxon) {
      console.error(`Unknown taxon: ${gbifKey}`);
      console.error("Available:", Object.keys(GBIF_TAXA).join(", "));
      process.exit(1);
    }

    // Find all IUCN taxa that map to this GBIF group
    const iucnTaxa = IUCN_TAXA.filter((t) => IUCN_TO_GBIF[t.id] === gbifKey);

    groups.push({
      id: gbifKey,
      name: gbifTaxon.name,
      iucnTaxa,
      gbifTaxon,
    });
  }

  return groups;
}

// =============================================================================
// LINK LOGIC (in-memory, no Supabase)
// =============================================================================

const MATCH_CONCURRENCY = 50;

interface LinkResult {
  sis_taxon_id: number;
  gbif_species_key: number | null;
  match_type: string;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function linkTaxon(
  redlistSpecies: IucnSpeciesRow[],
  gbifSpeciesMap: Map<number, GbifSpeciesCsvRow>,
  claimedGbifKeys: Set<number>,
  logger: SyncLogger
): Promise<{ results: LinkResult[]; exact: number; fuzzy: number; noMatch: number; noGbifData: number; alreadyLinked: number }> {
  const gbifKeysAvailable = new Set(Array.from(gbifSpeciesMap.keys()));
  const results: LinkResult[] = [];
  let exact = 0, fuzzy = 0, noMatch = 0, noGbifData = 0, alreadyLinked = 0;

  let matched = 0;
  const matchResults = await mapConcurrent(
    redlistSpecies,
    MATCH_CONCURRENCY,
    async (species) => {
      try {
        const { key, matchType } = await matchGbifSpecies(species.scientific_name);
        matched++;
        if (matched % 500 === 0) {
          process.stdout.write(`\r    Matched ${matched}/${redlistSpecies.length}`);
        }
        return { species, key, matchType };
      } catch (err) {
        logger.log("error", { sis_taxon_id: species.sis_taxon_id, name: species.scientific_name, error: String(err) });
        return { species, key: null, matchType: "ERROR" };
      }
    }
  );
  if (redlistSpecies.length > 0) {
    process.stdout.write(`\r    Matched ${redlistSpecies.length}/${redlistSpecies.length}\n`);
  }

  for (const { species, key, matchType } of matchResults) {
    if (key === null) {
      noMatch++;
      results.push({ sis_taxon_id: species.sis_taxon_id, gbif_species_key: null, match_type: matchType });
    } else if (!gbifKeysAvailable.has(key)) {
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

  return { results, exact, fuzzy, noMatch, noGbifData, alreadyLinked };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const positionalArgs = args.filter((a) => !a.startsWith("--"));

  const shouldPush = flags.includes("--push");
  const skipGbif = flags.includes("--skip-gbif");

  const groups = buildTaxonGroups(positionalArgs.length > 0 ? positionalArgs : undefined);

  console.log("sync-all: Full pipeline");
  console.log("=".repeat(60));
  console.log(`Taxa: ${groups.map((g) => g.id).join(", ")}`);
  if (skipGbif) console.log("Mode: --skip-gbif (Red List only)");
  if (shouldPush) console.log("Will push to Supabase after sync");
  console.log();

  const startTime = Date.now();
  const logger = new SyncLogger("sync-all");

  // Accumulators across all taxa
  const allRedlistSpecies: IucnSpeciesRow[] = [];
  const allGbifSpecies = new Map<number, GbifSpeciesCsvRow>();
  const allLinkResults: LinkResult[] = [];
  const claimedGbifKeys = new Set<number>();

  // Connect to IUCN database
  const pgClient = new Client({
    host: process.env.DB_HOST || "localhost",
    port: 5433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await pgClient.connect();
    console.log("Connected to IUCN database\n");

    for (const group of groups) {
      const groupStart = Date.now();
      console.log(`${"═".repeat(60)}`);
      console.log(`${group.name} (${group.id})`);
      console.log(`${"═".repeat(60)}`);

      // ── Step 1: Red List ──────────────────────────────────────────
      console.log("\n  ▸ Red List");
      const groupRedlist: IucnSpeciesRow[] = [];
      for (const iucnTaxon of group.iucnTaxa) {
        const species = await fetchFromIucnDb(pgClient, iucnTaxon);
        console.log(`    ${iucnTaxon.name}: ${species.length} species`);
        groupRedlist.push(...species);
      }
      allRedlistSpecies.push(...groupRedlist);
      console.log(`    Total: ${groupRedlist.length} Red List species`);

      if (skipGbif) {
        // Still add unlinked entries to link results
        for (const s of groupRedlist) {
          allLinkResults.push({ sis_taxon_id: s.sis_taxon_id, gbif_species_key: null, match_type: "SKIPPED" });
        }
        const groupDuration = ((Date.now() - groupStart) / 1000).toFixed(1);
        console.log(`\n  Done (${groupDuration}s)\n`);
        continue;
      }

      // ── Step 2: GBIF ──────────────────────────────────────────────
      console.log("\n  ▸ GBIF");
      const rawResults = await fetchAllSpeciesCounts(group.gbifTaxon!);
      console.log(`    Raw species: ${rawResults.length}`);

      const speciesKeys = rawResults.map((r) => r.speciesKey);
      const validSpecies = await validateSpeciesKeys(speciesKeys);
      console.log(`    Valid species: ${validSpecies.size}`);

      for (const r of rawResults) {
        const info = validSpecies.get(r.speciesKey);
        if (!info) continue;
        allGbifSpecies.set(r.speciesKey, {
          gbif_species_key: r.speciesKey,
          scientific_name: info.canonicalName,
          common_name: info.vernacularName ? toTitleCase(info.vernacularName) : "",
          taxon_group: r.taxonGroup,
          total_count: r.count,
          count_since_assessment: null,
        });
      }

      // ── Step 3: Link ──────────────────────────────────────────────
      console.log("\n  ▸ Linking");
      const { results, exact, fuzzy, noMatch, noGbifData, alreadyLinked } =
        await linkTaxon(groupRedlist, allGbifSpecies, claimedGbifKeys, logger);
      allLinkResults.push(...results);
      const linked = exact + fuzzy;
      console.log(`    Linked: ${linked} (${exact} exact, ${fuzzy} fuzzy)`);
      console.log(`    Unlinked: ${noMatch + noGbifData + alreadyLinked} (${noMatch} no match, ${noGbifData} no GBIF data, ${alreadyLinked} duplicate)`);

      // ── Step 4: Since-assessment counts ───────────────────────────
      // Write intermediate CSVs so computeSinceAssessment can read them
      console.log("\n  ▸ Since-assessment counts");
      writeRedlistCsv(allRedlistSpecies, path.join(DATA_DIR, "redlist-species.csv"));
      writeLinksCsv(allLinkResults, path.join(DATA_DIR, "species-links.csv"));

      const saCount = await computeSinceAssessment(group.gbifTaxon!, allGbifSpecies, logger);
      console.log(`    Computed for ${saCount} species`);

      const groupDuration = ((Date.now() - groupStart) / 1000).toFixed(1);
      console.log(`\n  Done (${groupDuration}s)\n`);
    }

    // ── Write final CSVs ──────────────────────────────────────────────
    console.log("Writing CSVs...");
    const redlistPath = path.join(DATA_DIR, "redlist-species.csv");
    const gbifPath = path.join(DATA_DIR, "gbif-species.csv");
    const linksPath = path.join(DATA_DIR, "species-links.csv");

    writeRedlistCsv(allRedlistSpecies, redlistPath);
    console.log(`  ${redlistPath}: ${allRedlistSpecies.length.toLocaleString()} rows`);

    writeGbifCsv(allGbifSpecies, gbifPath);
    console.log(`  ${gbifPath}: ${allGbifSpecies.size.toLocaleString()} rows`);

    writeLinksCsv(allLinkResults, linksPath);
    const linkedCount = allLinkResults.filter((r) => r.gbif_species_key !== null).length;
    console.log(`  ${linksPath}: ${allLinkResults.length.toLocaleString()} rows (${linkedCount.toLocaleString()} linked)`);

    // ── Push to DB ────────────────────────────────────────────────────
    if (shouldPush) {
      console.log("\nPushing to Supabase...");
      // Dynamic import to avoid requiring Supabase env vars when not pushing
      const { main: pushMain } = await import("./push-to-db");
      // push-to-db reads from the CSVs we just wrote
      process.argv = [process.argv[0], "push-to-db.ts"];
      // We can't easily call pushMain since it reads process.argv.
      // Instead, use execSync for simplicity.
      const { execSync } = await import("child_process");
      execSync("npx tsx scripts/push-to-db.ts", { stdio: "inherit", cwd: path.join(__dirname, "..") });
    }

    // ── Summary ───────────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_all_complete", {
      redlist_count: allRedlistSpecies.length,
      gbif_count: allGbifSpecies.size,
      linked_count: linkedCount,
      duration_seconds: Number(elapsed),
    });

    console.log("\n" + "=".repeat(60));
    console.log("sync-all complete:");
    console.log(`  Red List species:  ${allRedlistSpecies.length.toLocaleString()}`);
    if (!skipGbif) {
      console.log(`  GBIF species:      ${allGbifSpecies.size.toLocaleString()}`);
      console.log(`  Linked:            ${linkedCount.toLocaleString()}`);
    }
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    await pgClient.end();
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("sync-all.ts") || process.argv[1]?.endsWith("sync-all.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
