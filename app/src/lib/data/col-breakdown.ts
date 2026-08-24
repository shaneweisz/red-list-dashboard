/**
 * Per-name CoL described/not-evaluated breakdown, with a "why doesn't this
 * assessed species have a clean 1:1 CoL match" diagnostic — shared between
 * scripts/build-taxa-summary.ts (build time, the static tree's official/SSC
 * nodes) and src/lib/data/live-taxa-children.ts (request time, dynamic
 * taxonomic-drilldown nodes — see dynamic-taxon.ts). Extracted from
 * build-taxa-summary.ts so the two call sites can never silently drift apart,
 * mirroring how taxonomy-sql.ts's filterToSql was pulled out for the same
 * reason (see that file's doc comment).
 *
 * The diagnostic query needs two backbone.parquet-dependent temp tables
 * (split_candidates, col_to_assessed) built ONCE per caller — full
 * backbone scans/joins, not cheap to repeat per name. build-taxa-summary.ts
 * builds them once per whole script run; live-taxa-children.ts memoizes them
 * once per warm server connection (see ensureBackboneHelpers there). This
 * module only *uses* them by name — building them is the caller's job, since
 * "once per run" vs. "once per warm process" are genuinely different lifetimes.
 */
import type { DuckDBConnection } from "@duckdb/node-api";
import { filterToSql, type NodeFilter } from "@/lib/taxonomy-sql";

export type NoMatchReason = "no_link" | "missing_from_backbone" | "infraspecific" | "provisional" | "lumped" | "not_in_base" | "extinct_unconfirmed" | "classified_elsewhere" | "synonym_of";
export interface NoMatchDetail {
  id: number;
  name: string;
  reason: NoMatchReason;
  /** The species/name it's lumped with or demoted under (reasons "lumped"/"infraspecific" only). */
  detail?: string;
  /** That species' own assessed id, so the frontend can link to it too ("lumped"/"infraspecific", only when the parent is itself IUCN-assessed). */
  detailId?: number;
  /** The CoL id this assessment links to, so the UI can deep-link to the CoL
   *  record that disagrees with it. Absent only for "no_link" (there isn't one). */
  colId?: string;
  /** The CoL record for `detail`, so the UI can link that name to CoL too. */
  detailColId?: string;
  /** CoL's OWN accepted name for that col_id, when the species/ universe has it.
   *  Differs from `detail` when CoL's accepted name is neither this species nor
   *  the assessed one that won the tie-break (e.g. a lump under a third name), so
   *  the UI can name the species the two were merged INTO rather than guess. */
  colName?: string;
}

// Heuristic "split from" flag for Not Evaluated species — see SPLIT_CANDIDATES_SQL
// below for the mechanism and its caveats. Keyed by col_id (NE species have no
// sis_taxon_id), additive on top of a breakdown entry, independently droppable.
export interface SplitDetail {
  colId: string;
  parentId: number;
  parentName: string;
  parentCategory: string;
}

export interface BreakdownEntry {
  name: string;
  count: number;
  neCount: number;
  trueAssessed: number;
  noMatchIds: number[];
  noMatchDetails?: NoMatchDetail[];
  splitDetails?: SplitDetail[];
}

