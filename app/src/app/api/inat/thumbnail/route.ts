import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

// Default-photo lookup for the species table's thumbnail column, keyed by
// scientific name. Proxied (rather than called directly from the browser)
// so repeat visits share Vercel's edge cache instead of every client hitting
// iNaturalist directly for the same handful of species on every page load.

interface InatDefaultImage {
  squareUrl: string | null;
  mediumUrl: string | null;
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name parameter is required" }, { status: 400 });
  }

  try {
    // iNat's q= search is fuzzy/relevance-ranked (by observation count), not
    // an exact lookup — per_page=10 + the exact-name filter below guards
    // against a rare species losing the top spot to a much more commonly
    // observed, unrelated taxon that happens to share its epithet (e.g.
    // "Monachus monachus", the Mediterranean Monk Seal, ranks 10th behind
    // several unrelated birds sharing "monachus").
    const taxaResp = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=species&per_page=10`
    );
    if (!taxaResp.ok) {
      return NextResponse.json({ inatDefaultImage: null }, { headers: CACHE_1H });
    }
    const taxaData = await taxaResp.json();
    const exactMatch = (taxaData.results || []).find((t: { name?: string }) => t.name === name);
    const defaultPhoto = exactMatch?.default_photo;

    const inatDefaultImage: InatDefaultImage | null = defaultPhoto
      ? {
          squareUrl: defaultPhoto.square_url || defaultPhoto.url || null,
          mediumUrl: defaultPhoto.medium_url || defaultPhoto.url || null,
        }
      : null;

    return NextResponse.json({ inatDefaultImage }, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching iNat thumbnail:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
