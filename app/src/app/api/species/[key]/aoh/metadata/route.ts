import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { CACHE_1H } from "@/lib/cache-headers";

const execFileAsync = promisify(execFile);

const STAR_DATA_DIR = "/scratch/sw984/star";

const TAXON_GROUP_TO_FOLDER: Record<string, string> = {
  mammalia: "MAMMALIA",
  aves: "AVES",
  reptilia: "REPTILIA",
  amphibia: "AMPHIBIA",
};

// Cache bounds computation: sisTaxonId → bounds
const boundsCache = new Map<string, [number, number, number, number]>();

async function getWgs84Bounds(
  tifPath: string
): Promise<[number, number, number, number]> {
  const { stdout } = await execFileAsync("gdalinfo", ["-json", tifPath]);
  const info = JSON.parse(stdout);
  if (info.wgs84Extent) {
    const coords = info.wgs84Extent.coordinates[0];
    const lons = coords.map((c: number[]) => c[0]);
    const lats = coords.map((c: number[]) => c[1]);
    return [
      Math.min(...lats),
      Math.min(...lons),
      Math.max(...lats),
      Math.max(...lons),
    ];
  }
  // Fallback for older GDAL
  const cc = info.cornerCoordinates;
  return [cc.lowerRight[1], cc.upperLeft[0], cc.upperLeft[1], cc.lowerRight[0]];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: sisTaxonId } = await params;
  const taxonGroup = request.nextUrl.searchParams.get("taxonGroup");

  if (!taxonGroup) {
    return NextResponse.json(
      { error: "taxonGroup query parameter is required" },
      { status: 400 }
    );
  }

  const folder = TAXON_GROUP_TO_FOLDER[taxonGroup.toLowerCase()];
  if (!folder) {
    return NextResponse.json(
      { error: `Unknown taxon group: ${taxonGroup}` },
      { status: 400 }
    );
  }

  const jsonPath = path.join(
    STAR_DATA_DIR,
    "aohs",
    "current",
    folder,
    `${sisTaxonId}_all.json`
  );

  if (!existsSync(jsonPath)) {
    return NextResponse.json(
      { error: "AOH metadata not found for this species" },
      { status: 404 }
    );
  }

  try {
    const raw = await readFile(jsonPath, "utf-8");
    const metadata = JSON.parse(raw);

    // Get WGS84 bounds from the TIF (cached)
    let bounds = boundsCache.get(sisTaxonId);
    if (!bounds) {
      const tifPath = path.join(
        STAR_DATA_DIR,
        "aohs",
        "current",
        folder,
        `${sisTaxonId}_all.tif`
      );
      if (existsSync(tifPath)) {
        bounds = await getWgs84Bounds(tifPath);
        boundsCache.set(sisTaxonId, bounds);
      }
    }

    return NextResponse.json(
      {
        ...metadata,
        // Add EPSG:4326 bounds as [south, west, north, east]
        bounds: bounds ?? null,
      },
      { headers: CACHE_1H }
    );
  } catch (error) {
    console.error("Error reading AOH metadata:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
