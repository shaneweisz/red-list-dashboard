import { NextRequest, NextResponse } from "next/server";
import { getSpeciesById } from "@/lib/data/species-store";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  const group = request.nextUrl.searchParams.get("group");

  if (isNaN(id) || !group) {
    return NextResponse.json(
      { error: "Invalid or missing id/group params" },
      { status: 400 }
    );
  }

  try {
    const species = getSpeciesById(id, group);
    if (!species) {
      return NextResponse.json(
        { error: "Species not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ species }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Species lookup error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Species lookup failed: ${message}` },
      { status: 500 }
    );
  }
}
