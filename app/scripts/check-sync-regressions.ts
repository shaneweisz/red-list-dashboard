/**
 * check-sync-regressions: compare a fresh sync against the one currently live
 *
 * The last migration attempt lost a whole coral class, two insect orders and
 * 21 million records from a single bird, and every one of those was found by
 * hand, afterwards, by someone who happened to look. The fish group was checked
 * because a species was noticed; corals were not checked, so corals shipped.
 *
 * This makes that check a phase instead of an act of vigilance. It diffs the
 * per-group numbers against the live sync and reports every material move, so a
 * group collapsing is impossible to miss rather than merely unlikely to be.
 *
 * It compares against the sync R2 is currently serving (app/latest-sync.txt),
 * which is what users see, not against whatever happens to be on disk.
 *
 * Usage:
 *   npx tsx scripts/check-sync-regressions.ts                 # diff vs the live sync
 *   npx tsx scripts/check-sync-regressions.ts --baseline DIR  # diff vs a local directory
 */

import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";

/** A move smaller than this in either direction is noise, not news. */
const MATERIAL_CHANGE = 0.1;
/** Groups with fewer species than this move around for uninteresting reasons. */
const MIN_GROUP_SIZE = 20;

export interface GroupStats {
  taxonGroup: string;
  species: number;
  withKey: number;
  occurrences: number;
}

export interface GroupDelta {
  taxonGroup: string;
  metric: "species with GBIF data" | "occurrences";
  before: number;
  after: number;
  pctChange: number;
}

export async function readGroupStats(assessedParquet: string): Promise<GroupStats[]> {
  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();
  try {
    const reader = await conn.runAndReadAll(`
      SELECT taxon_group                                  AS taxonGroup,
             count(*)                                     AS species,
             count(gbif_species_key)                      AS withKey,
             coalesce(sum(gbif_occurrence_count), 0)      AS occurrences
      FROM '${assessedParquet}'
      GROUP BY 1 ORDER BY 1
    `);
    return reader.getRowObjects().map((r) => ({
      taxonGroup: String(r.taxonGroup),
      species: Number(r.species),
      withKey: Number(r.withKey),
      occurrences: Number(r.occurrences),
    }));
  } finally {
    conn.closeSync();
    inst.closeSync();
  }
}

export function compareStats(before: GroupStats[], after: GroupStats[]): GroupDelta[] {
  const beforeById = new Map(before.map((g) => [g.taxonGroup, g]));
  const deltas: GroupDelta[] = [];

  for (const now of after) {
    const was = beforeById.get(now.taxonGroup);
    if (!was) continue;

    // Gate on how many species the group had, not on the metric's own magnitude:
    // a four-species group still has hundreds of occurrence records, and judging
    // that number against a species-count threshold would let it through.
    if (was.withKey < MIN_GROUP_SIZE) continue;

    const metrics = [
      { metric: "species with GBIF data" as const, before: was.withKey, after: now.withKey },
      { metric: "occurrences" as const, before: was.occurrences, after: now.occurrences },
    ];
    for (const m of metrics) {
      if (m.before === 0) continue;
      const pctChange = (m.after - m.before) / m.before;
      if (Math.abs(pctChange) >= MATERIAL_CHANGE) {
        deltas.push({ taxonGroup: now.taxonGroup, ...m, pctChange });
      }
    }
  }

  // A group that disappeared entirely is the most severe thing this can find.
  for (const was of before) {
    if (!after.some((g) => g.taxonGroup === was.taxonGroup) && was.withKey >= MIN_GROUP_SIZE) {
      deltas.push({
        taxonGroup: was.taxonGroup,
        metric: "species with GBIF data",
        before: was.withKey,
        after: 0,
        pctChange: -1,
      });
    }
  }

  return deltas.sort((a, b) => a.pctChange - b.pctChange);
}

async function resolveBaseline(explicit?: string): Promise<string> {
  if (explicit) return path.join(explicit, "assessed.parquet");

  // Default to whatever is live, so the diff answers "what would merging change
  // for users" rather than "what changed since some local state".
  const pointer = path.join(DATA_DIR, "..", "latest-sync.txt");
  const sync = fs.readFileSync(pointer, "utf-8").trim();
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error("R2_ACCOUNT_ID not set — pass --baseline DIR to diff against a local directory instead.");
  return `s3://dashboard-data/syncs/${sync}/assessed.parquet`;
}

export async function run(): Promise<void> {
  const baselineIdx = process.argv.indexOf("--baseline");
  const baselineDir = baselineIdx >= 0 ? process.argv[baselineIdx + 1] : undefined;

  const baseline = await resolveBaseline(baselineDir);
  const current = path.join(DATA_DIR, "assessed.parquet");

  console.log(`baseline: ${baseline}`);
  console.log(`current:  ${current}\n`);

  const [before, after] = await Promise.all([readGroupStats(baseline), readGroupStats(current)]);
  const deltas = compareStats(before, after);

  const totals = (s: GroupStats[]) => ({
    withKey: s.reduce((n, g) => n + g.withKey, 0),
    occurrences: s.reduce((n, g) => n + g.occurrences, 0),
  });
  const t0 = totals(before);
  const t1 = totals(after);
  console.log(`species with GBIF data: ${t0.withKey.toLocaleString()} → ${t1.withKey.toLocaleString()}`);
  console.log(`occurrences:            ${t0.occurrences.toLocaleString()} → ${t1.occurrences.toLocaleString()}\n`);

  const regressions = deltas.filter((d) => d.pctChange < 0);
  const gains = deltas.filter((d) => d.pctChange > 0);

  if (regressions.length === 0) {
    console.log("No material per-group regressions.");
  } else {
    console.log(`${regressions.length} material regression(s):`);
    for (const d of regressions) {
      console.log(
        `  ${d.taxonGroup.padEnd(28)} ${d.metric.padEnd(24)} ` +
        `${d.before.toLocaleString()} → ${d.after.toLocaleString()}  (${(d.pctChange * 100).toFixed(1)}%)`
      );
    }
  }
  for (const d of gains) {
    console.log(
      `  gain  ${d.taxonGroup.padEnd(22)} ${d.metric.padEnd(24)} ` +
      `${d.before.toLocaleString()} → ${d.after.toLocaleString()}  (+${(d.pctChange * 100).toFixed(1)}%)`
    );
  }

  // Reported, not thrown: a taxonomy migration legitimately moves numbers, and a
  // human has to judge whether a given move is the intended one. The point is
  // that no move goes unseen.
  if (regressions.length > 0) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1]?.endsWith("check-sync-regressions.ts") ||
  process.argv[1]?.endsWith("check-sync-regressions.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
