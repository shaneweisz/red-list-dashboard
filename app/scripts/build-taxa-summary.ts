/**
 * build-taxa-summary: Compute per-taxon summary stats → taxa-summary.json
 *                     + node-children-summaries.json for instant drill-down
 *
 * Reads per-taxon redlist and GBIF CSVs, computes summary statistics,
 * and writes to data/taxa-summary.json and data/node-children-summaries.json.
 *
 * Usage:
 *   npx tsx scripts/build-taxa-summary.ts
 */

import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR, REDLIST_DIR, GBIF_DIR } from "./utils";
import { TAXA } from "./taxa";
import { readRedlistCsv } from "./fetch-redlist-species";
import { readGbifCsv } from "./fetch-gbif-species";
import { readMappingCsv } from "./match-redlist-species-to-gbif";
import { NODE_INDEX, hasChildren, matchesFilter } from "../src/lib/taxonomy-utils";
import type { TaxonomyNode } from "../src/config/taxonomy-tree";
import type { NodeSummary } from "../src/lib/data/species-store";

const CURRENT_YEAR = new Date().getFullYear();
const OUTDATED_THRESHOLD_YEARS = 10;

export interface TaxonSummaryRow {
  table1a_taxon_group: string;
  total_assessed: number;
  outdated: number;
  by_category: Record<string, number>;
  gbif_species_count: number;
  gbif_ne_species_count: number;
  total_gbif_observations: number;
  mean_gbif_obs: number;
  median_gbif_obs: number | null;
  // Catalogue of Life backbone (#271): the extant accepted-species universe in this
  // group (col_described) and how many of those IUCN hasn't evaluated (col_ne =
  // universe minus assessed, by col_id). Filled after the per-taxon loop; 0 if the
  // CoL artifacts aren't present.
  col_described?: number;
  col_ne?: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Per-taxon_group CoL counts from the backbone artifacts: col_described = extant
// accepted universe; col_ne = that minus the col_ids IUCN has assessed. species/ is
// partitioned by taxon_group, so this is a single grouped scan. Returns empty (→ 0s)
// when the CoL artifacts aren't present (e.g. a sync that hasn't built them yet).
async function colCountsByGroup(): Promise<Map<string, { col_described: number; col_ne: number }>> {
  const out = new Map<string, { col_described: number; col_ne: number }>();
  const link = path.join(DATA_DIR, "species_link.parquet");
  const speciesGlob = path.join(DATA_DIR, "species", "**", "*.parquet");
  if (!fs.existsSync(path.join(DATA_DIR, "species")) || !fs.existsSync(link)) {
    console.log("  CoL counts: species/ or species_link.parquet missing — skipping (col_described/col_ne = 0)");
    return out;
  }
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  const rows = await (await conn.run(`
    SELECT taxon_group,
           count(*) FILTER (in_base AND extinct IS NOT TRUE) AS col_described,
           count(*) FILTER (in_base AND extinct IS NOT TRUE AND col_id NOT IN (
             SELECT col_id FROM read_parquet('${link}') WHERE src = 'redlist' AND col_id IS NOT NULL
           )) AS col_ne
    FROM read_parquet('${speciesGlob}', hive_partitioning=true)
    GROUP BY taxon_group`)).getRowObjects();
  for (const r of rows) out.set(String(r.taxon_group), { col_described: Number(r.col_described), col_ne: Number(r.col_ne) });
  return out;
}

export async function run(): Promise<void> {
  const summaries: TaxonSummaryRow[] = [];

  // Load mapping to determine which GBIF species are linked to redlist entries
  const mapping = readMappingCsv();
  const linkedGbifKeys = new Set<number>();
  for (const links of mapping.values()) {
    for (const link of links) {
      if (link.gbif_species_key != null) linkedGbifKeys.add(link.gbif_species_key);
    }
  }

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
    let gbifNeSpeciesCount = 0;
    let totalGbifObservations = 0;
    const obsCounts: number[] = [];

    if (fs.existsSync(gbifPath)) {
      const gbifMap = readGbifCsv(taxon.id);
      gbifSpeciesCount = gbifMap.size;
      for (const [key, g] of gbifMap) {
        totalGbifObservations += g.total_count;
        obsCounts.push(g.total_count);
        // NE = GBIF species not linked to any redlist entry
        if (!linkedGbifKeys.has(key)) gbifNeSpeciesCount++;
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
      gbif_ne_species_count: gbifNeSpeciesCount,
      total_gbif_observations: totalGbifObservations,
      mean_gbif_obs: meanGbifObs,
      median_gbif_obs: median(obsCounts),
    });

    console.log(`  ${taxon.id}: ${totalAssessed} assessed, ${gbifNeSpeciesCount} unassessed, ${outdated} outdated, ${gbifSpeciesCount} GBIF species`);
  }

