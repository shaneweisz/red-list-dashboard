import { describe, it, expect } from "vitest";
import { filterToSql, sqlStrList } from "@/lib/taxonomy-sql";
import { matchesFilter } from "@/lib/taxonomy-utils";

// filterToSql is the SQL mirror of matchesFilter (taxonomy-utils.ts) — previously
// inline in scripts/build-taxa-summary.ts (untested there), now shared with the live
// per-country query path (country-taxa-summary-duckdb.ts). These tests check the
// generated predicate's shape; full row-matching parity against real parquet data is
// verified manually (see country-taxa-summary-duckdb.test.ts's file comment).

describe("sqlStrList", () => {
  it("lowercases and quotes each value", () => {
    expect(sqlStrList(["Mammalia", "Aves"])).toBe("'mammalia', 'aves'");
  });

  it("escapes embedded single quotes", () => {
    expect(sqlStrList(["o'brien"])).toBe("'o''brien'");
  });
});

describe("filterToSql", () => {
  it("always scopes to csvGroups", () => {
    const sql = filterToSql({ csvGroups: ["mammals"] });
    expect(sql).toContain("taxon_group IN ('mammals')");
  });

  it("includes a class filter", () => {
    const sql = filterToSql({ csvGroups: ["mammals"], classNames: ["mammalia"] });
    expect(sql).toContain("coalesce(lower(class_name), '') IN ('mammalia')");
  });

  it("excludes classes, expanding a display-class alias to CoL's finer classes", () => {
    // chondrichthyes is a display-tree class name; CoL splits it into elasmobranchii/
    // holocephali — expandClasses() covers both so the exclusion actually matches CoL
    // rows (a plain "chondrichthyes" exclusion would never match anything there).
    const sql = filterToSql({ csvGroups: ["fishes"], excludeClasses: ["chondrichthyes"] });
    expect(sql).toContain("coalesce(lower(class_name), '') NOT IN ('elasmobranchii', 'holocephali')");
  });

  it("falls back to class_name when order_name is empty, matching matchesFilter's GBIF-taxonomy quirk", () => {
    const filter = { csvGroups: ["mammals"], orderNames: ["primates"] };
    const sql = filterToSql(filter);
    expect(sql).toContain("(coalesce(lower(order_name), '') IN ('primates') OR (coalesce(lower(order_name), '') = '' AND coalesce(lower(class_name), '') IN ('primates')))");
    // Parity check: a row with empty order_name but class_name matching the order
    // name is exactly the case this fallback exists for.
    expect(matchesFilter({ class_name: "primates", order_name: "" }, filter)).toBe(true);
  });

  it("derives genus from the first token of scientific_name", () => {
    const sql = filterToSql({ csvGroups: ["mammals"], genera: ["ursus"] });
    expect(sql).toContain("coalesce(lower(split_part(scientific_name, ' ', 1)), '') IN ('ursus')");
  });

  it("always appends the universe-wide COL_EXCLUDE_ALL_NODES exclusion", () => {
    const sql = filterToSql({ csvGroups: ["mammals"] });
    expect(sql).toMatch(/NOT IN \(.*\)$/);
  });

  it("wraps extraSpeciesNames as an OR escape hatch, still scoped to csvGroups", () => {
    const sql = filterToSql({ csvGroups: ["mammals"], families: ["bovidae"], extraSpeciesNames: ["antilocapra americana"] });
    expect(sql).toMatch(/^\(\(.*\) OR \(.*\)\)$/);
    expect(sql).toContain("antilocapra americana");
  });

  it("takes the CoL species-name override branch only when nodeId matches an override, mirroring matchesFilter's comment that this branch never applies to real IUCN-assessed rows", () => {
    // No override configured for an arbitrary nodeId → falls through to the normal clause.
    const withUnknownNode = filterToSql({ csvGroups: ["mammals"], genera: ["ursus"] }, "not-a-real-node-id");
    const withoutNode = filterToSql({ csvGroups: ["mammals"], genera: ["ursus"] });
    expect(withUnknownNode).toBe(withoutNode);
  });
});
