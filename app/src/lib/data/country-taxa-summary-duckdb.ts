/**
 * Country-scoped taxa-summary / node-children-summary, computed LIVE via DuckDB
 * instead of precomputed at sync time (contrast with taxa-summary.json /
 * node-children-summaries.json, read by species-store.ts).
 *
 * Precomputing one file per country (~150-200 countries) was rejected: it would
 * multiply scripts/build-taxa-summary.ts's runtime ~200x, add a staleness window,
 * and can't compose with other simultaneous filters. Instead this queries the same
 * assessed.parquet species-duckdb.ts already serves /api/redlist/species from,
 * adding a `countries` predicate to filterToSql()'s taxonomy-node predicate —
 * computed only for the specific country + node actually requested, not the whole
 * tree upfront.
 *
 * Deliberately omits GBIF (gbif_species_count, gbif_ne_species_count, ...) and
 * Catalogue of Life (col_described, col_ne) fields entirely — neither dataset has a
 * country dimension, so there is no valid per-country value to report. Callers
 * (the two API routes) must mark their response as country-scoped so the client
 * knows to hide those columns rather than render a misleading 0/undefined.
 */
import { getConn, parquetUri } from "./species-duckdb";
import { getTaxaSummary, type TaxaSummaryRow, type NodeSummary } from "./species-store";
import { NODE_INDEX } from "@/lib/taxonomy-utils";
import { filterToSql } from "@/lib/taxonomy-sql";
import { outdatedCutoffDate } from "@/lib/outdated";
import type { TaxonomyNode } from "@/config/taxonomy-tree";

// list_contains needs an exact-case match; countries are stored upper-case 2-letter
// codes (same convention as the countries= URL filter elsewhere in the app). Exported
// for unit tests (the DuckDB query itself is verified manually against live data —
// see the country-taxa-summary-duckdb.test.ts file comment).
export function countryWhere(cc: string): string {
  return `list_contains(string_split(coalesce(countries, ''), ';'), '${cc.toUpperCase().replace(/'/g, "''")}')`;
}

// One or more country codes — a single country, a whole IUCN region, or an
// arbitrary multi-select, all handled identically here: OR'd list_contains
// checks, not a sum of separately-computed per-country totals. This is why
// there's no double-counting risk generalizing from one country to many — each
// species is exactly one row in the underlying table, so count(*)/GROUP BY
// below still counts it once even if it matches several of these codes at
// once (e.g. occurs in both France and Germany within a "Europe" selection).
export function countriesWhere(codes: string[]): string {
  if (codes.length === 0) return "FALSE"; // no countries selected — matches nothing
  return codes.map(countryWhere).join(" OR ");
}

// DATE, not TIMESTAMP — isOutdated() compares full elapsed time, but assessment_date
// only ever carries day precision, so truncating the cutoff to a date is equivalent
// and avoids a timezone-sensitive TIMESTAMP comparison.
export function outdatedSql(cutoffIso: string): string {
  return `(assessment_date IS NULL OR CAST(assessment_date AS DATE) <= CAST('${cutoffIso}' AS DATE))`;
}

/**
 * Country-scoped equivalent of getTaxaSummary() — one row per Table 1a taxon_group,
 * mirroring build-taxa-summary.ts's pass 1 (a group is its whole CSV file, no
 * class/order/etc. filter). Always emits a row for every known group (even an
 * all-zero one) so the country route's per-node "available" check doesn't wrongly
 * mark a taxon unavailable just because zero of its species occur in this country —
 * unlike the global case, "0 species here" is a real, valid country-scoped answer.
 *
 * `countries` is one or more codes — a single country, a whole region, or an
 * arbitrary multi-select (see countriesWhere's doc comment for why this is safe
 * from double-counting regardless of how many codes are passed).
 */
