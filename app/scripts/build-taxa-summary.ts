/**
 * build-taxa-summary: Compute per-taxon summary stats → taxa-summary.json
 *                     + node-children-summaries.json for instant drill-down
 *
 * Reads per-taxon redlist and GBIF CSVs, computes summary statistics,
 * and writes to data/taxa-summary.json and data/node-children-summaries.json.
 *
 * Usage:
 *   npx tsx scripts/build-taxa-summary.ts
 */

import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR, REDLIST_DIR, GBIF_DIR } from "./utils";
import { TAXA } from "./taxa";
import { readRedlistCsv } from "./fetch-redlist-species";
import { readGbifCsv } from "./fetch-gbif-species";
import { readMappingCsv } from "./match-redlist-species-to-gbif";
import { NODE_INDEX, hasChildren, matchesFilter } from "../src/lib/taxonomy-utils";
import type { TaxonomyNode } from "../src/config/taxonomy-tree";
import type { NodeSummary } from "../src/lib/data/species-store";
import {
  COL_SPECIES_NAME_OVERRIDES,
  COL_EXCLUDE_ALL_NODES,
  COL_DOMESTIC_EXCLUDE_NAMES,
} from "../src/config/col-described-overrides";

const CURRENT_YEAR = new Date().getFullYear();
const OUTDATED_THRESHOLD_YEARS = 10;

// CoL species kept out of the universe (like the domesticated-GBIF exclusion). Homo sapiens
// — IUCN omits humans from its Red List export. Keep in sync with species-duckdb.ts.
const EXCLUDED_COL_IDS_SQL = `('6MB3T')`; // Homo sapiens

