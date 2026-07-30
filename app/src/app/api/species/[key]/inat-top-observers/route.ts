import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";
import { GBIF_CHECKLIST_KEY } from "@/lib/gbif";

interface InatContributor {
  login: string;
  name: string | null;
  count: number;
  iconUrl: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  // Species without a GBIF backbone match (CoL-only / not-yet-assessed) pass their
  // scientific name directly, since the GBIF species lookup below can't resolve them.
  const nameParam = request.nextUrl.searchParams.get("name");

  try {
    // Step 1: Determine the canonical scientific name — from the `name` param when
    // provided, otherwise from the GBIF species API keyed by the GBIF taxon key.
    let canonicalName: string | undefined = nameParam || undefined;
    if (!canonicalName) {
      // v2 match keyed by usageKey: v1/species/{key} only understands the legacy
      // Backbone's integer keys and returns 400 for a Catalogue of Life id, which
      // this route then turned into an empty result with a one-hour cache header.
      const gbifResp = await fetch(
        `https://api.gbif.org/v2/species/match?${new URLSearchParams({
          checklistKey: GBIF_CHECKLIST_KEY,
          usageKey: key,
        })}`
      );
      if (!gbifResp.ok) {
        return NextResponse.json({ observers: [], identifiers: [] }, { headers: CACHE_1H });
      }
      const gbifData = await gbifResp.json();
      canonicalName = gbifData.usage?.canonicalName;
    }
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