export async function getCountryTaxaSummary(countries: string[]): Promise<TaxaSummaryRow[]> {
  const conn = await getConn();
  const cutoff = outdatedCutoffDate().toISOString().slice(0, 10);
  const assessedUri = parquetUri("assessed.parquet");
  const rows = (await conn.runAndReadAll(
    `SELECT taxon_group, iucn_category AS category, count(*) AS n,
            sum(CASE WHEN ${outdatedSql(cutoff)} THEN 1 ELSE 0 END) AS n_outdated
     FROM '${assessedUri}'
     WHERE ${countriesWhere(countries)}
     GROUP BY taxon_group, iucn_category`
  )).getRowObjects();

  const byGroup = new Map<string, TaxaSummaryRow>();
  const allGroupIds = getTaxaSummary().map((r) => r.table1a_taxon_group);
  for (const group of allGroupIds) {
    byGroup.set(group, {
      table1a_taxon_group: group,
      total_assessed: 0,
      outdated: 0,
      by_category: {},
      gbif_species_count: 0,
      gbif_ne_species_count: 0,
      total_gbif_observations: 0,
      mean_gbif_obs: 0,
      median_gbif_obs: null,
    });
  }
  for (const r of rows) {
    const group = String(r.taxon_group);
    const row = byGroup.get(group);
    if (!row) continue; // taxon_group not in the current taxa-summary — ignore (shouldn't happen)
    const n = Number(r.n);
    const cat = (r.category as string) || "DD";
    row.total_assessed += n;
    row.outdated += Number(r.n_outdated);
    row.by_category[cat] = (row.by_category[cat] ?? 0) + n;
  }
  return [...byGroup.values()];
}

// Non-catch-all children whose filter defines classNames/orderNames "claim" their
// matching rows away from a catch-all sibling (excludeClasses-bearing child) — see
// computeChildrenSummaries' claim-tracking in build-taxa-summary.ts, which this
// mirrors. families/genera/speciesNames-scoped siblings are deliberately NOT
// claim-eligible (matching that function exactly). Exported for unit tests.
export function claimEligibleSiblingsSql(children: TaxonomyNode[], excludeIdx: number): string | null {
  const clauses = children
    .filter((c, i) => i !== excludeIdx && (c.filter.classNames?.length || c.filter.orderNames?.length))
    .map((c) => filterToSql(c.filter));
  return clauses.length ? clauses.map((c) => `(${c})`).join(" OR ") : null;
}

/**
 * Country-scoped equivalent of getPrecomputedChildrenSummaries(parentNodeId) — one
 * NodeSummary per child of the given parent, mirroring build-taxa-summary.ts's pass
 * 2 (computeChildrenSummaries), including its catch-all claim-tracking, but computed
 * on demand for just this one parent instead of the whole tree.
 *
 * `countries` is one or more codes — see getCountryTaxaSummary's doc comment.
 */
export async function getCountryChildrenSummaries(countries: string[], parentNodeId: string): Promise<NodeSummary[]> {
  const parent = NODE_INDEX.get(parentNodeId);
  if (!parent?.children?.length) return [];
  const conn = await getConn();
  const cutoff = outdatedCutoffDate().toISOString().slice(0, 10);
  const assessedUri = parquetUri("assessed.parquet");
  const children = parent.children;

  const summaries: NodeSummary[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    let where = filterToSql(child.filter);
    if (child.filter.excludeClasses?.length) {
      const claimed = claimEligibleSiblingsSql(children, i);
      if (claimed) where = `(${where}) AND NOT (${claimed})`;
    }
    const rows = (await conn.runAndReadAll(
      `SELECT iucn_category AS category, count(*) AS n,
              sum(CASE WHEN ${outdatedSql(cutoff)} THEN 1 ELSE 0 END) AS n_outdated
       FROM '${assessedUri}'
       WHERE (${where}) AND (${countriesWhere(countries)})
       GROUP BY iucn_category`
    )).getRowObjects();

    let totalAssessed = 0;
    let outdated = 0;
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      const n = Number(r.n);
      totalAssessed += n;
      outdated += Number(r.n_outdated);
      const cat = r.category as string | null;
      if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + n;
    }
    // estimatedDescribed/gbifNeSpeciesCount: no valid per-country value (see file
    // doc comment) — 0 here, not undefined, since NodeSummary requires a number;
    // callers must consult the response's countryScoped flag to know to hide them.
    summaries.push({
      id: child.id,
      name: child.name,
      estimatedDescribed: 0,
      totalAssessed,
      outdated,
      gbifNeSpeciesCount: 0,
      byCategory,
    });
  }
  return summaries;
}
