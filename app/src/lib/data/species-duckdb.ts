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

// Map a taxon (node id or arbitrary rank) to the CoL lineage VALUE to match in
// species/ — i.e. its scientific name. Our common-name node ids need translating
// (mammals→mammalia, beetles→coleoptera); arbitrary ranks (turdidae, odonata)
// already are CoL values, so they fall through. Unmapped nodes (fishes, the
// virtual roots, plant/fungi groups) return a value that won't match → no CoL
// species added (graceful). This is a seed of the node→CoL editorial mapping.
const COMMON_TO_COL_LINEAGE: Record<string, string> = {
  mammals: "mammalia", birds: "aves", reptiles: "reptilia", amphibians: "amphibia",
  beetles: "coleoptera", butterflies_and_moths: "lepidoptera", flies_and_mosquitoes: "diptera",
  bees_wasps_and_ants: "hymenoptera", true_bugs: "hemiptera", grasshoppers_crickets_locusts: "orthoptera",
  dragonflies_and_damselflies: "odonata", arachnids: "arachnida", molluscs: "mollusca",
};
export function colLineageValue(taxonId: string): string {
  const id = canonicalizeTaxonId(taxonId).toLowerCase();
  return COMMON_TO_COL_LINEAGE[id] ?? id;
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
  let rows = (await conn.runAndReadAll(assessedSql, where.params)).getRowObjects();

  if (opts.includeNE) {
    const neSql = `SELECT ${UNASSESSED_SELECT} FROM '${parquetUri("unassessed.parquet")}' ${whereSql}`;
    rows = rows.concat((await conn.runAndReadAll(neSql, where.params)).getRowObjects());
  }

  let result = rows.map(toSpeciesRow);

  // CoL-only species (#271, Phase 3): on an NE fetch, add the CoL accepted species
  // under this taxon that we DON'T already have (by name) — the "tree of life"
  // beyond the GBIF-observed set. Matched at any rank against the species/ universe
  // (lineage); deduped vs our assessed+unassessed; emitted as NE rows with the
  // requested taxon_id so the client's taxon filter keeps them. (Safety-capped;
  // a per-node size gate for the giants is a follow-up.)
  if (opts.includeNE && whereSql) {
    const cv = colLineageValue(opts.taxon);
    const taxonId = canonicalizeTaxonId(opts.taxon);
    const colSql = `
      SELECT col_id, scientific_name, class_name, order_name, family
      FROM read_parquet('${parquetUri("species/**/*.parquet")}', hive_partitioning=true)
      WHERE $cv IN (kingdom, phylum, class_name, order_name, family, genus)
        AND extinct IS NOT TRUE  -- drop CoL fossils so the universe tracks IUCN Table 1a (extant)
        AND lower(scientific_name) NOT IN (
          SELECT lower(scientific_name) FROM '${assessedUri}' a ${whereSql}
          UNION SELECT lower(scientific_name) FROM '${parquetUri("unassessed.parquet")}' ${whereSql}
        )
      LIMIT 600000`;
    const colRows = (await conn.runAndReadAll(colSql, { ...where.params, cv })).getRowObjects();
    let synthId = -2_000_000_000;
    for (const r of colRows) {
      // Build via toSpeciesRow for the correct shape + NE defaults; synthetic
      // negative id (display-only — no IUCN/GBIF detail), taxon_id forced to the
      // requested taxon so the client's taxon filter keeps these rows.
      const row = toSpeciesRow({
        id: synthId--, scientific_name: r.scientific_name, family: r.family, category: "NE",
        class_name: r.class_name, order_name: r.order_name, taxon_group: taxonId,
      });
      row.taxon_id = taxonId;
      result.push(row);
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
  // Fossils excluded (extinct IS NOT TRUE) so counts track the extant universe.
  const where = `$t IN (kingdom, phylum, class_name, order_name, family, genus) AND extinct IS NOT TRUE`;
  const lim = Math.min(Math.max(limit, 1), 200);
  const t = taxon.toLowerCase();
  const head = (await conn.runAndReadAll(
    `SELECT count(*) AS total,
            min(CASE WHEN genus=$t THEN 'genus' WHEN family=$t THEN 'family' WHEN order_name=$t THEN 'order'
                     WHEN class_name=$t THEN 'class' WHEN phylum=$t THEN 'phylum' WHEN kingdom=$t THEN 'kingdom' END) AS matched_rank
     FROM ${sp} WHERE ${where}`, { t },
  )).getRowObjects();
  const total = Number(head[0].total);
  if (total === 0) return { taxon, matched_rank: null, total: 0, sample: [] };
  const rows = (await conn.runAndReadAll(
    `SELECT col_id, scientific_name FROM ${sp} WHERE ${where} ORDER BY scientific_name LIMIT ${lim}`, { t },
  )).getRowObjects();
  return {
    taxon, matched_rank: (head[0].matched_rank as string) ?? null, total,
    sample: rows.map((r) => ({ col_id: String(r.col_id), scientific_name: String(r.scientific_name) })),
  };
}