export interface TaxonSummaryRow {
  table1a_taxon_group: string;
  total_assessed: number;
  outdated: number;
  by_category: Record<string, number>;
  gbif_species_count: number;
  gbif_ne_species_count: number;
  total_gbif_observations: number;
  mean_gbif_obs: number;
  median_gbif_obs: number | null;
  // Catalogue of Life backbone (#271): the extant accepted-species universe in this
  // group (col_described) and how many of those IUCN hasn't evaluated (col_ne =
  // universe minus assessed, by col_id). Filled after the per-taxon loop; 0 if the
  // CoL artifacts aren't present.
  col_described?: number;
  col_ne?: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A species CoL flags extinct still counts toward "described" if IUCN's OWN linked
// assessment agrees it's extinct (category EX/EW) — matching IUCN's Red List
// Guidelines (taxa extinct before 1500 CE are out of scope entirely; CoL gives us no
// extinction date, so "IUCN has confirmed EX/EW" is the closest available signal).
// Deliberately NOT "any IUCN assessment exists for this col_id": species_link matches
// by name/synonym, not taxonomic concept, so a CoL-extinct species can link to a
// STALE assessment of an unrelated or since-split taxon with a non-EX category (e.g.
// several CoL-extinct-flagged names matched to Least-Concern Columba species during
// verification) — requiring the category itself be EX/EW is what makes this safe.
// Species newly included this way are, by construction, always already-assessed
// (that's the join condition), so they can never also appear in col_ne — expanding
// this set only ever grows col_described, it never mislabels something "Not
// Evaluated" that's actually a long-extinct, never-assessed fossil.
async function createExEwAssessedTable(conn: DuckDBConnection, link: string, assessed: string, tableName: string): Promise<void> {
  await conn.run(`
    CREATE TEMP TABLE ${tableName} AS
      SELECT DISTINCT l.col_id
      FROM read_parquet('${link}') l
      JOIN read_parquet('${assessed}') a ON a.id = l.id
      WHERE l.src = 'redlist' AND l.col_id IS NOT NULL AND a.iucn_category IN ('EX', 'EW')`);
}

// "Extant, or CoL-extinct but IUCN-confirmed EX/EW" — see createExEwAssessedTable.
function extantUniverseSql(exEwTable: string): string {
  return `(extinct IS NOT TRUE OR col_id IN (SELECT col_id FROM ${exEwTable}))`;
}

// Per-taxon_group CoL counts from the backbone artifacts: col_described = extant
// accepted universe; col_ne = that minus the col_ids IUCN has assessed. species/ is
// partitioned by taxon_group, so this is a single grouped scan. Returns empty (→ 0s)
// when the CoL artifacts aren't present (e.g. a sync that hasn't built them yet).
async function colCountsByGroup(): Promise<Map<string, { col_described: number; col_ne: number }>> {
  const out = new Map<string, { col_described: number; col_ne: number }>();
  const link = path.join(DATA_DIR, "species_link.parquet");
  const assessedPath = path.join(DATA_DIR, "assessed.parquet");
  const speciesGlob = path.join(DATA_DIR, "species", "**", "*.parquet");
  if (!fs.existsSync(path.join(DATA_DIR, "species")) || !fs.existsSync(link)) {
    console.log("  CoL counts: species/ or species_link.parquet missing — skipping (col_described/col_ne = 0)");
    return out;
  }
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  await createExEwAssessedTable(conn, link, assessedPath, "ex_ew_assessed");
  const universe = extantUniverseSql("ex_ew_assessed");
  // Same domestic-form exclusion every SSC group's own CoL count already applies (see
  // filterToSql/COL_DOMESTIC_EXCLUDE_NAMES below) — without it, this per-taxon_group
  // total (used for the top-level "Mammals" row etc.) counts a domestic form alongside
  // its wild sibling species, diverging from the sum of that taxon's SSC group rows.
  // Deliberately COL_DOMESTIC_EXCLUDE_NAMES here, not the wider COL_EXCLUDE_ALL_NODES —
  // the extra bison-name overrides in that list exist only to stop sibling SSC nodes
  // (Bison SG vs. Asian Wild Cattle SG) double-counting each other, which doesn't apply
  // to this flat, single-group scan; excluding them here would just undercount bison.
  const notDomestic = `coalesce(lower(scientific_name), '') NOT IN (${sqlStrList(COL_DOMESTIC_EXCLUDE_NAMES)})`;
  const rows = await (await conn.run(`
    SELECT taxon_group,
           count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND ${notDomestic}) AS col_described,
           count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND ${notDomestic} AND col_id NOT IN (
             SELECT col_id FROM read_parquet('${link}') WHERE src = 'redlist' AND col_id IS NOT NULL
           )) AS col_ne
    FROM read_parquet('${speciesGlob}', hive_partitioning=true)
    GROUP BY taxon_group`)).getRowObjects();
  for (const r of rows) out.set(String(r.taxon_group), { col_described: Number(r.col_described), col_ne: Number(r.col_ne) });
  return out;
}

type NodeFilter = TaxonomyNode["filter"];

// The display tree classifies fishes by the traditional GBIF/IUCN classes, but CoL XR
// uses finer classes — so a node filtering on `actinopterygii` matches zero CoL rows
// (which are `teleostei`, `holostei`, …). Expand those display classes to the CoL
// classes they contain so the four fish sub-groups count correctly. Identity for any
// class name that already exists in CoL (orders are unaffected).
const COL_CLASS_ALIASES: Record<string, string[]> = {
  actinopterygii: ["teleostei", "chondrostei", "cladistii", "holostei"],
  sarcopterygii: ["dipneusti", "coelacanthi"],
  chondrichthyes: ["elasmobranchii", "holocephali"],
};
function expandClasses(names: string[]): string[] {
  return names.flatMap((n) => COL_CLASS_ALIASES[n.toLowerCase()] ?? [n]);
}

function sqlStrList(vals: string[]): string {
  return vals.map((v) => `'${v.toLowerCase().replace(/'/g, "''")}'`).join(", ");
}

// See config/col-described-overrides.ts for what these are and why — shared with the
// frontend so the "# Described Species" tooltip explains the same overrides applied
// here, instead of the two silently drifting apart.

// Translate a taxonomy node filter into a SQL predicate over species/, mirroring
// matchesFilter() exactly — including its `?? ""` null handling (so a null order_name
// behaves like an empty string, not SQL NULL, which would otherwise drop such rows from
// both an include and its complementary exclude). Children partition a group by
// class/order, which is exclusive in the CoL universe — so no claim-tracking needed.
// nodeId (optional) triggers the species-name overrides above when computing a node's
// own CoL described/not-evaluated counts — irrelevant for the real IUCN-assessed-species
// matching this same function mirrors, which doesn't go through this code path.
function filterToSql(filter: NodeFilter, nodeId?: string): string {
  const sciName = "coalesce(lower(scientific_name), '')";
  if (nodeId && COL_SPECIES_NAME_OVERRIDES[nodeId]) {
    return `taxon_group IN (${sqlStrList(filter.csvGroups)}) AND ${sciName} IN (${sqlStrList(COL_SPECIES_NAME_OVERRIDES[nodeId])})`;
  }
  const cls = "coalesce(lower(class_name), '')";
  const ord = "coalesce(lower(order_name), '')";
  const fam = "coalesce(lower(family), '')";
  const genus = "coalesce(lower(split_part(scientific_name, ' ', 1)), '')";
  const conds: string[] = [`taxon_group IN (${sqlStrList(filter.csvGroups)})`];
  if (filter.classNames?.length) conds.push(`${cls} IN (${sqlStrList(expandClasses(filter.classNames))})`);
  if (filter.excludeClasses?.length) conds.push(`${cls} NOT IN (${sqlStrList(expandClasses(filter.excludeClasses))})`);
  if (filter.orderNames?.length) {
    const l = sqlStrList(filter.orderNames);
    conds.push(`(${ord} IN (${l}) OR (${ord} = '' AND ${cls} IN (${l})))`);
  }
  if (filter.excludeOrders?.length) {
    const l = sqlStrList(filter.excludeOrders);
    conds.push(`NOT (${ord} IN (${l}) OR (${ord} = '' AND ${cls} IN (${l})))`);
  }
  if (filter.families?.length) conds.push(`${fam} IN (${sqlStrList(filter.families)})`);
  if (filter.excludeFamilies?.length) conds.push(`${fam} NOT IN (${sqlStrList(filter.excludeFamilies)})`);
  if (filter.genera?.length) conds.push(`${genus} IN (${sqlStrList(filter.genera)})`);
  if (filter.excludeGenera?.length) conds.push(`${genus} NOT IN (${sqlStrList(filter.excludeGenera)})`);
  if (filter.speciesNames?.length) conds.push(`${sciName} IN (${sqlStrList(filter.speciesNames)})`);
  if (filter.excludeSpeciesNames?.length) conds.push(`${sciName} NOT IN (${sqlStrList(filter.excludeSpeciesNames)})`);
  // Domestic forms + species reassigned to another node's CoL override (see above) —
  // excluded from every node's CoL count so they don't inflate one group's "described"
  // total or get double-counted between two groups.
  conds.push(`${sciName} NOT IN (${sqlStrList(COL_EXCLUDE_ALL_NODES)})`);
  const normalClause = conds.join(" AND ");
  // extraSpeciesNames: mirrors matchesFilter's OR escape hatch (taxonomy-utils.ts) —
  // species included regardless of the class/order/family/genus rule above. Still
  // scoped to this node's csvGroups and the CoL-only exclusions.
  if (filter.extraSpeciesNames?.length) {
    const extraClause = `taxon_group IN (${sqlStrList(filter.csvGroups)}) AND ${sciName} IN (${sqlStrList(filter.extraSpeciesNames)}) AND ${sciName} NOT IN (${sqlStrList(COL_EXCLUDE_ALL_NODES)})`;
    return `((${normalClause}) OR (${extraClause}))`;
  }
  return normalClause;
}

type PrimaryDim = { field: keyof NodeFilter; rank: string; names: string[] };

// Whichever include field enumerates this node's species is its "primary dimension"
// — the tree never sets more than one of these on a node (verified by
// taxonomy-tree.test.ts), so picking the first non-empty one is unambiguous.
function primaryDimension(filter: NodeFilter): PrimaryDim | null {
  if (filter.classNames?.length) return { field: "classNames", rank: "class", names: filter.classNames };
  if (filter.orderNames?.length) return { field: "orderNames", rank: "order", names: filter.orderNames };
  if (filter.families?.length) return { field: "families", rank: "family", names: filter.families };
  if (filter.genera?.length) return { field: "genera", rank: "genus", names: filter.genera };
  if (filter.speciesNames?.length) return { field: "speciesNames", rank: "species", names: filter.speciesNames };
  return null;
}

// Why one assessed species (behind a breakdown row's "No CoL Match" count) doesn't
// have a clean 1:1 CoL match — see classifyNoMatch. Modular/self-contained by design
// (a single function producing an additive field, colBreakdown[].noMatchDetails) so
// this can be reverted independently of the count-only noMatchIds mechanism it rides
// alongside.
export type NoMatchReason = "no_link" | "missing_from_backbone" | "infraspecific" | "provisional" | "lumped" | "not_in_base" | "extinct_unconfirmed" | "classified_elsewhere";
export interface NoMatchDetail {
  id: number;
  name: string;
  reason: NoMatchReason;
  /** The species/name it's lumped with or demoted under (reasons "lumped"/"infraspecific" only). */
  detail?: string;
  /** That species' own assessed id, so the frontend can link to it too ("lumped"/"infraspecific", only when the parent is itself IUCN-assessed). */
  detailId?: number;
}

// Classifies one "no match" diagnosis row (see the diagRows query in attachColCounts)
// into a human-explainable reason, cheapest/most-specific check first:
//  - no_link: never matched to any CoL name at all.
//  - infraspecific: its linked col_id IS in the current backbone, but at subspecies/
//    variety/form rank, not species rank — CoL currently treats it as part of
//    another species rather than its own (e.g. Arctocephalus townsendi is currently
//    "Arctocephalus philippii townsendi" in CoL). `detail`/`detailId` name the
//    parent it's classified under, linked if that parent is itself IUCN-assessed.
//  - provisional: its linked col_id IS species rank in the current backbone, but
//    status is "provisionally accepted" rather than "accepted" — CoL has the
//    concept, just hasn't fully accepted it yet (deliberately excluded from
//    colDescribed — provisionally-accepted names overshoot IUCN's own totals).
//  - missing_from_backbone: its linked col_id has no row in the backbone at all —
//    a genuine dangling reference (rare/never in practice; kept as a fallback for
//    the infraspecific/provisional checks above when they can't resolve a parent,
//    and for whenever backbone.parquet isn't available at build time).
//  - lumped: its linked col_id IS in the universe, but a DIFFERENT assessed species
//    won the accepted-name tie-break for it (a genuine CoL synonymy/lump).
//  - not_in_base: its linked col_id exists and matches this name, but isn't in CoL's
//    curated Base checklist yet (freshly split/described, still XR-only).
//  - extinct_unconfirmed: CoL flags its linked col_id extinct, but IUCN hasn't
//    confirmed EX/EW for it (so it falls outside the extant-or-EX/EW universe).
//  - classified_elsewhere: none of the above — the linked col_id is real, in_base,
//    and extant, but CoL's own class/order/family for it doesn't match this name
//    (a CoL-side reclassification, e.g. the pre-fix Ziphiidae/Hyperoodontidae case).
function classifyNoMatch(row: Record<string, unknown>): NoMatchDetail {
  const id = Number(row.id);
  const name = String(row.name);
  const linkedColId = row.linked_col_id as string | null;
  const linkedName = row.linked_name as string | null;
  const linkedInBase = row.linked_in_base as boolean | null;
  const linkedExtinct = row.linked_extinct as boolean | null;
  const winnerName = row.winner_name as string | null;
  const winnerId = row.winner_id as number | null;
  const bkRank = row.bk_rank as string | null;
  const parentName = row.parent_name as string | null;
  const parentAssessedId = row.parent_assessed_id as number | null;
  const parentAssessedName = row.parent_assessed_name as string | null;
  if (!linkedColId) return { id, name, reason: "no_link" };
  if (!linkedName) {
    if (bkRank === "species") return { id, name, reason: "provisional" };
    if (bkRank) {
      if (parentAssessedName) {
        return { id, name, reason: "infraspecific", detail: parentAssessedName, detailId: parentAssessedId != null ? Number(parentAssessedId) : undefined };
      }
      if (parentName) return { id, name, reason: "infraspecific", detail: parentName };
    }
    return { id, name, reason: "missing_from_backbone" };
  }
  if (winnerName) return { id, name, reason: "lumped", detail: winnerName, detailId: winnerId != null ? Number(winnerId) : undefined };
  if (!linkedInBase) return { id, name, reason: "not_in_base" };
  if (linkedExtinct) return { id, name, reason: "extinct_unconfirmed" };
  return { id, name, reason: "classified_elsewhere" };
}

// Heuristic "split from" flag for Not Evaluated species — see SPLIT_CANDIDATES_SQL
// below for the mechanism and its caveats. Keyed by col_id (NE species have no
// sis_taxon_id), additive on top of colBreakdown, and independently droppable.
export interface SplitDetail {
  colId: string;
  parentId: number;
  parentName: string;
  parentCategory: string;
}

// Precomputes a col_id → likely-former-parent lookup, once per build (not once per
// breakdown name — backbone.parquet is ~3.8M rows, so re-scanning it per name would
// be wasteful). The heuristic: CoL keeps a subspecies/infraspecific synonym record
// when a subspecies is promoted to full species status (e.g. "Gazella gazella
// acaciae" survives as a synonym once "Gazella acaciae" becomes its own accepted
// species) — so a synonym whose first two name tokens (genus + species) match an
// IUCN-assessed species is very likely that promoted species' former parent.
//
// One extra wrinkle, found via Giraffa tippelskirchi (a masai giraffe, promoted from
// subspecies to species — genuinely NE, split from the assessed Giraffa
// camelopardalis): CoL doesn't always point the old synonym straight at the new
// species. When the promoted species also got its own nominate subspecies (an
// "autonym" — here "Giraffa tippelskirchi tippelskirchi"), the OLD synonym
// ("Giraffa camelopardalis tippelskirchi") points at that new nominate SUBSPECIES,
// not at the species itself. So a direct synonym->parent hop isn't enough — this
// resolves one extra hop up (subspecies -> its own parent) whenever the synonym's
// immediate parent turns out to be an accepted subspecies/infraspecific rank rather
// than the species itself.
//
// This only catches the "was a named subspecies, got promoted" pattern (the common
// case in recent Bovidae/Giraffidae splits) — it won't catch a split into a
// segregate with no prior CoL subspecies record. One arbitrary (but deterministic)
// candidate is kept per NE species via row_number when more than one subspecies-rank
// synonym implies a different parent.
const SPLIT_CANDIDATES_SQL = (bb: string, assessedPath: string) => `
  CREATE TEMP TABLE split_candidates AS
  WITH synonym_rows AS (
    SELECT
      b.parent_id AS direct_parent_id,
      split_part(b.scientific_name, ' ', 1) || ' ' || split_part(b.scientific_name, ' ', 2) AS parent_binomial
    FROM read_parquet('${bb}') b
    WHERE b.status = 'synonym' AND b.rank IN ('subspecies', 'infraspecific name', 'variety')
  ),
  resolved AS (
    SELECT
      CASE
        WHEN p.rank = 'species' THEN p.col_id
        WHEN p.rank IN ('subspecies', 'infraspecific name', 'variety')
             AND p.status IN ('accepted', 'provisionally accepted') THEN p.parent_id
        ELSE NULL
      END AS ne_col_id,
      sr.parent_binomial
    FROM synonym_rows sr
    JOIN read_parquet('${bb}') p ON p.col_id = sr.direct_parent_id
  ),
  candidate_synonyms AS (
    SELECT ne_col_id, parent_binomial FROM resolved
    WHERE ne_col_id IS NOT NULL AND ne_col_id NOT IN (SELECT col_id FROM assessed_cids)
  ),
  matched AS (
    SELECT DISTINCT cs.ne_col_id, a.id AS parent_id, a.scientific_name AS parent_name, a.iucn_category AS parent_category
    FROM candidate_synonyms cs
    JOIN read_parquet('${assessedPath}') a ON lower(a.scientific_name) = lower(cs.parent_binomial)
  )
  SELECT ne_col_id, parent_id, parent_name, parent_category,
         row_number() OVER (PARTITION BY ne_col_id ORDER BY parent_id) AS rn
  FROM matched`;

// Precomputes a global col_id → IUCN-assessed-species lookup, once per build. Used
// by the "infraspecific" no-match reason (see classifyNoMatch) to name/link the
// currently-assessed species a demoted subspecies/variety is now classified under
// (e.g. Arctocephalus townsendi → Arctocephalus philippii) — a plain global lookup,
// not scoped to any one breakdown name, since the parent can fall in a different
// name within the same node (rare, but there's no reason to miss it). Same
// accepted-preferred tie-break as the per-name `winners` CTE in diagRows.
const COL_TO_ASSESSED_SQL = (link: string, assessedPath: string) => `
  CREATE TEMP TABLE col_to_assessed AS
  WITH links AS (
    SELECT l.col_id AS col_id, l.id AS assessed_id, a.scientific_name AS assessed_name,
           row_number() OVER (
             PARTITION BY l.col_id
             ORDER BY (CASE WHEN l.match_method IN ('accepted', 'accepted_homonym') THEN 0 ELSE 1 END), l.id
           ) AS rn
    FROM read_parquet('${link}') l
    JOIN read_parquet('${assessedPath}') a ON a.id = l.id
    WHERE l.src = 'redlist' AND l.col_id IS NOT NULL AND l.match_method != 'iucn_synonym_covered'
  )
  SELECT col_id, assessed_id, assessed_name FROM links WHERE rn = 1`;

// Attach CoL counts (colDescribed / colNe) to every node-children summary — same
// universe + assessed-by-col_id logic as the per-group counts, filtered per node so
// sub-groups (e.g. mammals → rodents) get real numbers instead of "—". Also attaches
// a per-name breakdown of colDescribed for nodes whose primary dimension enumerates
// more than one name (e.g. Pinniped SG: Otariidae/Phocidae/Odobenidae) — each count
// re-runs filterToSql narrowed to that one name (keeping every other clause, so a
// domestic-form exclusion or an overlapping node's excludeGenera still applies),
// which is why the entries sum to exactly colDescribed.
async function attachColCounts(summaries: Record<string, NodeSummary[]>): Promise<void> {
  const link = path.join(DATA_DIR, "species_link.parquet");
  const assessedPath = path.join(DATA_DIR, "assessed.parquet");
  const speciesGlob = path.join(DATA_DIR, "species", "**", "*.parquet");
  const backbonePath = path.join(DATA_DIR, "backbone.parquet");
  if (!fs.existsSync(path.join(DATA_DIR, "species")) || !fs.existsSync(link)) {
    console.log("  CoL node counts: species/ or species_link.parquet missing — skipping.");
    return;
  }
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  await conn.run(
    `CREATE TEMP TABLE assessed_cids AS SELECT DISTINCT col_id FROM read_parquet('${link}') WHERE src = 'redlist' AND col_id IS NOT NULL`
  );
  await createExEwAssessedTable(conn, link, assessedPath, "ex_ew_assessed");
  const universe = extantUniverseSql("ex_ew_assessed");
  const hasBackbone = fs.existsSync(backbonePath);
  if (hasBackbone) {
    await conn.run(SPLIT_CANDIDATES_SQL(backbonePath, assessedPath));
    await conn.run(COL_TO_ASSESSED_SQL(link, assessedPath));
  }
  let n = 0;
  let breakdownQueries = 0;
  for (const children of Object.values(summaries)) {
    for (const child of children) {
      const node = NODE_INDEX.get(child.id);
      if (!node) continue;
      const rows = await (await conn.run(`
        SELECT count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}) AS col_described,
               count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND col_id NOT IN (SELECT col_id FROM assessed_cids)) AS col_ne
        FROM read_parquet('${speciesGlob}', hive_partitioning=true)
        WHERE ${filterToSql(node.filter, node.id)}`)).getRowObjects();
      child.colDescribed = Number(rows[0].col_described);
      child.colNe = Number(rows[0].col_ne);
      n++;

      const dim = COL_SPECIES_NAME_OVERRIDES[node.id] ? null : primaryDimension(node.filter);
      if (dim) {
        const breakdown: {
          name: string; count: number; neCount: number; trueAssessed: number; noMatchIds: number[];
          noMatchDetails?: NoMatchDetail[];
          splitDetails?: SplitDetail[];
        }[] = [];
        for (const name of dim.names) {
          const narrowed: NodeFilter = { ...node.filter, [dim.field]: [name] };
          const bRows = await (await conn.run(`
            SELECT count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}) AS n,
                   count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND col_id NOT IN (SELECT col_id FROM assessed_cids)) AS ne
            FROM read_parquet('${speciesGlob}', hive_partitioning=true)
            WHERE ${filterToSql(narrowed, node.id)}`)).getRowObjects();
          // IUCN's own count of assessed species matching this one name — via
          // filterToSql WITHOUT nodeId, so a Bison-style CoL species-name override
          // (which only makes sense for CoL-sourced rows) doesn't wrongly zero out an
          // IUCN-sourced match (assessed.parquet still says "Bison bison", never CoL's
          // lumped "Bos bison"). Compared against count-neCount on the frontend to
          // flag likely splits/lumps/coverage gaps the CoL-derived figures paper over
          // (see BreakdownList in TaxaSummary.tsx).
          const trueRows = await (await conn.run(`
            SELECT count(*) AS n FROM read_parquet('${assessedPath}') WHERE ${filterToSql(narrowed)}`)).getRowObjects();
          // The specific assessed species (sis_taxon_id) behind that gap, plus enough
          // context (its own primary CoL link, and who "won" that link if it lost a
          // tie) to classify WHY each one doesn't have a clean match — see
          // classifyNoMatch below. Each CTE is scoped to a single table so
          // filterToSql's bare column names (shared between species/ and
          // assessed.parquet, e.g. scientific_name) never collide. Two assessed
          // species can share one col_id (a genuine CoL lump — e.g. Wild Pig SG's Sus
          // bucculentus (EX) is CoL-synonymized into Sus scrofa (LC), both linked to
          // the same accepted col_id) — count(*) over distinct col_ids (bRows above)
          // only "sees" that pair once, so trueAssessed can exceed count-neCount even
          // when every assessed id technically has SOME link. ROW_NUMBER picks one
          // canonical "CoL Match" winner per col_id (preferring an accepted-name
          // match over a synonym-derived one); every other candidate for that col_id,
          // and every id with no valid link at all, ends up unmatched — making
          // trueAssessed - noMatchIds.length exactly equal the "CoL Match" count.
          const diagRows = await (await conn.run(`
            WITH matched_species AS (
              SELECT col_id FROM read_parquet('${speciesGlob}', hive_partitioning=true)
              WHERE in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND ${filterToSql(narrowed, node.id)}
            ),
            matched_assessed AS (
              SELECT id, scientific_name FROM read_parquet('${assessedPath}') WHERE ${filterToSql(narrowed)}
            ),
            primary_links AS (
              -- Primary link only (excludes 'iucn_synonym_covered' — a bookkeeping
              -- alias so an assessed species doesn't resurface as a new NE candidate
              -- under a second CoL name, not a real "this species also equals a
              -- second col_id" claim). Without this, an id with both a primary and a
              -- covered link would win TWO col_id partitions and inflate the
              -- apparent match count.
              SELECT ma.id AS id, ma.scientific_name AS name, l.col_id AS col_id, l.match_method AS match_method
              FROM matched_assessed ma
              JOIN read_parquet('${link}') l ON l.id = ma.id AND l.src = 'redlist' AND l.col_id IS NOT NULL AND l.match_method != 'iucn_synonym_covered'
            ),
            candidate_links AS (
              SELECT id, name, col_id,
                     row_number() OVER (
                       PARTITION BY col_id
                       ORDER BY (CASE WHEN match_method IN ('accepted', 'accepted_homonym') THEN 0 ELSE 1 END), id
                     ) AS rn
              FROM primary_links
              WHERE col_id IN (SELECT col_id FROM matched_species)
            ),
            winners AS (
              SELECT col_id, id AS winner_id, name AS winner_name FROM candidate_links WHERE rn = 1
            )
            SELECT
              ma.id AS id, ma.scientific_name AS name,
              pl.col_id AS linked_col_id,
              sp.scientific_name AS linked_name, sp.in_base AS linked_in_base, sp.extinct AS linked_extinct,
              w.winner_name AS winner_name, w.winner_id AS winner_id
              ${hasBackbone ? `,
              bk.rank AS bk_rank,
              bkparent.scientific_name AS parent_name,
              ca.assessed_id AS parent_assessed_id, ca.assessed_name AS parent_assessed_name` : ""}
            FROM matched_assessed ma
            LEFT JOIN primary_links pl ON pl.id = ma.id
            LEFT JOIN read_parquet('${speciesGlob}', hive_partitioning=true) sp ON sp.col_id = pl.col_id
            LEFT JOIN winners w ON w.col_id = pl.col_id
            LEFT JOIN candidate_links cl ON cl.id = ma.id AND cl.rn = 1
            ${hasBackbone ? `
            -- Only needed to explain species/-misses (sp.scientific_name IS NULL) more
            -- precisely than a blanket "missing from backbone" — see classifyNoMatch's
            -- infraspecific/provisional reasons.
            LEFT JOIN read_parquet('${backbonePath}') bk ON bk.col_id = pl.col_id
            LEFT JOIN read_parquet('${backbonePath}') bkparent ON bkparent.col_id = bk.parent_id
            LEFT JOIN col_to_assessed ca ON ca.col_id = bk.parent_id` : ""}
            WHERE cl.id IS NULL
            -- Deterministic order — this JOIN chain has no natural order, and without
            -- one DuckDB's parallel scan returns diagRows (and so noMatchIds /
            -- noMatchDetails) in a different order on every run, turning every
            -- unrelated data sync into a huge same-set reordering diff.
            ORDER BY ma.id`)).getRowObjects();
          // Note: trueAssessed - noMatchIds.length (the "CoL Match" count shown in the
          // popover) is NOT expected to equal count - neCount above — the latter's
          // "linked" definition (assessed_cids) includes col_ids only reachable via an
          // 'iucn_synonym_covered' bookkeeping alias (an NE-dedup mechanism, not a real
          // second described species), which noMatchIds deliberately excludes so one
          // assessed id can't appear as the "canonical" CoL match for two different
          // col_ids at once. Both are correct; they answer different questions (CoL's
          // own described-vs-assessed split, vs. which specific IUCN-assessed species
          // have a clean 1:1 CoL match).
          const noMatchDetails = diagRows.map((r) => classifyNoMatch(r));
          // "Split from" candidates for this name's NE species — a lookup against the
          // once-per-build split_candidates table (see SPLIT_CANDIDATES_SQL), not a
          // fresh backbone.parquet scan. Deliberately scoped to the SAME NE universe
          // as bRows.ne (in_base, extant/EX-EW, narrowed filter), so an entry here is
          // guaranteed to be one of this name's neCount species.
          const splitDetails: SplitDetail[] = hasBackbone
            ? (await (await conn.run(`
                SELECT ns.col_id AS ne_col_id, sc.parent_id, sc.parent_name, sc.parent_category
                FROM (
                  SELECT col_id FROM read_parquet('${speciesGlob}', hive_partitioning=true)
                  WHERE in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}
                    AND ${filterToSql(narrowed, node.id)} AND col_id NOT IN (SELECT col_id FROM assessed_cids)
                ) ns
                JOIN split_candidates sc ON sc.ne_col_id = ns.col_id AND sc.rn = 1`)).getRowObjects())
                .map((r) => ({
                  colId: String(r.ne_col_id), parentId: Number(r.parent_id),
                  parentName: String(r.parent_name), parentCategory: String(r.parent_category),
                }))
            : [];
          breakdown.push({
            name, count: Number(bRows[0].n), neCount: Number(bRows[0].ne), trueAssessed: Number(trueRows[0].n),
            noMatchIds: noMatchDetails.map((d) => d.id),
            ...(noMatchDetails.length ? { noMatchDetails } : {}),
            ...(splitDetails.length ? { splitDetails } : {}),
          });
          breakdownQueries++;
        }
        child.colBreakdown = breakdown;
      }
    }
  }
  console.log(`  CoL node counts: attached to ${n} node summaries (${breakdownQueries} per-name breakdown queries).`);
}

export async function run(): Promise<void> {
  const summaries: TaxonSummaryRow[] = [];

  // Load mapping to determine which GBIF species are linked to redlist entries
  const mapping = readMappingCsv();
  const linkedGbifKeys = new Set<number>();
  for (const links of mapping.values()) {
    for (const link of links) {
      if (link.gbif_species_key != null) linkedGbifKeys.add(link.gbif_species_key);
    }
  }

  for (const taxon of TAXA) {
    const redlistPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
    const gbifPath = path.join(GBIF_DIR, `${taxon.id}.csv`);

    if (!fs.existsSync(redlistPath)) {
      console.log(`  Skipping ${taxon.id} — no redlist CSV`);
      continue;
    }

    const redlistSpecies = readRedlistCsv(taxon.id);

    const totalAssessed = redlistSpecies.length;
    let outdated = 0;
    const byCategory: Record<string, number> = {};

    for (const s of redlistSpecies) {
      // Count outdated
      if (s.assessment_date) {
        const year = parseInt(s.assessment_date.slice(0, 4), 10);
        if (!isNaN(year) && CURRENT_YEAR - year > OUTDATED_THRESHOLD_YEARS) {
          outdated++;
        }
      } else {
        // No assessment date = treat as outdated
        outdated++;
      }

      // Count by category
      const cat = s.category || "DD";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    // GBIF stats
    let gbifSpeciesCount = 0;
    let gbifNeSpeciesCount = 0;
    let totalGbifObservations = 0;
    const obsCounts: number[] = [];

    if (fs.existsSync(gbifPath)) {
      const gbifMap = readGbifCsv(taxon.id);
      gbifSpeciesCount = gbifMap.size;
      for (const [key, g] of gbifMap) {
        totalGbifObservations += g.total_count;
        obsCounts.push(g.total_count);
        // NE = GBIF species not linked to any redlist entry
        if (!linkedGbifKeys.has(key)) gbifNeSpeciesCount++;
      }
    }

    const meanGbifObs = gbifSpeciesCount > 0
      ? totalGbifObservations / gbifSpeciesCount
      : 0;

    summaries.push({
      table1a_taxon_group: taxon.id,
      total_assessed: totalAssessed,
      outdated,
      by_category: byCategory,
      gbif_species_count: gbifSpeciesCount,
      gbif_ne_species_count: gbifNeSpeciesCount,
      total_gbif_observations: totalGbifObservations,
      mean_gbif_obs: meanGbifObs,
      median_gbif_obs: median(obsCounts),
    });

    console.log(`  ${taxon.id}: ${totalAssessed} assessed, ${gbifNeSpeciesCount} unassessed, ${outdated} outdated, ${gbifSpeciesCount} GBIF species`);
  }

  // Catalogue of Life per-group counts: extant universe (col_described) and the
  // not-evaluated slice (col_ne = universe minus assessed col_ids). species/ is
  // partitioned by taxon_group, so this is one grouped scan. 0s if CoL not built yet.
  const colCounts = await colCountsByGroup();
  for (const s of summaries) {
    const c = colCounts.get(s.table1a_taxon_group);
    s.col_described = c?.col_described ?? 0;
    s.col_ne = c?.col_ne ?? 0;
  }

  const outputPath = path.join(DATA_DIR, "taxa-summary.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summaries, null, 2) + "\n");
  console.log(`\nWrote ${summaries.length} taxa → ${outputPath}`);

  // ─── Second pass: precompute node children summaries ──────────────
  console.log("\nComputing node children summaries...");

  // Build caches for CSV data (reusing what readRedlistCsv/readGbifCsv load)
  const redlistByGroup = new Map<string, ReturnType<typeof readRedlistCsv>>();
  const gbifByGroup = new Map<string, ReturnType<typeof readGbifCsv>>();
  for (const taxon of TAXA) {
    if (fs.existsSync(path.join(REDLIST_DIR, `${taxon.id}.csv`))) {
      redlistByGroup.set(taxon.id, readRedlistCsv(taxon.id));
    }
    if (fs.existsSync(path.join(GBIF_DIR, `${taxon.id}.csv`))) {
      gbifByGroup.set(taxon.id, readGbifCsv(taxon.id));
    }
  }

  // Must match EXCLUDED_DOMESTICATED_GBIF_KEYS in species-store.ts
  const excludedDomesticatedGbifKeys = new Set([
    2441022, 2435035, 2441110, 2441056, 2440886, 7422937, 2440891,
    9055455, 2441238, 5220190, 7515593, 2441019, 5219702, 10694102, 2436436,
  ]);

  function isOutdated(assessmentDate: string | null): boolean {
    if (!assessmentDate) return true;
    const year = parseInt(assessmentDate.slice(0, 4), 10);
    if (isNaN(year)) return true;
    return CURRENT_YEAR - year > OUTDATED_THRESHOLD_YEARS;
  }

  function computeNodeSummary(node: TaxonomyNode): NodeSummary {
    const filter = node.filter;
    let totalAssessed = 0;
    let outdatedCount = 0;
    let gbifNeSpeciesCount = 0;
    const byCategory: Record<string, number> = {};

    for (const group of filter.csvGroups) {
      const rows = redlistByGroup.get(group) ?? [];
      for (const row of rows) {
        if (!matchesFilter(row, filter)) continue;
        totalAssessed++;
        if (isOutdated(row.assessment_date)) outdatedCount++;
        const cat = row.category;
        if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      }

      const gbifMap = gbifByGroup.get(group);
      if (gbifMap) {
        for (const [key, gbifRow] of gbifMap) {
          if (linkedGbifKeys.has(key)) continue;
          if (excludedDomesticatedGbifKeys.has(key)) continue;
          if (!matchesFilter(gbifRow, filter)) continue;
          gbifNeSpeciesCount++;
        }
      }
    }

    return {
      id: node.id,
      name: node.name,
      estimatedDescribed: node.estimatedDescribed ?? 0,
      totalAssessed,
      outdated: outdatedCount,
      gbifNeSpeciesCount,
      byCategory,
    };
  }

  function computeChildrenSummaries(parentNode: TaxonomyNode): NodeSummary[] {
    const children = parentNode.children!;

    // Check if we need claim tracking (for catch-all nodes with excludeClasses)
    const needsClaimTracking = children.some(c =>
      c.filter.excludeClasses && c.filter.excludeClasses.length > 0
    );

    if (!needsClaimTracking) {
      return children.map(child => computeNodeSummary(child));
    }

    // Complex case: track claimed rows for catch-all nodes
    const claimedRowIds = new Set<number>();
    const claimedGbifKeys = new Set<number>();
    const results: NodeSummary[] = [];

    const nonCatchAll = children.filter(c =>
      !c.filter.excludeClasses || c.filter.excludeClasses.length === 0
    );
    const catchAll = children.filter(c =>
      c.filter.excludeClasses && c.filter.excludeClasses.length > 0
    );

    for (const child of nonCatchAll) {
      const summary = computeNodeSummary(child);
      results.push(summary);

      if (child.filter.classNames || child.filter.orderNames) {
        for (const group of child.filter.csvGroups) {
          const rows = redlistByGroup.get(group) ?? [];
          for (const row of rows) {
            if (matchesFilter(row, child.filter)) {
              claimedRowIds.add(row.sis_taxon_id);
            }
          }
          const gbifMap = gbifByGroup.get(group);
          if (gbifMap) {
            for (const [key, gbifRow] of gbifMap) {
              if (!linkedGbifKeys.has(key) && !excludedDomesticatedGbifKeys.has(key) && matchesFilter(gbifRow, child.filter)) {
                claimedGbifKeys.add(key);
              }
            }
          }
        }
      }
    }

    for (const child of catchAll) {
      let totalAssessed = 0;
      let outdatedCount = 0;
      let gbifNeSpeciesCount = 0;
      const byCategory: Record<string, number> = {};

      for (const group of child.filter.csvGroups) {
        const rows = redlistByGroup.get(group) ?? [];
        for (const row of rows) {
          if (!matchesFilter(row, child.filter)) continue;
          if (claimedRowIds.has(row.sis_taxon_id)) continue;
          totalAssessed++;
          if (isOutdated(row.assessment_date)) outdatedCount++;
          const cat = row.category;
          if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
        }

        const gbifMap = gbifByGroup.get(group);
        if (gbifMap) {
          for (const [key, gbifRow] of gbifMap) {
            if (linkedGbifKeys.has(key)) continue;
            if (excludedDomesticatedGbifKeys.has(key)) continue;
            if (!matchesFilter(gbifRow, child.filter)) continue;
            if (claimedGbifKeys.has(key)) continue;
            gbifNeSpeciesCount++;
          }
        }
      }

      results.push({
        id: child.id,
        name: child.name,
        estimatedDescribed: child.estimatedDescribed ?? 0,
        totalAssessed,
        outdated: outdatedCount,
        gbifNeSpeciesCount,
        byCategory,
      });
    }

    return results;
  }

  const nodeChildrenSummaries: Record<string, NodeSummary[]> = {};
  let parentCount = 0;
  let childCount = 0;

  for (const [nodeId, node] of NODE_INDEX) {
    if (!hasChildren(nodeId)) continue;
    const childSummaries = computeChildrenSummaries(node);
    nodeChildrenSummaries[nodeId] = childSummaries;
    parentCount++;
    childCount += childSummaries.length;
    console.log(`  ${nodeId}: ${childSummaries.length} children`);
  }

  await attachColCounts(nodeChildrenSummaries);

  const childrenOutputPath = path.join(DATA_DIR, "node-children-summaries.json");
  fs.writeFileSync(childrenOutputPath, JSON.stringify(nodeChildrenSummaries, null, 2) + "\n");
  console.log(`\nWrote ${parentCount} parents (${childCount} children) → ${childrenOutputPath}`);
}

async function main() {
  loadEnvFiles();

  console.log("build-taxa-summary: per-taxon CSVs → taxa-summary.json");
  console.log("=".repeat(50));

  await run();
}

const isDirectRun = process.argv[1]?.endsWith("build-taxa-summary.ts") || process.argv[1]?.endsWith("build-taxa-summary.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
