/**
 * DuckDB-backed read layer (#261). Queries assessed.parquet / unassessed.parquet
 * — local in dev, R2 (httpfs) in prod — replacing the load-whole-CSV-into-memory
 * path in species-store. Filters translate the taxonomy SpeciesFilter to SQL,
 * faithfully mirroring matchesFilter (incl. the order_name→class_name fallback).
 *
 * Species lists (assessed, optional NE union) + arbitrary-rank filtering. The
 * list carries denormalized latest_assessors/latest_reviewers but NOT the full
 * history array — that's fetched lazily per species (getAssessmentHistory) when
 * a detail panel opens. Search / summaries land in later steps.
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { NODE_INDEX, getCsvGroupsForNode } from "@/lib/taxonomy-utils";
import { canonicalizeTaxonId, mapTaxonId } from "@/lib/data/taxonomy-constants";

const DATA_DIR = path.join(process.cwd(), "data");
// Dev has the parquets on disk; on Vercel they aren't bundled → read from R2.
const USE_R2 = !fs.existsSync(path.join(DATA_DIR, "assessed.parquet"));
// httpfs vendored at build time (scripts/fetch-duckdb-ext.ts) + traced into the
// v2 function (next.config). LOAD by path avoids the cold-start network INSTALL.
const HTTPFS_EXT = path.join(process.cwd(), "duckdb-ext", "httpfs.duckdb_extension");

function parquetUri(name: string): string {
  if (!USE_R2) return path.join(DATA_DIR, name);
  const ts = fs.readFileSync(path.join(process.cwd(), "latest-sync.txt"), "utf-8").trim();
  return `s3://${process.env.R2_DATA_BUCKET_NAME}/syncs/${ts}/${name}`;
}

let connPromise: Promise<DuckDBConnection> | null = null;
async function getConn(): Promise<DuckDBConnection> {
  if (!connPromise) {
    connPromise = (async () => {
      const inst = await DuckDBInstance.create(":memory:");
      const conn = await inst.connect();
      if (USE_R2) {
        await conn.run(`LOAD '${HTTPFS_EXT}'`);
        await conn.run(`
          SET s3_region='auto';
          SET s3_endpoint='${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com';
          SET s3_url_style='path';
          SET s3_access_key_id='${process.env.R2_ACCESS_KEY_ID}';
          SET s3_secret_access_key='${process.env.R2_SECRET_ACCESS_KEY}';
        `);
      }
      return conn;
    })();
  }
  return connPromise;
}

// The NE de-dup set (assessed col_ids) and the GBIF-by-col_id overlay map are GLOBAL
// (taxon-independent) but were rebuilt on every NE query — and the assessed set was
// scanned twice. Materialize both once per warm container as temp tables; large
// groups (plants ~280k) stop paying for the ~557k-row GBIF aggregation + the 173k
// anti-set on each request. Reset on failure so a transient R2 error can retry.
let neHelpersPromise: Promise<void> | null = null;
function ensureNeHelpers(conn: DuckDBConnection): Promise<void> {
  if (!neHelpersPromise) {
    neHelpersPromise = (async () => {
      const linkUri = parquetUri("species_link.parquet");
      const unassessedUri = parquetUri("unassessed.parquet");
      await conn.run(`CREATE TEMP TABLE ne_assessed_col_ids AS
        SELECT DISTINCT col_id FROM read_parquet('${linkUri}') WHERE src = 'redlist' AND col_id IS NOT NULL`);
      await conn.run(`CREATE TEMP TABLE ne_gbif_by_col AS
        SELECT sl.col_id AS col_id, any_value(un.gbif_species_key) AS gbif_species_key, max(un.gbif_occurrence_count) AS gbif_occurrence_count
        FROM read_parquet('${linkUri}') sl JOIN read_parquet('${unassessedUri}') un ON un.id = sl.id
        WHERE sl.src = 'gbif' AND sl.col_id IS NOT NULL GROUP BY sl.col_id`);
    })().catch((e) => { neHelpersPromise = null; throw e; });
  }
  return neHelpersPromise;
}

// ─── Resolve a taxon identifier to a SQL predicate ──────────────────────────
//
// Parity with /api/redlist/species: a taxonomy node filters by its csvGroups
// ONLY (drill-down sub-filtering — rodents, etc. — is applied client-side). A
// non-node identifier is the new capability: arbitrary-rank match. Values bind
// as parameters; the '|'-joined string is split in SQL (DuckDB can't bind a raw
// JS array).

export interface WhereParts { clauses: string[]; params: Record<string, string>; }

export function resolveWhere(taxonId: string): WhereParts {
  const id = canonicalizeTaxonId(taxonId);
  if (id === "all") return { clauses: [], params: {} };
  if (NODE_INDEX.has(id)) {
    const groups = getCsvGroupsForNode(id);
    return { clauses: ["taxon_group = ANY(string_split($g, '|'))"], params: { g: groups.join("|") } };
  }
  // arbitrary rank (e.g. family=turdidae): match the value at class/order/family
  return {
    clauses: ["(class_name = $arv OR order_name = $arv OR family = $arv)"],
    params: { arv: id.toLowerCase() },
  };
}

// node→CoL editorial mapping: each surfaced display node → the CoL lineage value(s)
// that define it + the species/ partition they live in. Multi-value where a node
// spans several CoL classes/phyla (flowering_plants = magnoliopsida + liliopsida).
// Values match rank-agnostically against the denormalized lineage (kingdom…genus),
// pruned to the partition so the scan reads one R2 file. Derived from the CoL
// lineage breakdown (stock-take 2026-06-12). Groups NOT listed (corals, crustaceans,
// velvet_worms, horseshoe_crabs, other_*) skip the universe scan → GBIF-NE only,
// until their (subset/subphylum) lineage is mapped.
const COL_NODE_TARGET: Record<string, { values: string[]; part: string }> = {
  // Vertebrates (Chordata). fishes = the true-fish classes (excludes tunicates/lancelets).
  mammals: { values: ["mammalia"], part: "Chordata" },
  birds: { values: ["aves"], part: "Chordata" },
  reptiles: { values: ["reptilia"], part: "Chordata" },
  amphibians: { values: ["amphibia"], part: "Chordata" },
  fishes: { values: ["teleostei", "elasmobranchii", "holocephali", "myxini", "petromyzonti", "chondrostei", "cladistii", "holostei", "dipneusti", "coelacanthi"], part: "Chordata" },
  // Insects + arachnids (Arthropoda).
  beetles: { values: ["coleoptera"], part: "Arthropoda" },
  butterflies_and_moths: { values: ["lepidoptera"], part: "Arthropoda" },
  flies_and_mosquitoes: { values: ["diptera"], part: "Arthropoda" },
  bees_wasps_and_ants: { values: ["hymenoptera"], part: "Arthropoda" },
  true_bugs: { values: ["hemiptera"], part: "Arthropoda" },
  grasshoppers_crickets_locusts: { values: ["orthoptera"], part: "Arthropoda" },
  dragonflies_and_damselflies: { values: ["odonata"], part: "Arthropoda" },
  arachnids: { values: ["arachnida"], part: "Arthropoda" },
  molluscs: { values: ["mollusca"], part: "Mollusca" },
  // Plants (Plantae).
  flowering_plants: { values: ["magnoliopsida", "liliopsida"], part: "Plantae" },
  gymnosperms: { values: ["pinopsida", "cycadopsida", "ginkgoopsida", "gnetopsida"], part: "Plantae" },
  ferns_and_allies: { values: ["polypodiopsida", "lycopodiopsida"], part: "Plantae" },
  mosses: { values: ["bryophyta", "marchantiophyta", "anthocerotophyta"], part: "Plantae" },
  green_algae: { values: ["chlorophyta", "charophyta"], part: "Plantae" },
  red_algae: { values: ["rhodophyta"], part: "Plantae" },
  // Fungi & protists. mushrooms = all Fungi; brown_algae = phaeophyceae (in Chromista,
  // NOT all ochrophyta — that includes diatoms).
  mushrooms: { values: ["fungi"], part: "Fungi" },
  brown_algae: { values: ["phaeophyceae"], part: "Chromista" },
};

// species/ is Hive-partitioned by `part` (= phylum within Animalia, else kingdom).
// A query filtering by class_name/order/family does NOT prune partitions, so it
// full-scans all ~2.4M rows across 58 R2 files (the new-assessments hang). Map a
// CoL lineage VALUE to its partition so the query reads one file. Only the common
// animal clades need this (the giant partitions); unmapped values skip pruning.
const COL_LINEAGE_TO_PART: Record<string, string> = {
  mammalia: "Chordata", aves: "Chordata", reptilia: "Chordata", amphibia: "Chordata",
  coleoptera: "Arthropoda", lepidoptera: "Arthropoda", diptera: "Arthropoda",
  hymenoptera: "Arthropoda", hemiptera: "Arthropoda", orthoptera: "Arthropoda",
  odonata: "Arthropoda", arachnida: "Arthropoda", mollusca: "Mollusca",
};
export function colPartFor(lineageValue: string): string | null {
  return COL_LINEAGE_TO_PART[lineageValue.toLowerCase()] ?? null;
}

// Resolve a taxon to the CoL-universe scan target — or null to SKIP the scan:
//  - a mapped display node → its CoL lineage value(s) + partition (prune to 1 file);
//  - a surfaced node we haven't mapped yet (corals, crustaceans, other_*) → null:
//    skip the scan. Its node id matches no lineage column, so scanning would
//    full-scan every partition to return nothing (the 30s hang). These get the
//    GBIF-orphan NE list only until mapped;
//  - an arbitrary CoL rank (not a node) → the value itself + best-effort partition.
export function colUniverseTarget(taxonId: string): { values: string[]; part: string | null } | null {
  const id = canonicalizeTaxonId(taxonId);
  const node = COL_NODE_TARGET[id.toLowerCase()];
  if (node) return { values: node.values, part: node.part };
  if (NODE_INDEX.has(id)) return null;
  const v = id.toLowerCase();
  return { values: [v], part: colPartFor(v) };
}

// ─── SpeciesRow projection ─────────────────────────────────────────────────

export interface PreviousAssessment {
  id: number; year: string; category: string;
  date: string | null; assessors: string | null; reviewers: string | null;
}

const ASSESSED_SELECT = `
  id, assessment_id, scientific_name, common_name, family, iucn_category AS category,
  assessment_date, year_published, population_trend, countries, class_name, order_name,
  taxon_group, gbif_species_key, gbif_occurrence_count, gbif_observations_after_assessment_year,
  systems, growth_forms, movement_pattern, possibly_extinct, possibly_extinct_in_the_wild,
  criteria, threat_codes, has_map, latest_assessors, latest_reviewers`;

// unassessed.parquet lacks the assessment-only columns → fill SpeciesRow defaults
const UNASSESSED_SELECT = `
  id, NULL AS assessment_id, scientific_name, common_name, family, iucn_category AS category,
  NULL AS assessment_date, NULL AS year_published, NULL AS population_trend, countries, class_name, order_name,
  taxon_group, gbif_species_key, gbif_occurrence_count, NULL AS gbif_observations_after_assessment_year,
  '' AS systems, '' AS growth_forms, NULL AS movement_pattern, FALSE AS possibly_extinct, FALSE AS possibly_extinct_in_the_wild,
  NULL AS criteria, '' AS threat_codes, FALSE AS has_map, NULL AS latest_assessors, NULL AS latest_reviewers`;

const splitList = (s: unknown): string[] => (typeof s === "string" && s ? s.split(";").filter(Boolean) : []);
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function toSpeciesRow(r: Record<string, unknown>) {
  const id = Number(r.id);
  const taxonGroup = String(r.taxon_group);
  return {
    id,
    sis_taxon_id: id > 0 ? id : null,
    assessment_id: num(r.assessment_id),
    scientific_name: r.scientific_name ?? "",
    common_name: r.common_name ?? null,
    family: r.family ?? null,
    category: r.category ?? "",
    assessment_date: r.assessment_date ?? null,
    year_published: r.year_published ?? "",
    population_trend: r.population_trend ?? null,
    countries: splitList(r.countries),
    class_name: r.class_name ?? null,
    order_name: r.order_name ?? null,
    taxon_group: taxonGroup,
    taxon_id: mapTaxonId(taxonGroup),
    gbif_species_key: num(r.gbif_species_key),
    gbif_occurrence_count: num(r.gbif_occurrence_count),
    gbif_observations_after_assessment_year: num(r.gbif_observations_after_assessment_year),
    // Latest (most recent) assessment's assessors/reviewers, denormalized into
    // assessed.parquet — the list view's assessor/reviewer filter reads these.
    latest_assessors: (r.latest_assessors as string) ?? null,
    latest_reviewers: (r.latest_reviewers as string) ?? null,
    // Full history is fetched lazily (getAssessmentHistory) when a detail panel
    // opens; the species list no longer carries it (≈40% smaller payload).
    previous_assessments: [] as PreviousAssessment[],
    systems: splitList(r.systems),
    growth_forms: splitList(r.growth_forms),
    movement_pattern: r.movement_pattern ?? null,
    possibly_extinct: Boolean(r.possibly_extinct),
    possibly_extinct_in_the_wild: Boolean(r.possibly_extinct_in_the_wild),
    criteria: r.criteria ?? null,
    threat_codes: splitList(r.threat_codes),
    has_map: Boolean(r.has_map),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function querySpecies(opts: {
  taxon: string;
  includeNE?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ReturnType<typeof toSpeciesRow>[]> {
  const conn = await getConn();
  const where = resolveWhere(opts.taxon);
  const whereSql = where.clauses.length ? `WHERE ${where.clauses.join(" AND ")}` : "";
  const assessedUri = parquetUri("assessed.parquet");

  // No history join — the list carries only the latest assessors/reviewers
  // (denormalized columns). The full per-species history array is fetched lazily
  // via getAssessmentHistory when a detail panel opens. This reads a single file
  // and drops ≈40% of the payload (history was ~half the bytes for large taxa).
  const assessedSql = `SELECT ${ASSESSED_SELECT} FROM '${assessedUri}' a ${whereSql}`;
  const rows = (await conn.runAndReadAll(assessedSql, where.params)).getRowObjects();

  let result = rows.map(toSpeciesRow);

  // Not-Evaluated species (#271, Phase 3): on an NE fetch, add every species under
  // this taxon that is NOT IUCN-assessed — keyed by CoL `col_id`, not by name. Name
  // de-duping double-counted: IUCN assesses Hipposideros X while CoL's accepted name
  // is Doryrhina X (a genus reassignment), so the same animal showed once as assessed
  // and again as "new". species_link bridges both names to one col_id, so de-duping by
  // col_id collapses them. Two parts: (A) the CoL extant universe under the taxon minus
  // already-assessed col_ids, with GBIF occurrences overlaid; (B) GBIF-observed species
  // not represented in that universe (orphans). Safety-capped.
  if (opts.includeNE && whereSql) {
    const linkUri = parquetUri("species_link.parquet");
    const unassessedUri = parquetUri("unassessed.parquet");
    const taxonId = canonicalizeTaxonId(opts.taxon);
    // Build (once per warm container) the global de-dup set + GBIF overlay map.
    await ensureNeHelpers(conn);
    const assessedColIds = "(SELECT col_id FROM ne_assessed_col_ids)"; // assessed col_ids (de-dup key)
    const gbifByCol = "ne_gbif_by_col"; // GBIF occurrences keyed by col_id

    // (A) CoL extant universe under the taxon (in_base AND NOT fossil), minus the
    // col_ids that are already assessed. Skipped entirely for taxa with no CoL
    // lineage mapping (plants, fungi, …) — see colUniverseTarget — which would
    // otherwise full-scan every partition to match nothing (the 30s plants hang).
    // Pruned to one R2 file when the clade maps to a partition.
    const emitted = new Set<string>();
    const target = colUniverseTarget(opts.taxon);
    if (target) {
      const partClause = target.part ? "part = $part AND " : "";
      // Match if any of the target lineage value(s) appears at any rank of the
      // denormalized lineage — rank-agnostic + multi-value (a node can span several
      // CoL classes, e.g. flowering_plants = magnoliopsida + liliopsida).
      const univSql = `
        SELECT u.col_id, u.scientific_name, u.class_name, u.order_name, u.family,
               g.gbif_species_key, g.gbif_occurrence_count
        FROM (
          SELECT col_id, scientific_name, class_name, order_name, family
          FROM read_parquet('${parquetUri("species/**/*.parquet")}', hive_partitioning=true)
          WHERE ${partClause}len(list_intersect([kingdom, phylum, class_name, order_name, family, genus], string_split($vals, '|'))) > 0
            AND in_base AND extinct IS NOT TRUE
            AND col_id NOT IN ${assessedColIds}
        ) u
        LEFT JOIN ${gbifByCol} g ON g.col_id = u.col_id
        LIMIT 600000`;
      const vals = target.values.join("|");
      const univParams: Record<string, string> = target.part
        ? { vals, part: target.part } : { vals };
      const univRows = (await conn.runAndReadAll(univSql, univParams)).getRowObjects();
      let synthId = -2_000_000_000;
      for (const r of univRows) {
        emitted.add(String(r.col_id));
        // Synthetic negative id (no IUCN sis); GBIF key/count overlaid when observed so
        // the new-assessments sort-by-occurrences works. taxon_id forced to the requested
        // taxon so the client's taxon filter keeps these rows.
        const row = toSpeciesRow({
          id: synthId--, scientific_name: r.scientific_name, family: r.family, category: "NE",
          class_name: r.class_name, order_name: r.order_name, taxon_group: taxonId,
          gbif_species_key: r.gbif_species_key, gbif_occurrence_count: r.gbif_occurrence_count,
        });
        row.taxon_id = taxonId;
        result.push(row);
      }
    }

    // (B) GBIF-observed NE species. When the universe WAS scanned (mapped taxon),
    // de-dup orphans by col_id — vs assessed (SQL) and vs the universe rows (JS) — via
    // the species_link join. When the universe was SKIPPED (unmapped taxon), there are
    // no universe rows to double-count against, so use the plain, fast unassessed read
    // and avoid the species_link join over huge groups (the 138k-row plants slowness;
    // this is the pre-CoL behaviour for those groups).
    if (target) {
      const orphanSql = `
        SELECT x.*, sl.col_id AS _col_id
        FROM (SELECT ${UNASSESSED_SELECT} FROM read_parquet('${unassessedUri}') a ${whereSql}) x
        LEFT JOIN read_parquet('${linkUri}') sl ON sl.src = 'gbif' AND sl.id = x.id
        WHERE sl.col_id IS NULL OR sl.col_id NOT IN ${assessedColIds}`;
      const orphanRows = (await conn.runAndReadAll(orphanSql, where.params)).getRowObjects();
      for (const r of orphanRows) {
        if (r._col_id != null && emitted.has(String(r._col_id))) continue;
        result.push(toSpeciesRow(r));
      }
    } else {
      const orphanSql = `SELECT ${UNASSESSED_SELECT} FROM read_parquet('${unassessedUri}') a ${whereSql}`;
      const orphanRows = (await conn.runAndReadAll(orphanSql, where.params)).getRowObjects();
      for (const r of orphanRows) result.push(toSpeciesRow(r));
    }
  }

  if (opts.offset) result = result.slice(opts.offset);
  if (opts.limit != null) result = result.slice(0, opts.limit);
  return result;
}

// ─── Cross-taxa search ──────────────────────────────────────────────────────

export interface SearchResult {
  id: number;
  scientific_name: string;
  common_name: string | null;
  taxon_id: string;
  taxon_group: string;
  category: string;
  gbif_species_key: number | null;
  assessment_id: number | null;
  assessment_date: string | null;
  countries: string[];
}

// Substring search over both parquets (replaces the in-memory search-index.json).
// ILIKE can't use row-group pruning, but with column projection it scans only the
// name columns from R2 — ~200ms warm over both files. Ranking mirrors the old
// JSON path: exact common-name > common-name prefix > scientific prefix > alpha.
export async function searchSpecies(query: string, limit = 10): Promise<SearchResult[]> {
  if (query.length < 2) return [];
  const conn = await getConn();
  const lim = Math.min(Math.max(limit, 1), 50);
  const proj = (src: string, assessed: boolean) => `
    SELECT id, scientific_name, common_name, taxon_group, iucn_category AS category, gbif_species_key,
           ${assessed ? "assessment_id, CAST(assessment_date AS VARCHAR) AS assessment_date" : "NULL AS assessment_id, NULL AS assessment_date"},
           countries
    FROM '${parquetUri(src)}'
    WHERE scientific_name ILIKE '%' || $q || '%'
       OR (common_name IS NOT NULL AND common_name ILIKE '%' || $q || '%')`;
  const sql = `
    WITH hits AS (${proj("assessed.parquet", true)} UNION ALL ${proj("unassessed.parquet", false)})
    SELECT * FROM hits
    ORDER BY (lower(common_name) = $q) DESC,
             (lower(common_name) LIKE $q || '%') DESC,
             (lower(scientific_name) LIKE $q || '%') DESC,
             lower(scientific_name)
    LIMIT ${lim}`;
  const rows = (await conn.runAndReadAll(sql, { q: query.toLowerCase() })).getRowObjects();
  return rows.map((r) => ({
    id: Number(r.id),
    scientific_name: String(r.scientific_name ?? ""),
    common_name: (r.common_name as string) ?? null,
    taxon_id: mapTaxonId(String(r.taxon_group)),
    taxon_group: String(r.taxon_group),
    category: String(r.category ?? ""),
    gbif_species_key: num(r.gbif_species_key),
    assessment_id: num(r.assessment_id),
    assessment_date: (r.assessment_date as string) ?? null,
    countries: splitList(r.countries),
  }));
}

// Prime the cached connection (httpfs load + S3 config) so the first search
// isn't paying cold-start init. Called by /api/search/warm on page load.
export async function warmConnection(): Promise<void> {
  const conn = await getConn();
  await conn.run("SELECT 1");
}

// Lazy per-species assessment history (index 0 = latest), fetched when a detail
// panel opens. assessments.parquet is sorted by sis_taxon_id, so this prunes to
// a single row group.
export async function getAssessmentHistory(sisTaxonId: number): Promise<PreviousAssessment[]> {
  const conn = await getConn();
  const sql = `
    SELECT id, "year", category, "date", assessors, reviewers
    FROM '${parquetUri("assessments.parquet")}'
    WHERE sis_taxon_id = $id
    ORDER BY seq`;
  const rows = (await conn.runAndReadAll(sql, { id: sisTaxonId })).getRowObjects();
  return rows.map((pa) => ({
    id: Number(pa.id),
    year: String(pa.year ?? ""),
    category: String(pa.category ?? ""),
    date: (pa.date as string) ?? null,
    assessors: (pa.assessors as string) ?? null,
    reviewers: (pa.reviewers as string) ?? null,
  }));
}

// ─── CoL backbone: arbitrary-rank species listing (#271, Phase 3) ────────────

export interface BackboneSpecies { col_id: string; scientific_name: string; }

// All CoL accepted species under any taxon, matched at ANY rank (kingdom →
// genus) against the denormalized lineage — e.g. ?taxon=Felidae lists every cat
// species in the tree of life, most of them Not Evaluated. The hand-curated tree
// can only drill into predefined nodes; this works for any taxon CoL knows.
// (Uses the denormalized lineage columns, not the parent_id chain — the raw CoL
// parent tree skips/collapses ranks, so lineage is the reliable basis.)
export async function getSpeciesUnder(taxon: string, limit = 50): Promise<{
  taxon: string; matched_rank: string | null; total: number; sample: BackboneSpecies[];
}> {
  const conn = await getConn();
  const sp = `read_parquet('${parquetUri("species/**/*.parquet")}', hive_partitioning=true)`;
  const t = taxon.toLowerCase();
  // Extant universe = in_base AND NOT fossil (in_base catches the sparse-flag paleo
  // tail). Prune to the partition when the taxon is a known clade (else full-scan).
  const part = colPartFor(t);
  const partClause = part ? "part = $part AND " : "";
  const where = `${partClause}$t IN (kingdom, phylum, class_name, order_name, family, genus) AND in_base AND extinct IS NOT TRUE`;
  const params: Record<string, string> = part ? { t, part } : { t };
  const lim = Math.min(Math.max(limit, 1), 200);
  const head = (await conn.runAndReadAll(
    `SELECT count(*) AS total,
            min(CASE WHEN genus=$t THEN 'genus' WHEN family=$t THEN 'family' WHEN order_name=$t THEN 'order'
                     WHEN class_name=$t THEN 'class' WHEN phylum=$t THEN 'phylum' WHEN kingdom=$t THEN 'kingdom' END) AS matched_rank
     FROM ${sp} WHERE ${where}`, params,
  )).getRowObjects();
  const total = Number(head[0].total);
  if (total === 0) return { taxon, matched_rank: null, total: 0, sample: [] };
  const rows = (await conn.runAndReadAll(
    `SELECT col_id, scientific_name FROM ${sp} WHERE ${where} ORDER BY scientific_name LIMIT ${lim}`, params,
  )).getRowObjects();
  return {
    taxon, matched_rank: (head[0].matched_rank as string) ?? null, total,
    sample: rows.map((r) => ({ col_id: String(r.col_id), scientific_name: String(r.scientific_name) })),
  };
}
