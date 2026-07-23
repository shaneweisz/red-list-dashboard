import { describe, it, expect } from "vitest";
import {
  NODE_INDEX, getAncestors, matchesFilter, speciesMatchesNode,
  expandTaxaToken, collapseTaxaToTokens, getViewRootForNode,
} from "@/lib/taxonomy-utils";
import {
  isDynamicNodeId,
  buildDynamicNodeId,
  parseDynamicNodeId,
  nextDynamicRank,
  dynamicNodeFilter,
  dynamicNodeAncestors,
  dynamicNodeDisplayName,
  dynamicNodeMatchValue,
  setVernacularNames,
  DYNAMIC_DRILLDOWN_ROOTS,
} from "@/lib/dynamic-taxon";

describe("dynamic node id round-trip", () => {
  it("build -> parse is identity", () => {
    const segments = [
      { rank: "order" as const, value: "rodentia" },
      { rank: "family" as const, value: "muridae" },
    ];
    const id = buildDynamicNodeId("mammals", segments);
    expect(id).toBe("mammals~order:rodentia~family:muridae");
    expect(parseDynamicNodeId(id)).toEqual({ rootId: "mammals", segments });
  });

  it("a bare root id (no ~) is not dynamic", () => {
    expect(isDynamicNodeId("mammals")).toBe(false);
    expect(parseDynamicNodeId("mammals")).toBeNull();
  });

  it("a malformed segment (missing colon) fails to parse", () => {
    expect(parseDynamicNodeId("mammals~order")).toBeNull();
  });

  it("an unknown rank fails to parse", () => {
    expect(parseDynamicNodeId("mammals~phylum:chordata")).toBeNull();
  });

  it("never collides with a real static NODE_INDEX id", () => {
    for (const id of NODE_INDEX.keys()) {
      expect(isDynamicNodeId(id)).toBe(false);
    }
  });
});

describe("nextDynamicRank", () => {
  it("a bare root's next rank is order", () => {
    expect(nextDynamicRank("mammals")).toBe("order");
  });
  it("an order node's next rank is family", () => {
    expect(nextDynamicRank("mammals~order:rodentia")).toBe("family");
  });
  it("a family node's next rank is genus", () => {
    expect(nextDynamicRank("mammals~order:rodentia~family:muridae")).toBe("genus");
  });
  it("a genus node has no further rank (a leaf)", () => {
    expect(nextDynamicRank("mammals~order:rodentia~family:muridae~genus:mus")).toBeNull();
  });

  it("fishes is the one root that starts at class (Ray-finned/Lobe-finned/Sharks & Rays), not order", () => {
    expect(nextDynamicRank("fishes")).toBe("class");
    expect(nextDynamicRank("fishes~class:actinopterygii")).toBe("order");
    expect(nextDynamicRank("fishes~class:actinopterygii~order:cypriniformes")).toBe("family");
  });

  it("other roots are unaffected by fishes' class-first override", () => {
    expect(nextDynamicRank("birds")).toBe("order");
    expect(nextDynamicRank("reptiles")).toBe("order");
  });

  // Molluscs/Crustaceans/Other Invertebrates joined fishes on the class-first
  // rank order (2026-07-22) — CoL's order_name has a large real coverage gap
  // for these three specifically, while class_name is nearly fully populated.
  // Both the bare and "inv-"-prefixed ids need the override (DYNAMIC_DRILLDOWN_
  // ROOTS lists both forms for every non-fishes root — see that set's own doc
  // comment for why), which is exactly the kind of pairing this PR's own
  // review flagged as easy to half-wire (this test would have caught it: the
  // bare id alone was initially added to ROOT_RANK_ORDER without its "inv-"
  // twin during development).
  it("Molluscs/Crustaceans/Other Invertebrates also start at class, both bare and inv-prefixed forms", () => {
    for (const root of ["molluscs", "inv-molluscs", "crustaceans", "inv-crustaceans", "other_invertebrates", "inv-other_invertebrates"]) {
      expect(nextDynamicRank(root), `${root} should start at class`).toBe("class");
    }
  });

  // Structural consistency check: every DYNAMIC_DRILLDOWN_ROOTS member must
  // resolve to SOME real first rank — guards against a root being registered
  // as live-drillable (making its row show a chevron in the UI) without a
  // working rank chain behind it, which would silently return no children at
  // all rather than a helpful error.
  it("every DYNAMIC_DRILLDOWN_ROOTS member has a real (non-null) first rank", () => {
    for (const root of DYNAMIC_DRILLDOWN_ROOTS) {
      const rank = nextDynamicRank(root);
      expect(rank, `${root} has no first rank`).not.toBeNull();
      expect(["class", "order"]).toContain(rank);
    }
  });
});

