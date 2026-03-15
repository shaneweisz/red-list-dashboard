import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

interface InatObserver {
  login: string;
  name: string | null;
  observationCount: number;
  iconUrl: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  try {
    // Step 1: Get canonical name from GBIF species API
    const gbifResp = await fetch(`https://api.gbif.org/v1/species/${key}`);
    if (!gbifResp.ok) {
      return NextResponse.json({ observers: [] }, { headers: CACHE_1H });
    }
    const gbifData = await gbifResp.json();
    const canonicalName: string | undefined = gbifData.canonicalName;
    if (!canonicalName) {
      return NextResponse.json({ observers: [] }, { headers: CACHE_1H });
    }

    // Step 2: Search iNaturalist for the taxon by exact name
    const taxaResp = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(canonicalName)}&rank=species,subspecies&per_page=5`
    );
    if (!taxaResp.ok) {
      return NextResponse.json({ observers: [] }, { headers: CACHE_1H });
    }
    const taxaData = await taxaResp.json();
    const taxon = (taxaData.results || []).find(
      (t: { name?: string }) => t.name === canonicalName
    );
    if (!taxon) {
      return NextResponse.json({ observers: [] }, { headers: CACHE_1H });
    }
    const inatTaxonId: number = taxon.id;

    // Step 3: Fetch top observers from iNaturalist
    const observersResp = await fetch(
      `https://api.inaturalist.org/v1/observations/observers?taxon_id=${inatTaxonId}&per_page=20&order_by=observation_count`
    );
    if (!observersResp.ok) {
      return NextResponse.json({ observers: [] }, { headers: CACHE_1H });
    }
    const observersData = await observersResp.json();
    const totalObservers: number = observersData.total_results || 0;

    const observers: InatObserver[] = (observersData.results || []).map(
      (r: {
        observation_count: number;
        user: { login: string; name?: string; icon?: string };
      }) => ({
        login: r.user.login,
        name: r.user.name || null,
        observationCount: r.observation_count,
        iconUrl: r.user.icon || null,
      })
    );

    return NextResponse.json(
      { observers, totalObservers, inatTaxonId },
      { headers: CACHE_1H }
    );
  } catch (error) {
    console.error("Error fetching iNat top observers:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
