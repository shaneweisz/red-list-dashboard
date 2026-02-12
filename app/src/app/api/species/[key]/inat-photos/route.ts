import { NextRequest, NextResponse } from "next/server";

interface InatObservation {
  url: string;
  date: string | null;
  imageUrl: string | null;
  location: string | null;
  observer: string | null;
  mediaType: "StillImage" | "Sound" | "MovingImage" | null;
  audioUrl: string | null;
}

const INAT_DATASET_KEY = "50c9509d-22c7-4a22-a47d-8c48425ef4a7";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const speciesKey = key;
  const searchParams = request.nextUrl.searchParams;
  const country = searchParams.get("country");
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  try {
    const queryParams = new URLSearchParams({
      taxonKey: speciesKey,
      datasetKey: INAT_DATASET_KEY,
      hasCoordinate: "true",
      limit: limit.toString(),
      offset: offset.toString(),
      ...(country ? { country: country.toUpperCase() } : {}),
    });

    const resp = await fetch(
      `https://api.gbif.org/v1/occurrence/search?${queryParams}`
    );

    if (!resp.ok) {
      return NextResponse.json({ observations: [], totalCount: 0 });
    }

    const data = await resp.json();
    const totalCount = data.count || 0;

    const observations: InatObservation[] = (data.results || [])
      .filter(
        (obs: { references?: string; media?: { type?: string; identifier?: string }[] }) =>
          obs.references && obs.media && obs.media.length > 0 && obs.media[0]?.identifier
      )
      .map(
        (obs: {
          references: string;
          eventDate?: string;
          media?: { type?: string; identifier?: string; format?: string }[];
          verbatimLocality?: string;
          stateProvince?: string;
          country?: string;
          recordedBy?: string;
        }) => {
          const media = obs.media || [];
          const imageMedia = media.find((m) => m.type === "StillImage");
          const audioMedia = media.find((m) => m.type === "Sound");
          const primaryType = (media[0]?.type as InatObservation["mediaType"]) || null;

          const imageUrl = imageMedia?.identifier || null;
          const audioUrl = audioMedia?.identifier || null;

          const locationParts = [
            obs.verbatimLocality,
            obs.stateProvince,
            obs.country,
          ].filter(Boolean);
          const location =
            locationParts.length > 0 ? locationParts.join(", ") : null;
          return {
            url: obs.references,
            date: obs.eventDate ? obs.eventDate.split("T")[0] : null,
            imageUrl,
            audioUrl,
            mediaType: primaryType,
            location,
            observer: obs.recordedBy || null,
          };
        }
      );

    return NextResponse.json({ observations, totalCount });
  } catch (error) {
    console.error("Error fetching iNat photos:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
