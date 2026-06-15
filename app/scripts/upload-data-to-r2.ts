/**
 * upload-data-to-r2: app/data/ → Cloudflare R2 dashboard-data bucket
 *
 * Uploads every file under app/data/ to syncs/<timestamp>/ in the
 * dashboard-data R2 bucket, then updates the repo-tracked
 * app/latest-sync.txt to point at the new timestamp. The pointer
 * change is committed via PR — production only switches to the new
 * sync once that PR merges.
 *
 * Layout in R2:
 *   <bucket>/
 *     syncs/
 *       2026-05-20T10-30-00Z/
 *         gbif/amphibia.csv
 *         redlist/...
 *         backbone.parquet
 *         ...
 *
 * Active sync pointer lives in app/latest-sync.txt (version-controlled).
 *
 * Prerequisites:
 *   - Environment variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *     R2_SECRET_ACCESS_KEY, R2_DATA_BUCKET_NAME
 *   - app/data/ populated locally (e.g. by running the sync pipeline)
 *
 * Usage:
 *   npx tsx scripts/upload-data-to-r2.ts
 */

import * as fs from "fs";
import * as path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { loadEnvFiles, SyncLogger, DATA_DIR, mapConcurrent } from "./utils";

const UPLOAD_CONCURRENCY = 16;
const LATEST_SYNC_FILE = path.join(__dirname, "..", "latest-sync.txt");

// Legacy artifacts to leave out of new syncs. search-index.json (~95MB) backed the old
// in-memory search; live search now queries Parquet over R2 (searchSpecies in
// species-duckdb.ts) and nothing reads the JSON. Excluding it here stops it propagating
// (fetch → data/ → re-upload) into future syncs. Relative-to-DATA_DIR, forward-slashed.
const EXCLUDE_FROM_SYNC = new Set(["search-index.json"]);

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)"
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getDataBucket(): string {
  const bucket = process.env.R2_DATA_BUCKET_NAME;
  if (!bucket) {
    throw new Error("Missing R2_DATA_BUCKET_NAME env var");
  }
  return bucket;
}

function makeTimestamp(): string {
  // 2026-05-20T10-30-00Z — lexicographically sortable, S3/URL-safe.
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".csv")) return "text/csv";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

async function main(): Promise<void> {
  loadEnvFiles();
  const logger = new SyncLogger("upload-data-to-r2");

  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Data dir does not exist: ${DATA_DIR}`);
  }

  const client = getR2Client();
  const bucket = getDataBucket();
  const timestamp = makeTimestamp();
  const syncPrefix = `syncs/${timestamp}/`;

  const localPaths = walkFiles(DATA_DIR).filter(
    (p) => !EXCLUDE_FROM_SYNC.has(path.relative(DATA_DIR, p).split(path.sep).join("/"))
  );
  if (localPaths.length === 0) {
    throw new Error(`No files found under ${DATA_DIR}`);
  }

  const totalBytes = localPaths.reduce((sum, p) => sum + fs.statSync(p).size, 0);
  console.log(
    `Uploading ${localPaths.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB) ` +
      `to s3://${bucket}/${syncPrefix}`
  );
  logger.log("upload_started", { bucket, timestamp, fileCount: localPaths.length, totalBytes });

  let completed = 0;
  await mapConcurrent(localPaths, UPLOAD_CONCURRENCY, async (localPath) => {
    const relPath = path.relative(DATA_DIR, localPath);
    const key = syncPrefix + relPath.split(path.sep).join("/");
    const body = fs.readFileSync(localPath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentTypeFor(localPath),
      })
    );
    completed++;
    process.stdout.write(`\r  ${completed}/${localPaths.length}`);
    logger.log("uploaded", { key, bytes: body.length });
  });
  console.log("");

  // Update the repo-tracked pointer file so the next PR flips production.
  fs.writeFileSync(LATEST_SYNC_FILE, timestamp + "\n");
  logger.log("pointer_file_updated", { timestamp, path: LATEST_SYNC_FILE });

  console.log(`Uploaded ${localPaths.length} files`);
  console.log(`Updated ${path.relative(process.cwd(), LATEST_SYNC_FILE)} → ${timestamp}`);
  console.log("");
  console.log("Next steps:");
  console.log("  git add app/latest-sync.txt app/data/taxa-summary.json app/data/node-children-summaries.json");
  console.log(`  git commit -m "Bump data sync to ${timestamp}"`);
  console.log("  git push  # open PR; merging flips production to the new sync");
  logger.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
