/**
 * build-matching test (#271, Phase 3): drives the real run() over tiny synthetic
 * parquets + a redlist CSV in a temp dir, then inspects species_link.parquet.
 * Focus: the matching ladder — accepted, CoL-synonym, and especially the
 * IUCN-synonym fallback (a species whose CURRENT name CoL doesn't know, but whose
 * IUCN-recorded synonym equals a CoL accepted name — the genus-reassignment case
 * that name-joins on the canonical name alone miss). Self-contained (DuckDB only).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { run } from "../build-matching";

let tmp: string;
let link: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "matching-test-"));
  fs.mkdirSync(path.join(tmp, "species"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "redlist"), { recursive: true });
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  const copy = (sql: string, file: string) => conn.run(`COPY (${sql}) TO '${path.join(tmp, file)}' (FORMAT PARQUET);`);

  // CoL accepted species (col_acc source).
  await copy(`SELECT * FROM (VALUES
      ('C1','Panthera leo','mammalia','felidae'),
      ('C2','Macronycteris vittatus','mammalia','hipposideridae'),
      ('C3','Felis catus','mammalia','felidae'),
      ('C4','Apis mellifera','insecta','apidae')
    ) v(col_id, scientific_name, class_name, family)`, "species/data_0.parquet");

  // CoL backbone (col_syn source): one species-rank synonym → accepted parent C3.
  await copy(`SELECT * FROM (VALUES
      ('C3', NULL, 'accepted', 'species', 'Felis catus'),
      ('S1', 'C3', 'synonym', 'species', 'Felis silvestris catus')
    ) v(col_id, parent_id, status, rank, scientific_name)`, "backbone.parquet");

  // Our IUCN-assessed species.
  await copy(`SELECT * FROM (VALUES
      (1::BIGINT, 'Panthera leo', 'mammalia', 'felidae', NULL::BIGINT),
      (2::BIGINT, 'Felis silvestris catus', 'mammalia', 'felidae', NULL::BIGINT),
      (3::BIGINT, 'Hipposideros vittatus', 'mammalia', 'hipposideridae', NULL::BIGINT),
      (4::BIGINT, 'Gone extinctus', 'mammalia', 'nowhere', NULL::BIGINT)
    ) v(id, scientific_name, class_name, family, gbif_species_key)`, "assessed.parquet");

  // GBIF-only species (no IUCN synonyms).
  await copy(`SELECT * FROM (VALUES
      (101::BIGINT, 'Apis mellifera', 'insecta', 'apidae', 1001::BIGINT)
    ) v(id, scientific_name, class_name, family, gbif_species_key)`, "unassessed.parquet");

  // Redlist CSV with the IUCN synonym source: sis 3 (Hipposideros vittatus) records
  // the synonym "Macronycteris vittatus" — which is CoL's accepted name (C2).
  fs.writeFileSync(path.join(tmp, "redlist", "mammals.csv"),
    "sis_taxon_id,synonyms\n1,\n2,\n3,Macronycteris vittatus:NEW\n4,\n");

  await run({ dataDir: tmp });
  link = path.join(tmp, "species_link.parquet");
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function rows(): Promise<Record<string, unknown>[]> {
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  return (await (await conn.run(`SELECT id, col_id, match_method FROM '${link}' ORDER BY id`)).getRowObjects());
}

describe("build-matching ladder", () => {
  it("matches a canonical name to a CoL accepted species", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 1)!;
    expect([r.col_id, r.match_method]).toEqual(["C1", "accepted"]);
  });

  it("matches a canonical name that is a CoL synonym → accepted parent", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 2)!;
    expect([r.col_id, r.match_method]).toEqual(["C3", "synonym"]);
  });

  it("falls back to an IUCN-recorded synonym when the canonical name is unknown to CoL", async () => {
    // Hipposideros vittatus is not in CoL; its IUCN synonym Macronycteris vittatus is
    // CoL's accepted name (C2) — so it resolves there instead of going unmatched.
    const r = (await rows()).find((x) => Number(x.id) === 3)!;
    expect([r.col_id, r.match_method]).toEqual(["C2", "iucn_synonym"]);
  });

  it("leaves a species with no canonical or synonym hit unmatched", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 4)!;
    expect([r.col_id, r.match_method]).toEqual([null, "unmatched"]);
  });

  it("matches GBIF-only species too (no IUCN synonyms involved)", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 101)!;
    expect([r.col_id, r.match_method]).toEqual(["C4", "accepted"]);
  });
});
