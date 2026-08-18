/**
 * Serves the occurrence map's two file-backed context layers from the maps
 * bucket: RESOLVE Ecoregions 2017, and the GBIF sampling-effort raster.
 *
 * A route rather than a public bucket URL, so the bucket stays private and the
 * caching is ours to set. Both files are immutable — a new version of either
 * dataset means a new filename, which is a code change — so they are cached
 * hard at every layer and held in this process between requests.
 */
import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { isOverlayAsset } from "@/lib/map-overlays";

let r2Client: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (r2Client) return r2Client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return r2Client;
}

/**
 * Kept in the server process after the first request.
 *
 * Two files, a few megabytes, never invalidated — against a round trip to R2
 * for every reader who switches an overlay on. Held as a promise so a burst of
 * requests during a cold start shares one fetch rather than each starting
 * their own.
 */
const cache = new Map<string, Promise<{ body: Buffer; contentType: string; encoding?: string }>>();

async function load(asset: string) {
  const cached = cache.get(asset);
  if (cached) return cached;

  const pending = (async () => {
    const client = getR2Client();
    const bucket = process.env.R2_MAPS_BUCKET_NAME;
    if (!client || !bucket) throw new Error("R2 is not configured");

    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: `overlays/${asset}` })
    );
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) throw new Error("Empty object");
    return {
      body: Buffer.from(bytes),
      contentType: object.ContentType ?? "application/octet-stream",
      // Passed straight through: the ecoregions object is stored gzipped, and
      // the browser is what unpacks it. Dropping this header hands the client
      // gzip bytes labelled as JSON.
      encoding: object.ContentEncoding,
    };
  })();

  cache.set(asset, pending);
  // A failed fetch must not be remembered as the answer for the process's life.
  pending.catch(() => cache.delete(asset));
  return pending;
}

export async function GET(request: NextRequest, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;

  // Only the two names the map knows about. Everything else — including any
  // attempt to walk out of the prefix — is a 404 rather than a lookup.
  if (!isOverlayAsset(asset)) {
    return NextResponse.json({ error: "Unknown overlay" }, { status: 404 });
  }

  try {
    const { body, contentType, encoding } = await load(asset);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (encoding) headers["Content-Encoding"] = encoding;
    return new NextResponse(new Uint8Array(body), { headers });
  } catch (error) {
    console.error(`Failed to serve overlay ${asset}:`, error);
    return NextResponse.json({ error: "Overlay unavailable" }, { status: 502 });
  }
}
