/**
 * The guard that stands between a CoL release and a silently empty taxon group.
 *
 * Group root keys are CoL usage ids, and CoL renumbers them between releases:
 * going from COL26.6 to COL26.7, Rhodophyta moves L2MHG -> CHDNQ and Blattodea's
 * key disappears outright. Rhodophyta is red_algae's ONLY root, so a stale key
 * there does not produce an error — it produces a group with no species in it,
 * which looks exactly like a group that has no species.
 *
 * That is the failure that closed #441 and #444, and GBIF is expected to promote
 * COL26.7 within weeks of this landing, so the guard is about to matter. These
 * tests exist because the guard was previously unverified and short-circuits when
 * backbone.parquet is absent — meaning in CI it did nothing at all, silently.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { assertRootKeysResolve } from "../fetch-gbif-species";
import type { Taxon } from "../taxa";

let dir: string;
let taxonomy: string;

/** A stand-in Catalogue of Life holding two live root keys and not a third. */
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootkeys-"));
  taxonomy = path.join(dir, "backbone.parquet");
  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();
  await conn.run(`
    COPY (SELECT * FROM (VALUES
      ('AVES',  'Aves',       'class'),
      ('CHDNQ', 'Rhodophyta', 'phylum')
    ) AS t(col_id, scientific_name, rank))
    TO '${taxonomy}' (FORMAT PARQUET)`);
  conn.closeSync();
  inst.closeSync();
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const taxon = (id: string, keys: string[]) =>
  ({ id, gbif: keys.map((taxonKey) => ({ taxonKey })) }) as unknown as Taxon;

describe("assertRootKeysResolve", () => {
  it("passes when every root key still exists in the release", async () => {
    await expect(
      assertRootKeysResolve([taxon("birds", ["AVES"]), taxon("red_algae", ["CHDNQ"])], taxonomy)
    ).resolves.toBeUndefined();
  });

  it("throws when a key was renumbered, naming the group and the key", async () => {
    // red_algae still pointing at COL26.6's Rhodophyta after the release moved.
    const err = await assertRootKeysResolve([taxon("red_algae", ["L2MHG"])], taxonomy).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("red_algae");
    expect(err.message).toContain("L2MHG");
    // Actionable: it has to say what to run, or it is just a crash.
    expect(err.message).toMatch(/derive-gbif-taxon-keys/);
  });

  it("throws when a key disappears outright, as Blattodea's did", async () => {
    await expect(
      assertRootKeysResolve([taxon("other_insects", ["BLATTODEA_GONE"])], taxonomy)
    ).rejects.toThrow(/other_insects/);
  });

  it("reports every dead key, not just the first", async () => {
    const err = await assertRootKeysResolve(
      [taxon("red_algae", ["L2MHG"]), taxon("other_insects", ["BLATTODEA_GONE"])],
      taxonomy
    ).catch((e) => e);
    expect(err.message).toContain("L2MHG");
    expect(err.message).toContain("BLATTODEA_GONE");
    expect(err.message).toContain("2 group root key(s)");
  });

  it("does not mistake a live key that simply has no occurrences for a dead one", async () => {
    // Existence, not productivity. Turbellaria holds 13,998 records and zero
    // species-rank facets; treating that as death aborted an entire sync once.
    await expect(assertRootKeysResolve([taxon("birds", ["AVES"])], taxonomy)).resolves.toBeUndefined();
  });
});
