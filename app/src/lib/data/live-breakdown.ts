/**
 * Live, on-demand version of the no-match diagnostic breakdown (see
 * col-breakdown.ts) for dynamic taxonomic-drilldown nodes (dynamic-taxon.ts) —
 * the same "why doesn't this species have a clean 1:1 CoL match" click-through
 * that official/SSC nodes get for free from the precomputed
 * table1a/ssc-group-children-summaries.json, computed here per (rank, value) bucket only
 * when a user actually expands one in the popover (TaxaSummary.tsx's
 * BreakdownList), not eagerly for a whole level.
 *
 * The split_candidates/col_to_assessed temp tables are fully determined by the
 * data sync (never by which taxon/bucket a user is viewing), so
 * scripts/build-taxa-summary.ts precomputes them once at sync time into
 * data/col-split-candidates.parquet / data/col-to-assessed.parquet — tiny
 * files (~6K / ~173K rows) loaded here directly. This used to instead rebuild
 * both from scratch on the first breakdown request after every cold server
 * start via a full scan + self-join over backbone.parquet (8M rows, ~125MB) —
 * memoized once per warm server connection (mirrors ensureNeHelpers in
 * species-duckdb.ts) so only that first request paid the cost, but that cost
 * was still several seconds of real backbone-scanning work. If the
 * precomputed files are missing (e.g. an older data sync from before this
 * existed), falls back to rebuilding from backbone.parquet directly, same as
 * before. If backbone.parquet itself is unavailable for any reason, degrades
 * gracefully to a breakdown with no noMatchDetails/splitDetails (same
 * fallback scripts/build-taxa-summary.ts's hasBackbone flag already provides)
 * rather than failing the request.
 */
import { getConn, parquetUri, ensureNeHelpers } from "./species-duckdb";
import { ensureVernacularNamesLoaded } from "./vernacular-names";
import {
  computeBreakdownEntry,
  SPLIT_CANDIDATES_SQL,
  COL_TO_ASSESSED_SQL,
  type BreakdownEntry,
  type BreakdownQueryContext,
} from "./col-breakdown";
import { dynamicNodeFilter, isDynamicNodeId, dynamicNodeMatchValue } from "@/lib/dynamic-taxon";
import { NODE_INDEX } from "@/lib/taxonomy-utils";
import type { NodeFilter } from "@/lib/taxonomy-sql";

// Keep in sync with the same constant in scripts/build-taxa-summary.ts and
// species-duckdb.ts — Homo sapiens, which IUCN omits from its Red List export.
const EXCLUDED_COL_IDS_SQL = `('6MB3T')`;

let backboneHelpersPromise: Promise<boolean> | null = null; // resolves to hasBackbone
async function ensureBackboneHelpers(conn: Awaited<ReturnType<typeof getConn>>): Promise<boolean> {
  if (!backboneHelpersPromise) {
    backboneHelpersPromise = (async () => {
      await ensureNeHelpers(conn); // ne_assessed_col_ids / ne_ex_ew_col_ids
      try {
        try {
          // Fast path: load the precomputed tables directly — no backbone scan.
          await conn.run(`CREATE TEMP TABLE split_candidates AS SELECT * FROM read_parquet('${parquetUri("col-split-candidates.parquet")}')`);
          await conn.run(`CREATE TEMP TABLE col_to_assessed AS SELECT * FROM read_parquet('${parquetUri("col-to-assessed.parquet")}')`);
        } catch (precomputeError) {
          // Precomputed files missing (e.g. an older data sync from before these
          // existed) — fall back to building them from backbone.parquet directly.
          console.error("live-breakdown: precomputed CoL match helpers unavailable, rebuilding from backbone.parquet:", precomputeError);
          const backbonePath = parquetUri("backbone.parquet");
          const assessedPath = parquetUri("assessed.parquet");
          const linkPath = parquetUri("species_link.parquet");
          await conn.run(SPLIT_CANDIDATES_SQL(backbonePath, assessedPath, "ne_assessed_col_ids"));
          await conn.run(COL_TO_ASSESSED_SQL(linkPath, assessedPath));
        }
        return true;
      } catch (e) {
        // backbone.parquet missing/unreadable — degrade to no diagnostic detail
        // rather than fail every breakdown request.
        console.error("live-breakdown: backbone helpers unavailable, degrading:", e);
        return false;
      }
    })().catch((e) => { backboneHelpersPromise = null; throw e; });
  }
  return backboneHelpersPromise;
}

/**
 * One breakdown entry for a dynamic node's own (whole) filter — mirrors
 * build-taxa-summary.ts's isExcludeOnlyCatchAll case (a single bucket keyed by
 * the node's own name), since a dynamic node's live-enumerated siblings are
 * already each their own separate node/request, not multiple names under one
 * parent the way a static multi-name SSC group is.
 */
export async function getLiveBreakdown(nodeId: string): Promise<BreakdownEntry | null> {
  const filter: NodeFilter | undefined = isDynamicNodeId(nodeId) ? (dynamicNodeFilter(nodeId) ?? undefined) : NODE_INDEX.get(nodeId)?.filter;
  if (!filter) return null;

  ensureVernacularNamesLoaded();
  const conn = await getConn();
  const hasBackbone = await ensureBackboneHelpers(conn);
  const ctx: BreakdownQueryContext = {
    conn,
    speciesGlob: parquetUri("species/**/*.parquet"),
    assessedPath: parquetUri("assessed.parquet"),
    linkPath: parquetUri("species_link.parquet"),
    universeSql: `(extinct IS NOT TRUE OR col_id IN (SELECT col_id FROM ne_ex_ew_col_ids))`,
    assessedCidsTable: "ne_assessed_col_ids",
    excludedColIdsSql: EXCLUDED_COL_IDS_SQL,
    hasBackbone,
    backbonePath: hasBackbone ? parquetUri("backbone.parquet") : undefined,
  };
  // The raw matchable scientific value (e.g. "muridae"), NOT dynamicNodeDisplayName's
  // "Scientific name (Common name)" string — this becomes BreakdownEntry.name, which
  // the client's matchesBreakdownName compares case-insensitively against a species
  // row's own family/order_name/etc. column (TaxaSummary.tsx's SpeciesListPanel).
  // Passing the display string there was a real bug: for any bucket with a known
  // common name, "muridae (mice)" never equals a row's family "muridae", so the
  // breakdown's species-list click-through silently returned zero species.
  const name = isDynamicNodeId(nodeId) ? dynamicNodeMatchValue(nodeId) : (NODE_INDEX.get(nodeId)?.name ?? nodeId);
  return computeBreakdownEntry(ctx, name, filter, isDynamicNodeId(nodeId) ? undefined : nodeId);
}