// Classifies one "no match" diagnosis row (see computeBreakdownEntry's diagRows
// query) into a human-explainable reason, cheapest/most-specific check first:
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
//  - synonym_of: same as not_in_base (its linked col_id is XR-only), BUT IUCN's own
//    name is separately held by the curated checklist AS A SYNONYM of an accepted
//    species — so "not in the checklist yet" would be exactly backwards. The usual
//    cause is a genus transfer CoL has made and IUCN hasn't (Acanthoptila nipalensis
//    -> Turdoides nipalensis, Sorbus minima -> Hedlundia minima). Checked before
//    not_in_base, since it is the more specific finding.
//  - not_in_base: its linked col_id exists and matches this name, isn't in CoL's
//    curated Base checklist, and the checklist doesn't cover the name as a synonym
//    either (freshly split/described, still XR-only).
//  - extinct_unconfirmed: CoL flags its linked col_id extinct, but IUCN hasn't
//    confirmed EX/EW for it (so it falls outside the extant-or-EX/EW universe).
//  - classified_elsewhere: none of the above — the linked col_id is real, in_base,
//    and extant, but CoL's own class/order/family for it doesn't match this name
//    (a CoL-side reclassification, e.g. the pre-fix Ziphiidae/Hyperoodontidae case).
export function classifyNoMatch(row: Record<string, unknown>): NoMatchDetail {
  const id = Number(row.id);
  const name = String(row.name);
  const linkedColId = row.linked_col_id as string | null;
  const linkedName = row.linked_name as string | null;
  const linkedInBase = row.linked_in_base as boolean | null;
  const linkedExtinct = row.linked_extinct as boolean | null;
  const winnerName = row.winner_name as string | null;
  const winnerId = row.winner_id as number | null;
  const bkRank = row.bk_rank as string | null;
  const coveredName = row.covered_name as string | null;
  const coveredColId = row.covered_col_id as string | null;
  const parentColId = row.parent_col_id as string | null;
  const provColId = row.prov_col_id as string | null;
  const synName = row.syn_name as string | null;
  const synColId = row.syn_col_id as string | null;
  const parentName = row.parent_name as string | null;
  const parentAssessedId = row.parent_assessed_id as number | null;
  const parentAssessedName = row.parent_assessed_name as string | null;
  if (!linkedColId) {
    // Nothing in species_link — but CoL may still hold the name, just not as an
    // accepted species: build-matching only links accepted names, so a
    // provisionally-accepted record (134 species) never gets linked and would
    // otherwise be reported as "no CoL name at all", which is plainly wrong to
    // anyone who looks the name up (e.g. Idaea josephinae -> C7CM2).
    if (provColId) return { id, name, reason: "provisional", colId: provColId };
    return { id, name, reason: "no_link" };
  }
  // Every remaining reason has a col_id to point at, and — where species/ knows
  // the name — CoL's own accepted spelling of it.
  const ref = { colId: linkedColId, ...(linkedName ? { colName: linkedName } : {}) };
  if (!linkedName) {
    if (bkRank === "species") return { id, name, reason: "provisional", ...ref };
    if (bkRank) {
      if (parentAssessedName) {
        return { id, name, reason: "infraspecific", detail: parentAssessedName, detailId: parentAssessedId != null ? Number(parentAssessedId) : undefined, ...(parentColId ? { detailColId: parentColId } : {}), ...ref };
      }
      if (parentName) return { id, name, reason: "infraspecific", detail: parentName, ...(parentColId ? { detailColId: parentColId } : {}), ...ref };
    }
    return { id, name, reason: "missing_from_backbone", ...ref };
  }
  if (winnerName) return { id, name, reason: "lumped", detail: winnerName, detailId: winnerId != null ? Number(winnerId) : undefined, detailColId: linkedColId, ...ref };
  if (!linkedInBase) {
    // Two routes to the same finding. The link table's own 'iucn_synonym_covered'
    // row is the cheap one, but build-matching doesn't always write it — the 2024
    // Accipiter break-up (Accipiter cooperii -> Astur cooperii, and 84 more) is
    // invisible to it — so fall back to asking the backbone directly whether this
    // name is a synonym of a species the curated checklist accepts.
    const synonymName = coveredName ?? synName;
    const synonymColId = coveredColId ?? synColId;
    if (synonymName && synonymColId) {
      // Link to the ACCEPTED record, not the XR-only one this assessment matched:
      // that XR id is exactly the one CoL may since have retired (Sorbus minima's
      // VJSZQ now 404s as "removed"), and the accepted record is what a reader wants.
      return { id, name, reason: "synonym_of", detail: synonymName, detailColId: synonymColId, ...ref, colId: synonymColId };
    }
    return { id, name, reason: "not_in_base", ...ref };
  }
  if (linkedExtinct) return { id, name, reason: "extinct_unconfirmed", ...ref };
  return { id, name, reason: "classified_elsewhere", ...ref };
}

