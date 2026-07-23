import { NextRequest, NextResponse } from "next/server";
import { getLiveBreakdown } from "@/lib/data/live-breakdown";
import { CACHE_1H } from "@/lib/cache-headers";

// Live, on-demand no-match diagnostic breakdown — see live-breakdown.ts's doc
// comment. Fetched lazily by TaxaSummary.tsx's BreakdownList only when a user
// expands a specific bucket, never eagerly for a whole level.
export async function GET(request: NextRequest) {
  const nodeId = request.nextUrl.searchParams.get("nodeId");
  if (!nodeId) {
    return NextResponse.json({ error: "Missing nodeId parameter" }, { status: 400 });
  }

  try {
    const breakdown = await getLiveBreakdown(nodeId);
    if (!breakdown) {
      return NextResponse.json({ error: "Unknown node" }, { status: 404 });
    }
    return NextResponse.json({ breakdown }, { headers: CACHE_1H });
  } catch (error) {
    console.error(`Live breakdown error for ${nodeId}:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Breakdown failed: ${message}` }, { status: 500 });
  }
}
