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

import { execFileSync } from "child_process";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";

/** A move smaller than this in either direction is noise, not news. */
const MATERIAL_CHANGE = 0.1;
/**
 * Below these counts a metric moves around for uninteresting reasons. Occurrence
 * totals get a higher floor because even a handful of species carries thousands
 * of records, and a percentage of a small number is noise.
 */
const MIN_SAMPLE_FOR: Record<GroupDelta["metric"], number> = {
  "species with GBIF data": 20,
  "occurrences": 5000,
  "browsable species": 50,
  "common names": 50,
  "CoL described species": 50,
};

export interface GroupStats {
  taxonGroup: string;
  species: number;
  withKey: number;
  occurrences: number;
  /** Unassessed species in this group, and how many carry a common name. */
  unassessed: number;
  unassessedNamed: number;
  /**
   * The described denominator every "% assessed" figure divides by, read from
   * taxa-summary.json rather than the parquets — it comes from the CoL universe
   * (species/), which the parquets know nothing about. Two releases of curated
   * checklist reconciliation moved it in 22 of 28 groups and nothing was
   * watching, because every metric here was GBIF-derived.
   */
  colDescribed: number;
}

export interface GroupDelta {
  taxonGroup: string;
  metric: "species with GBIF data" | "occurrences" | "browsable species" | "common names" | "CoL described species";
  before: number;
  after: number;
  pctChange: number;
}

/**
 * Per-group numbers for both halves of the dataset.
 *
 * The unassessed side was originally left out, and it is 75% of the rows and the
 * whole browsing experience — a group collapsing there was invisible to every
 * guard. Common-name coverage is counted for the same reason: 88,573 names went
 * to zero once and nothing noticed, because nothing was counting.
 */
export async function readGroupStats(assessedParquet: string): Promise<GroupStats[]> {
  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();
  try {
    if (assessedParquet.startsWith("s3://")) await configureR2(conn);
    const unassessedParquet = assessedParquet.replace(/assessed\.parquet$/, "unassessed.parquet");
    const reader = await conn.runAndReadAll(`
      WITH a AS (
        SELECT taxon_group,
               count(*)                                AS species,
               count(gbif_species_key)                 AS withKey,
               coalesce(sum(gbif_occurrence_count), 0) AS occurrences
        FROM '${assessedParquet}' GROUP BY 1
      ), u AS (
        SELECT taxon_group,
               count(*)                                AS unassessed,
               count(NULLIF(common_name, ''))          AS unassessedNamed
        FROM '${unassessedParquet}' GROUP BY 1
      )
      SELECT coalesce(a.taxon_group, u.taxon_group) AS taxonGroup,
             coalesce(a.species, 0) AS species,
             coalesce(a.withKey, 0) AS withKey,
             coalesce(a.occurrences, 0) AS occurrences,
             coalesce(u.unassessed, 0) AS unassessed,
             coalesce(u.unassessedNamed, 0) AS unassessedNamed
      FROM a FULL OUTER JOIN u ON u.taxon_group = a.taxon_group
      ORDER BY 1
    `);
    // col_described lives in taxa-summary.json beside the parquets, in both a
    // local sync directory and an R2 prefix. Absent (an older sync, or a partial
    // run) leaves it 0, which MIN_SAMPLE_FOR then skips — a metric we cannot read
    // must not read as a collapse to zero.
    const summaryPath = assessedParquet.replace(/assessed\.parquet$/, "taxa-summary.json");
    const described = new Map<string, number>();
    try {
      const rows = await (await conn.runAndReadAll(
        `SELECT table1a_taxon_group AS g, col_described AS n FROM read_json_auto('${summaryPath}')`
      )).getRowObjects();
      for (const r of rows) if (r.g != null && r.n != null) described.set(String(r.g), Number(r.n));
    } catch {
      console.warn(`  (no taxa-summary.json beside ${assessedParquet} — CoL described species not compared)`);
    }
    return reader.getRowObjects().map((r) => ({
      taxonGroup: String(r.taxonGroup),
      species: Number(r.species),
      withKey: Number(r.withKey),
      occurrences: Number(r.occurrences),
      unassessed: Number(r.unassessed),
      unassessedNamed: Number(r.unassessedNamed),
      colDescribed: described.get(String(r.taxonGroup)) ?? 0,
    }));
  } finally {
    conn.closeSync();
    inst.closeSync();
  }
}

