import { describe, it, expect } from "vitest";
import { filterToSql, sqlStrList, canonicalOrderColumnSql, canonicalClassColumnSql } from "@/lib/taxonomy-sql";
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

  it("includes an order filter, expanding the artiodactyla/cetacea CoL order-label split", () => {
    // Verified against real data (2026-07-21): IUCN's assessed.parquet already files
    // whales/dolphins under order_name "artiodactyla" (the modern Cetartiodactyla
    // merger), but CoL XR still keeps "Cetacea" as its own separate, traditional
    // order label — a node filtering orderNames:["artiodactyla"] would otherwise
    // silently miss all 111 CoL-labeled cetaceans.
    const sql = filterToSql({ csvGroups: ["mammals"], orderNames: ["artiodactyla"] });
    expect(sql).toContain("coalesce(lower(order_name), '') IN ('artiodactyla', 'cetacea')");
  });

  it("excludes orders, also expanding the artiodactyla/cetacea split", () => {
    const sql = filterToSql({ csvGroups: ["mammals"], excludeOrders: ["artiodactyla"] });
    expect(sql).toContain("coalesce(lower(order_name), '') IN ('artiodactyla', 'cetacea')");
  });

  it("includes an order filter, expanding the caprimulgiformes/struthioniformes legacy-lump CoL splits", () => {
    // Verified against real data (2026-07-21): IUCN's assessed.parquet still uses
    // two old lumped bird orders, while CoL uses the finer modern splits (found
    // once Birds gained live order-level drilldown for the first time).
    const caprimulgiformes = filterToSql({ csvGroups: ["birds"], orderNames: ["caprimulgiformes"] });
    expect(caprimulgiformes).toContain("coalesce(lower(order_name), '') IN ('caprimulgiformes', 'apodiformes', 'nyctibiiformes', 'steatornithiformes')");
    const struthioniformes = filterToSql({ csvGroups: ["birds"], orderNames: ["struthioniformes"] });
    expect(struthioniformes).toContain("coalesce(lower(order_name), '') IN ('struthioniformes', 'tinamiformes', 'rheiformes', 'casuariiformes', 'apterygiformes')");
  });

  it("includes an order filter, expanding the pinales/cupressales/araucariales legacy-lump CoL split", () => {
    // Verified against real data (2026-07-21): IUCN's assessed.parquet lumps all
    // conifers under the old "Pinales", while CoL splits Cupressaceae/Taxaceae
    // into "Cupressales" and Podocarpaceae/Araucariaceae into "Araucariales".
    const sql = filterToSql({ csvGroups: ["gymnosperms"], orderNames: ["pinales"] });
    expect(sql).toContain("coalesce(lower(order_name), '') IN ('pinales', 'cupressales', 'araucariales')");
  });

  it("an order with no known CoL split is unaffected", () => {
    const sql = filterToSql({ csvGroups: ["mammals"], orderNames: ["rodentia"] });
    expect(sql).toContain("coalesce(lower(order_name), '') IN ('rodentia')");
    expect(sql).not.toContain("cetacea");
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

describe("canonicalOrderColumnSql", () => {
  it("collapses a known CoL-only order label to its IUCN-canonical form", () => {
    const sql = canonicalOrderColumnSql("order_name");
    expect(sql).toContain("WHEN 'cetacea' THEN 'artiodactyla'");
  });

  it("leaves any other order value as-is (lowercased)", () => {
    const sql = canonicalOrderColumnSql("order_name");
    expect(sql).toMatch(/ELSE lower\(order_name\) END/);
  });

  it("without sciNameCol, skips the species-name override entirely", () => {
    const sql = canonicalOrderColumnSql("order_name");
    expect(sql).not.toContain("sphenodon");
  });

  it("with sciNameCol, collapses a known CoL null-order-name species to its real order", () => {
    // Regression coverage for the Tuataras live-drilldown bug: CoL's Sphenodon
    // punctatus row has a NULL order_name, so a plain GROUP BY put it in
    // "Unclassified Order" instead of "Rhynchocephalia".
    const sql = canonicalOrderColumnSql("order_name", "scientific_name");
    expect(sql).toContain("WHEN lower(scientific_name) = 'sphenodon punctatus' THEN 'rhynchocephalia'");
  });
});

describe("canonicalClassColumnSql", () => {
  it("collapses CoL's finer fish class labels to IUCN's coarser canonical ones", () => {
    // Same category of fix as canonicalOrderColumnSql, one rank up — CoL never
    // literally uses "actinopterygii"/"sarcopterygii"/"chondrichthyes" as a raw
    // class_name (only their finer subdivisions), so a plain GROUP BY class_name
    // would otherwise surface e.g. "Teleostei" as its own misleading "0%
    // assessed" bucket instead of folding into Ray-finned Fishes.
    const sql = canonicalClassColumnSql("class_name");
    expect(sql).toContain("WHEN 'teleostei' THEN 'actinopterygii'");
    expect(sql).toContain("WHEN 'chondrostei' THEN 'actinopterygii'");
    expect(sql).toContain("WHEN 'cladistii' THEN 'actinopterygii'");
    expect(sql).toContain("WHEN 'holostei' THEN 'actinopterygii'");
    expect(sql).toContain("WHEN 'dipneusti' THEN 'sarcopterygii'");
    expect(sql).toContain("WHEN 'coelacanthi' THEN 'sarcopterygii'");
    expect(sql).toContain("WHEN 'elasmobranchii' THEN 'chondrichthyes'");
    expect(sql).toContain("WHEN 'holocephali' THEN 'chondrichthyes'");
  });

  it("leaves any other class value as-is (lowercased)", () => {
    const sql = canonicalClassColumnSql("class_name");
    expect(sql).toMatch(/ELSE lower\(class_name\) END/);
  });
});
