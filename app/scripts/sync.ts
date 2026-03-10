/**
 * sync: End-to-end sync orchestrator
 *
 * Phase 1: Fetch data (per taxon)
 *   For each taxon: fetch Red List → write CSV, fetch GBIF → write CSV
 *
 * Phase 2: Match species (all at once)
 *   Match all Red List species to GBIF keys → update redlist CSV
 *
 * Phase 3: Count new GBIF observations (per taxon)
 *   For each taxon: compute counts since assessment → write GBIF CSV
 *
 * Prerequisites:
 *   1. SSH tunnel to IUCN DB (port 5433)
 *   2. Environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/sync.ts                     # Full sync, all taxa
 *   npx tsx scripts/sync.ts mammalia aves        # Specific taxa only
 */

import * as path from "path";
import { Client } from "pg";
import {
  loadEnvFiles,
  SyncLogger,
  DATA_DIR,
  toTitleCase,
} from "./utils";
import {
  fetchFromIucnDb,
  writeRedlistCsv,
  RedlistSpecies,
  REDLIST_TAXA,
} from "./fetch-redlist-species";
import {
  GBIF_TAXA,
  GbifTaxon,
  GbifSpecies,
  fetchGbifCounts,
  validateSpeciesKeys,
  writeGbifCsv,
} from "./fetch-gbif-species";
import { fetchCountsSinceAssessment } from "./fetch-gbif-new-counts";
import { matchAllSpecies } from "./match-redlist-species-to-gbif";

