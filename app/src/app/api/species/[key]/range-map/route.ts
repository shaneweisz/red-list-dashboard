import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CACHE_1H } from "@/lib/cache-headers";

// In-memory cache: assessmentId → { data, timestamp }
const rangeCache = new Map<number, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Cache the R2 key for each assessment (handles simplified vs unsimplified filenames)
const keyCache = new Map<number, string | null>();

let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 credentials");
  }

  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return r2Client;
}

/**
 * Find the R2 key for a given assessment ID.
 * Files may be stored as:
 *   iucn-range-maps/{id}.json           (full resolution)
 *   iucn-range-maps/{id}_s{tol}.json    (simplified)
 */
async function findR2Key(client: S3Client, bucket: string, assessmentId: number): Promise<string | null> {
  if (keyCache.has(assessmentId)) return keyCache.get(assessmentId)!;

  // Try the unsimplified key first (most common)
  const directKey = `iucn-range-maps/${assessmentId}.json`;
  try {
    await client.send(new GetObjectCommand({ Bucket: bucket, Key: directKey }));
    keyCache.set(assessmentId, directKey);
    return directKey;
  } catch {
    // Not found — check for simplified variants
  }

  // List keys with the assessment ID prefix to find simplified variants
  // Pick the least simplified (lowest tolerance) if multiple exist
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `iucn-range-maps/${assessmentId}`,
      MaxKeys: 10,
    })
  );

  let bestKey: string | null = null;
  let bestTolerance = Infinity;
  for (const obj of response.Contents ?? []) {
    if (!obj.Key?.endsWith(".json")) continue;
    const tolMatch = obj.Key.match(/_s([\d.]+)\.json$/);
    const tolerance = tolMatch ? parseFloat(tolMatch[1]) : 0;
    if (tolerance < bestTolerance) {
      bestTolerance = tolerance;
      bestKey = obj.Key;
    }
  }
  if (bestKey) {
    keyCache.set(assessmentId, bestKey);
    return bestKey;
  }

  keyCache.set(assessmentId, null);
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const assessmentId = parseInt(key, 10);

  if (isNaN(assessmentId)) {
    return NextResponse.json(
      { error: "Invalid assessment ID" },
      { status: 400 }
    );
  }

  // Check in-memory cache
  const cached = rangeCache.get(assessmentId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, { headers: CACHE_1H });
  }

  try {
    const client = getR2Client();
    const bucket = process.env.R2_BUCKET_NAME;

    if (!bucket) {
      return NextResponse.json(
        { error: "R2 bucket not configured" },
        { status: 500 }
      );
    }

    const r2Key = await findR2Key(client, bucket, assessmentId);
    if (!r2Key) {
      return NextResponse.json(
        { error: "No range map found for this assessment" },
        { status: 404 }
      );
    }

    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: r2Key })
    );

    const body = await response.Body?.transformToString();
    if (!body) {
      return NextResponse.json(
        { error: "No range map found for this assessment" },
        { status: 404 }
      );
    }

    const data = JSON.parse(body);

    // Cache the result
    rangeCache.set(assessmentId, {
      data,
      timestamp: Date.now(),
    });

    return NextResponse.json(data, { headers: CACHE_1H });
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NoSuchKey") {
      return NextResponse.json(
        { error: "No range map found for this assessment" },
        { status: 404 }
      );
    }
    console.error("Error fetching range map from R2:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
