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
import { getTaxaSummary } from "@/lib/data/species-store";
import { isDynamicNodeId, dynamicNodeFilter } from "@/lib/dynamic-taxon";
import { filterToSql, sqlStrList } from "@/lib/taxonomy-sql";
import { COL_DOMESTIC_EXCLUDE_NAMES } from "@/config/col-described-overrides";

const DATA_DIR = path.join(process.cwd(), "data");
// Dev has the parquets on disk; on Vercel they aren't bundled → read from R2.
const USE_R2 = !fs.existsSync(path.join(DATA_DIR, "assessed.parquet"));
// httpfs vendored at build time (scripts/fetch-duckdb-ext.ts) + traced into the
// v2 function (next.config). LOAD by path avoids the cold-start network INSTALL.
const HTTPFS_EXT = path.join(process.cwd(), "duckdb-ext", "httpfs.duckdb_extension");

// Exported for src/lib/data/country-taxa-summary-duckdb.ts, which queries the same
// assessed.parquet over the same cached connection — a second independent connection
// would double the httpfs/R2 setup cost per cold start.
export function parquetUri(name: string): string {
  if (!USE_R2) return path.join(DATA_DIR, name);
  const ts = fs.readFileSync(path.join(process.cwd(), "latest-sync.txt"), "utf-8").trim();
  return `s3://${process.env.R2_DATA_BUCKET_NAME}/syncs/${ts}/${name}`;
}

