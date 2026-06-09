/**
 * fetch-col-counts: Computed Catalogue of Life accepted-species counts per taxon.
 *
 * STEP 1 of the "extend to all described species" work — see the feasibility
 * discussion. This produces an *authoritative, computed* described-species
 * denominator from Catalogue of Life, to compare against (and eventually
 * replace) the hardcoded `estimatedDescribed` literature estimates in
 * src/config/taxonomy-tree.ts.
 *
 * Catalogue of Life is queried through GBIF's hosted mirror of the CoL
 * checklist dataset (`COL_GBIF_DATASET_KEY`). GBIF's API is the only host
 * reachable from the sync environment's network allowlist; api.checklistbank.org
 * (the native CoL API) is currently blocked. The numbers are still CoL's — GBIF
 * just mirrors the published checklist — but if/when ChecklistBank is
 * allowlisted, swap `resolveColKey`/`countAcceptedSpecies` for the equivalent
 * /dataset/{key}/nameusage/search calls and the rest of the pipeline is unchanged.
 *
 * Scope: the 21 Table 1a groups (scripts/taxa.ts), whose redlist filters are
 * pure taxonomic inclusion lists (kingdom/phylum/class/order names) and map
 * cleanly to CoL subtrees. Deeper subgroups (orders within insects/mammals/
 * fungi) still use literature sources and are out of scope for step 1.
 *
 * Usage:
 *   npx tsx scripts/fetch-col-counts.ts            # all taxa
 *   npx tsx scripts/fetch-col-counts.ts mammalia   # one taxon
 */

import * as fs from "fs";
import * as path from "path";
import { loadEnvFiles, DATA_DIR, delay, mapConcurrent } from "./utils";
import { getTaxa, type RedlistQuery } from "./taxa";

// GBIF's hosted mirror of the Catalogue of Life checklist. Override via env if
// the dataset key changes between annual releases.
const COL_GBIF_DATASET_KEY =
  process.env.COL_GBIF_DATASET_KEY || "7ddf754f-d193-4cc9-b351-99906754a03b";

const GBIF_BASE = "https://api.gbif.org/v1";
const MAX_RETRIES = 4;
const CONCURRENCY = 4;

// redlist filterColumn → GBIF/CoL rank used for name resolution
const RANK_BY_COLUMN: Record<RedlistQuery["filterColumn"], string> = {
  kingdom_name: "KINGDOM",
  phylum_name: "PHYLUM",
  class_name: "CLASS",
  order_name: "ORDER",
};

interface GbifUsage {
  key: number;
  scientificName?: string;
  canonicalName?: string;
  rank?: string;
  taxonomicStatus?: string;
}

interface GbifSearchResponse {
  count: number;
  results: GbifUsage[];
}

