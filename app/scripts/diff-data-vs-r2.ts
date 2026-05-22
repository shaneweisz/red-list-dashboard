/**
 * diff-data-vs-r2: Compare local app/data/ vs the current R2 live sync.
 *
 * Downloads whatever sync latest.txt points at into a temp dir, walks
 * both trees, and reports differences. Intended to spot-check a fresh
 * local sync before publishing it via upload-data-to-r2.
 *
 * Reports per file:
 *   + path (new file, only in local)
 *   - path (removed, only in R2)
 *   ~ path: CSV    → "N → M rows (+added, -removed, ~modified)" keyed by first column
 *   ~ path: JSON   → byte delta
 *   ~ path: binary → byte delta
 *
 * Usage:
 *   npx tsx scripts/diff-data-vs-r2.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";
import { loadEnvFiles, DATA_DIR, mapConcurrent, readCsv } from "./utils";

const DOWNLOAD_CONCURRENCY = 16;
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

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
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

async function downloadLiveSync(
  client: S3Client,
  bucket: string,
  targetDir: string
): Promise<string> {
  const pointerResp = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: LATEST_POINTER_KEY })
  );
  const timestamp = (await streamToBuffer(pointerResp.Body as Readable))
    .toString("utf-8")
    .trim();
  if (!timestamp) {
    throw new Error(`Empty ${LATEST_POINTER_KEY} in s3://${bucket}/`);
  }
  const syncPrefix = `syncs/${timestamp}/`;

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: syncPrefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  if (keys.length === 0) {
    throw new Error(`No objects under s3://${bucket}/${syncPrefix}`);
  }

  await mapConcurrent(keys, DOWNLOAD_CONCURRENCY, async (key) => {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = await streamToBuffer(resp.Body as Readable);
    const relPath = key.substring(syncPrefix.length);
    const localPath = path.join(targetDir, ...relPath.split("/"));
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, body);
  });

  return timestamp;
}

function compareCsv(localPath: string, remotePath: string): string | null {
  const localRows = readCsv<Record<string, string>>(localPath, (r) => r);
  const remoteRows = readCsv<Record<string, string>>(remotePath, (r) => r);

  // Use first column as identity if both files have rows.
  const firstKey =
    localRows[0] !== undefined
      ? Object.keys(localRows[0])[0]
      : remoteRows[0] !== undefined
        ? Object.keys(remoteRows[0])[0]
        : null;

  if (!firstKey) {
    // Both empty; equal length means identical.
    return localRows.length === remoteRows.length
      ? null
      : `${remoteRows.length} → ${localRows.length} rows`;
  }

  const localById = new Map(localRows.map((r) => [r[firstKey], r]));
  const remoteById = new Map(remoteRows.map((r) => [r[firstKey], r]));

  let added = 0;
  let modified = 0;
  for (const [id, row] of localById) {
    const r = remoteById.get(id);
    if (!r) added++;
    else if (JSON.stringify(row) !== JSON.stringify(r)) modified++;
  }
  let removed = 0;
  for (const id of remoteById.keys()) {
    if (!localById.has(id)) removed++;
  }

  if (added === 0 && removed === 0 && modified === 0) return null;
  return `${remoteRows.length} → ${localRows.length} rows (+${added} new, -${removed} removed, ~${modified} modified)`;
}

async function main(): Promise<void> {
  loadEnvFiles();

  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Local data dir does not exist: ${DATA_DIR}. Run a sync first.`);
  }

  const client = getR2Client();
  const bucket = getDataBucket();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-live-"));

  try {
    console.log("Downloading live R2 sync...");
    const timestamp = await downloadLiveSync(client, bucket, tempDir);
    console.log(`Comparing local app/data/ vs R2 sync ${timestamp}\n`);

    const localFiles = new Set(
      walkFiles(DATA_DIR).map((p) => path.relative(DATA_DIR, p))
    );
    const remoteFiles = new Set(
      walkFiles(tempDir).map((p) => path.relative(tempDir, p))
    );
    const allFiles = [...new Set([...localFiles, ...remoteFiles])].sort();

    let changeCount = 0;
    for (const relPath of allFiles) {
      const localPath = path.join(DATA_DIR, relPath);
      const remotePath = path.join(tempDir, relPath);
      const inLocal = localFiles.has(relPath);
      const inRemote = remoteFiles.has(relPath);

      if (inLocal && !inRemote) {
        console.log(`+ ${relPath} (new file)`);
        changeCount++;
        continue;
      }
      if (!inLocal && inRemote) {
        console.log(`- ${relPath} (removed)`);
        changeCount++;
        continue;
      }

      const localSize = fs.statSync(localPath).size;
      const remoteSize = fs.statSync(remotePath).size;
      if (localSize === remoteSize) {
        // Quick buffer compare to confirm true identity.
        if (fs.readFileSync(localPath).equals(fs.readFileSync(remotePath))) {
          continue;
        }
      }

      if (relPath.endsWith(".csv")) {
        const summary = compareCsv(localPath, remotePath);
        if (summary) {
          console.log(`~ ${relPath}: ${summary}`);
          changeCount++;
        }
      } else if (relPath.endsWith(".json")) {
        const delta = localSize - remoteSize;
        const sign = delta >= 0 ? "+" : "";
        console.log(
          `~ ${relPath}: ${remoteSize} → ${localSize} bytes (${sign}${delta})`
        );
        changeCount++;
      } else {
        console.log(
          `~ ${relPath}: ${remoteSize} → ${localSize} bytes (binary change)`
        );
        changeCount++;
      }
    }

    console.log("");
    if (changeCount === 0) {
      console.log("No differences. Local app/data/ matches the live R2 sync.");
    } else {
      console.log(`${changeCount} file(s) changed.`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