let connPromise: Promise<DuckDBConnection> | null = null;
export async function getConn(): Promise<DuckDBConnection> {
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
// Exported for src/lib/data/live-taxa-children.ts, which needs the exact same
// "assessed col_ids" / "CoL-extinct but IUCN-confirmed EX/EW" universe (ne_assessed_
// col_ids / ne_ex_ew_col_ids) for its own colDescribed/colNe counts — reusing these
// avoids building a second, redundant set of identical temp tables on the same
// warm connection.
let neHelpersPromise: Promise<void> | null = null;
export function ensureNeHelpers(conn: DuckDBConnection): Promise<void> {
  if (!neHelpersPromise) {
    neHelpersPromise = (async () => {
      const linkUri = parquetUri("species_link.parquet");
      const unassessedUri = parquetUri("unassessed.parquet");
      const assessedUri = parquetUri("assessed.parquet");
      await conn.run(`CREATE TEMP TABLE ne_assessed_col_ids AS
        SELECT DISTINCT col_id FROM read_parquet('${linkUri}') WHERE src = 'redlist' AND col_id IS NOT NULL`);
      // A species CoL flags extinct still belongs to the "described" universe if
      // IUCN's own linked assessment agrees (EX/EW) — see the matching comment +
      // rationale next to createExEwAssessedTable in scripts/build-taxa-summary.ts.
      // Mirrored here so this runtime species list and the build-time colDescribed/
      // colNe summary numbers never disagree with each other.
      await conn.run(`CREATE TEMP TABLE ne_ex_ew_col_ids AS
        SELECT DISTINCT l.col_id
        FROM read_parquet('${linkUri}') l
        JOIN read_parquet('${assessedUri}') a ON a.id = l.id
        WHERE l.src = 'redlist' AND l.col_id IS NOT NULL AND a.iucn_category IN ('EX', 'EW')`);
      await conn.run(`CREATE TEMP TABLE ne_gbif_by_col AS
        SELECT sl.col_id AS col_id, any_value(un.gbif_species_key) AS gbif_species_key, max(un.gbif_occurrence_count) AS gbif_occurrence_count, any_value(un.countries) AS countries, any_value(un.common_name) AS common_name
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
  // Dynamic (live taxonomic-drilldown) id — not in NODE_INDEX, but a real,
  // unambiguous, rank-disambiguated filter (see dynamic-taxon.ts). Checked
  // before the arbitrary-rank fallback below, which would otherwise compare the
  // whole raw id string (e.g. "mammals~order:rodentia~family:muridae") against
  // class_name/order_name/family and match nothing — filterToSql already
  // inlines its own escaped literals, so this clause needs no bind params.
  if (isDynamicNodeId(id)) {
    const filter = dynamicNodeFilter(id);
    if (filter) return { clauses: [filterToSql(filter)], params: {} };
  }
  // arbitrary rank (e.g. family=turdidae): match the value at class/order/family
  return {
    clauses: ["(class_name = $arv OR order_name = $arv OR family = $arv)"],
    params: { arv: id.toLowerCase() },
  };
}

// species/ is Hive-partitioned by `taxon_group` (the IUCN Table 1a group, assigned at
// build time from the lineage — see build-backbone's TAXON_GROUP_CASE). So the NE
// universe is filtered with the SAME `whereSql` resolveWhere() builds for the
// assessed/unassessed parquets, and the partition prunes to the queried group(s). No
// separate node→CoL lineage mapping or per-query partition logic is needed.

// ─── SpeciesRow projection ─────────────────────────────────────────────────

export interface PreviousAssessment {
  id: number; year: string; category: string;
  date: string | null; criteria: string | null; assessors: string | null; reviewers: string | null;
}

const ASSESSED_SELECT = `
  id, assessment_id, scientific_name, common_name, family, iucn_category AS category,
  assessment_date, year_published, population_trend, countries, class_name, order_name,
  taxon_group, gbif_species_key, gbif_occurrence_count, gbif_observations_after_assessment_year,
  systems, growth_forms, movement_pattern, possibly_extinct, possibly_extinct_in_the_wild,
  criteria, threat_codes, latest_assessors, latest_reviewers`;

const splitList = (s: unknown): string[] => (typeof s === "string" && s ? s.split(";").filter(Boolean) : []);
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function toSpeciesRow(r: Record<string, unknown>) {
  const id = Number(r.id);
  const taxonGroup = String(r.taxon_group);
  return {
    id,
    sis_taxon_id: id > 0 ? id : null,
    col_id: (r.col_id as string) ?? null, // CoL id — set on NE rows (assessed resolve via sis)
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
    // Species description year from CoL (NE rows only; null for assessed species,
    // whose parquet has no such column). Coalesced upstream from the author-year
    // columns with a cited-reference-year fallback — see build-backbone.
    described_year: num(r.described_year),
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
  };
}

// CoL species deliberately kept out of the universe (analogous to the domesticated-GBIF
// exclusion). Homo sapiens — IUCN omits humans from its Red List export, so it would
// otherwise surface as "not evaluated". Keep in sync with build-taxa-summary.
const EXCLUDED_COL_IDS_SQL = `('6MB3T')`; // Homo sapiens

// Domestic/feral forms (dog, cat, cattle, etc.) excluded from the NE universe here too —
// each has a wild-form sibling species already counted separately (see
// COL_DOMESTIC_EXCLUDE_NAMES's doc comment), so counting the domestic form as "Not
// Evaluated" as well would double up. Matches build-taxa-summary.ts's colCountsByGroup,
// whose precomputed col_ne this live count must agree with (#397 — Mammals showed 530
// live vs. 520 precomputed, a gap of exactly these 10 names). Node-scoped queries that
// go through filterToSql already exclude the wider COL_EXCLUDE_ALL_NODES (this list plus
// the Bison SG name overrides) via whereSql, making this redundant-but-harmless for them;
// this is the only exclusion applied for the taxon_group-partition fast path (top-level
// taxa like "mammals"), which bypasses filterToSql entirely.
const NOT_DOMESTIC_SQL = `coalesce(lower(scientific_name), '') NOT IN (${sqlStrList(COL_DOMESTIC_EXCLUDE_NAMES)})`;

// Per-taxon_group not-evaluated counts from the precomputed taxa-summary (in memory),
// used to decide tooLarge instantly without scanning species/ on R2.
let neByGroupCache: Map<string, number> | null = null;
function neByGroup(): Map<string, number> {
  if (neByGroupCache) return neByGroupCache;
  const m = new Map<string, number>();
  for (const row of getTaxaSummary()) m.set(row.table1a_taxon_group, Number(row.col_ne ?? 0));
  neByGroupCache = m;
  return m;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function querySpecies(opts: {
  taxon: string;
  includeNE?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ species: ReturnType<typeof toSpeciesRow>[]; truncated: boolean; tooLarge: boolean; neTotal: number | null }> {
  const conn = await getConn();
  const where = resolveWhere(opts.taxon);
  const whereSql = where.clauses.length ? `WHERE ${where.clauses.join(" AND ")}` : "";
  const assessedUri = parquetUri("assessed.parquet");
  // Cap the Not-Evaluated additions: a giant aggregate (insects ~1M, invertebrates
  // ~1.3M) can't be serialized in one response (it 500s / times out). Return up to
  // NE_CAP, flag `truncated`, and report `neTotal` so the UI can say "showing N of M
  // — drill into a sub-group". Every species stays reachable via its leaf node.
  const NE_CAP = 400_000;
  // The NE list is never partially truncated now: a group over the cap returns no rows
  // with tooLarge=true (UI prompts a drill-down); groups under the cap load in full.
  const truncated = false;
  let tooLarge = false;
  let neTotal: number | null = null;

  // Fast tooLarge path: decide from the precomputed per-group col_ne (in memory) before any
  // R2 work, so the drill-down prompt for a giant aggregate (insects, invertebrates) is
  // instant instead of waiting on a ~2M-row count + the cold ensureNeHelpers build. The
  // per-group sum is an upper bound for any sub-group, so it never falsely blocks a
  // manageable one (only the two aggregates exceed the cap). Best-effort: if taxa-summary
  // isn't bundled in this function, fall through to the live count below (still correct).
  if (opts.includeNE) {
    try {
      const groups = getCsvGroupsForNode(canonicalizeTaxonId(opts.taxon));
      const neEstimate = groups.reduce((sum, g) => sum + (neByGroup().get(g) ?? 0), 0);
      if (neEstimate > NE_CAP) {
        return { species: [], truncated, tooLarge: true, neTotal: neEstimate };
      }
    } catch {
      // taxa-summary unavailable — the live count in the NE branch still enforces the cap.
    }
  }

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
    const taxonId = canonicalizeTaxonId(opts.taxon);
    // Build (once per warm container) the global de-dup set + GBIF overlay map.
    await ensureNeHelpers(conn);
    const assessedColIds = "(SELECT col_id FROM ne_assessed_col_ids)"; // assessed col_ids (de-dup key)
    const speciesUri = parquetUri("species/**/*.parquet");

    // The NE list IS the CoL extant universe under the taxon, not already assessed
    // (minus the small EXCLUDED_COL_IDS denylist). species/ is partitioned by taxon_group,
    // so the SAME `whereSql` used for the assessed parquet filters + prunes it.
    const univFilter = `${whereSql} AND in_base AND (extinct IS NOT TRUE OR col_id IN (SELECT col_id FROM ne_ex_ew_col_ids)) AND col_id NOT IN ${assessedColIds} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND ${NOT_DOMESTIC_SQL}`;

    // Count first (cheap). A giant aggregate (insects ~935k, invertebrates ~1.3M) exceeds
    // the cap — serializing it is a 250MB+ payload the browser can't load. Flag `tooLarge`
    // and return no rows so the UI prompts a drill-down into a sub-group instead. Every
    // group under the cap (beetles ~262k and smaller) loads in full (never truncated).
    const univCount = Number((await conn.runAndReadAll(
      `SELECT count(*) AS c FROM read_parquet('${speciesUri}', hive_partitioning=true) ${univFilter}`,
      where.params)).getRowObjects()[0].c);
    if (univCount > NE_CAP) {
      tooLarge = true;
      neTotal = univCount;
    } else {
      // GBIF orphans (species GBIF knows but CoL's Base universe doesn't) were dropped: the
      // NE list equals the col_ne count exactly and excludes fossils CoL keeps out of the
      // universe (woolly mammoth in_base=false; American mastodon CoL-unmatched).
      const univSql = `
        SELECT u.col_id, u.scientific_name, u.class_name, u.order_name, u.family, u.taxon_group, u.described_year,
               g.gbif_species_key, g.gbif_occurrence_count, g.countries, g.common_name
        FROM (
          SELECT col_id, scientific_name, class_name, order_name, family, taxon_group, described_year
          FROM read_parquet('${speciesUri}', hive_partitioning=true) ${univFilter}
        ) u
        LEFT JOIN ne_gbif_by_col g ON g.col_id = u.col_id`;
      const univRows = (await conn.runAndReadAll(univSql, where.params)).getRowObjects();
      for (const r of univRows) {
        // Slim NE row — only the 13 populated fields. The other 16 (assessment-only:
        // assessment_id/date, trend, criteria, threats, systems, assessors, …) are always
        // null/empty/false for NE, so omitting them ~halves the payload + server
        // serialization (beetles ~262k rows: 178MB → ~90MB). The client handles their
        // absence exactly as the nulls it receives today (audited: every access is
        // optional-chained, falsy-checked, or NE-skipped). Synthetic negative id (no IUCN
        // sis) derived from col_id via colIdToSearchId — stable across queries, unlike a
        // per-query decrementing counter (the previous approach): a species fetched once
        // as part of "Mammals" and again scoped to "Rodentia" got a DIFFERENT counter-based
        // id each time (each query restarts its own count from -2,000,000,000), while an
        // unrelated species from the two different queries could easily land on the exact
        // same id — RedListView.tsx's speciesDetails cache is keyed by id and never
        // revalidates an existing entry, so the second species silently rendered under the
        // first's cached photo/common name/etc (reported: a cached Giraffe thumbnail
        // showing for Fictidomys parvidens after drilling from Mammals into Rodentia).
        // colIdToSearchId is already proven collision-free/stable for this exact purpose
        // (search results); taxon_group is the REAL CoL group (sub-group filter), taxon_id
        // forced to the requested taxon (top-level filter); GBIF key/count/countries/
        // common_name overlaid when the species is GBIF-observed.
        result.push({
          id: colIdToSearchId((r.col_id as string) ?? (r.scientific_name as string) ?? String(taxonId)),
          col_id: (r.col_id as string) ?? null,
          scientific_name: r.scientific_name ?? "",
          common_name: r.common_name ?? null,
          family: r.family ?? null,
          category: "NE",
          countries: splitList(r.countries),
          class_name: r.class_name ?? null,
          order_name: r.order_name ?? null,
          taxon_group: String(r.taxon_group),
          taxon_id: taxonId,
          described_year: num(r.described_year),
          gbif_species_key: num(r.gbif_species_key),
          gbif_occurrence_count: num(r.gbif_occurrence_count),
        } as unknown as ReturnType<typeof toSpeciesRow>);
      }
    }
  }

  if (opts.offset) result = result.slice(opts.offset);
  if (opts.limit != null) result = result.slice(0, opts.limit);
  return { species: result, truncated, tooLarge, neTotal };
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
  // Set when the result was matched via a synonym (the old name the user typed) rather than
  // its accepted name — the dropdown shows "(syn. <name>)". scientific_name is the accepted name.
  matched_synonym?: string | null;
}

// taxon_group → its representative *leaf* display node (csvGroups===[group], no class/order
// sub-filter). mapTaxonId maps to the top-level taxon (e.g. invertebrates), which is too
// large to load in new-assessments; a CoL-only search result must navigate to the leaf node
// (e.g. dragonflies-damselflies) so its NE list actually loads.
const GROUP_TO_LEAF_NODE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [id, node] of NODE_INDEX) {
    const f = node.filter;
    if (f.csvGroups?.length === 1 && !f.classNames && !f.orderNames && !f.excludeClasses &&
        !f.excludeOrders && !f.families && !f.excludeFamilies && !m.has(f.csvGroups[0])) {
      m.set(f.csvGroups[0], id);
    }
  }
  return m;
})();

// Stable negative int id for a CoL-only species (no IUCN sis id / GBIF key). Used as the
// search result's id — the URL `species=` param + the cached-preview key — and never
// collides with real positive sis/gbif ids. Also used by the NE branch of querySpecies
// above (same reasoning: a stable, collision-free id independent of which query produced
// the row — see that call site's comment for the bug a per-query counter caused here).
export function colIdToSearchId(colId: string): number {
  let h = 0;
  for (let i = 0; i < colId.length; i++) h = (Math.imul(h, 31) + colId.charCodeAt(i)) | 0;
  return -(Math.abs(h) || 1);
}

// Substring search over both parquets (replaces the in-memory search-index.json).
// ILIKE can't use row-group pruning, but with column projection it scans only the
// name columns from R2 — ~200ms warm over both files. Ranking mirrors the old
// JSON path: exact common-name > common-name prefix > scientific prefix > alpha.
// Falls back to the CoL universe (species/) only when the fast path is sparse — see below.
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
  const fast: SearchResult[] = rows.map((r) => {
    const tg = String(r.taxon_group);
    const cat = String(r.category ?? "");
    // NE results navigate to the new-assessments view, which can't load a giant aggregate
    // (mapTaxonId's top-level taxon) — send them to the leaf node so the list loads. Assessed
    // results go to reassessments (assessed-only, always loadable) via the top-level taxon.
    return {
      id: Number(r.id),
      scientific_name: String(r.scientific_name ?? ""),
      common_name: (r.common_name as string) ?? null,
      taxon_id: cat === "NE" ? (GROUP_TO_LEAF_NODE.get(tg) ?? mapTaxonId(tg)) : mapTaxonId(tg),
      taxon_group: tg,
      category: cat,
      gbif_species_key: num(r.gbif_species_key),
      assessment_id: num(r.assessment_id),
      assessment_date: (r.assessment_date as string) ?? null,
      countries: splitList(r.countries),
    };
  });
  // Return as soon as the direct search (assessed ∪ unassessed, ~16MB) finds anything.
  // The CoL-only and synonym tiers below each full-scan a large parquet over R2 (species/
  // ~36MB, synonym-index ~77MB) with no pruning — ~10s on a cold function. They exist to
  // *answer* queries the direct search can't (an old/synonym name, or a CoL-only species),
  // not to pad results, so only run them when the direct search came up empty. A precise
  // hit like "Panthera leo" returns here after one cheap scan instead of falling through
  // both heavy tiers.
  if (fast.length > 0) return fast;

  // CoL-only fallback: universe species (species/) that are neither IUCN-assessed nor
  // GBIF-observed. species/ has no common name and can't partition-prune on name, so this
  // full-scans the name column — gated above on the direct search returning nothing, so it
  // holds ALL assessed+GBIF matches (none), and any species/ match is genuinely CoL-only
  // (name-dedup suffices, no species_link anti-join needed). Render as NE → leaf taxon.
  const seen = new Set(fast.map((r) => r.scientific_name.toLowerCase()));
  const colSql = `
    SELECT col_id, scientific_name, taxon_group
    FROM read_parquet('${parquetUri("species/**/*.parquet")}', hive_partitioning=true)
    WHERE scientific_name ILIKE '%' || $q || '%' AND in_base AND extinct IS NOT TRUE
      AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}
    ORDER BY (lower(scientific_name) LIKE $q || '%') DESC, lower(scientific_name)
    LIMIT ${(lim - fast.length) * 3 + 5}`;
  const colRows = (await conn.runAndReadAll(colSql, { q: query.toLowerCase() })).getRowObjects();
  for (const r of colRows) {
    const name = String(r.scientific_name ?? "");
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const tg = String(r.taxon_group);
    fast.push({
      id: colIdToSearchId(String(r.col_id)),
      scientific_name: name,
      common_name: null,
      taxon_id: GROUP_TO_LEAF_NODE.get(tg) ?? mapTaxonId(tg),
      taxon_group: tg,
      category: "NE",
      gbif_species_key: null,
      assessment_id: null,
      assessment_date: null,
      countries: [],
    });
    if (fast.length >= lim) break;
  }
  if (fast.length >= lim) return fast;

  // Synonym tier: resolve an old/synonym name to its accepted species via synonym-index.parquet
  // (name-sorted → prefix-range prunes to ~1 row group). Reached only when the direct search
  // found nothing (gated above). The accepted species routes like a direct hit — assessed →
  // reassessments (sis id), NE → new-assessments/leaf node — and carries the matched synonym
  // for the UI. Graceful no-op if the index isn't in this sync prefix.
  const synUri = parquetUri("synonym-index.parquet");
  const synLo = `'${query.toLowerCase().replace(/'/g, "''")}'`;
  const need = lim - fast.length;
  const synCols = `synonym_name, accepted_name, accepted_col_id, taxon_group, sis_id, category`;
  try {
    let synRows = (await conn.runAndReadAll(
      `SELECT ${synCols} FROM read_parquet('${synUri}')
       WHERE synonym_name_lower >= ${synLo} AND synonym_name_lower < ${synLo} || chr(1114111)
       ORDER BY synonym_name_lower LIMIT ${need * 3 + 5}`, {})).getRowObjects();
    // Substring backstop (the query appears mid-name, not as a prefix) full-scans the whole
    // 77MB index over R2 with no pruning, so only fall back to it when the prefix-range found
    // nothing at all — not merely when it returned fewer than `need`.
    if (synRows.length === 0) {
      synRows = (await conn.runAndReadAll(
        `SELECT ${synCols} FROM read_parquet('${synUri}')
         WHERE synonym_name_lower LIKE '%' || ${synLo} || '%' AND synonym_name_lower NOT LIKE ${synLo} || '%'
         ORDER BY synonym_name_lower LIMIT ${need * 3 + 5}`, {})).getRowObjects();
    }
    for (const r of synRows) {
      const accName = String(r.accepted_name ?? "");
      if (seen.has(accName.toLowerCase())) continue; // accepted already listed (direct hit, or another synonym of it)
      seen.add(accName.toLowerCase());
      const tg = String(r.taxon_group);
      const cat = String(r.category ?? "NE");
      const sis = r.sis_id == null ? null : Number(r.sis_id);
      fast.push({
        id: sis ?? colIdToSearchId(String(r.accepted_col_id)),
        scientific_name: accName,
        common_name: null,
        taxon_id: cat === "NE" ? (GROUP_TO_LEAF_NODE.get(tg) ?? mapTaxonId(tg)) : mapTaxonId(tg),
        taxon_group: tg,
        category: cat,
        gbif_species_key: null,
        assessment_id: null,
        assessment_date: null,
        countries: [],
        matched_synonym: String(r.synonym_name ?? ""),
      });
      if (fast.length >= lim) break;
    }
  } catch { /* synonym index not in this sync prefix — skip */ }
  return fast;
}

// ─── Catalogue of Life: synonyms for a species ──────────────────────────────

export interface SpeciesSynonyms {
  col_id: string | null;
  accepted_name: string | null;
  accepted_authorship: string | null;
  synonyms: { name: string; authorship: string | null; status: string }[];
}

// Synonyms (+ accepted name/authorship) for one species, for the detail panel's CoL tab.
// Resolve the CoL col_id from either the col_id (NE rows carry it) or the sis id (assessed,
// via species_link), then one scan of backbone for `col_id = c` (the accepted) OR
// `parent_id = c` (its synonyms). backbone isn't indexed on these, so it full-scans — fine
// for a deliberate, cached detail-tab open (not the search hot path).
export async function getSynonyms(opts: { col?: string | null; sis?: number | null }): Promise<SpeciesSynonyms> {
  const conn = await getConn();
  let colId = opts.col ?? null;
  if (!colId && opts.sis != null) {
    const linkUri = parquetUri("species_link.parquet");
    const r = (await conn.runAndReadAll(
      `SELECT col_id FROM read_parquet('${linkUri}') WHERE src='redlist' AND id=$id AND col_id IS NOT NULL LIMIT 1`,
      { id: opts.sis })).getRowObjects();
    colId = r.length ? String(r[0].col_id) : null;
  }
  if (!colId) return { col_id: null, accepted_name: null, accepted_authorship: null, synonyms: [] };

  const bbUri = parquetUri("backbone.parquet");
  const rows = (await conn.runAndReadAll(
    `SELECT col_id, scientific_name, authorship, status FROM read_parquet('${bbUri}')
     WHERE col_id=$c OR parent_id=$c`, { c: colId })).getRowObjects();
  let accepted_name: string | null = null, accepted_authorship: string | null = null;
  const synonyms: SpeciesSynonyms["synonyms"] = [];
  for (const r of rows) {
    if (String(r.col_id) === colId) {
      accepted_name = String(r.scientific_name ?? "");
      accepted_authorship = (r.authorship as string) ?? null;
    } else if (r.status === "synonym" || r.status === "ambiguous synonym") {
      synonyms.push({ name: String(r.scientific_name ?? ""), authorship: (r.authorship as string) ?? null, status: String(r.status) });
    }
  }
  synonyms.sort((a, b) => a.name.localeCompare(b.name));
  return { col_id: colId, accepted_name, accepted_authorship, synonyms };
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
  // SELECT * rather than naming `criteria` explicitly: assessments.parquet is
  // rebuilt by a separate scheduled sync (scripts/build-parquet.ts), not by this
  // deploy, so there's a window where the deployed code expects a column the
  // currently-synced parquet doesn't have yet. Naming it would throw a DuckDB
  // Binder Error for every request in that window — this deploy's whole history
  // fetch failing (not just criteria) until the next sync catches up. `pa.criteria`
  // below is simply undefined/null on old data instead.
  const sql = `
    SELECT *
    FROM '${parquetUri("assessments.parquet")}'
    WHERE sis_taxon_id = $id
    ORDER BY seq`;
  const rows = (await conn.runAndReadAll(sql, { id: sisTaxonId })).getRowObjects();
  return rows.map((pa) => ({
    id: Number(pa.id),
    year: String(pa.year ?? ""),
    category: String(pa.category ?? ""),
    date: (pa.date as string) ?? null,
    criteria: (pa.criteria as string) ?? null,
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
  // Arbitrary-rank lineage match over the extant universe. species/ is partitioned by
  // taxon_group, not by clade, so an arbitrary rank can't prune — it full-scans. (This
  // is a power-user endpoint not wired into the UI; the hot path is querySpecies.)
  const where = `$t IN (kingdom, phylum, class_name, order_name, family, genus) AND in_base AND extinct IS NOT TRUE`;
  const params: Record<string, string> = { t };
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

// ─── Higher-rank taxon suggestions (search-bar autocomplete) ─────────────────

export interface TaxonSuggestion {
  /** Prettified display name, e.g. "Felidae". */
  name: string;
  /** Rank the query matched at. */
  rank: "class" | "order" | "family";
  /** Lowercased token to pass as ?taxa= (what resolveWhere/querySpecies match on). */
  taxon: string;
}

// Recognize a higher-rank taxon (class / order / family) the user is typing, so the
// search bar can offer "Browse Felidae → " above the species hits. Restricted to the
// three ranks resolveWhere()'s arbitrary-rank branch matches on — genus is excluded
// because the dashboard query (querySpecies) can't filter by it, so a genus pick would
// land on an empty view. Prefix-matches the DISTINCT rank names in the assessed ∪
// unassessed parquets (already warm in the search hot path, name columns pre-lowercased
// at build time), so it never full-scans species/. A rank with zero assessed and zero
// GBIF-observed species won't surface — acceptable: those are exactly the taxa a user
// wouldn't browse to, and the direct species/synonym search still answers by name.
export async function suggestTaxa(query: string, limit = 3): Promise<TaxonSuggestion[]> {
  if (query.length < 2) return [];
  const conn = await getConn();
  const q = query.toLowerCase();
  const RANKS: { col: string; rank: TaxonSuggestion["rank"] }[] = [
    { col: "family", rank: "family" },
    { col: "order_name", rank: "order" },
    { col: "class_name", rank: "class" },
  ];
  const part = (src: string, col: string, rank: string) =>
    `SELECT DISTINCT ${col} AS name, '${rank}' AS rank FROM '${parquetUri(src)}'
     WHERE ${col} IS NOT NULL AND ${col} LIKE $q || '%'`;
  const parts = RANKS.flatMap(({ col, rank }) =>
    [part("assessed.parquet", col, rank), part("unassessed.parquet", col, rank)]);
  const lim = Math.min(Math.max(limit, 1), 10);
  // Exact match first, then shortest (closest) name, then alphabetical. DISTINCT in the
  // sub-selects collapses per-file dupes; the outer query dedupes across ranks by name.
  const sql = `
    SELECT name, any_value(rank) AS rank FROM (${parts.join(" UNION ALL ")})
    GROUP BY name
    ORDER BY (name = $q) DESC, length(name), name
    LIMIT ${lim}`;
  const rows = (await conn.runAndReadAll(sql, { q })).getRowObjects();
  return rows.map((r) => {
    const name = String(r.name);
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      rank: String(r.rank) as TaxonSuggestion["rank"],
      taxon: name,
    };
  });
}
