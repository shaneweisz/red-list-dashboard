/**
 * pipeline: End-to-end sync orchestrator
 *
 * Phase 1: Fetch data (per taxon)
 *   For each taxon: fetch Red List → write CSV, fetch GBIF → write CSV
 *
 * Phase 2: Match species (all at once)
 *   Match all Red List species to GBIF keys → write links CSV
 *
 * Phase 3: Since-assessment counts (per taxon)
 *   For each taxon: compute counts since assessment → write GBIF CSV
 *
 * Prerequisites:
 *   1. SSH tunnel to IUCN DB (port 5433)
 *   2. Environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/pipeline.ts                     # Full sync, all taxa
 *   npx tsx scripts/pipeline.ts mammalia aves        # Specific taxa only
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
} from "./fetch-redlist";
import {
  GBIF_TAXA,
  GbifTaxon,
  GbifSpecies,
  fetchGbifCounts,
  validateSpeciesKeys,
  fetchCountsSinceAssessment,
  writeGbifCsv,
} from "./fetch-gbif";
import {
  matchAllSpecies,
  writeLinksCsv,
} from "./match";

// =============================================================================
// REDLIST → GBIF TAXON MAPPING
// =============================================================================

const REDLIST_TO_GBIF: Record<string, string> = {
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

function getGbifTaxon(redlistId: string): GbifTaxon {
  const gbifId = REDLIST_TO_GBIF[redlistId];
  if (!gbifId || !GBIF_TAXA[gbifId]) {
    throw new Error(`No GBIF taxon mapping for: ${redlistId}`);
  }
  return GBIF_TAXA[gbifId];
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

  console.log("pipeline: Full sync");
  console.log("=".repeat(60));
  console.log(`Taxa: ${taxaIds.join(", ")}`);
  console.log();

  const startTime = Date.now();
  const logger = new SyncLogger("pipeline");

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

    for (const taxonId of taxaIds) {
      const redlistEntries = REDLIST_TAXA.filter((t) => t.id === taxonId);
      const taxonName = redlistEntries[0].name;
      const taxonStart = Date.now();

      console.log(`\n${taxonName} (${taxonId})`);
      logger.log("taxon_start", { taxon: taxonId });

      // ── Red List ──
      console.log("  ▸ Red List");
      for (const entry of redlistEntries) {
        const species = await fetchFromIucnDb(pgClient, entry);
        console.log(`    ${entry.name}: ${species.length} species`);
        allRedlistSpecies.push(...species);
      }

      writeRedlistCsv(allRedlistSpecies, path.join(DATA_DIR, "redlist-species.csv"));

      // ── GBIF ──
      const gbifTaxon = getGbifTaxon(taxonId);
      if (!fetchedGbifTaxa.has(gbifTaxon.id)) {
        fetchedGbifTaxa.add(gbifTaxon.id);

        console.log(`  ▸ GBIF (${gbifTaxon.name})`);
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
      } else {
        console.log(`  ▸ GBIF (${gbifTaxon.name}) — already fetched`);
      }

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      logger.log("taxon_fetch_complete", { taxon: taxonId, duration_seconds: Number(taxonDuration) });
      console.log(`  Done (${taxonDuration}s)`);
    }

    console.log(`\nPhase 1 complete: ${allRedlistSpecies.length} Red List, ${allGbifSpecies.size} GBIF species\n`);

    // ══════════════════════════════════════════════════════════════
    // Phase 2: Match all species
    // ══════════════════════════════════════════════════════════════
    console.log("Phase 2: Match species");
    console.log("═".repeat(60));

    const linkResults = await matchAllSpecies(logger);
    const linksPath = path.join(DATA_DIR, "species-links.csv");
    writeLinksCsv(linkResults, linksPath);

    const linkedCount = linkResults.filter((r) => r.gbif_species_key !== null).length;
    console.log(`\nPhase 2 complete: ${linkedCount} linked out of ${linkResults.length}\n`);

    // ══════════════════════════════════════════════════════════════
    // Phase 3: Since-assessment counts (per GBIF taxon)
    // ══════════════════════════════════════════════════════════════
    console.log("Phase 3: Since-assessment counts");
    console.log("═".repeat(60));

    const processedGbifTaxa = new Set<string>();
    for (const taxonId of taxaIds) {
      const gbifTaxon = getGbifTaxon(taxonId);
      if (processedGbifTaxa.has(gbifTaxon.id)) continue;
      processedGbifTaxa.add(gbifTaxon.id);

      console.log(`\n${gbifTaxon.name} (${gbifTaxon.id})`);
      const saCount = await fetchCountsSinceAssessment(gbifTaxon, allGbifSpecies);
      console.log(`  Computed for ${saCount} species`);

      writeGbifCsv(allGbifSpecies, path.join(DATA_DIR, "gbif-species.csv"));
    }

    console.log("\nPhase 3 complete\n");

    // ══════════════════════════════════════════════════════════════
    // Summary
    // ══════════════════════════════════════════════════════════════
    const redlistPath = path.join(DATA_DIR, "redlist-species.csv");
    const gbifPath = path.join(DATA_DIR, "gbif-species.csv");

    console.log("CSVs written:");
    console.log(`  ${redlistPath}: ${allRedlistSpecies.length.toLocaleString()} rows`);
    console.log(`  ${gbifPath}: ${allGbifSpecies.size.toLocaleString()} rows`);
    console.log(`  ${linksPath}: ${linkResults.length.toLocaleString()} rows (${linkedCount.toLocaleString()} linked)`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("pipeline_complete", {
      redlist_count: allRedlistSpecies.length,
      gbif_count: allGbifSpecies.size,
      linked_count: linkedCount,
      duration_seconds: Number(elapsed),
    });

    console.log("\n" + "=".repeat(60));
    console.log("Pipeline complete:");
    console.log(`  Red List species:  ${allRedlistSpecies.length.toLocaleString()}`);
    console.log(`  GBIF species:      ${allGbifSpecies.size.toLocaleString()}`);
    console.log(`  Linked:            ${linkedCount.toLocaleString()}`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    await pgClient.end();
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("pipeline.ts") || process.argv[1]?.endsWith("pipeline.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
