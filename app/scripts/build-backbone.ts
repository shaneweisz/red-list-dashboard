/**
 * build-backbone (#271, Phase 3): turn the Catalogue of Life eXtended Release
 * (XR) ColDP into the taxonomic-backbone parquets that replace the hand-curated
 * taxonomy tree. Two outputs:
 *
 *  - backbone.parquet   = the full CoL NameUsage (all ranks + synonyms): one row
 *      per usage with col_id, parent_id, status, rank, scientific_name,
 *      authorship. The tree edges (parent_id), synonym→accepted resolution, and
 *      arbitrary-rank nodes all derive from this. Lean (~9.4M rows), single file.
 *  - species/           = the accepted-species universe (~2.4M), Hive-partitioned
 *      for pruning. XR ships denormalized lineage, so each row carries kingdom…genus
 *      directly (no parent_id walk). Partitioned by `part` (= phylum within Animalia,
 *      else kingdom) since Animalia is 1.8M / Arthropoda 1.35M — this isolates the
 *      giant clades. Lineage-sorted within each partition. Each row carries two flags
 *      that define the DISPLAYABLE EXTANT universe: `extinct` (CoL's col:extinct
 *      tri-state) and `in_base` (its source is a curated CoL Base GSD, not the XR
 *      paleo-paper tail). The read layer's universe = `in_base AND extinct IS NOT
 *      TRUE`, which tracks IUCN Table 1a "described" (= extant) counts.
 *
 * Input: NameUsage.tsv from the XR ColDP archive (env COLDP_TSV, else
 * data/_coldp_xr.tsv). A companion fetch step downloads the export.zip
 * (api.checklistbank.org/dataset/313100/export.zip?format=ColDP&extended=true)
 * and extracts NameUsage.tsv; this script is the transform. XR ≈ ChecklistBank
 * dataset 313100 ("COL25.11 XR"), a swappable pinned dep.
 *
 *   COLDP_TSV=/path/to/NameUsage.tsv npx tsx scripts/build-backbone.ts
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR } from "./utils";

// The browsable species universe is status='accepted' ONLY. CoL also marks names
// 'provisionally accepted' — its uncertainty hedge, a grab-bag of dubious names
// and unflagged fossils. Including them overshoots IUCN Table 1a described counts
// (e.g. mammals 1.26× vs 1.05× accepted-only; Table 1a "described" = extant), so
// the universe excludes them. The backbone below still keeps EVERY usage
// (provisional + synonyms) for tree edges + synonym→accepted resolution.
const SPECIES_STATUS = "('accepted')";

// CoL Base release (ChecklistBank dataset key) whose ~165 source datasets are the
// curated "Global Species Databases" (GSDs). XR = Base GSDs + an extended tail of
// mostly individual paleontology papers, each its own source, that describe fossil
// species WITHOUT setting col:extinct — so the extinct flag alone can't catch them.
// We tag each species with in_base = (its sourceID is a Base GSD); the read layer's
// extant universe filters to in_base, dropping that unflagged-fossil tail. Source
// keys are global + version-stable, so a current Base release is a valid allowlist.
const COL_BASE_DATASET = process.env.COL_BASE_DATASET || "315149";

async function fetchBaseSourceIds(): Promise<string[]> {
  const res = await fetch(`https://api.checklistbank.org/dataset/${COL_BASE_DATASET}/source`);
  if (!res.ok) throw new Error(`Base source list fetch failed (${COL_BASE_DATASET}): ${res.status}`);
  const arr = (await res.json()) as Array<{ key: number }>;
  const ids = arr.map((s) => String(s.key)).filter(Boolean);
  if (ids.length === 0) throw new Error(`Base ${COL_BASE_DATASET} returned no sources`);
  return ids;
}

export async function run(opts: { tsv?: string; outDir?: string; baseSourceIds?: string[] } = {}): Promise<void> {
  const tsv = opts.tsv || process.env.COLDP_TSV || path.join(DATA_DIR, "_coldp_xr.tsv");
  if (!fs.existsSync(tsv)) {
    throw new Error(`ColDP TSV not found: ${tsv}. Set COLDP_TSV or run the XR fetch step.`);
  }
  const outDir = opts.outDir || DATA_DIR;
  const backboneOut = path.join(outDir, "backbone.parquet");
  const speciesDir = path.join(outDir, "species");
  fs.mkdirSync(outDir, { recursive: true });

  const baseSourceIds = opts.baseSourceIds ?? (await fetchBaseSourceIds());

  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();
  // The Base-GSD source allowlist as a temp table for the in_base tag below.
  await conn.run(`CREATE TEMP TABLE base_src(id VARCHAR);`);
  await conn.run(`INSERT INTO base_src VALUES ${baseSourceIds.map((i) => `('${i.replace(/'/g, "''")}')`).join(",")};`);

  // Load the full NameUsage once. all_varchar avoids type-sniffing surprises on
  // the ~9.4M-row / ~70-col ColDP TSV; we only need a handful of columns. The
  // denormalized lineage (col:kingdom…col:genus) and col:extinct are standard
  // ColDP; we no longer read the ChecklistBank-only clb:taxGroup augmentation.
  await conn.run(`
    CREATE TEMP TABLE nu AS
      SELECT
        "col:ID" AS col_id, "col:parentID" AS parent_id, "col:status" AS status,
        "col:rank" AS rank, "col:scientificName" AS scientific_name, "col:authorship" AS authorship,
        "col:kingdom" AS kingdom, "col:phylum" AS phylum, "col:class" AS class_name,
        "col:order" AS order_name, "col:family" AS family, "col:genus" AS genus,
        "col:sourceID" AS source_id,
        -- CoL flags a species fossil via col:extinct ('true'/'false'/empty). Kept
        -- as a tri-state boolean (true=fossil, false=extant, null=unflagged): the
        -- species universe filters out true so per-group totals track IUCN Table 1a
        -- (described = extant). The extinct flag is sparse (many fossils are null),
        -- so in_base (below) catches the rest.
        CASE WHEN lower("col:extinct") = 'true' THEN TRUE
             WHEN lower("col:extinct") = 'false' THEN FALSE END AS extinct
      FROM read_csv('${tsv}', delim='\t', header=true, quote='', ignore_errors=true, all_varchar=true);
  `);

  // backbone.parquet — the lean tree + synonyms (all ranks, all statuses).
  await conn.run(`
    COPY (SELECT col_id, parent_id, status, rank, scientific_name, authorship FROM nu)
    TO '${backboneOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  // species/ — accepted species only, lineage from XR's denormalized columns,
  // partitioned by `part` and lineage-sorted within. Small row groups so the
  // class/order/family filters prune finely (the single-file layout did not).
  fs.rmSync(speciesDir, { recursive: true, force: true });
  await conn.run(`
    COPY (
      SELECT
        col_id, scientific_name, authorship,
        lower(kingdom) AS kingdom, lower(phylum) AS phylum, lower(class_name) AS class_name,
        lower(order_name) AS order_name, lower(family) AS family, lower(genus) AS genus,
        extinct,
        (source_id IN (SELECT id FROM base_src)) AS in_base,
        coalesce(nullif(CASE WHEN kingdom = 'Animalia' THEN phylum ELSE kingdom END, ''), 'other') AS part
      FROM nu
      WHERE rank = 'species' AND status IN ${SPECIES_STATUS}
      ORDER BY kingdom, phylum, class_name, order_name, family, scientific_name
    ) TO '${speciesDir}' (FORMAT PARQUET, PARTITION_BY (part), COMPRESSION ZSTD, ROW_GROUP_SIZE 20000, OVERWRITE_OR_IGNORE);
  `);

  // ── verification ───────────────────────────────────────────────────────────
  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const bb = (await q(`SELECT count(*) n, count(*) FILTER (status='accepted') acc,
                              count(*) FILTER (status='provisionally accepted') prov,
                              count(*) FILTER (status LIKE '%synonym%') syn FROM '${backboneOut}'`))[0];
  console.log(`Wrote ${backboneOut}: ${Number(bb.n).toLocaleString()} usages (${Number(bb.acc).toLocaleString()} accepted, ${Number(bb.prov).toLocaleString()} provisionally accepted, ${Number(bb.syn).toLocaleString()} synonyms)`);
  const sp = (await q(`SELECT count(*) n, count(DISTINCT part) parts,
                              count(*) FILTER (extinct IS TRUE) AS fossil,
                              count(*) FILTER (NOT in_base) AS non_base,
                              count(*) FILTER (in_base AND extinct IS NOT TRUE) AS universe
                       FROM '${speciesDir}/**/*.parquet'`))[0];
  console.log(`Wrote ${speciesDir}/: ${Number(sp.n).toLocaleString()} accepted species across ${Number(sp.parts)} partitions (${baseSourceIds.length} Base GSD sources)`);
  console.log(`  extant universe (in_base AND NOT fossil): ${Number(sp.universe).toLocaleString()} — drops ${Number(sp.fossil).toLocaleString()} flagged fossils + ${Number(sp.non_base).toLocaleString()} non-Base (the unflagged-fossil tail)`);
  const parts = await q(`SELECT part, count(*) n FROM '${speciesDir}/**/*.parquet' GROUP BY part ORDER BY n DESC LIMIT 6`);
  console.log("  largest partitions:", parts.map((r) => `${r.part}=${Number(r.n).toLocaleString()}`).join(", "));
}

const isDirectRun = process.argv[1]?.endsWith("build-backbone.ts") || process.argv[1]?.endsWith("build-backbone.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