// Precomputes a col_id -> likely-former-parent lookup, once per caller lifetime
// (not once per breakdown name — backbone.parquet is ~3.8M rows, so re-scanning
// it per name would be wasteful). The heuristic: CoL keeps a subspecies/
// infraspecific synonym record when a subspecies is promoted to full species
// status (e.g. "Gazella gazella acaciae" survives as a synonym once "Gazella
// acaciae" becomes its own accepted species) — so a synonym whose first two name
// tokens (genus + species) match an IUCN-assessed species is very likely that
// promoted species' former parent.
//
// One extra wrinkle, found via Giraffa tippelskirchi (a masai giraffe, promoted
// from subspecies to species — genuinely NE, split from the assessed Giraffa
// camelopardalis): CoL doesn't always point the old synonym straight at the new
// species. When the promoted species also got its own nominate subspecies (an
// "autonym" — here "Giraffa tippelskirchi tippelskirchi"), the OLD synonym
// ("Giraffa camelopardalis tippelskirchi") points at that new nominate SUBSPECIES,
// not at the species itself. So a direct synonym->parent hop isn't enough — this
// resolves one extra hop up (subspecies -> its own parent) whenever the synonym's
// immediate parent turns out to be an accepted subspecies/infraspecific rank
// rather than the species itself.
//
// This only catches the "was a named subspecies, got promoted" pattern (the
// common case in recent Bovidae/Giraffidae splits) — it won't catch a split into
// a segregate with no prior CoL subspecies record. One arbitrary (but
// deterministic) candidate is kept per NE species via row_number when more than
// one subspecies-rank synonym implies a different parent.
export const SPLIT_CANDIDATES_SQL = (bb: string, assessedPath: string, assessedCidsTable: string) => `
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
    WHERE ne_col_id IS NOT NULL AND ne_col_id NOT IN (SELECT col_id FROM ${assessedCidsTable})
  ),
  matched AS (
    SELECT DISTINCT cs.ne_col_id, a.id AS parent_id, a.scientific_name AS parent_name, a.iucn_category AS parent_category
    FROM candidate_synonyms cs
    JOIN read_parquet('${assessedPath}') a ON lower(a.scientific_name) = lower(cs.parent_binomial)
  )
  SELECT ne_col_id, parent_id, parent_name, parent_category,
         row_number() OVER (PARTITION BY ne_col_id ORDER BY parent_id) AS rn
  FROM matched`;

