/**
 * DuckDB-backed read layer (#261). Queries assessed.parquet / unassessed.parquet
 * — local in dev, R2 (httpfs) in prod — replacing the load-whole-CSV-into-memory
 * path in species-store. Filters translate the taxonomy SpeciesFilter to SQL,
 * faithfully mirroring matchesFilter (incl. the order_name→class_name fallback).
 *
 * Phase-1 scope: species lists (assessed, optional NE union) + arbitrary-rank
 * filtering. Search / history / summaries land in later steps.
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { NODE_INDEX, getCsvGroupsForNode } from "@/lib/taxonomy-utils";
import { canonicalizeTaxonId, mapTaxonId } from "@/lib/data/taxonomy-constants";

const DATA_DIR = path.join(process.cwd(), "data");
// Dev has the parquets on disk; on Vercel they aren't bundled → read from R2.
const USE_R2 = !fs.existsSync(path.join(DATA_DIR, "assessed.parquet"));

function parquetUri(name: string): string {
  if (!USE_R2) return path.join(DATA_DIR, name);
  const ts = fs.readFileSync(path.join(process.cwd(), "latest-sync.txt"), "utf-8").trim();
  return `s3://${process.env.R2_DATA_BUCKET_NAME}/syncs/${ts}/${name}`;
}

let connPromise: Promise<DuckDBConnection> | null = null;
async function getConn(): Promise<DuckDBConnection> {
  if (!connPromise) {
    connPromise = (async () => {
      const inst = await DuckDBInstance.create(
        ":memory:",
        USE_R2 ? { extension_directory: "/tmp/duckdb_ext", home_directory: "/tmp" } : {},
      );
      const conn = await inst.connect();
      if (USE_R2) {
        await conn.run("INSTALL httpfs; LOAD httpfs;");
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

interface WhereParts { clauses: string[]; params: Record<string, string>; }

function resolveWhere(taxonId: string): WhereParts {
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

// ─── SpeciesRow projection ─────────────────────────────────────────────────

const ASSESSED_SELECT = `
  id, scientific_name, common_name, family, iucn_category AS category,
  assessment_date, year_published, population_trend, countries, class_name, order_name,
  taxon_group, gbif_species_key, gbif_occurrence_count, gbif_observations_after_assessment_year,
  systems, growth_forms, movement_pattern, possibly_extinct, possibly_extinct_in_the_wild,
  criteria, threat_codes, has_map`;

// unassessed.parquet lacks the assessment-only columns → fill SpeciesRow defaults
const UNASSESSED_SELECT = `
  id, scientific_name, common_name, family, iucn_category AS category,
  NULL AS assessment_date, NULL AS year_published, NULL AS population_trend, countries, class_name, order_name,
  taxon_group, gbif_species_key, gbif_occurrence_count, NULL AS gbif_observations_after_assessment_year,
  '' AS systems, '' AS growth_forms, NULL AS movement_pattern, FALSE AS possibly_extinct, FALSE AS possibly_extinct_in_the_wild,
  NULL AS criteria, '' AS threat_codes, FALSE AS has_map`;

const splitList = (s: unknown): string[] => (typeof s === "string" && s ? s.split(";").filter(Boolean) : []);
const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toSpeciesRow(r: Record<string, unknown>) {
  const id = Number(r.id);
  const taxonGroup = String(r.taxon_group);
  return {
    id,
    sis_taxon_id: id > 0 ? id : null,
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
    // DuckDB emits the history as a JSON string (to_json) — parse to plain objects.
    previous_assessments: typeof r.previous_assessments === "string"
      ? (JSON.parse(r.previous_assessments) as Array<Record<string, unknown>>).map((pa) => ({
          id: Number(pa.id),
          year: String(pa.year ?? ""),
          category: String(pa.category ?? ""),
          date: (pa.date as string) ?? null,
          assessors: (pa.assessors as string) ?? null,
          reviewers: (pa.reviewers as string) ?? null,
        }))
      : [],
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

  // Assessed: join the per-species history (rebuilt in original array order via
  // seq; index 0 = latest) into previous_assessments. Run NE as a second query
  // (avoids UNION-ing the nested struct list) and concat — order doesn't matter
  // (the client sorts).
  const assessedSql = `
    WITH hist AS (
      SELECT sis_taxon_id,
             to_json(list({'id': id, 'year': "year", 'category': category, 'date': "date",
                   'assessors': assessors, 'reviewers': reviewers} ORDER BY seq)) AS previous_assessments
      FROM '${parquetUri("assessments.parquet")}'
      GROUP BY sis_taxon_id
    )
    SELECT ${ASSESSED_SELECT}, h.previous_assessments
    FROM '${parquetUri("assessed.parquet")}' a
    LEFT JOIN hist h ON h.sis_taxon_id = a.id
    ${whereSql}`;
  let rows = (await conn.runAndReadAll(assessedSql, where.params)).getRowObjects();

  if (opts.includeNE) {
    const neSql = `SELECT ${UNASSESSED_SELECT} FROM '${parquetUri("unassessed.parquet")}' ${whereSql}`;
    rows = rows.concat((await conn.runAndReadAll(neSql, where.params)).getRowObjects());
  }

  let result = rows.map(toSpeciesRow);
  if (opts.offset) result = result.slice(opts.offset);
  if (opts.limit != null) result = result.slice(0, opts.limit);
  return result;
}
