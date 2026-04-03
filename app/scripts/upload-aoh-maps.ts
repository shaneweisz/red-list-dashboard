/**
 * upload-aoh-maps: Pre-rendered AOH PNGs → Cloudflare R2
 *
 * Reads AOH GeoTIFFs from the STAR pipeline output directory, reprojects
 * from Mollweide to WGS84, renders as PNG, and uploads to R2 alongside
 * metadata JSON (bounds + AOH stats).
 *
 * This eliminates the need for runtime GDAL on Vercel — the API routes
 * become simple R2 fetches.
 *
 * Prerequisites:
 *   1. STAR pipeline output in /scratch/sw984/star/aohs/current/
 *   2. GDAL tools (gdalwarp, gdal_translate, gdalinfo) on PATH
 *   3. Environment variables: R2_*
 *
 * Usage:
 *   npx tsx scripts/upload-aoh-maps.ts                    # all taxa
 *   npx tsx scripts/upload-aoh-maps.ts mammalia aves      # specific taxa
 *   npx tsx scripts/upload-aoh-maps.ts --ids 10009        # specific sis_taxon_ids
 *   npx tsx scripts/upload-aoh-maps.ts mammalia --force   # re-upload all
 */

import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { loadEnvFiles, SyncLogger } from "./utils";
import { execFileSync } from "child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const R2_PREFIX = "aoh-maps";
const STAR_DATA_DIR = "/scratch/sw984/star";
const MAX_SIZE = 4096; // Max pixel dimension for output PNG

const TAXON_GROUPS = ["MAMMALIA", "AVES", "REPTILIA", "AMPHIBIA"] as const;

const TAXON_GROUP_LOWER: Record<string, string> = {
  mammalia: "MAMMALIA",
  aves: "AVES",
  reptilia: "REPTILIA",
  amphibia: "AMPHIBIA",
};

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function listExistingKeys(r2: S3Client, bucket: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let continuationToken: string | undefined;

  do {
    const response = await r2.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${R2_PREFIX}/`,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.add(obj.Key);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

function getWgs84Bounds(tifPath: string): [number, number, number, number] {
  const stdout = execFileSync("gdalinfo", ["-json", tifPath], { encoding: "utf-8" });
  const info = JSON.parse(stdout);
  if (info.wgs84Extent) {
    const coords = info.wgs84Extent.coordinates[0];
    const lons = coords.map((c: number[]) => c[0]);
    const lats = coords.map((c: number[]) => c[1]);
    return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
  }
  const cc = info.cornerCoordinates;
  return [cc.lowerRight[1], cc.upperLeft[0], cc.upperLeft[1], cc.lowerRight[0]];
}

function renderAohPng(
  tifPath: string,
  tmpDir: string,
): { pngBuffer: Buffer; bounds: [number, number, number, number] } {
  const warpedPath = join(tmpDir, "warped.tif");
  const pngPath = join(tmpDir, "aoh.png");

  // Step 1: Reproject Mollweide → WGS84, cap pixel size
  const warpArgs = [
    "-t_srs", "EPSG:4326",
    "-r", "near",
    "-co", "COMPRESS=LZW",
    "-overwrite",
  ];

  // Check source dimensions and cap if needed
  const infoOut = execFileSync("gdalinfo", ["-json", tifPath], { encoding: "utf-8" });
  const info = JSON.parse(infoOut);
  const srcWidth = info.size[0];
  const srcHeight = info.size[1];
  const longest = Math.max(srcWidth, srcHeight);
  if (longest > MAX_SIZE) {
    const scale = MAX_SIZE / longest;
    warpArgs.push("-ts", String(Math.round(srcWidth * scale)), String(Math.round(srcHeight * scale)));
  }

  warpArgs.push(tifPath, warpedPath);
  execFileSync("gdalwarp", warpArgs);

  // Step 2: Get WGS84 bounds from warped file
  const bounds = getWgs84Bounds(warpedPath);

  // Step 3: Render to PNG
  execFileSync("gdal_translate", [
    "-of", "PNG",
    "-ot", "Byte",
    "-scale",
    "-a_nodata", "none",
    "-b", "1",
    "-colorinterp", "green",
    warpedPath,
    pngPath,
  ]);

  return { pngBuffer: readFileSync(pngPath), bounds };
}

/** List all sisTaxonIds that have AOH TIFs for a given taxon group folder */
function listAohSpecies(folder: string): string[] {
  const dir = join(STAR_DATA_DIR, "aohs", "current", folder);
  if (!existsSync(dir)) return [];

  const files = require("fs").readdirSync(dir) as string[];
  const ids: string[] = [];
  for (const f of files) {
    const match = f.match(/^(\d+)_all\.tif$/);
    if (match) ids.push(match[1]);
  }
  return ids;
}

async function uploadBatch(
  r2: S3Client,
  bucket: string,
  folder: string,
  ids: string[],
  existingKeys: Set<string>,
  logger: SyncLogger,
): Promise<{ uploaded: number; skipped: number; existing: number; failed: number }> {
  let uploaded = 0;
  let skipped = 0;
  let existing = 0;
  let failed = 0;

  const tmpDir = mkdtempSync(join(tmpdir(), "aoh-upload-"));

  for (const id of ids) {
    const pngKey = `${R2_PREFIX}/${id}.png`;
    const metaKey = `${R2_PREFIX}/${id}.json`;

    try {
      if (existingKeys.has(pngKey)) {
        existing++;
        logger.log("aoh_existing", { sisTaxonId: id });
        console.log(`    ${id} — already in R2, skipping`);
        continue;
      }

      const total = uploaded + existing + skipped + failed + 1;
      process.stdout.write(`    [${total}/${ids.length}] ${id}...`);
      const t0 = Date.now();

      const tifPath = join(STAR_DATA_DIR, "aohs", "current", folder, `${id}_all.tif`);
      const jsonPath = join(STAR_DATA_DIR, "aohs", "current", folder, `${id}_all.json`);

      if (!existsSync(tifPath)) {
        skipped++;
        logger.log("aoh_no_tif", { sisTaxonId: id });
        console.log(` no TIF (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        continue;
      }

      // Render PNG + extract bounds
      const { pngBuffer, bounds } = renderAohPng(tifPath, tmpDir);

      // Read metadata JSON if it exists
      let metadata: Record<string, unknown> = {};
      if (existsSync(jsonPath)) {
        metadata = JSON.parse(readFileSync(jsonPath, "utf-8"));
      }

      // Combine metadata with bounds
      const metaJson = JSON.stringify({ ...metadata, bounds });

      // Upload PNG
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: pngKey,
          Body: pngBuffer,
          ContentType: "image/png",
        })
      );

      // Upload metadata
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: metaKey,
          Body: metaJson,
          ContentType: "application/json",
        })
      );

      uploaded++;
      const sizeMB = (pngBuffer.length / 1024 / 1024).toFixed(2);
      logger.log("aoh_uploaded", { sisTaxonId: id, sizeMB });
      console.log(` ${sizeMB} MB (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed++;
      logger.log("aoh_failed", { sisTaxonId: id, error: err instanceof Error ? err.message : String(err) });
      console.log(` FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Clean up temp dir
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  return { uploaded, skipped, existing, failed };
}