// Precomputes a global col_id -> IUCN-assessed-species lookup, once per caller
// lifetime. Used by the "infraspecific" no-match reason (classifyNoMatch) to
// name/link the currently-assessed species a demoted subspecies/variety is now
// classified under (e.g. Arctocephalus townsendi -> Arctocephalus philippii) — a
// plain global lookup, not scoped to any one breakdown name, since the parent can
// fall in a different name within the same node (rare, but there's no reason to
// miss it). Same accepted-preferred tie-break as the per-name "winners" CTE below.
export const COL_TO_ASSESSED_SQL = (link: string, assessedPath: string) => `
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

export interface BreakdownQueryContext {
  conn: DuckDBConnection;
  speciesGlob: string;
  assessedPath: string;
  linkPath: string;
  /** e.g. "(extinct IS NOT TRUE OR col_id IN (SELECT col_id FROM ex_ew_assessed))" */
  universeSql: string;
  /** Table of all IUCN-linked col_ids (assessed_cids at build time, ne_assessed_col_ids live). */
  assessedCidsTable: string;
  excludedColIdsSql: string;
  /** Whether split_candidates/col_to_assessed (backbone-dependent) have been built. */
  hasBackbone: boolean;
  /** Only read when hasBackbone is true. */
  backbonePath?: string;
}

/**
 * The "which assessed species here have no clean 1:1 CoL match, and why"
 * diagnostic on its own — shared between computeBreakdownEntry (one breakdown
 * name at a time) and scripts/build-col-revisions.ts, which runs it ONCE over
 * every assessed species to build the dashboard-wide flag. Both call sites must
 * classify identically, so the query lives here rather than being written twice.
 *
 * `speciesWhere`/`assessedWhere` scope the CoL universe and the assessed set
 * respectively (they differ: only the species/ side takes a nodeId, so a
 * CoL-species-name override can't wrongly zero out an IUCN-sourced match — see
 * computeBreakdownEntry). Pass "true" for both to diagnose everything.
 */
export async function computeNoMatchDetails(
  ctx: BreakdownQueryContext,
  speciesWhere: string,
  assessedWhere: string,
): Promise<NoMatchDetail[]> {
  const { conn, speciesGlob, assessedPath, linkPath, universeSql: universe, excludedColIdsSql: EXCLUDED_COL_IDS_SQL, hasBackbone } = ctx;
  // The specific assessed species (sis_taxon_id) behind that gap, plus enough
  // context (its own primary CoL link, and who "won" that link if it lost a tie)
  // to classify WHY each one doesn't have a clean match — see classifyNoMatch.
  // Each CTE is scoped to a single table so filterToSql's bare column names
  // (shared between species/ and assessed.parquet, e.g. scientific_name) never
  // collide. Two assessed species can share one col_id (a genuine CoL lump — e.g.
  // Wild Pig SG's Sus bucculentus (EX) is CoL-synonymized into Sus scrofa (LC),
  // both linked to the same accepted col_id) — a count(*) over distinct col_ids
  // only "sees" that pair once, so computeBreakdownEntry's trueAssessed can exceed
  // its count-neCount even when every assessed id technically has SOME link.
  // ROW_NUMBER picks one canonical "CoL Match" winner per col_id (preferring an
  // accepted-name match over a synonym-derived one); every other candidate for
  // that col_id, and every id with no valid link at all, ends up unmatched —
  // making trueAssessed - noMatchIds.length exactly equal the "CoL Match" count.
  const diagRows = await (await conn.run(`
    WITH matched_species AS (
      SELECT col_id FROM read_parquet('${speciesGlob}', hive_partitioning=true)
      WHERE in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND ${speciesWhere}
    ),
    matched_assessed AS (
      SELECT id, scientific_name FROM read_parquet('${assessedPath}') WHERE ${assessedWhere}
    ),
    primary_links AS (
      -- Primary link only (excludes 'iucn_synonym_covered' — a bookkeeping alias
      -- so an assessed species doesn't resurface as a new NE candidate under a
      -- second CoL name, not a real "this species also equals a second col_id"
      -- claim). Without this, an id with both a primary and a covered link would
      -- win TWO col_id partitions and inflate the apparent match count.
      SELECT ma.id AS id, ma.scientific_name AS name, l.col_id AS col_id, l.match_method AS match_method
      FROM matched_assessed ma
      JOIN read_parquet('${linkPath}') l ON l.id = ma.id AND l.src = 'redlist' AND l.col_id IS NOT NULL AND l.match_method != 'iucn_synonym_covered'
    ),
    covered_links AS (
      -- IUCN's own name as the curated checklist knows it: an
      -- 'iucn_synonym_covered' row is written when the checklist holds this name
      -- as a SYNONYM of an accepted species, which is the opposite of "not in the
      -- checklist yet" — see classifyNoMatch's synonym_of.
      SELECT id, min(col_id) AS col_id, min(name) AS name FROM (
      SELECT cl.id AS id, cl.col_id AS col_id, cs.scientific_name AS name
      FROM (
        SELECT ma.id AS id, l.col_id AS col_id
        FROM matched_assessed ma
        JOIN read_parquet('${linkPath}') l ON l.id = ma.id AND l.src = 'redlist'
          AND l.col_id IS NOT NULL AND l.match_method = 'iucn_synonym_covered'
      ) cl
      JOIN read_parquet('${speciesGlob}', hive_partitioning=true) cs
        ON cs.col_id = cl.col_id AND cs.in_base
      ) GROUP BY id
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
    )${hasBackbone ? `,
    -- Names CoL holds ONLY as a provisionally-accepted species. Semi-joined to the
    -- assessed names in scope, so this reads backbone.parquet against a small
    -- build side rather than scanning it whole, and pre-aggregated so it can't
    -- multiply rows in the SELECT below.
    prov_by_name AS (
      SELECT lower(scientific_name) AS lname, min(col_id) AS col_id
      FROM read_parquet('${ctx.backbonePath}')
      WHERE rank = 'species' AND status = 'provisionally accepted'
        AND lower(scientific_name) IN (SELECT lower(scientific_name) FROM matched_assessed)
      GROUP BY 1
    ),
    -- The backbone's own synonym -> accepted-in-Base edge, for the names
    -- 'iucn_synonym_covered' misses. Same semi-join shape as prov_by_name.
    syn_in_base AS (
      SELECT lname, any_value(col_id) AS col_id, any_value(name) AS name FROM (
        SELECT lower(syn.scientific_name) AS lname, acc.col_id AS col_id, acc.scientific_name AS name
        FROM read_parquet('${ctx.backbonePath}') syn
        JOIN read_parquet('${speciesGlob}', hive_partitioning=true) acc
          ON acc.col_id = syn.parent_id AND acc.in_base
        WHERE syn.status = 'synonym'
          AND lower(syn.scientific_name) IN (SELECT lower(scientific_name) FROM matched_assessed)
      ) GROUP BY lname
    )` : ""}
    SELECT
      ma.id AS id, ma.scientific_name AS name,
      pl.col_id AS linked_col_id,
      sp.scientific_name AS linked_name, sp.in_base AS linked_in_base, sp.extinct AS linked_extinct,
      w.winner_name AS winner_name, w.winner_id AS winner_id,
      cov.name AS covered_name, cov.col_id AS covered_col_id
      ${hasBackbone ? `,
      pbn.col_id AS prov_col_id,
      sib.name AS syn_name, sib.col_id AS syn_col_id,
      bk.parent_id AS parent_col_id,
      bk.rank AS bk_rank,
      bkparent.scientific_name AS parent_name,
      ca.assessed_id AS parent_assessed_id, ca.assessed_name AS parent_assessed_name` : ""}
    FROM matched_assessed ma
    LEFT JOIN primary_links pl ON pl.id = ma.id
    LEFT JOIN read_parquet('${speciesGlob}', hive_partitioning=true) sp ON sp.col_id = pl.col_id
    LEFT JOIN winners w ON w.col_id = pl.col_id
    LEFT JOIN candidate_links cl ON cl.id = ma.id AND cl.rn = 1
    LEFT JOIN covered_links cov ON cov.id = ma.id
    ${hasBackbone ? `
    -- Only needed to explain species/-misses (sp.scientific_name IS NULL) more
    -- precisely than a blanket "missing from backbone" — see classifyNoMatch's
    -- infraspecific/provisional reasons.
    LEFT JOIN read_parquet('${ctx.backbonePath}') bk ON bk.col_id = pl.col_id
    LEFT JOIN read_parquet('${ctx.backbonePath}') bkparent ON bkparent.col_id = bk.parent_id
    LEFT JOIN col_to_assessed ca ON ca.col_id = bk.parent_id
    LEFT JOIN prov_by_name pbn ON pl.col_id IS NULL AND pbn.lname = lower(ma.scientific_name)
    LEFT JOIN syn_in_base sib ON sib.lname = lower(ma.scientific_name)` : ""}
    WHERE cl.id IS NULL
    -- Deterministic order — this JOIN chain has no natural order, and without one
    -- DuckDB's parallel scan returns diagRows (and so noMatchIds/noMatchDetails)
    -- in a different order on every run, turning every unrelated data sync into a
    -- huge same-set reordering diff (build time) or a jittery UI (live).
    ORDER BY ma.id`)).getRowObjects();
  // Note: trueAssessed - noMatchIds.length (the "CoL Match" count shown in the
  // popover) is NOT expected to equal computeBreakdownEntry's count - neCount — the latter's
  // "linked" definition (assessedCidsTable) includes col_ids only reachable via
  // an 'iucn_synonym_covered' bookkeeping alias (an NE-dedup mechanism, not a
  // real second described species), which noMatchIds deliberately excludes so
  // one assessed id can't appear as the "canonical" CoL match for two different
  // col_ids at once. Both are correct; they answer different questions (CoL's
  // own described-vs-assessed split, vs. which specific IUCN-assessed species
  // have a clean 1:1 CoL match).
  return diagRows.map((r) => classifyNoMatch(r));
}

/**
 * One breakdown entry (colDescribed/colNe split by name, plus the no-match
 * diagnostic) for a single narrowed filter. Callers must have already built
 * ctx.assessedCidsTable and, if ctx.hasBackbone, the split_candidates/
 * col_to_assessed temp tables (see the file doc comment for why building them
 * is the caller's responsibility, not this function's).
 */
export async function computeBreakdownEntry(
  ctx: BreakdownQueryContext,
  name: string,
  narrowed: NodeFilter,
  nodeId: string | undefined,
): Promise<BreakdownEntry> {
  const { conn, speciesGlob, assessedPath, universeSql: universe, assessedCidsTable, excludedColIdsSql: EXCLUDED_COL_IDS_SQL, hasBackbone } = ctx;

  const bRows = await (await conn.run(`
    SELECT count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}) AS n,
           count(*) FILTER (in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL} AND col_id NOT IN (SELECT col_id FROM ${assessedCidsTable})) AS ne
    FROM read_parquet('${speciesGlob}', hive_partitioning=true)
    WHERE ${filterToSql(narrowed, nodeId)}`)).getRowObjects();
  // IUCN's own count of assessed species matching this one name — via filterToSql
  // WITHOUT nodeId, so a Bison-style CoL species-name override (which only makes
  // sense for CoL-sourced rows) doesn't wrongly zero out an IUCN-sourced match
  // (assessed.parquet still says "Bison bison", never CoL's lumped "Bos bison").
  // Compared against count-neCount on the frontend to flag likely splits/lumps/
  // coverage gaps the CoL-derived figures paper over (see BreakdownList in
  // TaxaSummary.tsx).
  const trueRows = await (await conn.run(`
    SELECT count(*) AS n FROM read_parquet('${assessedPath}') WHERE ${filterToSql(narrowed)}`)).getRowObjects();
  const noMatchDetails = await computeNoMatchDetails(ctx, filterToSql(narrowed, nodeId), filterToSql(narrowed));
  // "Split from" candidates for this name's NE species — a lookup against the
  // once-per-caller-lifetime split_candidates table, not a fresh backbone.parquet
  // scan. Deliberately scoped to the SAME NE universe as bRows.ne (in_base,
  // extant/EX-EW, narrowed filter), so an entry here is guaranteed to be one of
  // this name's neCount species.
  const splitDetails: SplitDetail[] = hasBackbone
    ? (await (await conn.run(`
        SELECT ns.col_id AS ne_col_id, sc.parent_id, sc.parent_name, sc.parent_category
        FROM (
          SELECT col_id FROM read_parquet('${speciesGlob}', hive_partitioning=true)
          WHERE in_base AND ${universe} AND col_id NOT IN ${EXCLUDED_COL_IDS_SQL}
            AND ${filterToSql(narrowed, nodeId)} AND col_id NOT IN (SELECT col_id FROM ${assessedCidsTable})
        ) ns
        JOIN split_candidates sc ON sc.ne_col_id = ns.col_id AND sc.rn = 1
        -- Deterministic order, same reasoning as diagRows' own ORDER BY above —
        -- this join has no natural order either, and was previously missing this,
        -- producing a same-set-different-order diff on every unrelated data sync.
        ORDER BY ns.col_id`)).getRowObjects())
        .map((r) => ({
          colId: String(r.ne_col_id), parentId: Number(r.parent_id),
          parentName: String(r.parent_name), parentCategory: String(r.parent_category),
        }))
    : [];
  return {
    name, count: Number(bRows[0].n), neCount: Number(bRows[0].ne), trueAssessed: Number(trueRows[0].n),
    noMatchIds: noMatchDetails.map((d) => d.id),
    ...(noMatchDetails.length ? { noMatchDetails } : {}),
    ...(splitDetails.length ? { splitDetails } : {}),
  };
}

