/**
 * Shared utilities for sync scripts.
 *
 * - Species name normalization
 * - Matching logic (primary ID → name)
 * - JSONL logging
 * - Supabase service client creation
 */

import * as fs from "fs";
import * as path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// ENV LOADING
// =============================================================================

export function loadEnvFiles(): void {
  const dirs = [
    path.join(__dirname, "../../"),
    path.join(__dirname, "../"),
  ];
  for (const dir of dirs) {
    for (const file of [".env", ".env.local"]) {
      loadEnvFile(path.join(dir, file));
    }
  }
}

function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const withoutExport = trimmed.replace(/^export\s+/, "");
        const [key, ...valueParts] = withoutExport.split("=");
        const value = valueParts.join("=").replace(/^["']|["']$/g, "");
        if (key && value) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // File doesn't exist, skip
  }
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

/**
 * Fetch all rows from a Supabase query, paginating past the default 1000-row limit.
 */
const PAGE_SIZE = 10000;

export async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  filters?: (query: ReturnType<SupabaseClient["from"]>) => ReturnType<SupabaseClient["from"]>
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    if (filters) {
      query = filters(query) as typeof query;
    }
    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

// =============================================================================
// NAME NORMALIZATION
// =============================================================================

/**
 * Normalize a scientific name for matching:
 * - Lowercase
 * - Trim whitespace
 * - Collapse multiple spaces
 */
export function normalizeSpeciesName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

// =============================================================================
// MATCHING LOGIC
// =============================================================================

export interface ExistingSpecies {
  id: number;
  scientific_name: string;
  sis_taxon_id: number | null;
  gbif_species_key: number | null;
}

/**
 * Build lookup indexes from existing species rows for efficient matching.
 */
export interface SpeciesIndex {
  bySisTaxonId: Map<number, ExistingSpecies>;
  byGbifSpeciesKey: Map<number, ExistingSpecies>;
  byNormalizedName: Map<string, ExistingSpecies>;
}

export function buildSpeciesIndex(rows: ExistingSpecies[]): SpeciesIndex {
  const index: SpeciesIndex = {
    bySisTaxonId: new Map(),
    byGbifSpeciesKey: new Map(),
    byNormalizedName: new Map(),
  };

  for (const row of rows) {
    if (row.sis_taxon_id !== null) {
      index.bySisTaxonId.set(row.sis_taxon_id, row);
    }
    if (row.gbif_species_key !== null) {
      index.byGbifSpeciesKey.set(row.gbif_species_key, row);
    }
    index.byNormalizedName.set(normalizeSpeciesName(row.scientific_name), row);
  }

  return index;
}

export type MatchResult =
  | { match: "by_primary_id"; species: ExistingSpecies }
  | { match: "by_name"; species: ExistingSpecies }
  | { match: "none" };

/**
 * Find an existing species row using 2-tier matching:
 * 1. Match by primary external ID (sis_taxon_id or gbif_species_key)
 * 2. Match by normalized scientific name
 */
export function findMatch(
  index: SpeciesIndex,
  opts: {
    primaryId?: { type: "sis_taxon_id"; value: number } | { type: "gbif_species_key"; value: number };
    scientificName: string;
  }
): MatchResult {
  // Step 1: primary ID
  if (opts.primaryId) {
    const map = opts.primaryId.type === "sis_taxon_id"
      ? index.bySisTaxonId
      : index.byGbifSpeciesKey;
    const found = map.get(opts.primaryId.value);
    if (found) return { match: "by_primary_id", species: found };
  }

  // Step 2: normalized name
  const normalized = normalizeSpeciesName(opts.scientificName);
  const found = index.byNormalizedName.get(normalized);
  if (found) return { match: "by_name", species: found };

  return { match: "none" };
}

// =============================================================================
// JSONL LOGGING
// =============================================================================

export class SyncLogger {
  private stream: fs.WriteStream;
  private counts: Record<string, number> = {};

  constructor(scriptName: string, logsDir?: string) {
    const dir = logsDir || path.join(__dirname, "../logs");
    fs.mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
    const filename = `${ts}_${scriptName}.jsonl`;
    this.stream = fs.createWriteStream(path.join(dir, filename), { flags: "a" });
  }

  log(event: string, data: Record<string, unknown>): void {
    this.counts[event] = (this.counts[event] || 0) + 1;
    const entry = {
      ts: new Date().toISOString(),
      event,
      ...data,
    };
    this.stream.write(JSON.stringify(entry) + "\n");
  }

  getCounts(): Record<string, number> {
    return { ...this.counts };
  }

  close(): void {
    this.stream.end();
  }
}

// =============================================================================
// TAXA CONFIG
// =============================================================================

export interface IucnTaxonConfig {
  id: string;
  name: string;
  filterColumn: "kingdom_name" | "phylum_name" | "class_name" | "order_name";
  filterValues: string[];
}

export const IUCN_TAXA: IucnTaxonConfig[] = [
  // Vertebrates
  { id: "mammalia", name: "Mammals", filterColumn: "class_name", filterValues: ["MAMMALIA"] },
  { id: "aves", name: "Birds", filterColumn: "class_name", filterValues: ["AVES"] },
  { id: "reptilia", name: "Reptiles", filterColumn: "class_name", filterValues: ["REPTILIA"] },
  { id: "amphibia", name: "Amphibians", filterColumn: "class_name", filterValues: ["AMPHIBIA"] },
  { id: "fishes", name: "Fishes", filterColumn: "class_name", filterValues: ["ACTINOPTERYGII", "CHONDRICHTHYES", "MYXINI", "PETROMYZONTI", "SARCOPTERYGII"] },
  // Invertebrates
  { id: "insecta", name: "Insects", filterColumn: "class_name", filterValues: ["INSECTA"] },
  { id: "mollusca", name: "Molluscs", filterColumn: "phylum_name", filterValues: ["MOLLUSCA"] },
  { id: "crustacea", name: "Crustaceans", filterColumn: "class_name", filterValues: ["MALACOSTRACA", "MAXILLOPODA", "BRANCHIOPODA", "OSTRACODA", "HEXANAUPLIA"] },
  { id: "arachnida", name: "Arachnids", filterColumn: "class_name", filterValues: ["ARACHNIDA"] },
  { id: "corals", name: "Corals", filterColumn: "order_name", filterValues: ["SCLERACTINIA", "ALCYONACEA", "PENNATULACEA"] },
  // "Other Invertebrates" needs two entries because it spans different filter columns:
  // non-coral Anthozoa are filtered by order_name (to separate them from corals, which
  // are also in class ANTHOZOA), while the remaining classes are filtered by class_name.
  // Both entries share the same taxon_group id to match the IUCN Red List Table 1a grouping.
  { id: "other_invertebrates", name: "Other Invertebrates (non-coral Anthozoa)", filterColumn: "order_name", filterValues: [
    "ACTINIARIA", "ZOANTHARIA", "PENICILLARIA", "MALACALCYONCAEA", "SCLERALCYONACEA",
  ] },
  { id: "other_invertebrates", name: "Other Invertebrates", filterColumn: "class_name", filterValues: [
    "HOLOTHUROIDEA", "CLITELLATA", "DIPLOPODA", "COLLEMBOLA", "CHILOPODA",
    "DEMOSPONGIAE", "HYDROZOA", "UDEONYCHOPHORA", "NEMERTEA", "MEROSTOMATA",
    "ASTEROIDEA", "CALCAREA", "POLYCHAETA", "TURBELLARIA", "ECHINOIDEA",
  ] },
  // Plants
  { id: "plantae", name: "Plants", filterColumn: "kingdom_name", filterValues: ["PLANTAE"] },
  // Fungi & Protists
  { id: "fungi", name: "Fungi & Protists", filterColumn: "phylum_name", filterValues: ["ASCOMYCOTA", "BASIDIOMYCOTA", "OCHROPHYTA"] },
];

// Population trend code to text mapping (from IUCN DB)
export const POPULATION_TRENDS: Record<string, string> = {
  "0": "Increasing",
  "1": "Decreasing",
  "2": "Stable",
  "3": "Unknown",
};
