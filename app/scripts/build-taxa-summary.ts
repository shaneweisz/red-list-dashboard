/**
 * build-taxa-summary: Compute per-taxon summary stats → taxa-summary.json
 *
 * Reads per-taxon redlist and GBIF CSVs, computes summary statistics,
 * and writes to data/taxa-summary.json.
 *
 * Usage:
 *   npx tsx scripts/build-taxa-summary.ts
 */

import * as fs from "fs";
import * as path from "path";
import { loadEnvFiles, DATA_DIR, REDLIST_DIR, GBIF_DIR } from "./utils";
import { TAXA } from "./taxa";
import { readRedlistCsv } from "./fetch-redlist-species";
import { readGbifCsv } from "./fetch-gbif-species";

const CURRENT_YEAR = new Date().getFullYear();
const OUTDATED_THRESHOLD_YEARS = 10;

export interface TaxonSummaryRow {
  table1a_taxon_group: string;
  total_assessed: number;
  outdated: number;
  by_category: Record<string, number>;
  gbif_species_count: number;
  total_gbif_observations: number;
  mean_gbif_obs: number;
  median_gbif_obs: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function run(): Promise<void> {
  const summaries: TaxonSummaryRow[] = [];

  for (const taxon of TAXA) {
    const redlistPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
    const gbifPath = path.join(GBIF_DIR, `${taxon.id}.csv`);

    if (!fs.existsSync(redlistPath)) {
      console.log(`  Skipping ${taxon.id} — no redlist CSV`);
      continue;
    }

    const redlistSpecies = readRedlistCsv(taxon.id);

    const totalAssessed = redlistSpecies.length;
    let outdated = 0;
    const byCategory: Record<string, number> = {};

    for (const s of redlistSpecies) {
      // Count outdated
      if (s.assessment_date) {
        const year = parseInt(s.assessment_date.slice(0, 4), 10);
        if (!isNaN(year) && CURRENT_YEAR - year > OUTDATED_THRESHOLD_YEARS) {
          outdated++;
        }
      } else {
        // No assessment date = treat as outdated
        outdated++;
      }

      // Count by category
      const cat = s.category || "DD";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    // GBIF stats
    let gbifSpeciesCount = 0;
    let totalGbifObservations = 0;
    const obsCounts: number[] = [];

    if (fs.existsSync(gbifPath)) {
      const gbifMap = readGbifCsv(taxon.id);
      gbifSpeciesCount = gbifMap.size;
      for (const g of gbifMap.values()) {
        totalGbifObservations += g.total_count;
        obsCounts.push(g.total_count);
      }
    }

    const meanGbifObs = gbifSpeciesCount > 0
      ? totalGbifObservations / gbifSpeciesCount
      : 0;

    summaries.push({
      table1a_taxon_group: taxon.id,
      total_assessed: totalAssessed,
      outdated,
      by_category: byCategory,
      gbif_species_count: gbifSpeciesCount,
      total_gbif_observations: totalGbifObservations,
      mean_gbif_obs: meanGbifObs,
      median_gbif_obs: median(obsCounts),
    });

    console.log(`  ${taxon.id}: ${totalAssessed} assessed, ${outdated} outdated, ${gbifSpeciesCount} GBIF species`);
  }

  const outputPath = path.join(DATA_DIR, "taxa-summary.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summaries, null, 2) + "\n");
  console.log(`\nWrote ${summaries.length} taxa → ${outputPath}`);
}

async function main() {
  loadEnvFiles();

  console.log("build-taxa-summary: per-taxon CSVs → taxa-summary.json");
  console.log("=".repeat(50));

  await run();
}

const isDirectRun = process.argv[1]?.endsWith("build-taxa-summary.ts") || process.argv[1]?.endsWith("build-taxa-summary.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
