import { NextRequest, NextResponse } from "next/server";
import { getSpecies } from "@/lib/data/species-store";
import { getCsvGroupsForNode } from "@/lib/taxonomy-utils";
import { CACHE_5M } from "@/lib/cache-headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const taxonId = searchParams.get("taxon") || "all";
  const category = searchParams.get("category");
  const groups = getCsvGroupsForNode(taxonId);

  try {
    const includeNE = category === "NE";
    let species = getSpecies(groups, includeNE);

    if (category === "NE") {
      species = species.filter((s) => s.category === "NE");
    }

    // Stream JSON to avoid holding the entire serialized string in memory.
    // JSON.stringify of 172K objects creates a ~113MB string; streaming writes
    // one row at a time so V8 only needs ~1KB per iteration.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`{"species":[`));
        for (let i = 0; i < species.length; i++) {
          if (i > 0) controller.enqueue(encoder.encode(","));
          controller.enqueue(encoder.encode(JSON.stringify(species[i])));
        }
        controller.enqueue(encoder.encode(`],"total":${species.length}}`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/json",
        ...CACHE_5M,
      },
    });
  } catch (error) {
    console.error("Species query error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Species query failed: ${message}` },
      { status: 500 }
    );
  }
}
