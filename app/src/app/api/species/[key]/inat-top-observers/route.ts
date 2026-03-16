import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

interface InatContributor {
  login: string;
  name: string | null;
  count: number;
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
      return NextResponse.json({ observers: [], identifiers: [] }, { headers: CACHE_1H });
    }
    const gbifData = await gbifResp.json();
    const canonicalName: string | undefined = gbifData.canonicalName;
    if (!canonicalName) {
      return NextResponse.json({ observers: [], identifiers: [] }, { headers: CACHE_1H });
    }

    // Step 2: Search iNaturalist for the taxon by exact name
    const taxaResp = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(canonicalName)}&rank=species,subspecies&per_page=5`
    );
    if (!taxaResp.ok) {
      return NextResponse.json({ observers: [], identifiers: [] }, { headers: CACHE_1H });
    }
    const taxaData = await taxaResp.json();
    const taxon = (taxaData.results || []).find(
      (t: { name?: string }) => t.name === canonicalName
    );
    if (!taxon) {
      return NextResponse.json({ observers: [], identifiers: [] }, { headers: CACHE_1H });
    }
    const inatTaxonId: number = taxon.id;

    // Step 3: Fetch top observers and identifiers in parallel
    const [observersResp, identifiersResp] = await Promise.all([
      fetch(
        `https://api.inaturalist.org/v1/observations/observers?taxon_id=${inatTaxonId}&per_page=500&order_by=observation_count`
      ),
      fetch(
        `https://api.inaturalist.org/v1/observations/identifiers?taxon_id=${inatTaxonId}&per_page=500`
      ),
    ]);

    const parseContributors = (
      data: { results?: Array<{ observation_count?: number; count?: number; user: { login: string; name?: string; icon?: string } }> },
      countField: "observation_count" | "count"
    ): InatContributor[] =>
      (data.results || []).map((r) => ({
        login: r.user.login,
        name: r.user.name || null,
        count: (r as Record<string, unknown>)[countField] as number || 0,
        iconUrl: r.user.icon || null,
      }));

    let observers: InatContributor[] = [];
    let totalObservers = 0;
    if (observersResp.ok) {
      const observersData = await observersResp.json();
      totalObservers = observersData.total_results || 0;
      observers = parseContributors(observersData, "observation_count");
    }

    let identifiers: InatContributor[] = [];
    let totalIdentifiers = 0;
    if (identifiersResp.ok) {
      const identifiersData = await identifiersResp.json();
      totalIdentifiers = identifiersData.total_results || 0;
      identifiers = parseContributors(identifiersData, "count");
    }

    return NextResponse.json(
      { observers, totalObservers, identifiers, totalIdentifiers, inatTaxonId },
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
