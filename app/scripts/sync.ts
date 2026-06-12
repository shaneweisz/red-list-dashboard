/**
 * sync: End-to-end CSV sync orchestrator
 *
 * Runs all CSV pipeline phases in sequence:
 *   Phase 1: fetch-redlist-species  (IUCN DB → per-taxon CSVs)
 *   Phase 2: fetch-gbif-species     (GBIF API → per-taxon CSVs)
 *   Phase 3: match-redlist-species-to-gbif (GBIF Match API → data/mapping.csv)
 *   Phase 4: fetch-gbif-country-data (GBIF API → country occurrences per species)
 *   Phase 5: fetch-gbif-new-counts  (GBIF API → updates GBIF CSVs)
 *   Phase 6: build-parquet          (CSVs → assessed/unassessed parquets + search)
 *   Phase 7: fetch-coldp            (CoL XR ColDP archive → NameUsage.tsv, full sync only)
 *   Phase 8: build-backbone         (NameUsage.tsv → backbone.parquet + species/)
 *   Phase 9: build-matching         (→ species_link.parquet, IUCN/GBIF → col_id)
 *   Phase 10: build-taxa-summary    (CSVs + CoL artifacts → taxa-summary.json, incl. col counts)
 *
 * Prerequisites:
 *   1. DB connectivity to IUCN Postgres (direct via DB_HOST/DB_PORT, or SSH-tunneled to localhost:5433)
 *   2. Environment variables (see .env.example)
 *
 * Usage:
 *   npx tsx scripts/sync.ts                     # Full sync, all taxa
 *   npx tsx scripts/sync.ts mammalia aves        # Specific taxa only
 */

import * as fs from "fs";
import * as path from "path";
import { loadEnvFiles, SyncLogger } from "./utils";
import { run as fetchRedlistSpecies } from "./fetch-redlist-species";
import { run as fetchGbifSpecies } from "./fetch-gbif-species";
import { run as matchRedlistSpeciesToGbif } from "./match-redlist-species-to-gbif";
import { run as fetchGbifNewCounts } from "./fetch-gbif-new-counts";
import { run as fetchGbifCountryData } from "./fetch-gbif-country-data";
import { run as buildTaxaSummary } from "./build-taxa-summary";
import { run as buildSpeciesParquet } from "./build-parquet";
import { run as fetchColdp } from "./fetch-coldp";
import { run as buildBackbone } from "./build-backbone";
import { run as buildMatching } from "./build-matching";

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
  let coldpTsv: string | null = null;

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

    // Phase 6: Build DuckDB read-layer parquets (#261) — also powers search.
    console.log("\nPhase 6: build-parquet");
    console.log("═".repeat(60));
    await buildSpeciesParquet();

    // Phases 7-9: Catalogue of Life backbone (#271). The backbone is the whole tree
    // (taxon-independent) and matching needs the complete assessed/unassessed parquets,
    // so only run on a FULL sync; a partial-taxa sync leaves the existing CoL artifacts.
    if (!taxaFilter) {
      console.log("\nPhase 7: fetch-coldp (CoL XR ColDP → NameUsage.tsv)");
      console.log("═".repeat(60));
      coldpTsv = await fetchColdp();

      console.log("\nPhase 8: build-backbone (→ backbone.parquet + species/)");
      console.log("═".repeat(60));
      await buildBackbone({ tsv: coldpTsv });

      console.log("\nPhase 9: build-matching (→ species_link.parquet)");
      console.log("═".repeat(60));
      await buildMatching();
    } else {
      console.log("\nPhases 7-9 (CoL backbone): skipped on a partial-taxa sync — run a full sync to refresh.");
    }

    // Phase 10: Build taxa summary LAST — it reads the CoL artifacts (species/ +
    // species_link) to add per-group col_described / col_ne counts to taxa-summary.json.
    console.log("\nPhase 10: build-taxa-summary");
    console.log("═".repeat(60));
    await buildTaxaSummary();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("sync_complete", { duration_seconds: Number(elapsed) });

    console.log("\n" + "=".repeat(60));
    console.log(`Sync complete: ${minutes}m ${seconds}s`);
    console.log("");
    console.log("Next steps:");
    console.log("  npm run diff-data-vs-r2     # see what changed vs the live R2 sync");
    console.log("  npm run upload-data-to-r2   # publish this sync to R2");
  } finally {
    // Drop the temp ColDP TSV (~2.8GB) so it's never swept into the R2 upload.
    if (coldpTsv) fs.rmSync(path.dirname(coldpTsv), { recursive: true, force: true });
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