  // Catalogue of Life per-group counts: extant universe (col_described) and the
  // not-evaluated slice (col_ne = universe minus assessed col_ids). species/ is
  // partitioned by taxon_group, so this is one grouped scan. 0s if CoL not built yet.
  const colCounts = await colCountsByGroup();
  for (const s of summaries) {
    const c = colCounts.get(s.table1a_taxon_group);
    s.col_described = c?.col_described ?? 0;
    s.col_ne = c?.col_ne ?? 0;
  }

  const outputPath = path.join(DATA_DIR, "taxa-summary.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summaries, null, 2) + "\n");
  console.log(`\nWrote ${summaries.length} taxa → ${outputPath}`);

  // ─── Second pass: precompute node children summaries ──────────────
  console.log("\nComputing node children summaries...");

  // Build caches for CSV data (reusing what readRedlistCsv/readGbifCsv load)
  const redlistByGroup = new Map<string, ReturnType<typeof readRedlistCsv>>();
  const gbifByGroup = new Map<string, ReturnType<typeof readGbifCsv>>();
  for (const taxon of TAXA) {
    if (fs.existsSync(path.join(REDLIST_DIR, `${taxon.id}.csv`))) {
      redlistByGroup.set(taxon.id, readRedlistCsv(taxon.id));
    }
    if (fs.existsSync(path.join(GBIF_DIR, `${taxon.id}.csv`))) {
      gbifByGroup.set(taxon.id, readGbifCsv(taxon.id));
    }
  }

  // Must match EXCLUDED_DOMESTICATED_GBIF_KEYS in species-store.ts
  const excludedDomesticatedGbifKeys = new Set([
    2441022, 2435035, 2441110, 2441056, 2440886, 7422937, 2440891,
    9055455, 2441238, 5220190, 7515593, 2441019, 5219702, 10694102, 2436436,
  ]);

  function isOutdated(assessmentDate: string | null): boolean {
    if (!assessmentDate) return true;
    const year = parseInt(assessmentDate.slice(0, 4), 10);
    if (isNaN(year)) return true;
    return CURRENT_YEAR - year > OUTDATED_THRESHOLD_YEARS;
  }

  function computeNodeSummary(node: TaxonomyNode): NodeSummary {
    const filter = node.filter;
    let totalAssessed = 0;
    let outdatedCount = 0;
    let gbifNeSpeciesCount = 0;
    const byCategory: Record<string, number> = {};

    for (const group of filter.csvGroups) {
      const rows = redlistByGroup.get(group) ?? [];
      for (const row of rows) {
        if (!matchesFilter(row, filter)) continue;
        totalAssessed++;
        if (isOutdated(row.assessment_date)) outdatedCount++;
        const cat = row.category;
        if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      }

      const gbifMap = gbifByGroup.get(group);
      if (gbifMap) {
        for (const [key, gbifRow] of gbifMap) {
          if (linkedGbifKeys.has(key)) continue;
          if (excludedDomesticatedGbifKeys.has(key)) continue;
          if (!matchesFilter(gbifRow, filter)) continue;
          gbifNeSpeciesCount++;
        }
      }
    }

    return {
      id: node.id,
      name: node.name,
      estimatedDescribed: node.estimatedDescribed ?? 0,
      totalAssessed,
      outdated: outdatedCount,
      gbifNeSpeciesCount,
      byCategory,
    };
  }

  function computeChildrenSummaries(parentNode: TaxonomyNode): NodeSummary[] {
    const children = parentNode.children!;

    // Check if we need claim tracking (for catch-all nodes with excludeClasses)
    const needsClaimTracking = children.some(c =>
      c.filter.excludeClasses && c.filter.excludeClasses.length > 0
    );

    if (!needsClaimTracking) {
      return children.map(child => computeNodeSummary(child));
    }

    // Complex case: track claimed rows for catch-all nodes
    const claimedRowIds = new Set<number>();
    const claimedGbifKeys = new Set<number>();
    const results: NodeSummary[] = [];

    const nonCatchAll = children.filter(c =>
      !c.filter.excludeClasses || c.filter.excludeClasses.length === 0
    );
    const catchAll = children.filter(c =>
      c.filter.excludeClasses && c.filter.excludeClasses.length > 0
    );

    for (const child of nonCatchAll) {
      const summary = computeNodeSummary(child);
      results.push(summary);

      if (child.filter.classNames || child.filter.orderNames) {
        for (const group of child.filter.csvGroups) {
          const rows = redlistByGroup.get(group) ?? [];
          for (const row of rows) {
            if (matchesFilter(row, child.filter)) {
              claimedRowIds.add(row.sis_taxon_id);
            }
          }
          const gbifMap = gbifByGroup.get(group);
          if (gbifMap) {
            for (const [key, gbifRow] of gbifMap) {
              if (!linkedGbifKeys.has(key) && !excludedDomesticatedGbifKeys.has(key) && matchesFilter(gbifRow, child.filter)) {
                claimedGbifKeys.add(key);
              }
            }
          }
        }
      }
    }

    for (const child of catchAll) {
      let totalAssessed = 0;
      let outdatedCount = 0;
      let gbifNeSpeciesCount = 0;
      const byCategory: Record<string, number> = {};

      for (const group of child.filter.csvGroups) {
        const rows = redlistByGroup.get(group) ?? [];
        for (const row of rows) {
          if (!matchesFilter(row, child.filter)) continue;
          if (claimedRowIds.has(row.sis_taxon_id)) continue;
          totalAssessed++;
          if (isOutdated(row.assessment_date)) outdatedCount++;
          const cat = row.category;
          if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
        }

        const gbifMap = gbifByGroup.get(group);
        if (gbifMap) {
          for (const [key, gbifRow] of gbifMap) {
            if (linkedGbifKeys.has(key)) continue;
            if (excludedDomesticatedGbifKeys.has(key)) continue;
            if (!matchesFilter(gbifRow, child.filter)) continue;
            if (claimedGbifKeys.has(key)) continue;
            gbifNeSpeciesCount++;
          }
        }
      }

      results.push({
        id: child.id,
        name: child.name,
        estimatedDescribed: child.estimatedDescribed ?? 0,
        totalAssessed,
        outdated: outdatedCount,
        gbifNeSpeciesCount,
        byCategory,
      });
    }

    return results;
  }

  const nodeChildrenSummaries: Record<string, NodeSummary[]> = {};
  let parentCount = 0;
  let childCount = 0;

  for (const [nodeId, node] of NODE_INDEX) {
    if (!hasChildren(nodeId)) continue;
    const childSummaries = computeChildrenSummaries(node);
    nodeChildrenSummaries[nodeId] = childSummaries;
    parentCount++;
    childCount += childSummaries.length;
    console.log(`  ${nodeId}: ${childSummaries.length} children`);
  }

  const childrenOutputPath = path.join(DATA_DIR, "node-children-summaries.json");
  fs.writeFileSync(childrenOutputPath, JSON.stringify(nodeChildrenSummaries, null, 2) + "\n");
  console.log(`\nWrote ${parentCount} parents (${childCount} children) → ${childrenOutputPath}`);
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
