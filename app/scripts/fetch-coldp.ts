/**
 * fetch-coldp (#271, Phase 3): download the Catalogue of Life eXtended Release (XR)
 * ColDP archive and extract NameUsage.tsv + Reference.tsv — the inputs to build-backbone.
 *
 * Downloads to a TEMP dir (outside data/) so the ~2.8GB TSVs are never swept into the
 * R2 upload; build-backbone reads them, then the sync removes the temp dir. Each XR
 * release gets its own numeric ChecklistBank dataset key (COL25.11 XR = 313100,
 * COL26.6 XR = 315557, …) — there's no rolling "latest" alias for XR the way "3LR"
 * rolls for the regular release, so resolveLatestXrDataset() below queries
 * ChecklistBank for the newest `origin=xrelease` dataset instead of hardcoding one.
 * A hardcoded key silently goes stale forever once written (caught #276: a sync
 * kept re-fetching a 7-month-old XR snapshot, showing real discrepancies vs the
 * live site for species added/reclassified since). Override via env COL_XR_DATASET
 * if a specific release is ever needed. Shells out to curl + unzip (streams a
 * 1.4GB zip to disk — too big for an in-memory fetch).
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

export interface ColdpPaths {
  dir: string;
  nameUsage: string;
  reference: string;
  xrDataset: XrDatasetInfo;
}

export interface XrDatasetInfo {
  key: string;
  alias: string;
  doi: string | null;
  issued: string | null;
}

// Looked up by key (COL_XR_DATASET override) or by the newest xrelease dataset — either
// way we still hit the API so the citation metadata (alias/doi/issued) below is always
// accurate, not just the key.
export async function resolveXrDataset(): Promise<XrDatasetInfo> {
  const overrideKey = process.env.COL_XR_DATASET;
  const res = overrideKey
    ? await fetch(`https://api.checklistbank.org/dataset/${overrideKey}`)
    : await fetch("https://api.checklistbank.org/dataset?origin=xrelease&limit=1&sortBy=created");
  if (!res.ok) throw new Error(`resolveXrDataset: ChecklistBank lookup failed: ${res.status}`);
  const body = await res.json();
  const ds = overrideKey ? body : body.result?.[0];
  if (!ds) throw new Error("resolveXrDataset: no xrelease datasets returned");
  return { key: String(ds.key), alias: ds.alias, doi: ds.doi ?? null, issued: ds.issued ?? null };
}

// Citation metadata for the exact XR release the "described species" universe is built
// from — checked into git (like col-taxon-ids.json) so the frontend's "Source" link
// cites and links to the specific dataset version, not a generic/dateless CoL homepage
// link that silently goes stale as new releases ship.
export function writeReleaseMetadata(xr: XrDatasetInfo): void {
  const outPath = path.join(__dirname, "../src/config/col-release.json");
  fs.writeFileSync(outPath, JSON.stringify(xr, null, 2) + "\n");
  console.log(`fetch-coldp: wrote ${outPath} (${xr.alias}, ${xr.key})`);
}

export async function run(opts: { destDir?: string } = {}): Promise<ColdpPaths> {
  const xr = await resolveXrDataset();
  const XR_DATASET = xr.key;
  writeReleaseMetadata(xr);
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
  return { dir: destDir, nameUsage, reference, xrDataset: xr };
}

const isDirectRun = process.argv[1]?.endsWith("fetch-coldp.ts") || process.argv[1]?.endsWith("fetch-coldp.js");
if (isDirectRun) {
  loadEnvFiles();
  run().then((p) => console.log(`${p.nameUsage}\n${p.reference}`)).catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
