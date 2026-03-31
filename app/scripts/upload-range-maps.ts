/**
 * upload-range-maps: IUCN DB → Cloudflare R2
 *
 * Generates simplified range map GeoJSON (polygons + point localities)
 * from the IUCN PostgreSQL database and uploads to R2.
 *
 * Reads assessment IDs from per-taxon CSV files (matching the sync pipeline)
 * and skips species already uploaded to R2.
 *
 * Prerequisites:
 *   1. SSH tunnel to IUCN DB
 *   2. Environment variables: DB_*, R2_*
 *   3. Per-taxon CSVs must exist (run fetch-redlist-species first)
 *
 * Usage:
 *   npx tsx scripts/upload-range-maps.ts                    # all taxa
 *   npx tsx scripts/upload-range-maps.ts mammalia aves      # specific taxa
 *   npx tsx scripts/upload-range-maps.ts --ids 280792135    # specific assessment IDs
 */

import { Client } from "pg";
import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { loadEnvFiles, SyncLogger, readCsv, REDLIST_DIR } from "./utils";
import { getTaxa } from "./taxa";

const SIMPLIFY_TOLERANCE = 0.01; // ~1km in degrees
const R2_PREFIX = "iucn-range-maps";

const PRESENCE_LABELS: Record<number, string> = {
  1: "Extant",
  2: "Probably Extant",
  3: "Possibly Extant",
  4: "Possibly Extinct",
  5: "Extinct",
  6: "Presence Uncertain",
};