/**
 * A metric that moved the SAME WAY in nearly every group, however slightly.
 *
 * MATERIAL_CHANGE is a magnitude test, deliberately set at 10% to catch a group
 * collapsing. It is blind to the other way a sync goes wrong: every group nudging
 * together, which is not noise but a systematic shift — a changed input applied
 * everywhere at once. Two releases of curated-checklist reconciliation moved 22
 * of 28 groups' described counts down and none up, a total of 0.11%, and passed
 * the magnitude test a hundred times over while being exactly the kind of change
 * someone should be told about before it ships.
 *
 * Noise is symmetric; a real shift is not. So this tests consistency of DIRECTION
 * rather than size.
 */
export interface SystematicDrift {
  metric: GroupDelta["metric"];
  groupsDown: number;
  groupsUp: number;
  before: number;
  after: number;
  pctChange: number;
}

/** Enough groups to make one-sidedness mean something rather than be a small sample. */
const MIN_GROUPS_FOR_DRIFT = 8;
/** How one-sided it has to be. Below this, groups disagreeing IS the noise. */
const DRIFT_CONSENSUS = 0.9;
/** Under this the totals are not moving at all, and rounding dominates. */
const DRIFT_MIN_TOTAL_PCT = 0.0005;

export function detectSystematicDrift(before: GroupStats[], after: GroupStats[]): SystematicDrift[] {
  const beforeById = new Map(before.map((g) => [g.taxonGroup, g]));
  const metrics: [GroupDelta["metric"], (g: GroupStats) => number][] = [
    ["species with GBIF data", (g) => g.withKey],
    ["occurrences", (g) => g.occurrences],
    ["browsable species", (g) => g.unassessed],
    ["common names", (g) => g.unassessedNamed],
    ["CoL described species", (g) => g.colDescribed],
  ];
  const out: SystematicDrift[] = [];
  for (const [metric, read] of metrics) {
    let down = 0, up = 0, sumBefore = 0, sumAfter = 0;
    for (const now of after) {
      const was = beforeById.get(now.taxonGroup);
      if (!was) continue;
      const b = read(was), a2 = read(now);
      sumBefore += b; sumAfter += a2;
      if (a2 < b) down++; else if (a2 > b) up++;
    }
    const moved = down + up;
    if (moved < MIN_GROUPS_FOR_DRIFT || sumBefore === 0) continue;
    const consensus = Math.max(down, up) / moved;
    const pctChange = (sumAfter - sumBefore) / sumBefore;
    if (consensus >= DRIFT_CONSENSUS && Math.abs(pctChange) >= DRIFT_MIN_TOTAL_PCT) {
      out.push({ metric, groupsDown: down, groupsUp: up, before: sumBefore, after: sumAfter, pctChange });
    }
  }
  return out;
}

