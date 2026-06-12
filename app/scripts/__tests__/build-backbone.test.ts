/**
 * build-backbone transform test (#271, Phase 3): drives the real run() over a
 * tiny synthetic ColDP NameUsage TSV in a temp dir, then inspects the parquet it
 * writes. Focus: the two flags that define the displayable extant universe —
 *  - col:extinct → tri-state boolean (true=fossil / false=extant / empty=null);
 *  - in_base = (col:sourceID is one of the Base GSD source keys), which catches
 *    the unflagged-fossil tail (paleo papers that never set col:extinct).
 * The read layer's universe predicate is `in_base AND extinct IS NOT TRUE`. Also
 * pins the universe to status='accepted' (provisionally accepted excluded). The
 * Base source list is injected (opts.baseSourceIds) so the test never hits the
 * network. Self-contained (local fixture + DuckDB) — no R2 data needed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { run } from "../build-backbone";

// Minimal ColDP NameUsage: only the columns build-backbone reads by name. The last
// three feed described_year: the current-combination author year, the basionym
// author year, and the cited-reference id (resolved to a year via Reference.tsv).
const COLS = [
  "col:ID", "col:parentID", "col:status", "col:rank", "col:scientificName",
  "col:authorship", "col:kingdom", "col:phylum", "col:class", "col:order",
  "col:family", "col:genus", "col:sourceID", "col:extinct",
  "col:combinationAuthorshipYear", "col:basionymAuthorshipYear", "col:nameReferenceID",
];
// Base GSD source keys (injected). 100/200 are GSDs; 999 is a non-Base source
// (stand-in for the paleo-paper tail).
const BASE_SOURCE_IDS = ["100", "200"];
// id, parent, status, rank, name, auth, kingdom, phylum, class, order, family, genus, sourceID, extinct, combYear, basYear, refID
const ROWS: string[][] = [
  ["1", "F", "accepted", "species", "Panthera leo", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Panthera", "100", "false", "1758", "", ""],
  ["2", "F", "accepted", "species", "Smilodon fatalis", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Smilodon", "100", "true", "", "", ""],
  // Combination year empty → falls back to the basionym author year (1834).
  ["3", "F", "accepted", "species", "Felis incognita", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Felis", "200", "", "", "1834", ""],
  // Subgenus parenthetical: must be normalized to the binomial "Peropteryx leucoptera".
  // No author years → described_year falls back to the cited reference's year (R1 → 1867).
  ["7", "F", "accepted", "species", "Peropteryx (Peronymus) leucoptera", "L.", "Animalia", "Chordata", "Mammalia", "Chiroptera", "Emballonuridae", "Peropteryx", "200", "false", "", "", "R1"],
  // Unflagged fossil from a non-Base paleo source: extinct is null, so only in_base drops it.
  ["6", "F", "accepted", "species", "Cimexomys testus", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Cimexomys", "999", "", "", "", ""],
  ["4", "F", "provisionally accepted", "species", "Felis dubia", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Felis", "100", "false", "", "", ""],
  ["5", "1", "synonym", "species", "Felis leo", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Felis", "100", "", "", "", ""],
  ["F", "R", "accepted", "family", "Felidae", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "", "100", "", "", "", ""],
];

// Minimal ColDP Reference: id → issued date. R1's date is a full CSL date so the
// build's 4-digit-year extraction is exercised, not just a bare year.
const REF_COLS = ["col:ID", "col:issued"];
const REF_ROWS: string[][] = [["R1", "1867-05-01"]];

let tmp: string;
let speciesGlob: string;
let backbone: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backbone-test-"));
  const tsv = path.join(tmp, "NameUsage.tsv");
  fs.writeFileSync(tsv, [COLS.join("\t"), ...ROWS.map((r) => r.join("\t"))].join("\n") + "\n");
  const referenceTsv = path.join(tmp, "Reference.tsv");
  fs.writeFileSync(referenceTsv, [REF_COLS.join("\t"), ...REF_ROWS.map((r) => r.join("\t"))].join("\n") + "\n");
  await run({ tsv, referenceTsv, outDir: tmp, baseSourceIds: BASE_SOURCE_IDS });
  speciesGlob = path.join(tmp, "species", "**", "*.parquet");
  backbone = path.join(tmp, "backbone.parquet");
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  return (await (await conn.run(sql)).getRowObjects());
}

describe("build-backbone species universe", () => {
  it("keeps every status='accepted' species (drops provisionally accepted, synonyms, higher ranks)", async () => {
    const rows = await query(`SELECT scientific_name FROM read_parquet('${speciesGlob}', hive_partitioning=true) ORDER BY scientific_name`);
    // Felis dubia (provisionally accepted) excluded. The fossil + non-Base species
    // are KEPT in the parquet (carried with flags) and filtered at query time.
    expect(rows.map((r) => r.scientific_name)).toEqual([
      "Cimexomys testus", "Felis incognita", "Panthera leo", "Peropteryx leucoptera", "Smilodon fatalis",
    ]);
  });

  it("normalizes a subgenus parenthetical to the canonical binomial (dedup + display)", async () => {
    const rows = await query(`SELECT scientific_name FROM read_parquet('${speciesGlob}', hive_partitioning=true) WHERE scientific_name LIKE 'Peropteryx%'`);
    // "Peropteryx (Peronymus) leucoptera" → "Peropteryx leucoptera" so it matches
    // the plain binomial in our assessed/GBIF data and doesn't reappear as "new".
    expect(rows.map((r) => r.scientific_name)).toEqual(["Peropteryx leucoptera"]);
  });

  it("derives col:extinct as a tri-state boolean: true→TRUE, false→FALSE, empty→NULL", async () => {
    const rows = await query(`SELECT scientific_name, extinct FROM read_parquet('${speciesGlob}', hive_partitioning=true)`);
    const byName = new Map(rows.map((r) => [r.scientific_name, r.extinct]));
    expect(byName.get("Panthera leo")).toBe(false);      // col:extinct='false'
    expect(byName.get("Smilodon fatalis")).toBe(true);   // col:extinct='true'  (flagged fossil)
    expect(byName.get("Felis incognita")).toBeNull();    // col:extinct=''      (unflagged)
    expect(byName.get("Cimexomys testus")).toBeNull();   // unflagged fossil
  });

  it("tags in_base from col:sourceID against the Base GSD allowlist", async () => {
    const rows = await query(`SELECT scientific_name, in_base FROM read_parquet('${speciesGlob}', hive_partitioning=true)`);
    const byName = new Map(rows.map((r) => [r.scientific_name, r.in_base]));
    expect(byName.get("Panthera leo")).toBe(true);       // source 100 (GSD)
    expect(byName.get("Felis incognita")).toBe(true);    // source 200 (GSD)
    expect(byName.get("Cimexomys testus")).toBe(false);  // source 999 (paleo-paper tail)
  });

  it("the universe predicate `in_base AND extinct IS NOT TRUE` drops flagged AND unflagged fossils", async () => {
    const rows = await query(`SELECT scientific_name FROM read_parquet('${speciesGlob}', hive_partitioning=true) WHERE in_base AND extinct IS NOT TRUE ORDER BY scientific_name`);
    // Smilodon (flagged fossil) and Cimexomys (unflagged, non-Base) both excluded.
    expect(rows.map((r) => r.scientific_name)).toEqual([
      "Felis incognita", "Panthera leo", "Peropteryx leucoptera",
    ]);
  });

  it("derives described_year: combination year, then basionym year, then reference year", async () => {
    const rows = await query(`SELECT scientific_name, described_year FROM read_parquet('${speciesGlob}', hive_partitioning=true)`);
    const byName = new Map(rows.map((r) => [r.scientific_name, r.described_year]));
    expect(Number(byName.get("Panthera leo"))).toBe(1758);          // combination author year
    expect(Number(byName.get("Felis incognita"))).toBe(1834);       // basionym fallback
    expect(Number(byName.get("Peropteryx leucoptera"))).toBe(1867); // reference-year fallback (R1, parsed from "1867-05-01")
    expect(byName.get("Cimexomys testus")).toBeNull();              // no year anywhere
  });

  it("lowercases the denormalized lineage and partitions by taxon_group (Table 1a group)", async () => {
    const rows = await query(`SELECT DISTINCT class_name, taxon_group FROM read_parquet('${speciesGlob}', hive_partitioning=true)`);
    // All fixture species are class Mammalia → taxon_group 'mammals' (TAXON_GROUP_CASE).
    expect(rows).toEqual([{ class_name: "mammalia", taxon_group: "mammals" }]);
  });
});

describe("build-backbone backbone.parquet", () => {
  it("carries every usage (all ranks + synonyms) for tree + synonym resolution", async () => {
    const rows = await query(`SELECT count(*) n, count(*) FILTER (status LIKE '%synonym%') syn FROM read_parquet('${backbone}')`);
    expect(Number(rows[0].n)).toBe(8);   // all rows, including the family + synonym
    expect(Number(rows[0].syn)).toBe(1);
  });
});