describe("dynamicNodeFilter", () => {
  it("inherits the root's csvGroups and ANDs in each segment's rank", () => {
    const filter = dynamicNodeFilter("mammals~order:rodentia~family:muridae");
    expect(filter).toEqual({
      csvGroups: NODE_INDEX.get("mammals")!.filter.csvGroups,
      orderNames: ["rodentia"],
      families: ["muridae"],
    });
  });

  it("returns null for an unknown root", () => {
    expect(dynamicNodeFilter("not-a-real-root~order:rodentia")).toBeNull();
  });

  it("a class segment (fishes) ANDs in classNames", () => {
    const filter = dynamicNodeFilter("fishes~class:actinopterygii");
    expect(filter).toEqual({
      csvGroups: NODE_INDEX.get("fishes")!.filter.csvGroups,
      classNames: ["actinopterygii"],
    });
  });

  it("an empty-string segment value matches a null/blank row via matchesFilter's existing coalesce behavior", () => {
    const filter = dynamicNodeFilter("mammals~order:rodentia~family:")!;
    const rowWithNullFamily = { class_name: "mammalia", order_name: "rodentia", family: null, scientific_name: "Mus musculus", taxon_group: "mammals" };
    const rowWithRealFamily = { class_name: "mammalia", order_name: "rodentia", family: "muridae", scientific_name: "Mus musculus", taxon_group: "mammals" };
    expect(matchesFilter(rowWithNullFamily, filter)).toBe(true);
    expect(matchesFilter(rowWithRealFamily, filter)).toBe(false);
  });
});

describe("dynamicNodeAncestors", () => {
  it("matches getAncestors's contract: immediate parent up to root, exclusive of self, then the real ancestor chain", () => {
    const id = "mammals~order:rodentia~family:muridae";
    expect(dynamicNodeAncestors(id)).toEqual([
      "mammals~order:rodentia",
      "mammals",
      ...getAncestors("mammals"),
    ]);
  });

  it("a single-segment dynamic node's only dynamic ancestor is the root itself", () => {
    expect(dynamicNodeAncestors("mammals~order:rodentia")).toEqual(["mammals", ...getAncestors("mammals")]);
  });
});

describe("speciesMatchesNode with a dynamic node id", () => {
  // Regression coverage for the real correctness bug this session fixed:
  // speciesMatchesNode used to do `if (!node) return true` for ANY id not in
  // NODE_INDEX, which — before dynamic ids existed — was a safe "don't filter"
  // default. Once dynamic ids became a real, expected input, that default would
  // silently show every species in the csvGroup regardless of the selected
  // order/family/genus. These tests fail loudly if that regresses.
  const rodent = { taxon_group: "mammals", class_name: "mammalia", order_name: "rodentia", family: "muridae", scientific_name: "Mus musculus" };
  const bat = { taxon_group: "mammals", class_name: "mammalia", order_name: "chiroptera", family: "vespertilionidae", scientific_name: "Myotis myotis" };
  const differentGroup = { taxon_group: "reptiles", class_name: "reptilia", order_name: "rodentia", family: "muridae", scientific_name: "Not a real rodent" };

  it("matches a species under the selected order, rejects a sibling order", () => {
    expect(speciesMatchesNode(rodent, "mammals~order:rodentia")).toBe(true);
    expect(speciesMatchesNode(bat, "mammals~order:rodentia")).toBe(false);
  });

  it("narrows further at family rank", () => {
    expect(speciesMatchesNode(rodent, "mammals~order:rodentia~family:muridae")).toBe(true);
    expect(speciesMatchesNode(rodent, "mammals~order:rodentia~family:sciuridae")).toBe(false);
  });

  it("still requires csvGroup membership even if rank values happen to match", () => {
    expect(speciesMatchesNode(differentGroup, "mammals~order:rodentia")).toBe(false);
  });

  it("a genuinely unknown, non-dynamic id still falls back to 'don't filter' (unchanged legacy behavior)", () => {
    expect(speciesMatchesNode(rodent, "this-id-does-not-exist-anywhere")).toBe(true);
  });
});

describe("taxonomy-utils integration: getAncestors/getViewRootForNode with a dynamic id", () => {
  it("getAncestors returns the dynamic ancestor chain then the root's real ancestors", () => {
    const id = "mammals~order:rodentia~family:muridae";
    expect(getAncestors(id)).toEqual([
      "mammals~order:rodentia",
      "mammals",
      ...getAncestors("mammals"),
    ]);
  });

  it("getViewRootForNode resolves a dynamic id to its real display root", () => {
    expect(getViewRootForNode("mammals~order:rodentia~family:muridae")).toBe("mammals");
  });
});