export function compareStats(before: GroupStats[], after: GroupStats[]): GroupDelta[] {
  const beforeById = new Map(before.map((g) => [g.taxonGroup, g]));
  const deltas: GroupDelta[] = [];

  for (const now of after) {
    const was = beforeById.get(now.taxonGroup);
    if (!was) continue;

    const metrics = [
      { metric: "species with GBIF data" as const, before: was.withKey, after: now.withKey },
      { metric: "occurrences" as const, before: was.occurrences, after: now.occurrences },
      { metric: "browsable species" as const, before: was.unassessed, after: now.unassessed },
      { metric: "common names" as const, before: was.unassessedNamed, after: now.unassessedNamed },
      { metric: "CoL described species" as const, before: was.colDescribed, after: now.colDescribed },
    ];
    for (const m of metrics) {
      // Each metric is judged against its own scale. Gating the whole group on
      // its assessed-species count hid exactly the case worth catching: brown
      // algae has 18 assessed species but 6,381 browsable ones, so a group-level
      // floor of 20 discarded a collapse of the larger number.
      if (m.before < MIN_SAMPLE_FOR[m.metric]) continue;
      const pctChange = (m.after - m.before) / m.before;
      if (Math.abs(pctChange) >= MATERIAL_CHANGE) {
        deltas.push({ taxonGroup: now.taxonGroup, ...m, pctChange });
      }
    }
  }

  // A group that disappeared entirely is the most severe thing this can find.
  for (const was of before) {
    if (!after.some((g) => g.taxonGroup === was.taxonGroup) && was.withKey >= MIN_SAMPLE_FOR["species with GBIF data"]) {
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

/**
 * Point DuckDB at R2 rather than AWS.
 *
 * Without this an s3:// path resolves to s3.amazonaws.com and 403s — which is
 * exactly what this check did in its default configuration, while sync.ts caught
 * the error and logged "skipped". A guard against silent failure that fails
 * silently is worse than no guard, because it reads as a pass.
 */
async function configureR2(conn: Awaited<ReturnType<DuckDBInstance["connect"]>>): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "check-sync-regressions: R2 credentials missing (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
      "R2_SECRET_ACCESS_KEY). Pass --baseline DIR to diff against a local directory instead."
    );
  }
  await conn.run(`INSTALL httpfs; LOAD httpfs;`);
  await conn.run(`
    CREATE OR REPLACE SECRET r2_baseline (
      TYPE S3,
      KEY_ID '${accessKeyId}',
      SECRET '${secretAccessKey}',
      ENDPOINT '${accountId}.r2.cloudflarestorage.com',
      REGION 'auto',
      URL_STYLE 'path'
    );
  `);
}

async function resolveBaseline(explicit?: string): Promise<string> {
  if (explicit) return path.join(explicit, "assessed.parquet");

  // The baseline is the pointer on main, not the one in this working tree.
  //
  // A branch that has already run an upload has bumped its own latest-sync.txt,
  // so reading the local file compares the new sync against itself and reports a
  // serene set of zero changes — which is what happened the first time this ran.
  // main is what users are being served, and "what would merging change for them"
  // is the only question worth asking here.
  const sync = execFileSync("git", ["show", "origin/main:app/latest-sync.txt"], {
    encoding: "utf-8",
    cwd: path.join(DATA_DIR, ".."),
  }).trim();
  const bucket = process.env.R2_DATA_BUCKET_NAME ?? "dashboard-data";
  return `s3://${bucket}/syncs/${sync}/assessed.parquet`;
}

export async function run(): Promise<{ deltas: GroupDelta[]; regressions: GroupDelta[]; drifts: SystematicDrift[] }> {
  const baselineIdx = process.argv.indexOf("--baseline");
  const baselineDir = baselineIdx >= 0 ? process.argv[baselineIdx + 1] : undefined;

  const baseline = await resolveBaseline(baselineDir);
  const current = path.join(DATA_DIR, "assessed.parquet");

  console.log(`baseline: ${baseline}`);
  console.log(`current:  ${current}\n`);

  const [before, after] = await Promise.all([readGroupStats(baseline), readGroupStats(current)]);
  const deltas = compareStats(before, after);
  const drifts = detectSystematicDrift(before, after);

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

  if (drifts.length) {
    console.log("\nSystematic drift (below the per-group threshold, but one-directional):");
    for (const d of drifts) {
      console.log(
        `  ${d.metric.padEnd(24)} ${d.before.toLocaleString()} → ${d.after.toLocaleString()}  ` +
        `(${(d.pctChange * 100).toFixed(2)}%, down in ${d.groupsDown} groups, up in ${d.groupsUp})`
      );
    }
  }

  // Reported, not thrown: a taxonomy migration legitimately moves numbers, and a
  // human has to judge whether a given move is the intended one. The point is
  // that no move goes unseen. The caller decides what to do about it — this
  // deliberately does not set process.exitCode, which would fail an otherwise
  // successful sync before it reaches the upload step.
  return { deltas, regressions, drifts };
}

const isDirectRun =
  process.argv[1]?.endsWith("check-sync-regressions.ts") ||
  process.argv[1]?.endsWith("check-sync-regressions.js");
if (isDirectRun) {
  loadEnvFiles();
  run()
    .then(({ regressions }) => {
      if (regressions.length > 0) process.exitCode = 1;
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
