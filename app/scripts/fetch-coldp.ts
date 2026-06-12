/**
 * fetch-coldp (#271, Phase 3): download the Catalogue of Life eXtended Release (XR)
 * ColDP archive and extract NameUsage.tsv — the input to build-backbone.
 *
 * Downloads to a TEMP dir (outside data/) so the ~2.8GB TSV is never swept into the
 * R2 upload; build-backbone reads it, then the sync removes the temp dir. XR ≈
 * ChecklistBank dataset 313100 ("COL25.11 XR"), a swappable pinned dep (env
 * COL_XR_DATASET). Shells out to curl + unzip (streams a 1.4GB zip to disk — too
 * big for an in-memory fetch).
 *
 * Returns the path to the extracted NameUsage.tsv.
 *
 *   npx tsx scripts/fetch-coldp.ts        # downloads + prints the TSV path
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { loadEnvFiles } from "./utils";

const XR_DATASET = process.env.COL_XR_DATASET || "313100";

export async function run(opts: { destDir?: string } = {}): Promise<string> {
  const destDir = opts.destDir || fs.mkdtempSync(path.join(os.tmpdir(), "coldp-xr-"));
  fs.mkdirSync(destDir, { recursive: true });
  const zip = path.join(destDir, "coldp_xr.zip");
  const url = `https://api.checklistbank.org/dataset/${XR_DATASET}/export.zip?format=ColDP&extended=true`;

  console.log(`fetch-coldp: downloading XR (${XR_DATASET}) ColDP export…`);
  execFileSync("curl", ["-fsSL", url, "-o", zip], { stdio: ["ignore", "inherit", "inherit"] });
  console.log("fetch-coldp: extracting NameUsage.tsv…");
  execFileSync("unzip", ["-o", zip, "NameUsage.tsv", "-d", destDir], { stdio: ["ignore", "inherit", "inherit"] });
  fs.rmSync(zip, { force: true });

  const tsv = path.join(destDir, "NameUsage.tsv");
  if (!fs.existsSync(tsv)) throw new Error("fetch-coldp: NameUsage.tsv missing after extraction");
  console.log(`fetch-coldp: wrote ${tsv} (${(fs.statSync(tsv).size / 1024 / 1024).toFixed(0)} MB)`);
  return tsv;
}

const isDirectRun = process.argv[1]?.endsWith("fetch-coldp.ts") || process.argv[1]?.endsWith("fetch-coldp.js");
if (isDirectRun) {
  loadEnvFiles();
  run().then((tsv) => console.log(tsv)).catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