function getGbifTaxon(redlistId: string): GbifTaxon {
  const gbifTaxon = GBIF_TAXA[redlistId];
  if (!gbifTaxon) {
    throw new Error(`No GBIF taxon for: ${redlistId}`);
  }
  return gbifTaxon;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const taxonFilter = args.length > 0 ? args.map((a) => a.toLowerCase()) : undefined;

  // Deduplicate REDLIST_TAXA by id (other_invertebrates has two entries)
  const seenIds = new Set<string>();
  const uniqueTaxaIds: string[] = [];
  for (const t of REDLIST_TAXA) {
    if (!seenIds.has(t.id)) {
      seenIds.add(t.id);
      uniqueTaxaIds.push(t.id);
    }
  }

  const taxaIds = taxonFilter || uniqueTaxaIds;

  for (const id of taxaIds) {
    if (!seenIds.has(id)) {
      console.error(`Unknown taxon: ${id}`);
      console.error("Available:", uniqueTaxaIds.join(", "));
      process.exit(1);
    }
  }

  console.log("sync: Full sync");
  console.log("=".repeat(60));
  console.log(`Taxa: ${taxaIds.join(", ")}`);
  console.log();

  const startTime = Date.now();
  const logger = new SyncLogger("sync");
  logger.log("sync_start", { taxa: taxaIds });

  const allRedlistSpecies: RedlistSpecies[] = [];
  const allGbifSpecies = new Map<number, GbifSpecies>();
  const fetchedGbifTaxa = new Set<string>();

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

    // ══════════════════════════════════════════════════════════════
    // Phase 1: Fetch Red List + GBIF data (per taxon)
    // ══════════════════════════════════════════════════════════════
    console.log("Phase 1: Fetch data");
    console.log("═".repeat(60));
    const fetchStart = Date.now();
    logger.log("fetch_start", { taxa: taxaIds });

    for (const taxonId of taxaIds) {
      const redlistEntries = REDLIST_TAXA.filter((t) => t.id === taxonId);
      const taxonName = redlistEntries[0].name;
      const taxonStart = Date.now();

      console.log(`\n${taxonName} (${taxonId})`);

      // ── Red List ──
      console.log("  ▸ Red List");
      const redlistStart = Date.now();
      let taxonRedlistCount = 0;
      for (const entry of redlistEntries) {
        const species = await fetchFromIucnDb(pgClient, entry);
        console.log(`    ${entry.name}: ${species.length} species`);
        taxonRedlistCount += species.length;
        allRedlistSpecies.push(...species);
      }

      writeRedlistCsv(allRedlistSpecies, path.join(DATA_DIR, "redlist-species.csv"));

      const redlistDuration = ((Date.now() - redlistStart) / 1000).toFixed(1);
      logger.log("fetch_redlist_species", {
        taxon: taxonId,
        species_count: taxonRedlistCount,
        duration_seconds: Number(redlistDuration),
      });

      // ── GBIF ──
      const gbifTaxon = getGbifTaxon(taxonId);
      if (!fetchedGbifTaxa.has(gbifTaxon.id)) {
        fetchedGbifTaxa.add(gbifTaxon.id);

        console.log(`  ▸ GBIF (${gbifTaxon.name})`);
        const gbifStart = Date.now();
        const rawResults = await fetchGbifCounts(gbifTaxon);
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
            taxon_group_table1a: r.taxonGroup,
            total_count: r.count,
            count_after_assessment_year: null,
          });
        }

        writeGbifCsv(allGbifSpecies, path.join(DATA_DIR, "gbif-species.csv"));

        const gbifDuration = ((Date.now() - gbifStart) / 1000).toFixed(1);
        logger.log("fetch_gbif_species", {
          taxon: gbifTaxon.id,
          raw_count: rawResults.length,
          valid_count: validSpecies.size,
          duration_seconds: Number(gbifDuration),
        });
      } else {
        console.log(`  ▸ GBIF (${gbifTaxon.name}) — already fetched`);
      }

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      console.log(`  Done (${taxonDuration}s)`);
    }

    const fetchDuration = ((Date.now() - fetchStart) / 1000).toFixed(1);
    logger.log("fetch_complete", {
      redlist_total: allRedlistSpecies.length,
      gbif_total: allGbifSpecies.size,
      duration_seconds: Number(fetchDuration),
    });
    console.log(`\nPhase 1 complete: ${allRedlistSpecies.length} Red List, ${allGbifSpecies.size} GBIF species\n`);

    // Done with the database — close before the long-running GBIF phases
    await pgClient.end();

    // ══════════════════════════════════════════════════════════════
    // Phase 2: Match all species
    // ══════════════════════════════════════════════════════════════
    console.log("Phase 2: Match species");
    console.log("═".repeat(60));
    const matchStart = Date.now();
    logger.log("match_redlist_species_to_gbif_start", {});

    const matchedSpecies = await matchAllSpecies(logger);
    writeRedlistCsv(matchedSpecies, path.join(DATA_DIR, "redlist-species.csv"));

    const linkedCount = matchedSpecies.filter((r) => r.gbif_species_key !== null).length;
    const matchDuration = ((Date.now() - matchStart) / 1000).toFixed(1);
    logger.log("match_redlist_species_to_gbif_complete", {
      total: matchedSpecies.length,
      linked: linkedCount,
      duration_seconds: Number(matchDuration),
    });
    console.log(`\nPhase 2 complete: ${linkedCount} linked out of ${matchedSpecies.length}\n`);

    // ══════════════════════════════════════════════════════════════
    // Phase 3: Count new GBIF observations (per GBIF taxon)
    // ══════════════════════════════════════════════════════════════
    console.log("Phase 3: Count new GBIF observations");
    console.log("═".repeat(60));
    const saStart = Date.now();
    logger.log("fetch_new_gbif_counts_start", {});

    const processedGbifTaxa = new Set<string>();
    for (const taxonId of taxaIds) {
      const gbifTaxon = getGbifTaxon(taxonId);
      if (processedGbifTaxa.has(gbifTaxon.id)) continue;
      processedGbifTaxa.add(gbifTaxon.id);

      console.log(`\n${gbifTaxon.name} (${gbifTaxon.id})`);
      const taxonSaStart = Date.now();
      const saCount = await fetchCountsSinceAssessment(gbifTaxon, allGbifSpecies);
      const taxonSaDuration = ((Date.now() - taxonSaStart) / 1000).toFixed(1);
      console.log(`  Computed for ${saCount} species`);

      logger.log("fetch_new_gbif_counts_taxon", {
        taxon: gbifTaxon.id,
        species_computed: saCount,
        duration_seconds: Number(taxonSaDuration),
      });

      writeGbifCsv(allGbifSpecies, path.join(DATA_DIR, "gbif-species.csv"));
    }

    const saDuration = ((Date.now() - saStart) / 1000).toFixed(1);
    logger.log("fetch_new_gbif_counts_complete", {
      duration_seconds: Number(saDuration),
    });
    console.log("\nPhase 3 complete\n");

    // ══════════════════════════════════════════════════════════════
    // Summary
    // ══════════════════════════════════════════════════════════════
    const redlistPath = path.join(DATA_DIR, "redlist-species.csv");
    const gbifPath = path.join(DATA_DIR, "gbif-species.csv");

    console.log("CSVs written:");
    console.log(`  ${redlistPath}: ${matchedSpecies.length.toLocaleString()} rows (${linkedCount.toLocaleString()} linked)`);
    console.log(`  ${gbifPath}: ${allGbifSpecies.size.toLocaleString()} rows`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", {
      redlist_count: matchedSpecies.length,
      gbif_count: allGbifSpecies.size,
      linked_count: linkedCount,
      fetch_seconds: Number(fetchDuration),
      match_seconds: Number(matchDuration),
      fetch_new_gbif_counts_seconds: Number(saDuration),
      total_seconds: Number(elapsed),
    });

    console.log("\n" + "=".repeat(60));
    console.log("Sync complete:");
    console.log(`  Red List species:  ${matchedSpecies.length.toLocaleString()}`);
    console.log(`  GBIF species:      ${allGbifSpecies.size.toLocaleString()}`);
    console.log(`  Linked:            ${linkedCount.toLocaleString()}`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("sync.ts") || process.argv[1]?.endsWith("sync.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
