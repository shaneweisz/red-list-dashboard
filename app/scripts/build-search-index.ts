/**
 * build-search-index: Pre-build a JSON search index for fast species lookup.
 *
 * Reads per-taxon redlist and GBIF CSVs + mapping, produces a single
 * data/search-index.json with lightweight entries for all species.
 * Loaded once by the search API on first request — avoids parsing 42 CSVs.
 *
 * Usage:
 *   npx tsx scripts/build-search-index.ts
 */

import * as fs from "fs";
import * as path from "path";
import { DATA_DIR, REDLIST_DIR, GBIF_DIR } from "./utils";
import { TAXA } from "./taxa";
import { readRedlistCsv } from "./fetch-redlist-species";
import { readGbifCsv } from "./fetch-gbif-species";
import { readMappingCsv } from "./match-redlist-species-to-gbif";
import { EXCLUDED_DOMESTICATED_GBIF_KEYS, mapTaxonId } from "../src/lib/data/taxonomy-constants";

// Compact entry — null/empty fields omitted to reduce file size.
// See SearchIndexEntry in species-store.ts for the full type.
interface SearchEntry {
  i: number;          // id (sis_taxon_id or -gbif_key)
  s: string;          // scientific_name
  c?: string;         // common_name (omitted when null)
  ti: string;         // taxon_id (display group)
  tg: string;         // taxon_group (CSV group)
  cat: string;        // category
  gk?: number;        // gbif_species_key (omitted when null)
  aid?: number;       // assessment_id (omitted when null)
  ad?: string;        // assessment_date (omitted when null)
  ctry?: string;      // countries as semicolon-separated string (omitted when empty)
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function run(): Promise<void> {
  const entries: SearchEntry[] = [];

  const mapping = readMappingCsv();
  const linkedGbifKeys = new Set<number>();
  for (const entry of mapping.values()) {
    if (entry.gbif_species_key != null) linkedGbifKeys.add(entry.gbif_species_key);
  }

  for (const taxon of TAXA) {
    const redlistPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
    const gbifPath = path.join(GBIF_DIR, `${taxon.id}.csv`);

    // Assessed species from redlist
    if (fs.existsSync(redlistPath)) {
      const redlistSpecies = readRedlistCsv(taxon.id);
      for (const r of redlistSpecies) {
        const gbifKey = mapping.get(r.sis_taxon_id)?.gbif_species_key ?? null;
        const entry: SearchEntry = {
          i: r.sis_taxon_id,
          s: r.scientific_name,
          ti: mapTaxonId(r.taxon_group_table1a),
          tg: r.taxon_group_table1a,
          cat: r.category || "",
        };
        if (r.common_name) entry.c = r.common_name;
        if (gbifKey) entry.gk = gbifKey;
        if (r.assessment_id) entry.aid = r.assessment_id;
        if (r.assessment_date) entry.ad = r.assessment_date;
        if (r.countries.length > 0) entry.ctry = r.countries.join(";");
        entries.push(entry);
      }
    }

    // NE species from GBIF (not linked to redlist)
    if (fs.existsSync(gbifPath)) {
      const gbifMap = readGbifCsv(taxon.id);
      for (const [key, g] of gbifMap) {
        if (linkedGbifKeys.has(key)) continue;
        if (EXCLUDED_DOMESTICATED_GBIF_KEYS.has(key)) continue;
        const entry: SearchEntry = {
          i: -key,
          s: g.scientific_name,
          ti: mapTaxonId(g.taxon_group_table1a),
          tg: g.taxon_group_table1a,
          cat: "NE",
          gk: key,
        };
        if (g.common_name) entry.c = g.common_name;
        const countries = g.countries ? String(g.countries).trim() : "";
        if (countries) entry.ctry = countries;
        entries.push(entry);
      }
    }
  }

  // Write as CSV — smaller on disk than JSON and consistent with the rest of the data layer.
  // Countries use semicolons as separator (same as other CSVs), so we quote fields that may
  // contain commas. Scientific/common names can contain commas too.
  const CSV_HEADERS = ["id", "scientific_name", "common_name", "taxon_id", "taxon_group", "category", "gbif_species_key", "assessment_id", "assessment_date", "countries"];
  const lines = [CSV_HEADERS.join(",")];
  for (const e of entries) {
    const fields = [
      String(e.i),
      csvEscape(e.s),
      csvEscape(e.c ?? ""),
      e.ti,
      e.tg,
      e.cat,
      e.gk != null ? String(e.gk) : "",
      e.aid != null ? String(e.aid) : "",
      e.ad ?? "",
      e.ctry ?? "",
    ];
    lines.push(fields.join(","));
  }
  const csv = lines.join("\n");

  const outPath = path.join(DATA_DIR, "search-index.csv");
  fs.writeFileSync(outPath, csv);

  const sizeMB = (Buffer.byteLength(csv) / 1024 / 1024).toFixed(1);
  console.log(`  Wrote ${entries.length.toLocaleString()} entries to ${outPath} (${sizeMB} MB)`);
}

// Direct execution
const isDirectRun = process.argv[1]?.endsWith("build-search-index.ts") || process.argv[1]?.endsWith("build-search-index.js");
if (isDirectRun) {
  run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