describe("URL token round-trip for a dynamic id (deep-link support)", () => {
  it("expandTaxaToken resolves a dynamic token straight to its root + itself as subgroup", () => {
    const id = "mammals~order:rodentia~family:muridae";
    expect(expandTaxaToken(id)).toEqual({ taxa: "mammals", subgroup: id });
  });

  it("collapseTaxaToTokens emits the dynamic id as its own token and drops the redundant root", () => {
    const id = "mammals~order:rodentia";
    const tokens = collapseTaxaToTokens(["mammals"], [id]);
    expect(tokens).toEqual([id]);
  });

  it("round-trips: collapse then expand recovers the original selection", () => {
    const id = "mammals~order:rodentia~family:muridae~genus:mus";
    const [token] = collapseTaxaToTokens(["mammals"], [id]);
    expect(expandTaxaToken(token)).toEqual({ taxa: "mammals", subgroup: id });
  });

  // Regression: a dynamic id whose OWN root segment happens to start with one of
  // the pl-/inv-/fu- virtual-view-group prefixes (reached by drilling into a
  // virtual-group child like Flowering Plants, Corals, Mushrooms) used to have
  // that prefix silently stripped by collapseTaxaToTokens' blanket
  // stripNodePrefix(sg) call — stripNodePrefix is only correct for a STATIC id's
  // URL-token form (inv-corals -> corals), not for a dynamic id, which round-
  // trips through the URL as itself. That made the id unstable across any URL
  // rewrite for an unrelated reason (e.g. toggling the Assessed/Not Evaluated
  // view mode calls setUrlViewMode, which re-serializes the whole taxa list) —
  // "pl-flowering_plants~order:malpighiales" silently became
  // "flowering_plants~order:malpighiales", a DIFFERENT dynamic id as far as
  // anything keyed on the original root string is concerned (reported: an
  // ancestor breadcrumb row's cached data went missing after toggling view mode,
  // since TaxaSummary.tsx's subgroupData cache was keyed by the now-stale prefixed
  // root and never populated under the new bare one).
  it("preserves a dynamic id's own pl-/inv-/fu- root prefix through a collapse (does not strip it like a static id's token)", () => {
    const id = "pl-flowering_plants~order:malpighiales";
    const tokens = collapseTaxaToTokens(["plantae"], [id]);
    expect(tokens).toEqual([id]);
  });

  it("round-trips a prefixed-root dynamic id through repeated collapse+expand cycles unchanged (simulates toggling view mode, which re-serializes the URL)", () => {
    const id = "pl-flowering_plants~order:malpighiales";
    const [token1] = collapseTaxaToTokens(["plantae"], [id]);
    const { taxa, subgroup } = expandTaxaToken(token1);
    const [token2] = collapseTaxaToTokens([taxa], [subgroup!]);
    expect(token2).toBe(id);
  });
});

describe("dynamicNodeDisplayName", () => {
  it("shows 'Scientific name (Common name)' when a curated common name exists", () => {
    expect(dynamicNodeDisplayName("mammals~order:rodentia")).toBe("Rodentia (Rodents)");
  });
  it("falls back to just the capitalized scientific name when no common name is known", () => {
    expect(dynamicNodeDisplayName("mammals~order:zorotypida")).toBe("Zorotypida");
  });
  it("labels an empty-value segment as Unclassified <Rank>", () => {
    expect(dynamicNodeDisplayName("mammals~order:rodentia~family:")).toBe("Unclassified Family");
  });
  it("prefers the curated COMMON_NAME_BY_VALUE override over a CoL-derived vernacular name", () => {
    setVernacularNames({ rodentia: "Some CoL Phrasing" });
    expect(dynamicNodeDisplayName("mammals~order:rodentia")).toBe("Rodentia (Rodents)");
    setVernacularNames({}); // reset for other tests
  });
  it("falls back to a CoL-derived vernacular name when there's no curated override", () => {
    setVernacularNames({ zorotypida: "Angel Insects" });
    expect(dynamicNodeDisplayName("mammals~order:zorotypida")).toBe("Zorotypida (Angel Insects)");
    setVernacularNames({}); // reset for other tests
  });
});

describe("dynamicNodeMatchValue", () => {
  // Regression coverage: live-breakdown.ts's getLiveBreakdown used to pass
  // dynamicNodeDisplayName's "Scientific name (Common name)" string as a
  // BreakdownEntry's `name`, which matchesBreakdownName then compared against a
  // species row's raw family/order_name/etc. column — "muridae (mice)" never
  // equals "muridae", so the species-list click-through silently returned zero
  // species for any bucket with a known common name. dynamicNodeMatchValue is
  // the fix: the raw, lowercase, matchable value alone.
  it("returns the raw lowercase scientific value regardless of any known common name", () => {
    expect(dynamicNodeMatchValue("mammals~order:rodentia")).toBe("rodentia");
    expect(dynamicNodeMatchValue("mammals~order:rodentia~family:muridae")).toBe("muridae");
  });
  it("returns '' for an empty-value (Unclassified) segment", () => {
    expect(dynamicNodeMatchValue("mammals~order:rodentia~family:")).toBe("");
  });
});
