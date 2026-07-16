import { NextResponse } from "next/server";
import { getDataSyncDate } from "@/lib/data/species-store";
import { CACHE_1H } from "@/lib/cache-headers";

export async function GET() {
  try {
    return NextResponse.json({ dataAsOf: getDataSyncDate().toISOString() }, { headers: CACHE_1H });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `data-sync-date failed: ${message}` }, { status: 500 });
  }
}
