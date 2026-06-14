/**
 * fetch-col-checklist (#271, Phase 3): download the CURATED Catalogue of Life
 * Checklist (ChecklistBank dataset `3LR`) as a SIMPLE ColDP archive and extract
 * NameUsage.tsv — the input to build-backbone's demotion overlay.
 *
 * Why: our species universe is built from the CoL eXtended Release (XR, see
 * fetch-coldp), which maximizes coverage but does NOT reconcile conflicting source
 * taxonomies — so it over-splits, surfacing contested splits as accepted species
 * that become spurious "Not Evaluated" rows (e.g. Pycnonotus tricolor, an accepted
 * species in XR but a synonym of the assessed P. barbatus in the curated checklist).
 * The curated checklist applies CoL's editorial reconciliation. We use it as a
 * CORRECTION OVERLAY, not the base: build-backbone drops from the XR universe any
 * col_id the curated checklist DEMOTES (to synonym/infraspecific). Curated silence
 * never deletes coverage (so groups XR has but the checklist lacks — e.g. macroalgae,
 * whose AlgaeBase GSD isn't in the curated assembly — are preserved); only curated
 * contradiction does. col_ids are shared across both datasets, so the join is exact.
 *
 * The SIMPLE export (~166MB) carries col:ID/status/rank/scientificName — all we need
 * for the denylist; no need for the 1GB extended export. `3LR` is the rolling latest
 * CoL release, swappable via env COL_CHECKLIST_DATASET.
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
  const url = `https://api.checklistbank.org/dataset/${CHECKLIST_DATASET}/export.zip?format=ColDP`;

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
