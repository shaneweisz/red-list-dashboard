import { describe, it, expect } from "vitest";
import { NODE_INDEX, getAncestors, matchesFilter, speciesMatchesNode } from "@/lib/taxonomy-utils";
import {
  isDynamicNodeId,
  buildDynamicNodeId,
  parseDynamicNodeId,
  nextDynamicRank,
  dynamicNodeFilter,
  dynamicNodeAncestors,
  dynamicNodeDisplayName,
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

describe("dynamicNodeDisplayName", () => {
  it("uses the curated common name when one exists", () => {
    expect(dynamicNodeDisplayName("mammals~order:rodentia")).toBe("Rodents");
  });
  it("falls back to a capitalized scientific name otherwise", () => {
    expect(dynamicNodeDisplayName("mammals~order:zorotypida")).toBe("Zorotypida");
  });
  it("labels an empty-value segment as Unclassified <Rank>", () => {
    expect(dynamicNodeDisplayName("mammals~order:rodentia~family:")).toBe("Unclassified Family");
  });
});
