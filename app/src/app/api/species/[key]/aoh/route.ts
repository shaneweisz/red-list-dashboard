import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/roles";

let r2Client: S3Client | null = null;

// Cache the resolved key for each species so the variant lookup
// (canonical vs `_c{x}x{y}` clipped) only runs once per process.
const keyCache = new Map<string, string | null>();

/**
 * Find the AOH PNG R2 key for a species. Files may be stored as:
 *   aoh-maps/{id}.png             (normal)
 *   aoh-maps/{id}_c{x}x{y}.png    (edges trimmed for globe-spanning species)
 */
async function findAohPngKey(client: S3Client, bucket: string, sisTaxonId: string): Promise<string | null> {
  if (keyCache.has(sisTaxonId)) return keyCache.get(sisTaxonId)!;

  const directKey = `aoh-maps/${sisTaxonId}.png`;
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
    if (obj.Key?.endsWith(".png")) {
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

  try {
    const client = getR2Client();
    const bucket = process.env.R2_MAPS_BUCKET_NAME;

    if (!bucket) {
      return NextResponse.json(
        { error: "R2 bucket not configured" },
        { status: 500 }
      );
    }

    const r2Key = await findAohPngKey(client, bucket, sisTaxonId);
    if (!r2Key) {
      return NextResponse.json(
        { error: "AOH map not found for this species" },
        { status: 404 }
      );
    }

    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: r2Key })
    );

    const body = await response.Body?.transformToByteArray();
    if (!body) {
      return NextResponse.json(
        { error: "AOH map not found for this species" },
        { status: 404 }
      );
    }

    return new NextResponse(Buffer.from(body), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=60",
      },
    });
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NoSuchKey") {
      return NextResponse.json(
        { error: "AOH map not found for this species" },
        { status: 404 }
      );
    }
    console.error("Error fetching AOH PNG from R2:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
