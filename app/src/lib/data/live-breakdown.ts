/**
 * Live, on-demand version of the no-match diagnostic breakdown (see
 * col-breakdown.ts) for dynamic taxonomic-drilldown nodes (dynamic-taxon.ts) —
 * the same "why doesn't this species have a clean 1:1 CoL match" click-through
 * that official/SSC nodes get for free from the precomputed
 * node-children-summaries.json, computed here per (rank, value) bucket only
 * when a user actually expands one in the popover (TaxaSummary.tsx's
 * BreakdownList), not eagerly for a whole level.
 *
 * The backbone.parquet-dependent temp tables (split_candidates, col_to_assessed)
 * are expensive to build (full backbone scans/joins) — memoized once per warm
 * server connection (mirrors ensureNeHelpers in species-duckdb.ts), so only the
 * first request after a cold start pays that cost; every request after reuses
 * them. If backbone.parquet is unavailable for any reason, degrades gracefully
 * to a breakdown with no noMatchDetails/splitDetails (same fallback
 * scripts/build-taxa-summary.ts's hasBackbone flag already provides) rather
 * than failing the request.
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
import { dynamicNodeFilter, isDynamicNodeId, dynamicNodeDisplayName } from "@/lib/dynamic-taxon";
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
        const backbonePath = parquetUri("backbone.parquet");
        const assessedPath = parquetUri("assessed.parquet");
        const linkPath = parquetUri("species_link.parquet");
        await conn.run(SPLIT_CANDIDATES_SQL(backbonePath, assessedPath, "ne_assessed_col_ids"));
        await conn.run(COL_TO_ASSESSED_SQL(linkPath, assessedPath));
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
  const name = isDynamicNodeId(nodeId) ? dynamicNodeDisplayName(nodeId) : (NODE_INDEX.get(nodeId)?.name ?? nodeId);
  return computeBreakdownEntry(ctx, name, filter, isDynamicNodeId(nodeId) ? undefined : nodeId);
}
