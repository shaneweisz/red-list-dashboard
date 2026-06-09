/**
 * diff-col-vs-estimates: Compare computed Catalogue of Life counts against the
 * hardcoded `estimatedDescribed` literature estimates in taxonomy-tree.ts.
 *
 * This is the validation step before swapping the denominator: it shows which
 * per-taxon numbers would move, by how much, and which taxa still need
 * IUCN↔CoL name reconciliation (unresolved class/order names) before their
 * CoL count can be trusted.
 *
 * Run `npx tsx scripts/fetch-col-counts.ts` first to produce data/col-counts.json.
 *
 * Usage:
 *   npx tsx scripts/diff-col-vs-estimates.ts
 */

import * as fs from "fs";
import * as path from "path";
import { DATA_DIR } from "./utils";
import { TAXONOMY_TREE } from "../src/config/taxonomy-tree";

interface NameResult {
  name: string;
  resolved: boolean;
  speciesCount: number | null;
}
interface TaxonResult {
  taxonId: string;
  name: string;
  count: number;
  summedSubtrees: number;
  unresolvedNames: string[];
  names: NameResult[];
}
interface ColCounts {
  generatedAt: string;
  datasetTitle: string;
  datasetModified: string | null;
  all: number;
  taxa: Record<string, TaxonResult>;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function pct(col: number, est: number): string {
  if (est === 0) return "—";
  const d = ((col - est) / est) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}

function main() {
  const countsPath = path.join(DATA_DIR, "col-counts.json");
  if (!fs.existsSync(countsPath)) {
    console.error(`Missing ${countsPath}. Run: npx tsx scripts/fetch-col-counts.ts`);
    process.exit(1);
  }
  const counts: ColCounts = JSON.parse(fs.readFileSync(countsPath, "utf-8"));

  const topLevel = TAXONOMY_TREE.children ?? [];

  console.log(`CoL source : ${counts.datasetTitle} (modified ${counts.datasetModified ?? "?"})`);
  console.log(`Generated  : ${counts.generatedAt}\n`);

  const header = ["Group", "Current est.", "CoL count", "Δ", "Δ%", "Flags"];
  const widths = [22, 14, 12, 12, 9, 0];
  const pad = (s: string, w: number) => (w ? s.padEnd(w) : s);
  console.log(header.map((h, i) => pad(h, widths[i])).join(" "));
  console.log("-".repeat(90));

  let totalEst = 0;
  let totalCol = 0;
  const needsReconciliation: string[] = [];

  for (const node of topLevel) {
    const est = node.estimatedDescribed ?? 0;
    const r = counts.taxa[node.id];
    if (!r) continue;
    totalEst += est;
    totalCol += r.count;

    const flags: string[] = [];
    if (r.unresolvedNames.length) {
      flags.push(`unresolved: ${r.unresolvedNames.join(", ")}`);
      needsReconciliation.push(node.id);
    }

    const delta = r.count - est;
    const row = [
      pad(node.id, widths[0]),
      pad(fmt(est), widths[1]),
      pad(fmt(r.count), widths[2]),
      pad((delta >= 0 ? "+" : "") + fmt(delta), widths[3]),
      pad(pct(r.count, est), widths[4]),
      flags.join("; "),
    ];
    console.log(row.join(" "));
  }

  console.log("-".repeat(90));
  console.log(
    [
      pad("TOTAL", widths[0]),
      pad(fmt(totalEst), widths[1]),
      pad(fmt(totalCol), widths[2]),
      pad((totalCol - totalEst >= 0 ? "+" : "") + fmt(totalCol - totalEst), widths[3]),
      pad(pct(totalCol, totalEst), widths[4]),
      "",
    ].join(" "),
  );
  console.log(`\nRoot node "all" estimate: ${fmt(TAXONOMY_TREE.estimatedDescribed ?? 0)}  |  CoL total: ${fmt(counts.all)}`);

  if (needsReconciliation.length) {
    console.log(
      `\n⚠  ${needsReconciliation.length} taxa have unresolved IUCN→CoL names (counts undercount until ` +
        `reconciled): ${needsReconciliation.join(", ")}`,
    );
    console.log(
      "   These are synonym/naming differences (e.g. IUCN HETEROKONTOPHYTA → CoL Ochrophyta, " +
        "UDEONYCHOPHORA → Onychophora, ALCYONACEA → reclassified). A small synonym map closes the gap.",
    );
  }
}

main();
