/**
 * upload-data-to-r2: app/data/ → Cloudflare R2 dashboard-data bucket
 *
 * Uploads every file under app/data/ to syncs/<timestamp>/ in the
 * dashboard-data R2 bucket, then writes latest.txt pointing to that
 * timestamp.
 *
 * The latest.txt write is the final step. A fetch picking up latest.txt
 * always sees a fully-uploaded sync — partial uploads from a crashed run
 * leave the previous sync live.
 *
 * Layout in R2:
 *   <bucket>/
 *     latest.txt              ← "2026-05-20T10-30-00Z"
 *     syncs/
 *       2026-05-20T10-30-00Z/
 *         gbif/amphibia.csv
 *         redlist/...
 *         search-index.json
 *         ...
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
const LATEST_POINTER_KEY = "latest.txt";

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

  const localPaths = walkFiles(DATA_DIR);
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

  // Final atomic step: flip the pointer to the new sync.
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: LATEST_POINTER_KEY,
      Body: timestamp,
      ContentType: "text/plain",
    })
  );
  logger.log("latest_pointer_written", { timestamp });

  console.log(`Uploaded ${localPaths.length} files`);
  console.log(`latest.txt now points to: ${timestamp}`);
  logger.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
