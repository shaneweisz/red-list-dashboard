import { describe, it, expect } from "vitest";
import { TAXONOMY_TREE, type TaxonomyNode } from "../taxonomy-tree";
import {
  NODE_INDEX,
  PARENT_INDEX,
  findNode,
  getAncestors,
  hasChildren,
  getNodePath,
  matchesFilter,
  speciesMatchesNode,
  getNodeDef,
  getCsvGroupsForNode,
  getViewRootForNode,
} from "@/lib/taxonomy-utils";
import { TAXONOMY_VIEWS } from "../taxonomy-views";

// ─── Helpers ─────────────────────────────────────────────────────────

/** Collect all nodes in the tree (flat). */
function collectNodes(node: TaxonomyNode): TaxonomyNode[] {
  const result = [node];
  if (node.children) {
    for (const child of node.children) {
      result.push(...collectNodes(child));
    }
  }
  return result;
}

const allNodes = collectNodes(TAXONOMY_TREE);

// =============================================================================
// Tree integrity
// =============================================================================

describe("Taxonomy tree integrity", () => {
  it("root node is 'all'", () => {
    expect(TAXONOMY_TREE.id).toBe("all");
    expect(TAXONOMY_TREE.name).toBe("All Species");
  });

  it("every node has a unique ID", () => {
    const ids = allNodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every node has a non-empty name", () => {
    for (const node of allNodes) {
      expect(node.name.length, `${node.id} missing name`).toBeGreaterThan(0);
    }
  });

  it("every node has at least one csvGroup in its filter", () => {
    for (const node of allNodes) {
      expect(
        node.filter.csvGroups.length,
        `${node.id} has no csvGroups`
      ).toBeGreaterThan(0);
    }
  });

  it("every node with estimatedDescribed has a source", () => {
    for (const node of allNodes) {
      if (node.estimatedDescribed && node.estimatedDescribed > 0) {
        expect(
          node.estimatedSource?.length,
          `${node.id} missing estimatedSource`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("no filter has both orderNames and excludeOrders set", () => {
    for (const node of allNodes) {
      const hasInclude = node.filter.orderNames && node.filter.orderNames.length > 0;
      const hasExclude = node.filter.excludeOrders && node.filter.excludeOrders.length > 0;
      expect(
        !!(hasInclude && hasExclude),
        `${node.id} has both orderNames and excludeOrders`
      ).toBe(false);
    }
  });

  it("NODE_INDEX contains all nodes", () => {
    expect(NODE_INDEX.size).toBe(allNodes.length);
    for (const node of allNodes) {
      expect(NODE_INDEX.has(node.id)).toBe(true);
    }
  });

  it("PARENT_INDEX has entries for all non-root nodes", () => {
    for (const node of allNodes) {
      if (node.id === "all") continue;
      expect(PARENT_INDEX.has(node.id), `${node.id} missing from PARENT_INDEX`).toBe(true);
    }
  });
});

// =============================================================================
// Default view contains expected top-level taxa
// =============================================================================

describe("Default view roots", () => {
  const defaultRoots = ["mammalia", "aves", "reptilia", "amphibia", "fishes", "invertebrates", "plantae", "fungi"];

  it("all default view roots exist in the tree", () => {
    for (const id of defaultRoots) {
      expect(findNode(id), `${id} not found in tree`).toBeDefined();
    }
  });

  it("all default view roots have colors", () => {
    for (const id of defaultRoots) {
      const node = findNode(id)!;
      expect(node.color, `${id} missing color`).toBeTruthy();
    }
  });
});

// =============================================================================
// Table 1a groups exist
// =============================================================================

describe("Table 1a groups", () => {
  const table1aGroups = [
    "mammalia", "aves", "reptilia", "amphibia", "fishes",
    "insecta", "arachnida", "mollusca", "crustacea", "corals",
    "other_invertebrates", "velvet_worms", "horseshoe_crabs",
    "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
    "green_algae", "red_algae",
    "mushrooms", "brown_algae",
  ];

  it("all 21 Table 1a groups exist as nodes", () => {
    for (const id of table1aGroups) {
      expect(findNode(id), `${id} not found`).toBeDefined();
    }
  });
});

// =============================================================================
// Mammal and bird subgroups (new)
// =============================================================================

describe("New mammal subgroups", () => {
  const mammalNode = findNode("mammalia");

  it("mammalia has children", () => {
    expect(mammalNode?.children?.length).toBeGreaterThan(0);
  });

  it("all mammal subgroups use mammalia csvGroup", () => {
    for (const child of mammalNode?.children ?? []) {
      expect(child.filter.csvGroups).toEqual(["mammalia"]);
    }
  });

  it("has expected subgroups", () => {
    const ids = new Set(mammalNode?.children?.map(c => c.id) ?? []);
    expect(ids.has("rodents")).toBe(true);
    expect(ids.has("bats")).toBe(true);
    expect(ids.has("primates")).toBe(true);
    expect(ids.has("carnivores")).toBe(true);
    expect(ids.has("whales-dolphins")).toBe(true);
    expect(ids.has("other-mammals")).toBe(true);
  });
});

describe("New bird subgroups", () => {
  const avesNode = findNode("aves");

  it("aves has children", () => {
    expect(avesNode?.children?.length).toBeGreaterThan(0);
  });

  it("all bird subgroups use aves csvGroup", () => {
    for (const child of avesNode?.children ?? []) {
      expect(child.filter.csvGroups).toEqual(["aves"]);
    }
  });

  it("has expected subgroups", () => {
    const ids = new Set(avesNode?.children?.map(c => c.id) ?? []);
    expect(ids.has("songbirds")).toBe(true);
    expect(ids.has("parrots")).toBe(true);
    expect(ids.has("raptors")).toBe(true);
    expect(ids.has("owls")).toBe(true);
    expect(ids.has("other-birds")).toBe(true);
  });
});

// =============================================================================
// Existing subgroups preserved
// =============================================================================

describe("Existing subgroups preserved", () => {
  it("reptilia has lizards-snakes, turtles-tortoises, crocodilians", () => {
    const node = findNode("reptilia")!;
    const ids = node.children!.map(c => c.id);
    expect(ids).toContain("lizards-snakes");
    expect(ids).toContain("turtles-tortoises");
    expect(ids).toContain("crocodilians");
  });

  it("amphibia has frogs-toads, salamanders-newts, caecilians", () => {
    const node = findNode("amphibia")!;
    const ids = node.children!.map(c => c.id);
    expect(ids).toContain("frogs-toads");
    expect(ids).toContain("salamanders-newts");
    expect(ids).toContain("caecilians");
  });

  it("fishes has bony-fish, sharks-rays, jawless-fish", () => {
    const node = findNode("fishes")!;
    const ids = node.children!.map(c => c.id);
    expect(ids).toContain("bony-fish");
    expect(ids).toContain("sharks-rays");
    expect(ids).toContain("jawless-fish");
  });

  it("insecta has beetles, butterflies-moths, other-insects", () => {
    const node = findNode("insecta")!;
    const ids = node.children!.map(c => c.id);
    expect(ids).toContain("beetles");
    expect(ids).toContain("butterflies-moths");
    expect(ids).toContain("other-insects");
  });
});

// =============================================================================
// Utility functions
// =============================================================================

describe("findNode", () => {
  it("returns node for known id", () => {
    const node = findNode("sharks-rays");
    expect(node).toBeDefined();
    expect(node!.name).toBe("Sharks & Rays");
  });

  it("returns undefined for unknown id", () => {
    expect(findNode("nonexistent")).toBeUndefined();
  });
});

describe("getNodeDef", () => {
  it("returns node + parentId for known child", () => {
    const result = getNodeDef("sharks-rays");
    expect(result).not.toBeNull();
    expect(result!.node.name).toBe("Sharks & Rays");
    expect(result!.parentId).toBe("fishes");
  });

  it("returns null for unknown id", () => {
    expect(getNodeDef("nonexistent")).toBeNull();
  });

  it("returns null for root (no parent)", () => {
    expect(getNodeDef("all")).toBeNull();
  });
});

describe("hasChildren", () => {
  it("returns true for expandable nodes", () => {
    expect(hasChildren("mammalia")).toBe(true);
    expect(hasChildren("aves")).toBe(true);
    expect(hasChildren("reptilia")).toBe(true);
    expect(hasChildren("insecta")).toBe(true);
    expect(hasChildren("invertebrates")).toBe(true);
    expect(hasChildren("plantae")).toBe(true);
  });

  it("returns false for leaf nodes", () => {
    expect(hasChildren("arachnida")).toBe(false);
    expect(hasChildren("velvet_worms")).toBe(false);
    expect(hasChildren("green_algae")).toBe(false);
  });
});

describe("getAncestors", () => {
  it("returns ancestors for deeply nested node", () => {
    const ancestors = getAncestors("beetles");
    expect(ancestors).toContain("insecta");
    expect(ancestors).toContain("all");
  });

  it("returns empty array for root", () => {
    expect(getAncestors("all")).toEqual([]);
  });
});

describe("getNodePath", () => {
  it("returns full path from root to node", () => {
    const path = getNodePath("beetles");
    expect(path[0]).toBe("all");
    expect(path[path.length - 1]).toBe("beetles");
    expect(path).toContain("insecta");
  });
});

describe("getCsvGroupsForNode", () => {
  it("returns single group for Table 1a node", () => {
    expect(getCsvGroupsForNode("mammalia")).toEqual(["mammalia"]);
    expect(getCsvGroupsForNode("insecta")).toEqual(["insecta"]);
  });

  it("returns multiple groups for virtual node", () => {
    const groups = getCsvGroupsForNode("invertebrates");
    expect(groups).toContain("insecta");
    expect(groups).toContain("mollusca");
    expect(groups).toContain("crustacea");
  });

  it("returns all 21 groups for 'all'", () => {
    expect(getCsvGroupsForNode("all").length).toBe(21);
  });
});

// =============================================================================
// speciesMatchesNode — orderNames filter
// =============================================================================

describe("speciesMatchesNode – orderNames filter", () => {
  it("matches reptile in squamata to lizards-snakes", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "Squamata" };
    expect(speciesMatchesNode(species, "lizards-snakes")).toBe(true);
  });

  it("rejects reptile in testudines from lizards-snakes", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "Testudines" };
    expect(speciesMatchesNode(species, "lizards-snakes")).toBe(false);
  });

  it("matches reptile in testudines to turtles-tortoises", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "Testudines" };
    expect(speciesMatchesNode(species, "turtles-tortoises")).toBe(true);
  });

  it("matches amphibian anura to frogs-toads", () => {
    const species = { taxon_group: "amphibia", class_name: null, order_name: "Anura" };
    expect(speciesMatchesNode(species, "frogs-toads")).toBe(true);
  });

  it("rejects amphibian from reptilia subgroup (wrong group)", () => {
    const species = { taxon_group: "amphibia", class_name: null, order_name: "Squamata" };
    expect(speciesMatchesNode(species, "lizards-snakes")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesNode — classNames filter
// =============================================================================

describe("speciesMatchesNode – classNames filter", () => {
  it("matches actinopterygii to bony-fish", () => {
    const species = { taxon_group: "fishes", class_name: "Actinopterygii", order_name: null };
    expect(speciesMatchesNode(species, "bony-fish")).toBe(true);
  });

  it("rejects chondrichthyes from bony-fish", () => {
    const species = { taxon_group: "fishes", class_name: "Chondrichthyes", order_name: null };
    expect(speciesMatchesNode(species, "bony-fish")).toBe(false);
  });

  it("matches chondrichthyes to sharks-rays", () => {
    const species = { taxon_group: "fishes", class_name: "Chondrichthyes", order_name: null };
    expect(speciesMatchesNode(species, "sharks-rays")).toBe(true);
  });
});

// =============================================================================
// speciesMatchesNode — excludeOrders filter
// =============================================================================

describe("speciesMatchesNode – excludeOrders filter", () => {
  it("matches insect with unlisted order to other-insects", () => {
    const species = { taxon_group: "insecta", class_name: null, order_name: "Neuroptera" };
    expect(speciesMatchesNode(species, "other-insects")).toBe(true);
  });

  it("rejects insect with excluded order from other-insects", () => {
    const species = { taxon_group: "insecta", class_name: null, order_name: "Coleoptera" };
    expect(speciesMatchesNode(species, "other-insects")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesNode — new mammal/bird subgroups
// =============================================================================

describe("speciesMatchesNode – mammal subgroups", () => {
  it("matches rodent to rodents", () => {
    const species = { taxon_group: "mammalia", class_name: "Mammalia", order_name: "Rodentia" };
    expect(speciesMatchesNode(species, "rodents")).toBe(true);
  });

  it("rejects rodent from bats", () => {
    const species = { taxon_group: "mammalia", class_name: "Mammalia", order_name: "Rodentia" };
    expect(speciesMatchesNode(species, "bats")).toBe(false);
  });

  it("matches bat to bats", () => {
    const species = { taxon_group: "mammalia", class_name: "Mammalia", order_name: "Chiroptera" };
    expect(speciesMatchesNode(species, "bats")).toBe(true);
  });

  it("matches primate to primates", () => {
    const species = { taxon_group: "mammalia", class_name: "Mammalia", order_name: "Primates" };
    expect(speciesMatchesNode(species, "primates")).toBe(true);
  });

  it("matches rare order to other-mammals", () => {
    const species = { taxon_group: "mammalia", class_name: "Mammalia", order_name: "Dermoptera" };
    expect(speciesMatchesNode(species, "other-mammals")).toBe(true);
  });

  it("rejects named order from other-mammals", () => {
    const species = { taxon_group: "mammalia", class_name: "Mammalia", order_name: "Carnivora" };
    expect(speciesMatchesNode(species, "other-mammals")).toBe(false);
  });
});

describe("speciesMatchesNode – bird subgroups", () => {
  it("matches passerine to songbirds", () => {
    const species = { taxon_group: "aves", class_name: "Aves", order_name: "Passeriformes" };
    expect(speciesMatchesNode(species, "songbirds")).toBe(true);
  });

  it("matches parrot to parrots", () => {
    const species = { taxon_group: "aves", class_name: "Aves", order_name: "Psittaciformes" };
    expect(speciesMatchesNode(species, "parrots")).toBe(true);
  });

  it("matches raptor to raptors", () => {
    const species = { taxon_group: "aves", class_name: "Aves", order_name: "Accipitriformes" };
    expect(speciesMatchesNode(species, "raptors")).toBe(true);
  });

  it("matches rare order to other-birds", () => {
    const species = { taxon_group: "aves", class_name: "Aves", order_name: "Coraciiformes" };
    expect(speciesMatchesNode(species, "other-birds")).toBe(true);
  });

  it("rejects named order from other-birds", () => {
    const species = { taxon_group: "aves", class_name: "Aves", order_name: "Passeriformes" };
    expect(speciesMatchesNode(species, "other-birds")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesNode — edge cases
// =============================================================================

describe("speciesMatchesNode – edge cases", () => {
  it("returns true for unknown node id (no filtering)", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: null };
    expect(speciesMatchesNode(species, "nonexistent-subgroup")).toBe(true);
  });

  it("handles null class_name with classNames filter (no match)", () => {
    const species = { taxon_group: "fishes", class_name: null, order_name: null };
    expect(speciesMatchesNode(species, "bony-fish")).toBe(false);
  });

  it("case-insensitive matching on class_name", () => {
    const species = { taxon_group: "fishes", class_name: "CHONDRICHTHYES", order_name: null };
    expect(speciesMatchesNode(species, "sharks-rays")).toBe(true);
  });

  it("case-insensitive matching on order_name", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "SQUAMATA" };
    expect(speciesMatchesNode(species, "lizards-snakes")).toBe(true);
  });
});

// =============================================================================
// speciesMatchesNode — class_name fallback for orderNames
// =============================================================================

describe("speciesMatchesNode – class_name fallback when order_name is empty", () => {
  it("matches reptile with class_name=squamata and empty order_name to lizards-snakes", () => {
    const species = { taxon_group: "reptilia", class_name: "squamata", order_name: "" };
    expect(speciesMatchesNode(species, "lizards-snakes")).toBe(true);
  });

  it("matches reptile with class_name=testudines and empty order_name to turtles-tortoises", () => {
    const species = { taxon_group: "reptilia", class_name: "testudines", order_name: "" };
    expect(speciesMatchesNode(species, "turtles-tortoises")).toBe(true);
  });

  it("does not use fallback when order_name is populated", () => {
    const species = { taxon_group: "reptilia", class_name: "testudines", order_name: "squamata" };
    expect(speciesMatchesNode(species, "lizards-snakes")).toBe(true);
    expect(speciesMatchesNode(species, "turtles-tortoises")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesNode — class_name fallback for excludeOrders
// =============================================================================

describe("speciesMatchesNode – class_name fallback for excludeOrders", () => {
  it("excludes species when class_name matches an excluded order and order_name is empty", () => {
    const species = { taxon_group: "insecta", class_name: "coleoptera", order_name: "" };
    expect(speciesMatchesNode(species, "other-insects")).toBe(false);
  });

  it("does not exclude when class_name is not in the exclude list", () => {
    const species = { taxon_group: "insecta", class_name: "some-class", order_name: "" };
    expect(speciesMatchesNode(species, "other-insects")).toBe(true);
  });
});

// =============================================================================
// matchesFilter — families filter (new for cetaceans)
// =============================================================================

describe("matchesFilter – families filter", () => {
  it("matches species with family in include list", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Delphinidae" };
    const filter = { csvGroups: ["mammalia"], orderNames: ["artiodactyla", "sirenia"], families: ["delphinidae", "trichechidae", "dugongidae"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });

  it("rejects species with family not in include list", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae" };
    const filter = { csvGroups: ["mammalia"], orderNames: ["artiodactyla", "sirenia"], families: ["delphinidae", "trichechidae", "dugongidae"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("excludeFamilies rejects matching family", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Delphinidae" };
    const filter = { csvGroups: ["mammalia"], orderNames: ["artiodactyla"], excludeFamilies: ["delphinidae", "ziphiidae"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("excludeFamilies passes non-matching family", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae" };
    const filter = { csvGroups: ["mammalia"], orderNames: ["artiodactyla"], excludeFamilies: ["delphinidae", "ziphiidae"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });
});

// =============================================================================
// matchesFilter — excludeClasses filter (new for other_invertebrates catch-all)
// =============================================================================

describe("matchesFilter – excludeClasses filter", () => {
  it("excludes species with class in exclude list", () => {
    const row = { class_name: "Echinoidea", order_name: null };
    const filter = { csvGroups: ["other_invertebrates"], excludeClasses: ["asteroidea", "echinoidea", "holothuroidea"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("passes species with class not in exclude list", () => {
    const row = { class_name: "Bivalvia", order_name: null };
    const filter = { csvGroups: ["other_invertebrates"], excludeClasses: ["asteroidea", "echinoidea", "holothuroidea"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });

  it("passes species with null class_name", () => {
    const row = { class_name: null, order_name: null };
    const filter = { csvGroups: ["other_invertebrates"], excludeClasses: ["asteroidea", "echinoidea"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });
});

// =============================================================================
// Partition coverage
// =============================================================================

describe("Subgroup partition coverage", () => {
  it("reptilia subgroups cover all common orders without overlap", () => {
    const subs = findNode("reptilia")!.children!;
    const allOrders = subs.flatMap(sg => sg.filter.orderNames ?? []);
    expect(new Set(allOrders).size).toBe(allOrders.length);
  });

  it("amphibia subgroups cover all common orders without overlap", () => {
    const subs = findNode("amphibia")!.children!;
    const allOrders = subs.flatMap(sg => sg.filter.orderNames ?? []);
    expect(new Set(allOrders).size).toBe(allOrders.length);
  });

  it("fishes subgroups cover distinct classes", () => {
    const subs = findNode("fishes")!.children!;
    const allClasses = subs.flatMap(sg => sg.filter.classNames ?? []);
    expect(new Set(allClasses).size).toBe(allClasses.length);
  });

  it("insect subgroups: named orders match other-insects excludeOrders", () => {
    const subs = findNode("insecta")!.children!;
    const otherInsects = subs.find(sg => sg.id === "other-insects")!;
    const namedOrders = subs
      .filter(sg => sg.id !== "other-insects")
      .flatMap(sg => sg.filter.orderNames ?? []);
    expect([...namedOrders].sort()).toEqual([...otherInsects.filter.excludeOrders!].sort());
  });

  it("flowering_plants: named orders match other-flowering-plants excludeOrders", () => {
    const subs = findNode("flowering_plants")!.children!;
    const otherFlowering = subs.find(sg => sg.id === "other-flowering-plants")!;
    const namedOrders = subs
      .filter(sg => sg.id !== "other-flowering-plants")
      .flatMap(sg => sg.filter.orderNames ?? []);
    expect([...namedOrders].sort()).toEqual([...otherFlowering.filter.excludeOrders!].sort());
  });

  it("fungi subgroups partition the mushrooms group", () => {
    const subs = findNode("mushrooms")!.children!;
    expect(subs).toHaveLength(2);
    const included = subs[0].filter.orderNames ?? [];
    const excluded = subs[1].filter.excludeOrders ?? [];
    expect([...included].sort()).toEqual([...excluded].sort());
  });

  it("mammal subgroups: named orders match other-mammals excludeOrders", () => {
    const subs = findNode("mammalia")!.children!;
    const otherMammals = subs.find(sg => sg.id === "other-mammals")!;
    const namedOrders = subs
      .filter(sg => sg.id !== "other-mammals")
      .flatMap(sg => sg.filter.orderNames ?? []);
    // De-duplicate since some orders appear in multiple subgroups (artiodactyla in both ungulates and whales)
    expect([...new Set(namedOrders)].sort()).toEqual([...otherMammals.filter.excludeOrders!].sort());
  });

  it("bird subgroups: named orders match other-birds excludeOrders", () => {
    const subs = findNode("aves")!.children!;
    const otherBirds = subs.find(sg => sg.id === "other-birds")!;
    const namedOrders = subs
      .filter(sg => sg.id !== "other-birds")
      .flatMap(sg => sg.filter.orderNames ?? []);
    expect([...new Set(namedOrders)].sort()).toEqual([...otherBirds.filter.excludeOrders!].sort());
  });
});

// ─── Default view: no double counting ────────────────────────────────

describe("default view CSV group coverage", () => {
  const defaultRoots = TAXONOMY_VIEWS.default.roots;

  it("no CSV group appears in multiple default view roots", () => {
    const seen = new Map<string, string>(); // csvGroup → rootId
    for (const rootId of defaultRoots) {
      const node = findNode(rootId)!;
      for (const csv of node.filter.csvGroups) {
        expect(seen.has(csv), `"${csv}" is in both "${seen.get(csv)}" and "${rootId}"`).toBe(false);
        seen.set(csv, rootId);
      }
    }
  });

  it("all 21 Table 1a CSV groups are covered by exactly one default view root", () => {
    const allCsvGroups = new Set<string>();
    for (const rootId of defaultRoots) {
      for (const csv of findNode(rootId)!.filter.csvGroups) {
        allCsvGroups.add(csv);
      }
    }
    expect(allCsvGroups.size).toBe(21);
  });

  it("brown_algae is in fungi, not plantae", () => {
    expect(findNode("fungi")!.filter.csvGroups).toContain("brown_algae");
    expect(findNode("plantae")!.filter.csvGroups).not.toContain("brown_algae");
  });
});

// ─── prefixTree: virtual nodes mirror canonical nodes ─────────────────

describe("prefixTree virtual nodes", () => {
  const prefixPairs: [string, string][] = [
    ["insecta", "inv-insecta"],
    ["mollusca", "inv-mollusca"],
    ["flowering_plants", "pl-flowering_plants"],
    ["mushrooms", "fu-mushrooms"],
    ["brown_algae", "fu-brown_algae"],
  ];

  for (const [canonicalId, prefixedId] of prefixPairs) {
    it(`${prefixedId} mirrors ${canonicalId}`, () => {
      const canonical = findNode(canonicalId)!;
      const prefixed = findNode(prefixedId)!;
      expect(prefixed.name).toBe(canonical.name);
      expect(prefixed.filter).toEqual(canonical.filter);
      expect(prefixed.estimatedDescribed).toBe(canonical.estimatedDescribed);
    });
  }

  it("prefixed children have prefixed IDs recursively", () => {
    const invInsecta = findNode("inv-insecta")!;
    expect(invInsecta.children).toBeDefined();
    for (const child of invInsecta.children!) {
      expect(child.id).toMatch(/^inv-/);
    }
  });

  it("prefixed nodes are in NODE_INDEX", () => {
    expect(NODE_INDEX.has("inv-beetles")).toBe(true);
    expect(NODE_INDEX.has("pl-orchids-lilies-bulbs")).toBe(true);
    expect(NODE_INDEX.has("fu-moulds-yeasts-cup")).toBe(true);
  });
});

// ─── Table 1a click-through: every group maps to a view root child ────

describe("Table 1a → default view mapping", () => {
  const defaultRoots = new Set(TAXONOMY_VIEWS.default.roots);
  const table1aGroups = TAXONOMY_VIEWS.table1a.roots;

  for (const group of table1aGroups) {
    it(`${group} maps to a default view root or its child`, () => {
      if (defaultRoots.has(group)) return; // direct root, fine

      let found = false;
      for (const rootId of defaultRoots) {
        const rootNode = findNode(rootId)!;
        const match = rootNode.children?.find(c =>
          c.filter.csvGroups.length === 1 && c.filter.csvGroups[0] === group
        ) ?? rootNode.children?.find(c =>
          c.filter.csvGroups.includes(group)
        );
        if (match) { found = true; break; }
      }
      expect(found, `${group} has no matching child under any default view root`).toBe(true);
    });
  }
});

// ─── Precomputed summaries structure ──────────────────────────────────

describe("node-children-summaries.json", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const data = JSON.parse(
    require("fs").readFileSync(
      require("path").join(process.cwd(), "data/node-children-summaries.json"),
      "utf-8"
    )
  );

  it("has entries for all parent nodes in the tree", () => {
    for (const [id] of NODE_INDEX) {
      if (!hasChildren(id)) continue;
      expect(data[id], `missing precomputed entry for parent "${id}"`).toBeDefined();
    }
  });

  it("child IDs match the tree structure", () => {
    for (const [id, node] of NODE_INDEX) {
      if (!node.children) continue;
      const treeChildIds = node.children.map(c => c.id);
      const dataChildIds = (data[id] ?? []).map((c: { id: string }) => c.id);
      expect(dataChildIds).toEqual(treeChildIds);
    }
  });

  it("summaries have valid shapes", () => {
    for (const children of Object.values(data) as Array<Array<Record<string, unknown>>>) {
      for (const child of children) {
        expect(typeof child.id).toBe("string");
        expect(typeof child.totalAssessed).toBe("number");
        expect(typeof child.outdated).toBe("number");
        expect(typeof child.gbifNeSpeciesCount).toBe("number");
        expect((child.totalAssessed as number)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
