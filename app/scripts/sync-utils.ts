/**
 * Shared utilities for sync scripts.
 *
 * - JSONL logging
 * - Supabase service client creation
 * - Paginated fetch
 * - Taxa configuration
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

  // Order by first selected column to ensure stable pagination
  const orderCol = select.split(",")[0].trim();

  while (true) {
    let query = supabase.from(table).select(select).order(orderCol).range(offset, offset + PAGE_SIZE - 1);
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
// JSONL LOGGING
// =============================================================================

export class SyncLogger {
  private stream: fs.WriteStream | null;
  private counts: Record<string, number> = {};

  constructor(scriptName: string, logsDir?: string) {
    const dir = logsDir || path.join(__dirname, "../logs");
    fs.mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
    const filename = `${ts}_${scriptName}.jsonl`;
    this.stream = fs.createWriteStream(path.join(dir, filename), { flags: "a" });
  }

  /** Create a no-op logger that doesn't write to disk */
  static noop(): SyncLogger {
    const logger = Object.create(SyncLogger.prototype) as SyncLogger;
    logger.stream = null;
    logger.counts = {};
    return logger;
  }

  log(event: string, data: Record<string, unknown>): void {
    this.counts[event] = (this.counts[event] || 0) + 1;
    if (!this.stream) return;
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
    this.stream?.end();
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
  { id: "velvet_worms", name: "Velvet Worms", filterColumn: "class_name", filterValues: ["UDEONYCHOPHORA"] },
  { id: "horseshoe_crabs", name: "Horseshoe Crabs", filterColumn: "class_name", filterValues: ["MEROSTOMATA"] },
  // "Other Invertebrates" needs two entries because it spans different filter columns:
  // non-coral Anthozoa are filtered by order_name (to separate them from corals, which
  // are also in class ANTHOZOA), while the remaining classes are filtered by class_name.
  // Both entries share the same taxon_group id to match the IUCN Red List Table 1a grouping.
  { id: "other_invertebrates", name: "Other Invertebrates (non-coral Anthozoa)", filterColumn: "order_name", filterValues: [
    "ACTINIARIA", "ZOANTHARIA", "PENICILLARIA", "MALACALCYONCAEA", "SCLERALCYONACEA",
  ] },
  { id: "other_invertebrates", name: "Other Invertebrates", filterColumn: "class_name", filterValues: [
    "HOLOTHUROIDEA", "CLITELLATA", "DIPLOPODA", "COLLEMBOLA", "CHILOPODA",
    "DEMOSPONGIAE", "HYDROZOA", "NEMERTEA",
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

// =============================================================================
// CSV UTILITIES
// =============================================================================

export const DATA_DIR = path.join(__dirname, "../data");

/** Escape a field for RFC 4180 CSV. Quotes fields containing commas, quotes, or newlines. */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Write rows to a CSV file. Rows are sorted by the first column for diffability. */
export function writeCsv(
  rows: Record<string, string | number | null | undefined>[],
  columns: string[],
  outputPath: string
): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const header = columns.join(",");
  const lines = rows.map((row) =>
    columns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined || val === "") return "";
      return csvEscape(String(val));
    }).join(",")
  );
  fs.writeFileSync(outputPath, header + "\n" + lines.join("\n") + "\n");
}

/** Parse a CSV line respecting quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/** Read a CSV file and parse each row using the provided function. */
export function readCsv<T>(
  inputPath: string,
  parse: (row: Record<string, string>) => T
): T[] {
  const content = fs.readFileSync(inputPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const results: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    results.push(parse(row));
  }

  return results;
}
