/**
 * sync: End-to-end CSV sync orchestrator
 *
 * Runs all CSV pipeline phases in sequence:
 *   Phase 1: fetch-redlist-species  (IUCN DB → per-taxon CSVs)
 *   Phase 2: fetch-gbif-species     (GBIF API → per-taxon CSVs)
 *   Phase 3: match-redlist-species-to-gbif (GBIF Match API → data/mapping.csv)
 *   Phase 4: fetch-gbif-country-data (GBIF API → country occurrences per species)
 *   Phase 5: fetch-gbif-new-counts  (GBIF API → updates GBIF CSVs)
 *   Phase 6: build-taxa-summary     (per-taxon CSVs → taxa-summary.json)
 *   Phase 7: build-search-index    (all CSVs → search-index.json)
 *   Phase 8: upload-range-maps     (IUCN DB → R2, skips existing)
 *
 * Prerequisites:
 *   1. SSH tunnel to IUCN DB (port 5433)
 *   2. Environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/sync.ts                     # Full sync, all taxa
 *   npx tsx scripts/sync.ts mammalia aves        # Specific taxa only
 */

import { loadEnvFiles, SyncLogger } from "./utils";
import { run as fetchRedlistSpecies } from "./fetch-redlist-species";
import { run as fetchGbifSpecies } from "./fetch-gbif-species";
import { run as matchRedlistSpeciesToGbif } from "./match-redlist-species-to-gbif";
import { run as fetchGbifNewCounts } from "./fetch-gbif-new-counts";
import { run as fetchGbifCountryData } from "./fetch-gbif-country-data";
import { run as buildTaxaSummary } from "./build-taxa-summary";
import { run as buildSearchIndex } from "./build-search-index";
import { run as uploadRangeMaps } from "./upload-range-maps";

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const taxa = args.map((a) => a.toLowerCase());
  const taxaFilter = taxa.length > 0 ? taxa : undefined;

  console.log("sync: Full CSV pipeline");
  console.log("=".repeat(60));
  console.log(`Taxa: ${taxaFilter ? taxaFilter.join(", ") : "all"}`);
  console.log();

  const startTime = Date.now();
  const logger = new SyncLogger("sync");

  try {
    logger.log("sync_start", { taxa: taxaFilter ?? "all" });

    // Phase 1: Red List
    console.log("Phase 1: fetch-redlist-species");
    console.log("═".repeat(60));
    await fetchRedlistSpecies({ taxa: taxaFilter, logger });

    // Phase 2: GBIF species
    console.log("\nPhase 2: fetch-gbif-species");
    console.log("═".repeat(60));
    await fetchGbifSpecies({ taxa: taxaFilter, logger });

    // Phase 3: Match
    console.log("\nPhase 3: match-redlist-species-to-gbif");
    console.log("═".repeat(60));
    await matchRedlistSpeciesToGbif({ logger });

    // Phase 4: GBIF country data
    console.log("\nPhase 4: fetch-gbif-country-data");
    console.log("═".repeat(60));
    await fetchGbifCountryData({ taxa: taxaFilter, logger });

    // Phase 5: New GBIF counts
    console.log("\nPhase 5: fetch-gbif-new-counts");
    console.log("═".repeat(60));
    await fetchGbifNewCounts({ taxa: taxaFilter, logger });

    // Phase 6: Build taxa summary
    console.log("\nPhase 6: build-taxa-summary");
    console.log("═".repeat(60));
    await buildTaxaSummary();

    // Phase 7: Build search index
    console.log("\nPhase 7: build-search-index");
    console.log("═".repeat(60));
    await buildSearchIndex();

    // Phase 8: Upload range maps to R2
    console.log("\nPhase 8: upload-range-maps");
    console.log("═".repeat(60));
    await uploadRangeMaps({ taxa: taxaFilter, logger });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", { duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(60));
    console.log(`Sync complete: ${minutes}m ${seconds}s`);
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
