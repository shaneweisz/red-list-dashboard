/**
 * fetch-col-checklist (#271, Phase 3): download the CURATED Catalogue of Life
 * Checklist (ChecklistBank dataset `3LR`) as an EXTENDED ColDP archive and extract
 * NameUsage.tsv — the input to build-backbone's demotion overlay.
 *
 * Why: our species universe is built from the CoL eXtended Release (XR, see
 * fetch-col-xr), which maximizes coverage but does NOT reconcile conflicting source
 * taxonomies — so it over-splits, surfacing contested splits as accepted species
 * that become spurious "Not Evaluated" rows (e.g. Pycnonotus tricolor, an accepted
 * species in XR but a synonym of the assessed P. barbatus in the curated checklist).
 * The curated checklist applies CoL's editorial reconciliation. We use it as a
 * CORRECTION OVERLAY, not the base: build-backbone drops from the XR universe any
 * col_id the curated checklist DEMOTES (to synonym/infraspecific). Curated silence
 * never deletes coverage (so groups XR has but the checklist lacks — e.g. macroalgae,
 * whose AlgaeBase GSD isn't in the curated assembly — are preserved); only curated
 * contradiction does. col_ids are shared across both datasets, so the join is exact
 * WHERE BOTH CARRY THE USAGE — but the release is NOT a subset of the XR: 94,728 of
 * its 5.4M usages have no XR row (measured, COL26.6 XR vs 3LR). Harmless for
 * demotion, which only ever removes; it does mean anything keyed off an XR row
 * cannot see those usages (see build-backbone's in_checklist).
 *
 * We only need col:ID/status/rank/scientificName, which the smaller SIMPLE archive
 * (~166MB vs ~1.8GB extended) also carries — but ChecklistBank only serves a GET
 * export.zip if that exact archive is already pre-built, and won't build one on
 * demand for anonymous requests (a fresh build needs a token we don't have). CoL
 * reliably pre-builds the extended archive alongside every release but the simple
 * one lags by a few days each month, so a sync running in that window 404s (caught
 * via a weekly-sync failure right after `3LR` rolled to a new release; fetch-col-xr
 * below has always requested extended for the same reason and never hit this). So
 * always request extended — the smaller archive isn't safe to depend on. `3LR` is
 * the rolling latest CoL release, swappable via env COL_CHECKLIST_DATASET.
 *
 * Downloads to a TEMP dir (outside data/) so the TSV is never swept into the R2
 * upload; build-backbone reads it, then the sync removes the temp dir.
 *
 * Returns the path to the extracted NameUsage.tsv.
 *
 *   npx tsx scripts/fetch-col-checklist.ts        # downloads + prints the TSV path
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { loadEnvFiles } from "./utils";

const CHECKLIST_DATASET = process.env.COL_CHECKLIST_DATASET || "3LR";

export async function run(opts: { destDir?: string } = {}): Promise<string> {
  const destDir = opts.destDir || fs.mkdtempSync(path.join(os.tmpdir(), "col-checklist-"));
  fs.mkdirSync(destDir, { recursive: true });
  const zip = path.join(destDir, "checklist.zip");
  const url = `https://api.checklistbank.org/dataset/${CHECKLIST_DATASET}/export.zip?format=ColDP&extended=true`;

  console.log(`fetch-col-checklist: downloading curated CoL Checklist (${CHECKLIST_DATASET}) ColDP export…`);
  execFileSync("curl", ["-fsSL", url, "-o", zip], { stdio: ["ignore", "inherit", "inherit"] });
  console.log("fetch-col-checklist: extracting NameUsage.tsv…");
  execFileSync("unzip", ["-o", zip, "NameUsage.tsv", "-d", destDir], { stdio: ["ignore", "inherit", "inherit"] });
  fs.rmSync(zip, { force: true });

  const tsv = path.join(destDir, "NameUsage.tsv");
  if (!fs.existsSync(tsv)) throw new Error("fetch-col-checklist: NameUsage.tsv missing after extraction");
  console.log(`fetch-col-checklist: wrote ${tsv} (${(fs.statSync(tsv).size / 1024 / 1024).toFixed(0)} MB)`);
  return tsv;
}

const isDirectRun = process.argv[1]?.endsWith("fetch-col-checklist.ts") || process.argv[1]?.endsWith("fetch-col-checklist.js");
if (isDirectRun) {
  loadEnvFiles();
  run().then((tsv) => console.log(tsv)).catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
