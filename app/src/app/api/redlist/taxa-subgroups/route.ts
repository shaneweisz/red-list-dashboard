import { NextRequest, NextResponse } from "next/server";
import { getChildrenSummaries } from "@/lib/data/species-store";
import { findNode, hasChildren } from "@/lib/taxonomy-utils";
import { CACHE_1H } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  // Accept both ?nodeId=X (new) and ?taxonId=X (backward compat)
  const nodeId =
    request.nextUrl.searchParams.get("nodeId") ??
    request.nextUrl.searchParams.get("taxonId");

  if (!nodeId) {
    return NextResponse.json(
      { error: "Missing nodeId parameter" },
      { status: 400 }
    );
  }

  if (!findNode(nodeId) || !hasChildren(nodeId)) {
    return NextResponse.json({ subgroups: [] }, { headers: CACHE_1H });
  }

  try {
    const subgroups = getChildrenSummaries(nodeId);
    return NextResponse.json({ subgroups }, { headers: CACHE_1H });
  } catch (error) {
    console.error(`Node children summary error for ${nodeId}:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Node summary failed: ${message}` },
      { status: 500 }
    );
  }
}
