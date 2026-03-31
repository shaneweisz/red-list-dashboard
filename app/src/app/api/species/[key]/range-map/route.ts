import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { CACHE_1H } from "@/lib/cache-headers";

// In-memory cache: assessmentId → { data, timestamp }
const rangeCache = new Map<number, { data: object; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

const PRESENCE_LABELS: Record<number, string> = {
  1: "Extant",
  2: "Probably Extant",
  3: "Possibly Extant",
  4: "Possibly Extinct",
  5: "Extinct",
  6: "Presence Uncertain",
};

const ORIGIN_LABELS: Record<number, string> = {
  1: "Native",
  2: "Reintroduced",
  3: "Introduced",
  4: "Vagrant",
  5: "Origin Uncertain",
  6: "Assisted Colonisation",
};

const DEFAULT_SIMPLIFY = 0.01; // ~1km tolerance in degrees

function getDbClient() {
  return new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const assessmentId = parseInt(key, 10);

  if (isNaN(assessmentId)) {
    return NextResponse.json(
      { error: "Invalid assessment ID" },
      { status: 400 }
    );
  }

  const simplify = parseFloat(
    request.nextUrl.searchParams.get("simplify") ?? String(DEFAULT_SIMPLIFY)
  );

  // Check cache (only for default simplify)
  if (simplify === DEFAULT_SIMPLIFY) {
    const cached = rangeCache.get(assessmentId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json(cached.data, { headers: CACHE_1H });
    }
  }

  const client = getDbClient();

  try {
    await client.connect();

    // Query mirrors STAR pipeline (extract_species_data_psql.py lines 97-107)
    // but returns separate geometries per presence/origin for frontend flexibility.
    // ST_SimplifyPreserveTopology reduces complexity for web rendering.
    const query =
      simplify > 0
        ? `
      SELECT
        assessment_ranges.presence,
        assessment_ranges.origin,
        ST_AsGeoJSON(
          ST_SimplifyPreserveTopology(
            ST_Union(assessment_ranges.geom::geometry),
            $2
          )
        ) AS geojson
      FROM
        assessments
        LEFT JOIN assessment_ranges ON assessment_ranges.assessment_id = assessments.id
      WHERE
        assessments.id = $1
        AND assessment_ranges.geom IS NOT NULL
      GROUP BY assessment_ranges.presence, assessment_ranges.origin
    `
        : `
      SELECT
        assessment_ranges.presence,
        assessment_ranges.origin,
        ST_AsGeoJSON(
          ST_Union(assessment_ranges.geom::geometry)
        ) AS geojson
      FROM
        assessments
        LEFT JOIN assessment_ranges ON assessment_ranges.assessment_id = assessments.id
      WHERE
        assessments.id = $1
        AND assessment_ranges.geom IS NOT NULL
      GROUP BY assessment_ranges.presence, assessment_ranges.origin
    `;

    const queryParams = simplify > 0 ? [assessmentId, simplify] : [assessmentId];
    const result = await client.query(query, queryParams);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "No range map found for this assessment" },
        { status: 404 }
      );
    }

    // Build GeoJSON FeatureCollection with presence/origin as properties
    const features = result.rows
      .filter((row) => row.geojson != null)
      .map((row) => ({
        type: "Feature" as const,
        properties: {
          presence: row.presence,
          presence_label: PRESENCE_LABELS[row.presence] ?? `Unknown (${row.presence})`,
          origin: row.origin,
          origin_label: ORIGIN_LABELS[row.origin] ?? `Unknown (${row.origin})`,
        },
        geometry: JSON.parse(row.geojson),
      }));

    if (features.length === 0) {
      return NextResponse.json(
        { error: "No valid geometries found" },
        { status: 404 }
      );
    }

    const featureCollection = {
      type: "FeatureCollection",
      features,
    };

    // Cache the result
    if (simplify === DEFAULT_SIMPLIFY) {
      rangeCache.set(assessmentId, {
        data: featureCollection,
        timestamp: Date.now(),
      });
    }

    return NextResponse.json(featureCollection, { headers: CACHE_1H });
  } catch (error) {
    console.error("Error fetching range map:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    await client.end().catch(() => { });
  }
}