async function gbifGet(endpoint: string, params: URLSearchParams): Promise<GbifSearchResponse | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${GBIF_BASE}/${endpoint}?${params}`);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < MAX_RETRIES) {
          await delay(Math.pow(2, attempt + 1) * 1000);
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as GbifSearchResponse;
    } catch {
      if (attempt < MAX_RETRIES) {
        await delay(Math.pow(2, attempt + 1) * 1000);
        continue;
      }
      return null;
    }
  }
  return null;
}

/** Resolve a taxonomic name to its CoL usage key at a given rank. */
async function resolveColKey(name: string, rank: string): Promise<GbifUsage | null> {
  // Note: rank is intentionally NOT a query param. CoL leaves many higher
  // clades unranked (rank: null), so a server-side rank filter would drop valid
  // matches like Actinopterygii. We filter by rank client-side as a preference.
  const params = new URLSearchParams({
    datasetKey: COL_GBIF_DATASET_KEY,
    q: name,
    status: "ACCEPTED",
    limit: "25",
  });
  const data = await gbifGet("species/search", params);
  if (!data || data.results.length === 0) return null;

  const target = name.toLowerCase();
  const isExactName = (u: GbifUsage) =>
    u.canonicalName?.toLowerCase() === target || u.scientificName?.toLowerCase() === target;

  // 1. Exact canonical match at the requested rank.
  const exactAtRank = data.results.find(
    (u) => u.rank === rank && u.taxonomicStatus === "ACCEPTED" && isExactName(u),
  );
  if (exactAtRank) return exactAtRank;

  // 2. Exact canonical match, ANY rank. CoL leaves many higher clades unranked
  //    (rank: null) — e.g. Actinopterygii — so an exact name match is more
  //    reliable than the rank. Safe because the name must match exactly.
  const exactAnyRank = data.results.find((u) => u.taxonomicStatus === "ACCEPTED" && isExactName(u));
  if (exactAnyRank) return exactAnyRank;

  // 3. Fall back to the first accepted usage at the requested rank.
  return data.results.find((u) => u.rank === rank && u.taxonomicStatus === "ACCEPTED") ?? null;
}

/** Count accepted species in the subtree rooted at a CoL usage key. */
async function countAcceptedSpecies(higherTaxonKey: number): Promise<number | null> {
  const params = new URLSearchParams({
    datasetKey: COL_GBIF_DATASET_KEY,
    highertaxonKey: String(higherTaxonKey),
    rank: "SPECIES",
    status: "ACCEPTED",
    limit: "0",
  });
  const data = await gbifGet("species/search", params);
  return data ? data.count : null;
}

interface NameResult {
  name: string;
  rank: string;
  resolved: boolean;
  colKey: number | null;
  matchedName: string | null;
  speciesCount: number | null;
}

interface TaxonResult {
  taxonId: string;
  name: string;
  count: number;
  /** True when >1 subtree was summed — watch for cross-subtree overlap. */
  summedSubtrees: number;
  unresolvedNames: string[];
  names: NameResult[];
}

async function fetchTaxon(taxonId: string, displayName: string, filters: RedlistQuery[]): Promise<TaxonResult> {
  // Flatten all (rank, name) pairs across the taxon's redlist filters.
  const pairs: { rank: string; name: string }[] = [];
  for (const f of filters) {
    const rank = RANK_BY_COLUMN[f.filterColumn];
    for (const v of f.filterValues) pairs.push({ rank, name: v });
  }

  const names: NameResult[] = await mapConcurrent(pairs, CONCURRENCY, async ({ rank, name }) => {
    const usage = await resolveColKey(name, rank);
    if (!usage) {
      return { name, rank, resolved: false, colKey: null, matchedName: null, speciesCount: null };
    }
    const speciesCount = await countAcceptedSpecies(usage.key);
    return {
      name,
      rank,
      resolved: true,
      colKey: usage.key,
      matchedName: usage.canonicalName ?? usage.scientificName ?? null,
      speciesCount,
    };
  });

  const resolved = names.filter((n) => n.resolved && n.speciesCount != null);
  const count = resolved.reduce((sum, n) => sum + (n.speciesCount ?? 0), 0);

  return {
    taxonId,
    name: displayName,
    count,
    summedSubtrees: resolved.length,
    unresolvedNames: names.filter((n) => !n.resolved).map((n) => n.name),
    names,
  };
}

export async function run(ids?: string[]): Promise<void> {
  const taxa = getTaxa(ids);
  console.log(`Querying Catalogue of Life via GBIF dataset ${COL_GBIF_DATASET_KEY}`);

  // Dataset metadata (publication date) for provenance.
  let datasetTitle = "Catalogue of Life";
  let datasetModified: string | null = null;
  try {
    const meta = await fetch(`${GBIF_BASE}/dataset/${COL_GBIF_DATASET_KEY}`);
    if (meta.ok) {
      const j = (await meta.json()) as { title?: string; modified?: string; created?: string };
      datasetTitle = j.title ?? datasetTitle;
      datasetModified = j.modified ?? j.created ?? null;
    }
  } catch {
    /* non-fatal */
  }

  const results: TaxonResult[] = [];
  for (const taxon of taxa) {
    const r = await fetchTaxon(taxon.id, taxon.name, taxon.redlist);
    results.push(r);
    const flags: string[] = [];
    if (r.summedSubtrees > 1) flags.push(`summed ${r.summedSubtrees} subtrees`);
    if (r.unresolvedNames.length) flags.push(`unresolved: ${r.unresolvedNames.join(", ")}`);
    console.log(`  ${taxon.id.padEnd(22)} ${r.count.toLocaleString().padStart(10)}${flags.length ? "   [" + flags.join("; ") + "]" : ""}`);
  }

  const total = results.reduce((sum, r) => sum + r.count, 0);
  const output = {
    generatedAt: new Date().toISOString(),
    source: "Catalogue of Life (via GBIF mirror)",
    datasetKey: COL_GBIF_DATASET_KEY,
    datasetTitle,
    datasetModified,
    all: total,
    taxa: Object.fromEntries(results.map((r) => [r.taxonId, r])),
  };

  // When run for a subset, merge into any existing file so partial runs don't clobber.
  const outputPath = path.join(DATA_DIR, "col-counts.json");
  if (ids && fs.existsSync(outputPath)) {
    const prev = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
    output.taxa = { ...prev.taxa, ...output.taxa };
    output.all = (Object.values(output.taxa) as TaxonResult[]).reduce((s, r) => s + r.count, 0);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nTotal: ${total.toLocaleString()} accepted species across ${results.length} taxa`);
  console.log(`Wrote → ${outputPath}`);
}

async function main() {
  loadEnvFiles();
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  console.log("fetch-col-counts: Catalogue of Life accepted-species counts per taxon");
  console.log("=".repeat(50));
  await run(ids.length ? ids : undefined);
}

const isDirectRun =
  process.argv[1]?.endsWith("fetch-col-counts.ts") || process.argv[1]?.endsWith("fetch-col-counts.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
