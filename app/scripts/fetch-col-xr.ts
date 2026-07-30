/**
 * fetch-col-xr (#271, Phase 3): download the Catalogue of Life eXtended Release (XR)
 * ColDP archive and extract NameUsage.tsv + Reference.tsv + VernacularName.tsv — the
 * inputs to build-backbone.
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
 * VernacularName.tsv (taxonID → common name, ~2M rows across all ranks) powers
 * order/family/genus-level common names in the dynamic taxonomic drilldown
 * (dynamic-taxon.ts) — species already get a common name from our own Red
 * List/GBIF data, so build-backbone only extracts the higher-rank subset.
 *
 * Returns the paths to the extracted TSVs (and their shared temp dir).
 *
 *   npx tsx scripts/fetch-col-xr.ts        # downloads + prints the TSV paths
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { loadEnvFiles } from "./utils";

export interface ColXrPaths {
  dir: string;
  nameUsage: string;
  reference: string;
  vernacularNames: string;
  xrDataset: XrDatasetInfo;
}

export interface XrDatasetInfo {
  key: string;
  alias: string;
  doi: string | null;
  issued: string | null;
}

/**
 * The Catalogue of Life release GBIF's occurrence index is built on.
 *
 * NOT the newest release, which is what this used to fetch. GBIF promotes each
 * CoL release to production roughly three weeks after CoL publishes it, so the
 * newest release is normally one ahead of the one GBIF is actually serving. Since
 * CoL renumbers usage ids for names whose authorship changes — around 2% per
 * release — being one ahead means a slice of GBIF's occurrence keys resolve to
 * nothing locally. Measured on this data: 504 assessed and 9,092 unassessed keys
 * unresolvable against the newest release, and zero against the indexed one.
 *
 * GBIF publishes which release it runs, though not where you would first look:
 * the dataset record's top-level `doi` tracks the newest crawl and is misleading,
 * while `/v2/species/match/metadata` reports the live index directly.
 */
async function resolveIndexedRelease(): Promise<string | null> {
  try {
    const res = await fetch("https://api.gbif.org/v2/species/match/metadata?checklistKey=xcol");
    if (!res.ok) return null;
    const body = (await res.json()) as { mainIndex?: { clbDatasetKey?: string; datasetAlias?: string } };
    const key = body.mainIndex?.clbDatasetKey;
    if (key) {
      console.log(`fetch-col-xr: GBIF's occurrence index runs ${body.mainIndex?.datasetAlias ?? "?"} (${key})`);
    }
    return key ?? null;
  } catch {
    return null;
  }
}

// Resolved in priority order: an explicit COL_XR_DATASET override, then the
// release GBIF indexes, then — only if GBIF cannot be asked — the newest release,
// which is a guess rather than an answer and says so.
export async function resolveXrDataset(): Promise<XrDatasetInfo> {
  const overrideKey = process.env.COL_XR_DATASET ?? (await resolveIndexedRelease());
  if (!process.env.COL_XR_DATASET && !overrideKey) {
    console.warn(
      "fetch-col-xr: could not determine which release GBIF indexes; falling back to the newest, " +
      "which will leave some GBIF keys unresolvable locally."
    );
  }
  const res = overrideKey
    ? await fetch(`https://api.checklistbank.org/dataset/${overrideKey}`)
    : await fetch("https://api.checklistbank.org/dataset?origin=xrelease&limit=1&sortBy=created");
  if (!res.ok) throw new Error(`resolveXrDataset: ChecklistBank lookup failed: ${res.status}`);
  const body = await res.json();
  const ds = overrideKey ? body : body.result?.[0];
  if (!ds) throw new Error("resolveXrDataset: no xrelease datasets returned");
  return { key: String(ds.key), alias: ds.alias, doi: ds.doi ?? null, issued: ds.issued ?? null };
}

/**
 * Whether the CoL archive on disk already matches the release we want.
 *
 * GBIF moves about once a month; this job runs weekly. Re-downloading a 3.4GB
 * archive to rebuild an identical backbone is most of the sync's wall-clock time
 * for no change at all, so a matching release id is grounds for skipping it —
 * and a changed one is exactly the signal that keys must be re-resolved.
 */
export function currentReleaseOnDisk(): string | null {
  try {
    const p = path.join(__dirname, "../src/config/col-release.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")).key ?? null;
  } catch {
    return null;
  }
}

// Citation metadata for the exact XR release the "described species" universe is built
// from — checked into git (like col-taxon-ids.json) so the frontend's "Source" link
// cites and links to the specific dataset version, not a generic/dateless CoL homepage
// link that silently goes stale as new releases ship.
export function writeReleaseMetadata(xr: XrDatasetInfo): void {
  const outPath = path.join(__dirname, "../src/config/col-release.json");
  fs.writeFileSync(outPath, JSON.stringify(xr, null, 2) + "\n");
  console.log(`fetch-col-xr: wrote ${outPath} (${xr.alias}, ${xr.key})`);
}

export async function run(opts: { destDir?: string } = {}): Promise<ColXrPaths> {
  const xr = await resolveXrDataset();
  const XR_DATASET = xr.key;
  writeReleaseMetadata(xr);
  const destDir = opts.destDir || fs.mkdtempSync(path.join(os.tmpdir(), "coldp-xr-"));
  fs.mkdirSync(destDir, { recursive: true });
  const zip = path.join(destDir, "coldp_xr.zip");
  const url = `https://api.checklistbank.org/dataset/${XR_DATASET}/export.zip?format=ColDP&extended=true`;

  console.log(`fetch-col-xr: downloading XR (${XR_DATASET}) ColDP export…`);
  execFileSync("curl", ["-fsSL", url, "-o", zip], { stdio: ["ignore", "inherit", "inherit"] });
  console.log("fetch-col-xr: extracting NameUsage.tsv + Reference.tsv + VernacularName.tsv…");
  execFileSync("unzip", ["-o", zip, "NameUsage.tsv", "Reference.tsv", "VernacularName.tsv", "-d", destDir], { stdio: ["ignore", "inherit", "inherit"] });
  fs.rmSync(zip, { force: true });

  const nameUsage = path.join(destDir, "NameUsage.tsv");
  const reference = path.join(destDir, "Reference.tsv");
  const vernacularNames = path.join(destDir, "VernacularName.tsv");
  if (!fs.existsSync(nameUsage)) throw new Error("fetch-col-xr: NameUsage.tsv missing after extraction");
  if (!fs.existsSync(reference)) throw new Error("fetch-col-xr: Reference.tsv missing after extraction");
  if (!fs.existsSync(vernacularNames)) throw new Error("fetch-col-xr: VernacularName.tsv missing after extraction");
  console.log(`fetch-col-xr: wrote ${nameUsage} (${(fs.statSync(nameUsage).size / 1024 / 1024).toFixed(0)} MB)`);
  console.log(`fetch-col-xr: wrote ${reference} (${(fs.statSync(reference).size / 1024 / 1024).toFixed(0)} MB)`);
  console.log(`fetch-col-xr: wrote ${vernacularNames} (${(fs.statSync(vernacularNames).size / 1024 / 1024).toFixed(0)} MB)`);
  return { dir: destDir, nameUsage, reference, vernacularNames, xrDataset: xr };
}

const isDirectRun = process.argv[1]?.endsWith("fetch-col-xr.ts") || process.argv[1]?.endsWith("fetch-col-xr.js");
if (isDirectRun) {
  loadEnvFiles();
  run().then((p) => console.log(`${p.nameUsage}\n${p.reference}\n${p.vernacularNames}`)).catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