export async function run(opts: {
  taxa?: string[];
  logger?: SyncLogger;
  force?: boolean;
} = {}): Promise<void> {
  const logger = opts.logger ?? new SyncLogger("upload-aoh-maps");
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw new Error("Missing R2_BUCKET_NAME");
  }

  let existingKeys: Set<string>;
  if (opts.force) {
    existingKeys = new Set();
    console.log("  Force mode: re-uploading all species");
  } else {
    console.log("  Listing existing R2 keys...");
    existingKeys = await listExistingKeys(r2, bucket);
    console.log(`  Found ${existingKeys.size} existing AOH maps in R2`);
  }

  // Determine which taxon group folders to process
  const folders = opts.taxa
    ? opts.taxa.map((t) => TAXON_GROUP_LOWER[t.toLowerCase()]).filter(Boolean)
    : [...TAXON_GROUPS];

  let totalUploaded = 0;
  let totalExisting = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const folder of folders) {
    const ids = listAohSpecies(folder);

    if (ids.length === 0) {
      console.log(`  ${folder}: no AOH maps found`);
      continue;
    }

    const alreadyUploaded = ids.filter((id) => existingKeys.has(`${R2_PREFIX}/${id}.png`));
    const toUpload = ids.filter((id) => !existingKeys.has(`${R2_PREFIX}/${id}.png`));

    console.log(`  ${folder}: ${ids.length} species with AOH (${alreadyUploaded.length} already in R2, ${toUpload.length} to upload)`);
    logger.log("aoh_taxon_start", { taxon: folder, total: ids.length, toUpload: toUpload.length });

    totalExisting += alreadyUploaded.length;
    const result = await uploadBatch(r2, bucket, folder, toUpload, existingKeys, logger);
    totalUploaded += result.uploaded;
    totalExisting += result.existing;
    totalSkipped += result.skipped;
    totalFailed += result.failed;

    console.log(`    ${folder} done: ${result.uploaded} uploaded, ${result.existing} existing, ${result.skipped} skipped, ${result.failed} failed`);
    logger.log("aoh_taxon_complete", { taxon: folder, ...result });
  }

  console.log(`\n  Total: ${totalUploaded} uploaded, ${totalExisting} already in R2, ${totalSkipped} skipped, ${totalFailed} failed`);
  logger.log("aoh_complete", { uploaded: totalUploaded, existing: totalExisting, skipped: totalSkipped, failed: totalFailed });
  if (!opts.logger) logger.close();
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const filteredArgs = args.filter((a) => a !== "--force");

  // Direct ID mode: --ids 10009 10032
  if (filteredArgs[0] === "--ids") {
    const ids = filteredArgs.slice(1).filter((a) => /^\d+$/.test(a));
    if (ids.length === 0) {
      console.error("No valid sis_taxon_ids provided");
      process.exit(1);
    }

    const r2 = getR2Client();
    const bucket = process.env.R2_BUCKET_NAME!;
    const logger = new SyncLogger("upload-aoh-maps");

    console.log("Listing existing R2 keys...");
    const existingKeys = force ? new Set<string>() : await listExistingKeys(r2, bucket);
    console.log(`Processing ${ids.length} species...`);

    // Find which folder each ID is in
    for (const id of ids) {
      let found = false;
      for (const folder of TAXON_GROUPS) {
        const tifPath = join(STAR_DATA_DIR, "aohs", "current", folder, `${id}_all.tif`);
        if (existsSync(tifPath)) {
          const result = await uploadBatch(r2, bucket, folder, [id], existingKeys, logger);
          console.log(`  ${id} (${folder}): ${result.uploaded ? "uploaded" : result.existing ? "existing" : "skipped"}`);
          found = true;
          break;
        }
      }
      if (!found) console.log(`  ${id}: TIF not found in any taxon group`);
    }

    logger.close();
    return;
  }

  // Taxon group mode (default)
  const taxa = filteredArgs.length > 0 ? filteredArgs.map((a) => a.toLowerCase()) : undefined;
  await run({ taxa, force });
}

const isDirectRun = process.argv[1]?.endsWith("upload-aoh-maps.ts") || process.argv[1]?.endsWith("upload-aoh-maps.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
