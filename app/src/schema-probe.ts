import { getConn, parquetUri } from "@/lib/data/species-duckdb";

const conn = await getConn();
for (const src of ["assessed.parquet", "unassessed.parquet"]) {
  const cols = (await conn.runAndReadAll(`DESCRIBE SELECT * FROM '${parquetUri(src)}'`)).getRowObjects();
  const idish = cols.map((c) => String(c.column_name)).filter((n) =>
    /id$|key$|sis|col|taxon/i.test(n)
  );
  console.log(`\n${src}: ${cols.length} columns`);
  console.log("  identifier-ish:", idish.join(", "));
}
for (const [src, name] of [["assessed.parquet", "Dracaena cinnabari"], ["unassessed.parquet", "Dioscorea biplicata"]] as const) {
  const rows = (await conn.runAndReadAll(
    `SELECT * FROM '${parquetUri(src)}' WHERE scientific_name = '${name}' LIMIT 1`
  )).getRowObjects();
  const r = rows[0] ?? {};
  const picked = Object.fromEntries(
    Object.entries(r).filter(([k]) => /^id$|assessment_id|sis|gbif_species_key|col_id|taxon_id/i.test(k))
  );
  console.log(`\n${name} (${src}):`, picked);
}
process.exit(0);
