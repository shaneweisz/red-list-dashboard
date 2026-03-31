/**
 * Generates simplified range map GeoJSON from the IUCN PostgreSQL database
 * and uploads to Cloudflare R2.
 *
 * Usage:
 *   npx tsx scripts/upload-range-maps.ts                    # all species with range data
 *   npx tsx scripts/upload-range-maps.ts 280792135          # single assessment ID
 *   npx tsx scripts/upload-range-maps.ts 280792135 12345    # multiple assessment IDs
 */

import { Client } from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { loadEnvFiles } from "./utils";

loadEnvFiles();

const SIMPLIFY_TOLERANCE = 0.01; // ~1km in degrees

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

async function generateRangeGeoJSON(
  db: Client,
  assessmentId: number
): Promise<object | null> {
  const result = await db.query(
    `
    SELECT
      assessment_ranges.presence,
      assessment_ranges.origin,
      ST_AsGeoJSON(
        ST_SimplifyPreserveTopology(
          ST_Union(assessment_ranges.geom::geometry),
          $2
        )
      ) AS geojson
    FROM
      assessments
      LEFT JOIN assessment_ranges ON assessment_ranges.assessment_id = assessments.id
    WHERE
      assessments.id = $1
      AND assessment_ranges.geom IS NOT NULL
    GROUP BY assessment_ranges.presence, assessment_ranges.origin
    `,
    [assessmentId, SIMPLIFY_TOLERANCE]
  );

  if (result.rows.length === 0) return null;

  const features = result.rows
    .filter((row) => row.geojson != null)
    .map((row) => ({
      type: "Feature" as const,
      properties: {
        presence: row.presence,
        presence_label: PRESENCE_LABELS[row.presence] ?? `Unknown (${row.presence})`,
        origin: row.origin,
        origin_label: ORIGIN_LABELS[row.origin] ?? `Unknown (${row.origin})`,
      },
      geometry: JSON.parse(row.geojson),
    }));

  if (features.length === 0) return null;

  return { type: "FeatureCollection", features };
}

async function getAssessmentIdsWithRanges(db: Client): Promise<number[]> {
  const result = await db.query(`
    SELECT DISTINCT assessments.id
    FROM assessments
    JOIN assessment_ranges ON assessment_ranges.assessment_id = assessments.id
    WHERE assessment_ranges.geom IS NOT NULL
    ORDER BY assessments.id
  `);
  return result.rows.map((r) => r.id);
}

async function main() {
  const args = process.argv.slice(2);
  const db = getDbClient();
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw new Error("Missing R2_BUCKET_NAME");
  }

  await db.connect();
  console.log("Connected to database");

  let assessmentIds: number[];

  if (args.length > 0) {
    assessmentIds = args.map((a) => parseInt(a, 10)).filter((n) => !isNaN(n));
  } else {
    console.log("Fetching all assessment IDs with range data...");
    assessmentIds = await getAssessmentIdsWithRanges(db);
  }

  console.log(`Processing ${assessmentIds.length} assessment(s)...`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of assessmentIds) {
    try {
      const geojson = await generateRangeGeoJSON(db, id);
      if (!geojson) {
        skipped++;
        continue;
      }

      const body = JSON.stringify(geojson);
      const key = `iucn-range-maps/${id}.json`;

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
      console.log(`  Uploaded ${key} (${sizeMB} MB)`);
    } catch (err) {
      failed++;
      console.error(`  Failed ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  await db.end();
  console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped (no data), ${failed} failed`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
