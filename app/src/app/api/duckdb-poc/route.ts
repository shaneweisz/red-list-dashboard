/**
 * PROOF-OF-CONCEPT (issue #260): query a Parquet file in R2 with DuckDB from a
 * serverless function. Validates the static-only "Parquet-on-R2 + DuckDB" bet —
 * native binding on Vercel, httpfs over R2 range requests, latency, bundle size.
 *
 * Not for production. Remove with the rest of the POC.
 *
 *   /api/duckdb-poc?mode=filter&taxon=mammalia        (clade)
 *   /api/duckdb-poc?mode=filter&family=felidae        (arbitrary rank, no node today)
 *   /api/duckdb-poc?mode=rollup&class=mammalia        (GROUP BY order × category)
 */
import { NextRequest, NextResponse } from "next/server";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

const PARQUET = `s3://${process.env.R2_DATA_BUCKET_NAME}/poc/species.parquet`;

// Cache the connection across warm invocations; time the cold init separately.
let connPromise: Promise<DuckDBConnection> | null = null;
let initMs = 0;

async function getConn(): Promise<DuckDBConnection> {
  if (!connPromise) {
    connPromise = (async () => {
      const t0 = Date.now();
      const inst = await DuckDBInstance.create(":memory:", {
        // Vercel's FS is read-only except /tmp — point DuckDB's extension dir there.
        extension_directory: "/tmp/duckdb_ext",
        home_directory: "/tmp",
      });
      const conn = await inst.connect();
      await conn.run("SET autoinstall_known_extensions=true; SET autoload_known_extensions=true;");
      await conn.run("INSTALL httpfs; LOAD httpfs;");
      await conn.run(`
        SET s3_region='auto';
        SET s3_endpoint='${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com';
        SET s3_url_style='path';
        SET s3_access_key_id='${process.env.R2_ACCESS_KEY_ID}';
        SET s3_secret_access_key='${process.env.R2_SECRET_ACCESS_KEY}';
      `);
      initMs = Date.now() - t0;
      return conn;
    })();
  }
  return connPromise;
}

// DuckDB returns BigInt for COUNT etc. — make it JSON-safe.
function jsonSafe(rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === "bigint" ? Number(v) : v;
    return o;
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const mode = sp.get("mode") ?? "filter";
  try {
    const conn = await getConn();
    const t0 = Date.now();
    let sql: string;

    if (mode === "rollup") {
      const cls = (sp.get("class") ?? "mammalia").replace(/'/g, "");
      sql = `SELECT order_name, iucn_category, count(*) AS n
             FROM '${PARQUET}' WHERE class_name = '${cls}'
             GROUP BY ALL ORDER BY n DESC`;
    } else {
      // filter by whichever rank is provided (proves arbitrary-rank filtering)
      const col = sp.get("family") ? "family"
        : sp.get("order") ? "order_name"
        : sp.get("taxon") || sp.get("class") ? "class_name"
        : "class_name";
      const val = (sp.get("family") || sp.get("order") || sp.get("taxon") || sp.get("class") || "mammalia").replace(/'/g, "");
      sql = `SELECT sis_taxon_id, scientific_name, common_name, class_name, order_name, family, iucn_category
             FROM '${PARQUET}' WHERE ${col} = '${val}' LIMIT 50`;
    }

    const reader = await conn.run(sql);
    const rows = jsonSafe(await reader.getRowObjects());
    const queryMs = Date.now() - t0;

    return NextResponse.json({
      ok: true,
      mode,
      coldInitMs: initMs,        // one-time DuckDB+httpfs init for this instance
      queryMs,                   // this query (warm)
      rowCount: rows.length,
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), initMs },
      { status: 500 }
    );
  }
}