const ORIGIN_LABELS: Record<number, string> = {
  1: "Native",
  2: "Reintroduced",
  3: "Introduced",
  4: "Vagrant",
  5: "Origin Uncertain",
  6: "Assisted Colonisation",
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

function getDbClient(): Client {
  return new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
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

async function generateRangeGeoJSON(
  db: Client,
  assessmentId: number
): Promise<object | null> {
  const [rangeResult, pointResult] = await Promise.all([
    db.query(
      `
      SELECT
        assessment_ranges.presence,
        assessment_ranges.origin,
        ST_AsGeoJSON(
          ST_SimplifyPreserveTopology(
            ST_Union(assessment_ranges.geom::geometry),
            $2
          )
        ) AS geojson,
        'range' AS source
      FROM
        assessments
        LEFT JOIN assessment_ranges ON assessment_ranges.assessment_id = assessments.id
      WHERE
        assessments.id = $1
        AND assessment_ranges.geom IS NOT NULL
      GROUP BY assessment_ranges.presence, assessment_ranges.origin
      `,
      [assessmentId, SIMPLIFY_TOLERANCE]
    ),
    db.query(
      `
      SELECT
        presence,
        origin,
        ST_AsGeoJSON(geom::geometry) AS geojson,
        'point' AS source
      FROM assessment_points
      WHERE assessment_id = $1
        AND geom IS NOT NULL
      `,
      [assessmentId]
    ),
  ]);

  const allRows = [...rangeResult.rows, ...pointResult.rows];
  if (allRows.length === 0) return null;

  const features = allRows
    .filter((row) => row.geojson != null)
    .map((row) => ({
      type: "Feature" as const,
      properties: {
        presence: row.presence,
        presence_label: PRESENCE_LABELS[row.presence] ?? `Unknown (${row.presence})`,
        origin: row.origin,
        origin_label: ORIGIN_LABELS[row.origin] ?? `Unknown (${row.origin})`,
        source: row.source,
      },
      geometry: JSON.parse(row.geojson),
    }));

  if (features.length === 0) return null;

  return { type: "FeatureCollection", features };
}

function getAssessmentIdsFromCsvs(taxaFilter?: string[]): { assessmentId: number; hasMap: boolean }[] {
  const taxa = getTaxa(taxaFilter);
  const results: { assessmentId: number; hasMap: boolean }[] = [];

  for (const taxon of taxa) {
    const csvPath = `${REDLIST_DIR}/${taxon.id}.csv`;
    try {
      const rows = readCsv(csvPath, (row) => ({
        assessmentId: parseInt(row.assessment_id, 10),
        hasMap: row.has_map === "true",
      }));
      for (const row of rows) {
        if (row.hasMap && !isNaN(row.assessmentId)) {
          results.push(row);
        }
      }
    } catch {
      console.warn(`  Warning: Could not read ${csvPath}, skipping`);
    }
  }

  return results;
}

async function uploadBatch(
  db: Client,
  r2: S3Client,
  bucket: string,
  assessmentIds: number[],
  existingKeys: Set<string>,
  logger: SyncLogger,
): Promise<{ uploaded: number; skipped: number; existing: number; failed: number }> {
  let uploaded = 0;
  let skipped = 0;
  let existing = 0;
  let failed = 0;

  for (const id of assessmentIds) {
    const key = `${R2_PREFIX}/${id}.json`;

    try {
      // Skip if already in R2
      if (existingKeys.has(key)) {
        existing++;
        continue;
      }

      const total = uploaded + existing + skipped + failed + 1;
      process.stdout.write(`    [${total}/${assessmentIds.length}] ${id}...`);
      const t0 = Date.now();
      const geojson = await generateRangeGeoJSON(db, id);
      if (!geojson) {
        skipped++;
        logger.log("range_map_no_data", { assessmentId: id });
        console.log(` no data (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        continue;
      }

      const body = JSON.stringify(geojson);
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
        })
      );

      uploaded++;
      const sizeMB = (Buffer.byteLength(body) / 1024 / 1024).toFixed(2);
      logger.log("range_map_uploaded", { assessmentId: id, sizeMB });
      console.log(` ${sizeMB} MB (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed++;
      logger.log("range_map_failed", { assessmentId: id, error: err instanceof Error ? err.message : String(err) });
      console.log(` FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { uploaded, skipped, existing, failed };
}

export async function run(opts: {
  taxa?: string[];
  logger?: SyncLogger;
} = {}): Promise<void> {
  const logger = opts.logger ?? new SyncLogger("upload-range-maps");
  const db = getDbClient();
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw new Error("Missing R2_BUCKET_NAME");
  }

  await db.connect();
  console.log("  Connected to database");

  console.log("  Listing existing R2 keys...");
  const existingKeys = await listExistingKeys(r2, bucket);
  console.log(`  Found ${existingKeys.size} existing range maps in R2`);

  const taxa = getTaxa(opts.taxa);
  let totalUploaded = 0;
  let totalExisting = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const taxon of taxa) {
    const species = getAssessmentIdsFromCsvs([taxon.id]);
    const assessmentIds = species.map((s) => s.assessmentId);

    if (assessmentIds.length === 0) {
      console.log(`  ${taxon.name}: no species with maps`);
      continue;
    }

    const alreadyUploaded = assessmentIds.filter((id) => existingKeys.has(`${R2_PREFIX}/${id}.json`));
    const toUpload = assessmentIds.filter((id) => !existingKeys.has(`${R2_PREFIX}/${id}.json`));

    console.log(`  ${taxon.name}: ${assessmentIds.length} species with maps (${alreadyUploaded.length} already in R2, ${toUpload.length} to upload)`);
    logger.log("range_map_taxon_start", { taxon: taxon.id, total: assessmentIds.length, toUpload: toUpload.length });

    totalExisting += alreadyUploaded.length;
    const result = await uploadBatch(db, r2, bucket, toUpload, existingKeys, logger);
    totalUploaded += result.uploaded;
    totalExisting += result.existing;
    totalSkipped += result.skipped;
    totalFailed += result.failed;

    console.log(`    ${taxon.name} done: ${result.uploaded} uploaded, ${result.existing} existing, ${result.skipped} skipped, ${result.failed} failed`);
    logger.log("range_map_taxon_complete", { taxon: taxon.id, ...result });
  }

  await db.end();
  console.log(`\n  Total: ${totalUploaded} uploaded, ${totalExisting} already in R2, ${totalSkipped} skipped (no data), ${totalFailed} failed`);
  logger.log("range_map_complete", { uploaded: totalUploaded, existing: totalExisting, skipped: totalSkipped, failed: totalFailed });
  if (!opts.logger) logger.close();
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);

  // Direct assessment ID mode: --ids 123 456
  if (args[0] === "--ids") {
    const ids = args.slice(1).map((a) => parseInt(a, 10)).filter((n) => !isNaN(n));
    if (ids.length === 0) {
      console.error("No valid assessment IDs provided");
      process.exit(1);
    }

    const db = getDbClient();
    const r2 = getR2Client();
    const bucket = process.env.R2_BUCKET_NAME!;
    const logger = new SyncLogger("upload-range-maps");

    await db.connect();
    console.log("Connected to database");
    console.log("Listing existing R2 keys...");
    const existingKeys = await listExistingKeys(r2, bucket);
    console.log(`Found ${existingKeys.size} existing range maps in R2`);
    console.log(`Processing ${ids.length} assessment(s)...`);

    const result = await uploadBatch(db, r2, bucket, ids, existingKeys, logger);
    await db.end();
    console.log(`\nDone: ${result.uploaded} uploaded, ${result.existing} existing, ${result.skipped} skipped, ${result.failed} failed`);
    return;
  }

  // Taxon group mode (default)
  const taxa = args.length > 0 ? args.map((a) => a.toLowerCase()) : undefined;
  await run({ taxa });
}

const isDirectRun = process.argv[1]?.endsWith("upload-range-maps.ts") || process.argv[1]?.endsWith("upload-range-maps.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
