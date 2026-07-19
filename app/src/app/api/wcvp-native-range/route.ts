import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { CACHE_5M } from "@/lib/cache-headers";

/**
 * Looks up a species' native-country list (ISO 3166-1 alpha-2) from Kew's World
 * Checklist of Vascular Plants (WCVP) — the "POWO" native-range source in
 * OccurrenceMapRow.tsx (issue #82), alongside the Red List assessment-based one
 * already carried on every species as `s.countries`.
 *
 * Queries the ~17MB `wcvp-native-countries.parquet` (bundled with this function,
 * committed to the repo — see native-range-refdata/README.md) via DuckDB rather
 * than a plain JSON import: a JS import would force parsing the entire file into
 * a JS object on every cold start just to answer a single-name lookup (the JSON
 * version measured ~3s to do that, blocking Node's event loop for the whole
 * duration — noticeably delaying the rest of the page, including the occurrence
 * map). DuckDB reads only the matching row.
 */
const PARQUET_PATH = path.join(process.cwd(), "src", "lib", "native-range-refdata", "wcvp-native-countries.parquet");

let connPromise: Promise<DuckDBConnection> | null = null;
async function getConn(): Promise<DuckDBConnection> {
  if (!connPromise) {
    connPromise = (async () => {
      const instance = await DuckDBInstance.create(":memory:");
      return instance.connect();
    })();
  }
  return connPromise;
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name parameter is required" }, { status: 400 });
  }
  const conn = await getConn();
  const result = await conn.runAndReadAll(
    `SELECT countries FROM read_parquet($path) WHERE name = $name`,
    { path: PARQUET_PATH, name }
  );
  // DuckDB LIST columns come back from getRowObjects() as { items: [...] }, not a plain array.
  const rows = result.getRowObjects() as unknown as { countries: { items: string[] } }[];
  const countries = rows.length > 0 ? rows[0].countries.items : null;
  return NextResponse.json({ countries }, { headers: CACHE_5M });
}
