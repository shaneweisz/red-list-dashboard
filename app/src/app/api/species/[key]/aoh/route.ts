import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { readFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const STAR_DATA_DIR = "/scratch/sw984/star";
const DEFAULT_MAX_SIZE = 4096;

const TAXON_GROUP_TO_FOLDER: Record<string, string> = {
  mammalia: "MAMMALIA",
  aves: "AVES",
  reptilia: "REPTILIA",
  amphibia: "AMPHIBIA",
};

function getAohTifPath(sisTaxonId: string, taxonGroup: string): string | null {
  const folder = TAXON_GROUP_TO_FOLDER[taxonGroup.toLowerCase()];
  if (!folder) return null;
  return path.join(STAR_DATA_DIR, "aohs", "current", folder, `${sisTaxonId}_all.tif`);
}

async function getBounds(tifPath: string): Promise<[number, number, number, number]> {
  const { stdout } = await execFileAsync("gdalinfo", ["-json", tifPath]);
  const info = JSON.parse(stdout);
  // cornerCoordinates: { upperLeft, lowerRight, ... } in source CRS
  // Use wgs84Extent if available (GDAL ≥3.x)
  if (info.wgs84Extent) {
    const coords = info.wgs84Extent.coordinates[0];
    const lons = coords.map((c: number[]) => c[0]);
    const lats = coords.map((c: number[]) => c[1]);
    return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
  }
  // Fallback: reproject bounds manually
  const cc = info.cornerCoordinates;
  return [cc.lowerRight[1], cc.upperLeft[0], cc.upperLeft[1], cc.lowerRight[0]];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: sisTaxonId } = await params;
  const taxonGroup = request.nextUrl.searchParams.get("taxonGroup");
  const maxSize = parseInt(
    request.nextUrl.searchParams.get("maxSize") ?? String(DEFAULT_MAX_SIZE),
    10
  );

  if (!taxonGroup) {
    return NextResponse.json(
      { error: "taxonGroup query parameter is required" },
      { status: 400 }
    );
  }

  const tifPath = getAohTifPath(sisTaxonId, taxonGroup);
  if (!tifPath || !existsSync(tifPath)) {
    return NextResponse.json(
      { error: "AOH map not found for this species" },
      { status: 404 }
    );
  }

  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "aoh-"));
    const warpedPath = path.join(tempDir, "warped.tif");
    const pngPath = path.join(tempDir, "aoh.png");

    // Step 1: Reproject to EPSG:4326 with optional size cap
    const warpArgs = [
      "-t_srs", "EPSG:4326",
      "-r", "near",
      "-co", "COMPRESS=LZW",
      "-overwrite",
    ];
    if (maxSize > 0) {
      // Get source dimensions to determine scaling
      const { stdout: infoOut } = await execFileAsync("gdalinfo", ["-json", tifPath]);
      const info = JSON.parse(infoOut);
      const srcWidth = info.size[0];
      const srcHeight = info.size[1];
      const longest = Math.max(srcWidth, srcHeight);
      if (longest > maxSize) {
        const scale = maxSize / longest;
        const outWidth = Math.round(srcWidth * scale);
        const outHeight = Math.round(srcHeight * scale);
        warpArgs.push("-ts", String(outWidth), String(outHeight));
      }
    }
    warpArgs.push(tifPath, warpedPath);
    await execFileAsync("gdalwarp", warpArgs);

    // Step 2: Get bounds from the warped (4326) raster
    const bounds = await getBounds(warpedPath);

    // Step 3: Render to PNG with green color ramp
    // Use gdal_translate to convert to byte range, then apply color via a VRT
    // Simple approach: scale to 0-255, output as single-band greyscale PNG
    // with alpha for nodata
    await execFileAsync("gdal_translate", [
      "-of", "PNG",
      "-ot", "Byte",
      "-scale",
      "-a_nodata", "none",
      "-b", "1",
      "-colorinterp", "green",
      warpedPath,
      pngPath,
    ]);

    const pngBuffer = await readFile(pngPath);

    return new NextResponse(pngBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=60",
        // Bounds as south,west,north,east
        "X-Bounds": bounds.join(","),
      },
    });
  } catch (error) {
    console.error("Error generating AOH PNG:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
