/**
 * computeNoMatchDetails end-to-end over fixture parquet.
 *
 * classifyNoMatch is a pure function and is tested as one, which left the query
 * that FEEDS it untested — and that query is a template string assembled from
 * three optional fragments. Removing one column from its SELECT list left a
 * double comma, and the whole suite stayed green while the build could not parse
 * its own SQL; only running a sync surfaced it. So this drives the real query
 * against a tiny synthetic universe and asserts the reasons that come back.
 *
 * The point is coverage of the SQL, not of the branching: one row per shape the
 * query has to carry a field for, so a projection that stops being selected, or
 * a join that stops resolving, fails here rather than in a data sync.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { computeNoMatchDetails, COL_TO_ASSESSED_SQL, type BreakdownQueryContext } from "../col-breakdown";

let tmp: string;
let conn: DuckDBConnection;
let ctx: BreakdownQueryContext;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "col-breakdown-sql-"));
  fs.mkdirSync(path.join(tmp, "species"), { recursive: true });
  conn = await (await DuckDBInstance.create(":memory:")).connect();
  const copy = (sql: string, file: string) =>
    conn.run(`COPY (${sql}) TO '${path.join(tmp, file)}' (FORMAT PARQUET);`);

  // CoL's displayable universe. IN1 is in Base; XR1 is the extended release only.
  await copy(`SELECT * FROM (VALUES
      ('IN1','Clean species', true, false),
      ('XR1','Xr onlyus', false, false),
      ('LUMP','Lump winner', true, false)
    ) v(col_id, scientific_name, in_base, extinct)`, "species/data_0.parquet");

  // Backbone: a synonym of an in-Base accepted species (the synonym_of route),
  // and a subspecies record (the infraspecific route).
  await copy(`SELECT * FROM (VALUES
      ('IN1', NULL, 'accepted', 'species', 'Clean species'),
      ('XR1', NULL, 'accepted', 'species', 'Xr onlyus'),
      ('LUMP', NULL, 'accepted', 'species', 'Lump winner'),
      ('SYN1', 'IN1', 'synonym', 'species', 'Renamed away'),
      ('SUB1', 'IN1', 'accepted', 'subspecies', 'Clean species demoted')
    ) v(col_id, parent_id, status, rank, scientific_name)`, "backbone.parquet");

  await copy(`SELECT * FROM (VALUES
      (1::BIGINT, 'Clean species', 'LC'),
      (2::BIGINT, 'Xr onlyus', 'LC'),
      (3::BIGINT, 'Renamed away', 'LC'),
      (4::BIGINT, 'Demoted one', 'LC'),
      (5::BIGINT, 'Lump winner', 'LC'),
      (6::BIGINT, 'Lump loser', 'LC'),
      (7::BIGINT, 'Nothing at all', 'LC')
    ) v(id, scientific_name, iucn_category)`, "assessed.parquet");

  await copy(`SELECT * FROM (VALUES
      ('redlist', 1::BIGINT, 'Clean species', 'IN1', 'accepted'),
      ('redlist', 2::BIGINT, 'Xr onlyus', 'XR1', 'accepted'),
      ('redlist', 3::BIGINT, 'Renamed away', 'XR1', 'accepted'),
      ('redlist', 4::BIGINT, 'Demoted one', 'SUB1', 'accepted'),
      ('redlist', 5::BIGINT, 'Lump winner', 'LUMP', 'accepted'),
      ('redlist', 6::BIGINT, 'Lump loser', 'LUMP', 'synonym'),
      ('redlist', 7::BIGINT, 'Nothing at all', NULL, 'unmatched')
    ) v(src, id, scientific_name, col_id, match_method)`, "species_link.parquet");

  // The same temp tables the real caller builds before running the diagnostic.
  await conn.run(COL_TO_ASSESSED_SQL(path.join(tmp, "species_link.parquet"), path.join(tmp, "assessed.parquet")));
  await conn.run(`CREATE TEMP TABLE assessed_cids AS
    SELECT DISTINCT col_id FROM read_parquet('${path.join(tmp, "species_link.parquet")}')
    WHERE col_id IS NOT NULL`);

  ctx = {
    conn,
    speciesGlob: path.join(tmp, "species", "**", "*.parquet"),
    assessedPath: path.join(tmp, "assessed.parquet"),
    linkPath: path.join(tmp, "species_link.parquet"),
    backbonePath: path.join(tmp, "backbone.parquet"),
    hasBackbone: true,
    universeSql: "extinct IS NOT TRUE",
    assessedCidsTable: "assessed_cids",
    excludedColIdsSql: "('__none__')",
  } as unknown as BreakdownQueryContext;
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("computeNoMatchDetails — the query, not just the classifier", () => {
  it("runs, and every field classifyNoMatch reads survives the SELECT list", async () => {
    const details = await computeNoMatchDetails(ctx, "true", "true");
    const byId = new Map(details.map((d) => [d.id, d]));

    // A clean 1:1 match must not be diagnosed at all.
    expect(byId.has(1)).toBe(false);

    // linked_in_base reaching the classifier: XR-only, no backbone synonymy.
    expect(byId.get(2)?.reason).toBe("not_in_base");

    // syn_name/syn_col_id reaching the classifier via the backbone route.
    expect(byId.get(3)?.reason).toBe("synonym_of");
    expect(byId.get(3)?.detail).toBe("Clean species");

    // bk_rank + parent fields reaching the classifier.
    expect(byId.get(4)?.reason).toBe("infraspecific");
    expect(byId.get(4)?.rank).toBe("subspecies");

    // winner_name/winner_id reaching the classifier.
    expect(byId.get(6)?.reason).toBe("lumped");
    expect(byId.get(6)?.detail).toBe("Lump winner");

    // No link at all.
    expect(byId.get(7)?.reason).toBe("unmatched");
  });
});
