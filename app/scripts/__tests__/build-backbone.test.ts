/**
 * build-backbone transform test (#271, Phase 3): drives the real run() over a
 * tiny synthetic ColDP NameUsage TSV in a temp dir, then inspects the parquet it
 * writes. Focus: the col:extinct → tri-state boolean derivation (true=fossil,
 * false=extant, empty=null) that lets the species universe drop fossils so
 * per-group totals track IUCN Table 1a, and that the `extinct IS NOT TRUE`
 * predicate the read layer uses excludes exactly the fossils. Also pins the
 * universe to status='accepted' (provisionally accepted excluded — SPECIES_STATUS).
 * Self-contained (local fixture + DuckDB) — no R2 data needed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { run } from "../build-backbone";

// Minimal ColDP NameUsage: only the columns build-backbone reads by name.
const COLS = [
  "col:ID", "col:parentID", "col:status", "col:rank", "col:scientificName",
  "col:authorship", "col:kingdom", "col:phylum", "col:class", "col:order",
  "col:family", "col:genus", "col:extinct",
];
// id, parent, status, rank, name, auth, kingdom, phylum, class, order, family, genus, extinct
const ROWS: string[][] = [
  ["1", "F", "accepted", "species", "Panthera leo", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Panthera", "false"],
  ["2", "F", "accepted", "species", "Smilodon fatalis", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Smilodon", "true"],
  ["3", "F", "accepted", "species", "Felis incognita", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Felis", ""],
  ["4", "F", "provisionally accepted", "species", "Felis dubia", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Felis", "false"],
  ["5", "1", "synonym", "species", "Felis leo", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Felis", ""],
  ["F", "R", "accepted", "family", "Felidae", "L.", "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "", ""],
];

let tmp: string;
let speciesGlob: string;
let backbone: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backbone-test-"));
  const tsv = path.join(tmp, "NameUsage.tsv");
  fs.writeFileSync(tsv, [COLS.join("\t"), ...ROWS.map((r) => r.join("\t"))].join("\n") + "\n");
  await run({ tsv, outDir: tmp });
  speciesGlob = path.join(tmp, "species", "**", "*.parquet");
  backbone = path.join(tmp, "backbone.parquet");
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  return (await (await conn.run(sql)).getRowObjects());
}

describe("build-backbone species universe", () => {
  it("keeps only status='accepted' species (drops provisionally accepted, synonyms, higher ranks)", async () => {
    const rows = await query(`SELECT scientific_name FROM read_parquet('${speciesGlob}', hive_partitioning=true) ORDER BY scientific_name`);
    // Felis dubia (provisionally accepted) is excluded — see SPECIES_STATUS.
    expect(rows.map((r) => r.scientific_name)).toEqual([
      "Felis incognita", "Panthera leo", "Smilodon fatalis",
    ]);
  });

  it("derives col:extinct as a tri-state boolean: true→TRUE, false→FALSE, empty→NULL", async () => {
    const rows = await query(`SELECT scientific_name, extinct FROM read_parquet('${speciesGlob}', hive_partitioning=true)`);
    const byName = new Map(rows.map((r) => [r.scientific_name, r.extinct]));
    expect(byName.get("Panthera leo")).toBe(false);     // col:extinct='false'
    expect(byName.get("Smilodon fatalis")).toBe(true);  // col:extinct='true'  (fossil)
    expect(byName.get("Felis incognita")).toBeNull();   // col:extinct=''      (unflagged)
  });

  it("the read-layer predicate `extinct IS NOT TRUE` drops fossils but keeps extant + unflagged", async () => {
    const rows = await query(`SELECT scientific_name FROM read_parquet('${speciesGlob}', hive_partitioning=true) WHERE extinct IS NOT TRUE ORDER BY scientific_name`);
    // Smilodon (fossil) excluded; the extant + unflagged species remain.
    expect(rows.map((r) => r.scientific_name)).toEqual([
      "Felis incognita", "Panthera leo",
    ]);
  });

  it("lowercases the denormalized lineage and partitions Animalia by phylum", async () => {
    const rows = await query(`SELECT DISTINCT class_name, part FROM read_parquet('${speciesGlob}', hive_partitioning=true)`);
    expect(rows).toEqual([{ class_name: "mammalia", part: "Chordata" }]);
  });
});

describe("build-backbone backbone.parquet", () => {
  it("carries every usage (all ranks + synonyms) for tree + synonym resolution", async () => {
    const rows = await query(`SELECT count(*) n, count(*) FILTER (status LIKE '%synonym%') syn FROM read_parquet('${backbone}')`);
    expect(Number(rows[0].n)).toBe(6);   // all rows, including the family + synonym
    expect(Number(rows[0].syn)).toBe(1);
  });
});
