import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

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
  const { key: sisTaxonId } = await params;

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
        Key: `aoh-maps/${sisTaxonId}.png`,
      })
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
