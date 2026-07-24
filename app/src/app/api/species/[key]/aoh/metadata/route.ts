import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CACHE_1H } from "@/lib/cache-headers";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/roles";

const metaCache = new Map<string, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Cache resolved key per species (canonical vs `_c{x}x{y}` clipped variant)
const keyCache = new Map<string, string | null>();

let r2Client: S3Client | null = null;

/** Mirror of findAohPngKey but for the .json metadata sibling. */
async function findAohMetaKey(client: S3Client, bucket: string, sisTaxonId: string): Promise<string | null> {
  if (keyCache.has(sisTaxonId)) return keyCache.get(sisTaxonId)!;

  const directKey = `aoh-maps/${sisTaxonId}.json`;
  try {
    await client.send(new GetObjectCommand({ Bucket: bucket, Key: directKey }));
    keyCache.set(sisTaxonId, directKey);
    return directKey;
  } catch {
    // Fall through to listing for clipped variants
  }

  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `aoh-maps/${sisTaxonId}_c`,
      MaxKeys: 5,
    })
  );
  for (const obj of response.Contents ?? []) {
    if (obj.Key?.endsWith(".json")) {
      keyCache.set(sisTaxonId, obj.Key);
      return obj.Key;
    }
  }

  keyCache.set(sisTaxonId, null);
  return null;
}

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
  const { key: sisTaxonId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAdmin(supabase, user?.id))) {
    return NextResponse.json({ error: "Not authorized to view AOH maps" }, { status: 403 });
  }

  // Check in-memory cache
  const cached = metaCache.get(sisTaxonId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data, { headers: CACHE_1H });
  }

  try {
    const client = getR2Client();
    const bucket = process.env.R2_MAPS_BUCKET_NAME;

    if (!bucket) {
      return NextResponse.json(
        { error: "R2 bucket not configured" },
        { status: 500 }
      );
    }

    const r2Key = await findAohMetaKey(client, bucket, sisTaxonId);
    if (!r2Key) {
      return NextResponse.json(
        { error: "AOH metadata not found for this species" },
        { status: 404 }
      );
    }

    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: r2Key })
    );

    const body = await response.Body?.transformToString();
    if (!body) {
      return NextResponse.json(
        { error: "AOH metadata not found for this species" },
        { status: 404 }
      );
    }

    const data = JSON.parse(body);

    metaCache.set(sisTaxonId, { data, timestamp: Date.now() });

    return NextResponse.json(data, { headers: CACHE_1H });
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NoSuchKey") {
      return NextResponse.json(
        { error: "AOH metadata not found for this species" },
        { status: 404 }
      );
    }
    console.error("Error fetching AOH metadata from R2:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
