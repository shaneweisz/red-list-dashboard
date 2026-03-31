import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { CACHE_1H } from "@/lib/cache-headers";

// In-memory cache: assessmentId → { data, timestamp }
const rangeCache = new Map<number, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

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

    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `iucn-range-maps/${assessmentId}.json`,
      })
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
