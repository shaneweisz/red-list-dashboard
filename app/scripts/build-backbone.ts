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
 * Curated-checklist demotion overlay: XR maximizes coverage but does NOT reconcile
 * conflicting source taxonomies, so it over-splits — surfacing contested splits as
 * accepted species that become spurious "Not Evaluated" rows (e.g. Pycnonotus
 * tricolor: accepted species in XR, but a synonym of the assessed P. barbatus in the
 * curated CoL Checklist). We correct this by dropping from species/ any col_id the
 * curated checklist DEMOTES (to synonym / infraspecific). The principle is
 * asymmetric: curated CONTRADICTION removes a species, but curated SILENCE never
 * does — so groups XR has and the checklist lacks (e.g. macroalgae, whose AlgaeBase
 * GSD isn't in the curated assembly) are preserved. col_ids are shared across both
 * datasets so the join is exact. The demotion set comes from fetch-col-checklist
 * (the simple 3LR ColDP); when absent (e.g. a partial run), no demotions are applied.
 *
 * Input: NameUsage.tsv from the XR ColDP archive (env COLDP_TSV, else
 * data/_coldp_xr.tsv). A companion fetch step downloads the export.zip
 * (api.checklistbank.org/dataset/313100/export.zip?format=ColDP&extended=true)
 * and extracts NameUsage.tsv; this script is the transform. XR ≈ ChecklistBank
 * dataset 313100 ("COL25.11 XR"), a swappable pinned dep. The demotion overlay reads
 * the curated checklist NameUsage (env COL_CHECKLIST_TSV / opts.demotionsTsv).
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

// A curated-checklist usage "demotes" an XR-accepted species when the checklist does
// NOT recognize that col_id as an accepted species — i.e. it's a synonym (incl.
// ambiguous synonym), misapplied, or accepted only at an infraspecific rank. Such
// col_ids are dropped from the XR species universe (see the demotion overlay above).
const DEMOTED_PREDICATE = `
  lower("col:status") LIKE '%synonym%'
  OR lower("col:status") = 'misapplied'
  OR (lower("col:status") IN ('accepted', 'provisionally accepted')
      AND lower("col:rank") IN ('subspecies','variety','form','subvariety','subform','natio','aberration'))`;

// CoL lineage → IUCN Table 1a group, per Table 1a's footnote definitions (2025-2):
// crustaceans = note 6's 7 classes (Maxillopoda split into CoL's copepoda/thecostraca/
// hexanauplia/ichthyostraca); corals = Octocorallia + orders Antipatharia/Corallimorpharia/
// Scleractinia; mosses = note 8; ferns&allies = note 9 (CoL lumps most into polypodiopsida/
// lycopodiopsida); brown_algae = Phaeophyceae (the actual brown seaweeds, not all
// Ochrophytina which includes diatoms). Evaluated top-down: specific groups before the
// `animalia`/kingdom catch-alls. Anything outside the 28 groups → 'other' (not surfaced).
// Lineage columns are already lowercased in the subquery this is applied over.
const TAXON_GROUP_CASE = `
  CASE
    WHEN class_name = 'mammalia' THEN 'mammals'
    WHEN class_name = 'aves' THEN 'birds'
    WHEN class_name = 'reptilia' THEN 'reptiles'
    WHEN class_name = 'amphibia' THEN 'amphibians'
    WHEN class_name IN ('teleostei','elasmobranchii','holocephali','myxini','petromyzonti','chondrostei','cladistii','holostei','dipneusti','coelacanthi') THEN 'fishes'
    WHEN order_name = 'coleoptera' THEN 'beetles'
    WHEN order_name = 'lepidoptera' THEN 'butterflies_and_moths'
    WHEN order_name = 'diptera' THEN 'flies_and_mosquitoes'
    WHEN order_name = 'hymenoptera' THEN 'bees_wasps_and_ants'
    WHEN order_name = 'hemiptera' THEN 'true_bugs'
    WHEN order_name = 'orthoptera' THEN 'grasshoppers_crickets_locusts'
    WHEN order_name = 'odonata' THEN 'dragonflies_and_damselflies'
    WHEN class_name = 'insecta' THEN 'other_insects'
    WHEN class_name = 'arachnida' THEN 'arachnids'
    WHEN phylum = 'mollusca' THEN 'molluscs'
    WHEN class_name IN ('malacostraca','branchiopoda','ostracoda','copepoda','thecostraca','hexanauplia','ichthyostraca','remipedia','cephalocarida','mystacocarida','tantulocarida') THEN 'crustaceans'
    WHEN class_name = 'octocorallia' OR order_name IN ('scleractinia','antipatharia','corallimorpharia') THEN 'corals'
    WHEN phylum = 'onychophora' THEN 'velvet_worms'
    WHEN class_name = 'merostomata' THEN 'horseshoe_crabs'
    WHEN kingdom = 'animalia' THEN 'other_invertebrates'
    WHEN class_name IN ('magnoliopsida','liliopsida') THEN 'flowering_plants'
    WHEN class_name IN ('pinopsida','cycadopsida','ginkgoopsida','gnetopsida') THEN 'gymnosperms'
    WHEN class_name IN ('polypodiopsida','lycopodiopsida','isoetopsida','equisetopsida','marattiopsida','psilotopsida') THEN 'ferns_and_allies'
    WHEN phylum IN ('bryophyta','marchantiophyta','anthocerotophyta') THEN 'mosses'
    WHEN phylum IN ('chlorophyta','charophyta') THEN 'green_algae'
    WHEN phylum = 'rhodophyta' THEN 'red_algae'
    WHEN kingdom = 'fungi' THEN 'mushrooms'
    WHEN class_name = 'phaeophyceae' THEN 'brown_algae'
    ELSE 'other'
  END`;

async function fetchBaseSourceIds(): Promise<string[]> {
  const res = await fetch(`https://api.checklistbank.org/dataset/${COL_BASE_DATASET}/source`);
  if (!res.ok) throw new Error(`Base source list fetch failed (${COL_BASE_DATASET}): ${res.status}`);
  const arr = (await res.json()) as Array<{ key: number }>;
  const ids = arr.map((s) => String(s.key)).filter(Boolean);
  if (ids.length === 0) throw new Error(`Base ${COL_BASE_DATASET} returned no sources`);
  return ids;
}

export async function run(
  opts: { tsv?: string; outDir?: string; baseSourceIds?: string[]; demotionsTsv?: string; demotedColIds?: string[] } = {},
): Promise<void> {
  const tsv = opts.tsv || process.env.COLDP_TSV || path.join(DATA_DIR, "_coldp_xr.tsv");
  if (!fs.existsSync(tsv)) {
    throw new Error(`ColDP TSV not found: ${tsv}. Set COLDP_TSV or run the XR fetch step.`);
  }
  const demotionsTsv = opts.demotionsTsv || process.env.COL_CHECKLIST_TSV;
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

  // Curated-checklist demotion denylist (col_ids the curated checklist demotes — see
  // header). Injected directly (tests), else read from the checklist NameUsage, else
  // empty (no demotions). col_ids are shared with XR, so this is an exact anti-join.
  await conn.run(`CREATE TEMP TABLE demoted(col_id VARCHAR);`);
  if (opts.demotedColIds) {
    if (opts.demotedColIds.length) {
      await conn.run(`INSERT INTO demoted VALUES ${opts.demotedColIds.map((i) => `('${i.replace(/'/g, "''")}')`).join(",")};`);
    }
  } else if (demotionsTsv) {
    if (!fs.existsSync(demotionsTsv)) throw new Error(`Checklist demotions TSV not found: ${demotionsTsv}`);
    await conn.run(`
      INSERT INTO demoted
      SELECT DISTINCT "col:ID" FROM read_csv('${demotionsTsv}', delim='\t', header=true, quote='', ignore_errors=true, all_varchar=true)
      WHERE "col:ID" IS NOT NULL AND (${DEMOTED_PREDICATE});`);
  }

  // Load the full NameUsage once. all_varchar avoids type-sniffing surprises on
  // the ~9.4M-row / ~70-col ColDP TSV; we only need a handful of columns. The
  // denormalized lineage (col:kingdom…col:genus) and col:extinct are standard
  // ColDP; we no longer read the ChecklistBank-only clb:taxGroup augmentation.
  await conn.run(`
    CREATE TEMP TABLE nu AS
      SELECT
        "col:ID" AS col_id, "col:parentID" AS parent_id, "col:status" AS status,
        "col:rank" AS rank,
        -- Normalize to the canonical binomial: XR writes a subgenus parenthetical
        -- in some names ("Diclidurus (Diclidurus) albus"). Strip it so names match
        -- our plain-binomial Red List/GBIF data (the NE-union dedup + build-matching
        -- both join on name) and display cleanly.
        trim(regexp_replace(regexp_replace("col:scientificName", '\\([^)]*\\)', '', 'g'), '\\s+', ' ', 'g')) AS scientific_name,
        "col:authorship" AS authorship,
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
  // partitioned by `taxon_group` (the IUCN Table 1a group) so the read layer filters
  // species/ with the SAME predicate it uses for assessed/unassessed (taxon_group),
  // and the partition prunes to the group(s). taxon_group is derived from the lineage
  // per Table 1a's footnote definitions (TAXON_GROUP_CASE); species outside the 28
  // groups (microbes, viruses, unplaced) fall to 'other' and aren't surfaced.
  fs.rmSync(speciesDir, { recursive: true, force: true });
  await conn.run(`
    COPY (
      SELECT col_id, scientific_name, authorship, kingdom, phylum, class_name, order_name, family, genus,
             extinct, in_base, ${TAXON_GROUP_CASE} AS taxon_group
      FROM (
        SELECT col_id, scientific_name, authorship,
               lower(kingdom) AS kingdom, lower(phylum) AS phylum, lower(class_name) AS class_name,
               lower(order_name) AS order_name, lower(family) AS family, lower(genus) AS genus,
               extinct, (source_id IN (SELECT id FROM base_src)) AS in_base
        FROM nu
        WHERE rank = 'species' AND status IN ${SPECIES_STATUS}
          -- Drop XR over-splits the curated checklist demotes (e.g. Pycnonotus tricolor).
          AND col_id NOT IN (SELECT col_id FROM demoted)
      )
      ORDER BY taxon_group, class_name, order_name, family, scientific_name
    ) TO '${speciesDir}' (FORMAT PARQUET, PARTITION_BY (taxon_group), COMPRESSION ZSTD, ROW_GROUP_SIZE 20000, OVERWRITE_OR_IGNORE);
  `);

  // ── verification ───────────────────────────────────────────────────────────
  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const bb = (await q(`SELECT count(*) n, count(*) FILTER (status='accepted') acc,
                              count(*) FILTER (status='provisionally accepted') prov,
                              count(*) FILTER (status LIKE '%synonym%') syn FROM '${backboneOut}'`))[0];
  console.log(`Wrote ${backboneOut}: ${Number(bb.n).toLocaleString()} usages (${Number(bb.acc).toLocaleString()} accepted, ${Number(bb.prov).toLocaleString()} provisionally accepted, ${Number(bb.syn).toLocaleString()} synonyms)`);
  const sp = (await q(`SELECT count(*) n, count(DISTINCT taxon_group) AS ngroups,
                              count(*) FILTER (extinct IS TRUE) AS fossil,
                              count(*) FILTER (NOT in_base) AS non_base,
                              count(*) FILTER (in_base AND extinct IS NOT TRUE) AS universe,
                              count(*) FILTER (taxon_group = 'other') AS other
                       FROM '${speciesDir}/**/*.parquet'`))[0];
  const demotedN = Number((await q(`SELECT count(*) n FROM demoted`))[0].n);
  console.log(`Wrote ${speciesDir}/: ${Number(sp.n).toLocaleString()} accepted species across ${Number(sp.ngroups)} taxon_group partitions (${baseSourceIds.length} Base GSD sources; ${demotedN.toLocaleString()} curated-checklist demotions applied)`);
  console.log(`  extant universe (in_base AND NOT fossil): ${Number(sp.universe).toLocaleString()} — drops ${Number(sp.fossil).toLocaleString()} flagged fossils + ${Number(sp.non_base).toLocaleString()} non-Base; ${Number(sp.other).toLocaleString()} outside the 28 groups ('other')`);
  const parts = await q(`SELECT taxon_group, count(*) FILTER (in_base AND extinct IS NOT TRUE) n FROM '${speciesDir}/**/*.parquet' GROUP BY taxon_group ORDER BY n DESC LIMIT 6`);
  console.log("  largest groups (extant universe):", parts.map((r) => `${r.taxon_group}=${Number(r.n).toLocaleString()}`).join(", "));
}

const isDirectRun = process.argv[1]?.endsWith("build-backbone.ts") || process.argv[1]?.endsWith("build-backbone.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
