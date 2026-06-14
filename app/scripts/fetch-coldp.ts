/**
 * fetch-coldp (#271, Phase 3): download the Catalogue of Life eXtended Release (XR)
 * ColDP archive and extract NameUsage.tsv + Reference.tsv — the inputs to build-backbone.
 *
 * Downloads to a TEMP dir (outside data/) so the ~2.8GB TSVs are never swept into the
 * R2 upload; build-backbone reads them, then the sync removes the temp dir. XR ≈
 * ChecklistBank dataset 313100 ("COL25.11 XR"), a swappable pinned dep (env
 * COL_XR_DATASET). Shells out to curl + unzip (streams a 1.4GB zip to disk — too
 * big for an in-memory fetch).
 *
 * Reference.tsv (the cited-publication table) carries each reference's `col:issued`
 * date; build-backbone joins it via a name's `col:nameReferenceID` to recover the
 * described year for botanical/fungal names, whose author citations omit the year
 * (the zoological author-year columns cover the animal side).
 *
 * Returns the paths to the extracted TSVs (and their shared temp dir).
 *
 *   npx tsx scripts/fetch-coldp.ts        # downloads + prints the TSV paths
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { loadEnvFiles } from "./utils";

const XR_DATASET = process.env.COL_XR_DATASET || "313100";

export interface ColdpPaths {
  dir: string;
  nameUsage: string;
  reference: string;
}

export async function run(opts: { destDir?: string } = {}): Promise<ColdpPaths> {
  const destDir = opts.destDir || fs.mkdtempSync(path.join(os.tmpdir(), "coldp-xr-"));
  fs.mkdirSync(destDir, { recursive: true });
  const zip = path.join(destDir, "coldp_xr.zip");
  const url = `https://api.checklistbank.org/dataset/${XR_DATASET}/export.zip?format=ColDP&extended=true`;

  console.log(`fetch-coldp: downloading XR (${XR_DATASET}) ColDP export…`);
  execFileSync("curl", ["-fsSL", url, "-o", zip], { stdio: ["ignore", "inherit", "inherit"] });
  console.log("fetch-coldp: extracting NameUsage.tsv + Reference.tsv…");
  execFileSync("unzip", ["-o", zip, "NameUsage.tsv", "Reference.tsv", "-d", destDir], { stdio: ["ignore", "inherit", "inherit"] });
  fs.rmSync(zip, { force: true });

  const nameUsage = path.join(destDir, "NameUsage.tsv");
  const reference = path.join(destDir, "Reference.tsv");
  if (!fs.existsSync(nameUsage)) throw new Error("fetch-coldp: NameUsage.tsv missing after extraction");
  if (!fs.existsSync(reference)) throw new Error("fetch-coldp: Reference.tsv missing after extraction");
  console.log(`fetch-coldp: wrote ${nameUsage} (${(fs.statSync(nameUsage).size / 1024 / 1024).toFixed(0)} MB)`);
  console.log(`fetch-coldp: wrote ${reference} (${(fs.statSync(reference).size / 1024 / 1024).toFixed(0)} MB)`);
  return { dir: destDir, nameUsage, reference };
}

const isDirectRun = process.argv[1]?.endsWith("fetch-coldp.ts") || process.argv[1]?.endsWith("fetch-coldp.js");
if (isDirectRun) {
  loadEnvFiles();
  run().then((p) => console.log(`${p.nameUsage}\n${p.reference}`)).catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
