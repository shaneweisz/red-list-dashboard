import { NextRequest, NextResponse } from "next/server";
import { CACHE_5M } from "@/lib/cache-headers";

// iNaturalist-direct observation feed, keyed by scientific name rather than a
// GBIF taxonKey. This powers the iNat photo grid for species that GBIF's
// backbone doesn't know (CoL-only / not-yet-assessed species), where the
// GBIF occurrence search the rest of the app relies on returns nothing.

interface InatObservation {
  url: string;
  date: string | null;
  imageUrl: string | null;
  location: string | null;
  observer: string | null;
  mediaType: "StillImage" | "Sound" | "MovingImage" | null;
  audioUrl: string | null;
  gbifID: number | null;
  decimalLatitude: number | null;
  decimalLongitude: number | null;
  license: string | null;
  rightsHolder: string | null;
}

// iNaturalist photo license codes → Creative Commons URL (so the client's
// formatLicense() renders the same "CC BY-NC 4.0" labels as the GBIF path).
const INAT_LICENSE_URL: Record<string, string> = {
  "cc-by": "https://creativecommons.org/licenses/by/4.0/",
  "cc-by-nc": "https://creativecommons.org/licenses/by-nc/4.0/",
  "cc-by-sa": "https://creativecommons.org/licenses/by-sa/4.0/",
  "cc-by-nd": "https://creativecommons.org/licenses/by-nd/4.0/",
  "cc-by-nc-sa": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "cc-by-nc-nd": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
};

type InatPhoto = { url?: string; license_code?: string | null; attribution?: string | null };
type InatSound = { file_url?: string; license_code?: string | null };
type InatApiObservation = {
  id?: number;
  uri?: string;
  observed_on?: string | null;
  time_observed_at?: string | null;
  place_guess?: string | null;
  geojson?: { coordinates?: [number, number] } | null;
  photos?: InatPhoto[];
  sounds?: InatSound[];
  user?: { login?: string; name?: string | null } | null;
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get("name");
  // iNat paginates with 1-based page; the client sends a 0-based page index.
  const page = parseInt(searchParams.get("page") || "0", 10);
  // iNat caps per_page at 200.
  const perPage = Math.min(parseInt(searchParams.get("per_page") || "10", 10), 200);
  // geo=true returns georeferenced observations (for the map), regardless of
  // whether they carry a photo; otherwise we return only observations with
  // media (for the photo grid).
  const geo = searchParams.get("geo") === "true";

  if (!name) {
    return NextResponse.json(
      { error: "name parameter is required" },
      { status: 400 }
    );
  }

  try {
    // Step 1: Resolve the iNaturalist taxon id from the scientific name (exact match).
    const taxaResp = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=species,subspecies&per_page=5`
    );
    if (!taxaResp.ok) {
      return NextResponse.json({ observations: [], totalCount: 0, inatTaxonId: null }, { headers: CACHE_5M });
    }
    const taxaData = await taxaResp.json();
    const taxon = (taxaData.results || []).find((t: { name?: string }) => t.name === name);
    if (!taxon) {
      return NextResponse.json({ observations: [], totalCount: 0, inatTaxonId: null }, { headers: CACHE_5M });
    }
    const inatTaxonId: number = taxon.id;

    // Step 2: Fetch observations, newest first — georeferenced (map) or with media (grid).
    const obsParams = new URLSearchParams({
      taxon_id: inatTaxonId.toString(),
      [geo ? "geo" : "photos"]: "true",
      order: "desc",
      order_by: "observed_on",
      per_page: perPage.toString(),
      page: (page + 1).toString(),
    });
    const obsResp = await fetch(
      `https://api.inaturalist.org/v1/observations?${obsParams}`
    );
    if (!obsResp.ok) {
      return NextResponse.json({ observations: [], totalCount: 0, inatTaxonId }, { headers: CACHE_5M });
    }
    const obsData = await obsResp.json();
    const totalCount: number = obsData.total_results || 0;

    const observations: InatObservation[] = (obsData.results || [])
      .map((obs: InatApiObservation): InatObservation => {
        const photo = obs.photos?.[0];
        const sound = obs.sounds?.[0];
        // iNat thumbnails come back as ".../square.jpg"; the app's getThumbUrl
        // rewrites ".../original." → ".../small.", so normalise to original here.
        const imageUrl = photo?.url ? photo.url.replace(/\/square\./, "/original.") : null;
        const audioUrl = sound?.file_url || null;
        const coords = obs.geojson?.coordinates ?? null;
        const licenseCode = photo?.license_code || null;
        return {
          url: obs.uri || `https://www.inaturalist.org/observations/${obs.id}`,
          date: obs.observed_on || (obs.time_observed_at ? obs.time_observed_at.split("T")[0] : null),
          imageUrl,
          audioUrl,
          mediaType: imageUrl ? "StillImage" : audioUrl ? "Sound" : null,
          location: obs.place_guess || null,
          observer: obs.user?.name || obs.user?.login || null,
          gbifID: null,
          decimalLatitude: coords ? coords[1] : null,
          decimalLongitude: coords ? coords[0] : null,
          license: licenseCode ? INAT_LICENSE_URL[licenseCode] ?? null : null,
          rightsHolder: photo?.attribution || null,
        };
      })
      // geo mode: keep georeferenced records (the map needs coordinates, not media);
      // grid mode: keep records that actually carry a photo or sound.
      .filter((o: InatObservation) =>
        geo
          ? o.decimalLatitude != null && o.decimalLongitude != null
          : o.imageUrl != null || o.audioUrl != null
      );

    return NextResponse.json({ observations, totalCount, inatTaxonId }, { headers: CACHE_5M });
  } catch (error) {
    console.error("Error fetching iNat observations:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
