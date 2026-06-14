import fs from "fs";
import path from "path";
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
  const defaultRoots = ["mammals", "birds", "reptiles", "amphibians", "fishes", "invertebrates", "plantae", "fungi"];

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
    "mammals", "birds", "reptiles", "amphibians", "fishes",
    "insecta", "arachnids", "molluscs", "crustaceans", "corals",
    "other_invertebrates", "velvet_worms", "horseshoe_crabs",
    "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
    "green_algae", "red_algae",
    "mushrooms", "brown_algae",
  ];

  it("all 21 Table 1a group nodes exist (Insects is one node aggregating 8 order groups)", () => {
    for (const id of table1aGroups) {
      expect(findNode(id), `${id} not found`).toBeDefined();
    }
  });
});

// =============================================================================
// Mammal subgroups (new)
// =============================================================================

describe("New mammal subgroups", () => {
  const mammalNode = findNode("mammals");

  it("mammalia has children", () => {
    expect(mammalNode?.children?.length).toBeGreaterThan(0);
  });

  it("all mammal subgroups use mammalia csvGroup", () => {
    for (const child of mammalNode?.children ?? []) {
      expect(child.filter.csvGroups).toEqual(["mammals"]);
    }
  });

  it("has expected subgroups", () => {
    const ids = new Set(mammalNode?.children?.map(c => c.id) ?? []);
    expect(ids.has("rodents")).toBe(true);
    expect(ids.has("bats")).toBe(true);
    expect(ids.has("eulipotyphla")).toBe(true);
    expect(ids.has("primates")).toBe(true);
    expect(ids.has("carnivores")).toBe(true);
    expect(ids.has("artiodactyls")).toBe(true);
    expect(ids.has("sirenians")).toBe(true);
    expect(ids.has("other-mammals")).toBe(true);
  });

  it("does not contain the old polyphyletic/paraphyletic groupings", () => {
    const ids = new Set(mammalNode?.children?.map(c => c.id) ?? []);
    expect(ids.has("insectivores")).toBe(false);
    expect(ids.has("whales-dolphins")).toBe(false);
    expect(ids.has("even-toed-ungulates")).toBe(false);
  });
});

describe("Aves is a leaf (no drill-down)", () => {
  it("aves has no children", () => {
    const avesNode = findNode("birds");
    expect(avesNode).toBeDefined();
    expect(avesNode?.children).toBeUndefined();
  });
});

// =============================================================================
// Existing subgroups preserved
// =============================================================================

describe("Existing subgroups preserved", () => {
  it("reptilia has squamates, turtles-tortoises, crocodilians, tuataras", () => {
    const node = findNode("reptiles")!;
    const ids = node.children!.map(c => c.id);
    expect(ids).toContain("squamates");
    expect(ids).toContain("turtles-tortoises");
    expect(ids).toContain("crocodilians");
    expect(ids).toContain("tuataras");
  });

  it("amphibia has frogs-toads, salamanders-newts, caecilians", () => {
    const node = findNode("amphibians")!;
    const ids = node.children!.map(c => c.id);
    expect(ids).toContain("frogs-toads");
    expect(ids).toContain("salamanders-newts");
    expect(ids).toContain("caecilians");
  });

  it("fishes has ray-finned-fishes, lobe-finned-fishes, sharks-rays, jawless-fish", () => {
    const node = findNode("fishes")!;
    const ids = node.children!.map(c => c.id);
    expect(ids).toContain("ray-finned-fishes");
    expect(ids).toContain("lobe-finned-fishes");
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
    expect(hasChildren("mammals")).toBe(true);
    expect(hasChildren("reptiles")).toBe(true);
    expect(hasChildren("insecta")).toBe(true);
    expect(hasChildren("invertebrates")).toBe(true);
    expect(hasChildren("plantae")).toBe(true);
  });

  it("returns false for leaf nodes", () => {
    expect(hasChildren("birds")).toBe(false);
    expect(hasChildren("arachnids")).toBe(false);
    expect(hasChildren("velvet_worms")).toBe(false);
    expect(hasChildren("horseshoe_crabs")).toBe(false);
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
  it("returns single group for Table 1a leaf node", () => {
    expect(getCsvGroupsForNode("mammals")).toEqual(["mammals"]);
    expect(getCsvGroupsForNode("beetles")).toEqual(["beetles"]);
  });

  it("returns the 8 order groups for the insecta parent node", () => {
    const groups = getCsvGroupsForNode("insecta");
    expect(groups).toContain("beetles");
    expect(groups).toContain("other_insects");
    expect(groups.length).toBe(8);
  });

  it("returns multiple groups for virtual node", () => {
    const groups = getCsvGroupsForNode("invertebrates");
    expect(groups).toContain("beetles");
    expect(groups).toContain("molluscs");
    expect(groups).toContain("crustaceans");
  });

  it("returns all 28 groups for 'all'", () => {
    expect(getCsvGroupsForNode("all").length).toBe(28);
  });
});

// =============================================================================
// speciesMatchesNode — orderNames filter
// =============================================================================

describe("speciesMatchesNode – orderNames filter", () => {
  it("matches reptile in squamata to squamates", () => {
    const species = { taxon_group: "reptiles", class_name: null, order_name: "Squamata" };
    expect(speciesMatchesNode(species, "squamates")).toBe(true);
  });

  it("rejects reptile in testudines from squamates", () => {
    const species = { taxon_group: "reptiles", class_name: null, order_name: "Testudines" };
    expect(speciesMatchesNode(species, "squamates")).toBe(false);
  });

  it("matches reptile in testudines to turtles-tortoises", () => {
    const species = { taxon_group: "reptiles", class_name: null, order_name: "Testudines" };
    expect(speciesMatchesNode(species, "turtles-tortoises")).toBe(true);
  });

  it("matches amphibian anura to frogs-toads", () => {
    const species = { taxon_group: "amphibians", class_name: null, order_name: "Anura" };
    expect(speciesMatchesNode(species, "frogs-toads")).toBe(true);
  });

  it("rejects amphibian from reptilia subgroup (wrong group)", () => {
    const species = { taxon_group: "amphibians", class_name: null, order_name: "Squamata" };
    expect(speciesMatchesNode(species, "squamates")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesNode — classNames filter
// =============================================================================

describe("speciesMatchesNode – classNames filter", () => {
  it("matches actinopterygii to ray-finned-fishes", () => {
    const species = { taxon_group: "fishes", class_name: "Actinopterygii", order_name: null };
    expect(speciesMatchesNode(species, "ray-finned-fishes")).toBe(true);
  });

  it("rejects chondrichthyes from ray-finned-fishes", () => {
    const species = { taxon_group: "fishes", class_name: "Chondrichthyes", order_name: null };
    expect(speciesMatchesNode(species, "ray-finned-fishes")).toBe(false);
  });

  it("matches chondrichthyes to sharks-rays", () => {
    const species = { taxon_group: "fishes", class_name: "Chondrichthyes", order_name: null };
    expect(speciesMatchesNode(species, "sharks-rays")).toBe(true);
  });

  it("matches sarcopterygii to lobe-finned-fishes, not ray-finned-fishes", () => {
    const species = { taxon_group: "fishes", class_name: "Sarcopterygii", order_name: null };
    expect(speciesMatchesNode(species, "lobe-finned-fishes")).toBe(true);
    expect(speciesMatchesNode(species, "ray-finned-fishes")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesNode — excludeOrders filter
// =============================================================================

describe("speciesMatchesNode – insect subgroups (csvGroup-based)", () => {
  // Insects are split into per-order CSV groups, so subgroup matching is by
  // taxon_group (the CSV group), not an order_name filter.
  it("matches species in the other_insects group to other-insects", () => {
    const species = { taxon_group: "other_insects", class_name: null, order_name: "Neuroptera" };
    expect(speciesMatchesNode(species, "other-insects")).toBe(true);
  });

  it("rejects a beetle from other-insects", () => {
    const species = { taxon_group: "beetles", class_name: null, order_name: "Coleoptera" };
    expect(speciesMatchesNode(species, "other-insects")).toBe(false);
  });

  it("matches a beetle to the beetles node", () => {
    const species = { taxon_group: "beetles", class_name: null, order_name: "Coleoptera" };
    expect(speciesMatchesNode(species, "beetles")).toBe(true);
  });
});

// =============================================================================
// speciesMatchesNode — mammal subgroups
// =============================================================================

describe("speciesMatchesNode – mammal subgroups", () => {
  it("matches rodent to rodents", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Rodentia" };
    expect(speciesMatchesNode(species, "rodents")).toBe(true);
  });

  it("rejects rodent from bats", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Rodentia" };
    expect(speciesMatchesNode(species, "bats")).toBe(false);
  });

  it("matches bat to bats", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Chiroptera" };
    expect(speciesMatchesNode(species, "bats")).toBe(true);
  });

  it("matches primate to primates", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Primates" };
    expect(speciesMatchesNode(species, "primates")).toBe(true);
  });

  it("matches eulipotyphlan (shrew) to eulipotyphla, not other-mammals", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Eulipotyphla" };
    expect(speciesMatchesNode(species, "eulipotyphla")).toBe(true);
    expect(speciesMatchesNode(species, "other-mammals")).toBe(false);
  });

  it("matches tenrec (Afrosoricida) to other-mammals (no longer lumped with Eulipotyphla)", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Afrosoricida" };
    expect(speciesMatchesNode(species, "other-mammals")).toBe(true);
    expect(speciesMatchesNode(species, "eulipotyphla")).toBe(false);
  });

  it("matches elephant shrew (Macroscelidea) to other-mammals", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Macroscelidea" };
    expect(speciesMatchesNode(species, "other-mammals")).toBe(true);
  });

  it("matches cetacean to artiodactyls (Cetartiodactyla) and not sirenians", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Artiodactyla", family: "Delphinidae" };
    expect(speciesMatchesNode(species, "artiodactyls")).toBe(true);
    expect(speciesMatchesNode(species, "sirenians")).toBe(false);
  });

  it("matches cow (Artiodactyla, Bovidae) to artiodactyls", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae" };
    expect(speciesMatchesNode(species, "artiodactyls")).toBe(true);
  });

  it("matches manatee (Sirenia) to sirenians, not artiodactyls or other-mammals", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Sirenia" };
    expect(speciesMatchesNode(species, "sirenians")).toBe(true);
    expect(speciesMatchesNode(species, "artiodactyls")).toBe(false);
    expect(speciesMatchesNode(species, "other-mammals")).toBe(false);
  });

  it("matches rare order to other-mammals", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Dermoptera" };
    expect(speciesMatchesNode(species, "other-mammals")).toBe(true);
  });

  it("rejects named order from other-mammals", () => {
    const species = { taxon_group: "mammals", class_name: "Mammalia", order_name: "Carnivora" };
    expect(speciesMatchesNode(species, "other-mammals")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesNode — edge cases
// =============================================================================

describe("speciesMatchesNode – edge cases", () => {
  it("returns true for unknown node id (no filtering)", () => {
    const species = { taxon_group: "reptiles", class_name: null, order_name: null };
    expect(speciesMatchesNode(species, "nonexistent-subgroup")).toBe(true);
  });

  it("handles null class_name with classNames filter (no match)", () => {
    const species = { taxon_group: "fishes", class_name: null, order_name: null };
    expect(speciesMatchesNode(species, "ray-finned-fishes")).toBe(false);
  });

  it("case-insensitive matching on class_name", () => {
    const species = { taxon_group: "fishes", class_name: "CHONDRICHTHYES", order_name: null };
    expect(speciesMatchesNode(species, "sharks-rays")).toBe(true);
  });

  it("case-insensitive matching on order_name", () => {
    const species = { taxon_group: "reptiles", class_name: null, order_name: "SQUAMATA" };
    expect(speciesMatchesNode(species, "squamates")).toBe(true);
  });
});

// =============================================================================
// speciesMatchesNode — class_name fallback for orderNames
// =============================================================================

describe("speciesMatchesNode – class_name fallback when order_name is empty", () => {
  it("matches reptile with class_name=squamata and empty order_name to squamates", () => {
    const species = { taxon_group: "reptiles", class_name: "squamata", order_name: "" };
    expect(speciesMatchesNode(species, "squamates")).toBe(true);
  });

  it("matches reptile with class_name=testudines and empty order_name to turtles-tortoises", () => {
    const species = { taxon_group: "reptiles", class_name: "testudines", order_name: "" };
    expect(speciesMatchesNode(species, "turtles-tortoises")).toBe(true);
  });

  it("does not use fallback when order_name is populated", () => {
    const species = { taxon_group: "reptiles", class_name: "testudines", order_name: "squamata" };
    expect(speciesMatchesNode(species, "squamates")).toBe(true);
    expect(speciesMatchesNode(species, "turtles-tortoises")).toBe(false);
  });
});

// =============================================================================
// matchesFilter — families filter (new for cetaceans)
// =============================================================================

describe("matchesFilter – families filter", () => {
  it("matches species with family in include list", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Delphinidae" };
    const filter = { csvGroups: ["mammals"], orderNames: ["artiodactyla", "sirenia"], families: ["delphinidae", "trichechidae", "dugongidae"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });

  it("rejects species with family not in include list", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae" };
    const filter = { csvGroups: ["mammals"], orderNames: ["artiodactyla", "sirenia"], families: ["delphinidae", "trichechidae", "dugongidae"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("excludeFamilies rejects matching family", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Delphinidae" };
    const filter = { csvGroups: ["mammals"], orderNames: ["artiodactyla"], excludeFamilies: ["delphinidae", "ziphiidae"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("excludeFamilies passes non-matching family", () => {
    const row = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae" };
    const filter = { csvGroups: ["mammals"], orderNames: ["artiodactyla"], excludeFamilies: ["delphinidae", "ziphiidae"] };
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
    const subs = findNode("reptiles")!.children!;
    const allOrders = subs.flatMap(sg => sg.filter.orderNames ?? []);
    expect(new Set(allOrders).size).toBe(allOrders.length);
  });

  it("amphibia subgroups cover all common orders without overlap", () => {
    const subs = findNode("amphibians")!.children!;
    const allOrders = subs.flatMap(sg => sg.filter.orderNames ?? []);
    expect(new Set(allOrders).size).toBe(allOrders.length);
  });

  it("fishes subgroups cover distinct classes", () => {
    const subs = findNode("fishes")!.children!;
    const allClasses = subs.flatMap(sg => sg.filter.classNames ?? []);
    expect(new Set(allClasses).size).toBe(allClasses.length);
  });

  it("insect subgroups: each maps to one distinct CSV group, covering the parent", () => {
    const parent = findNode("insecta")!;
    const subs = parent.children!;
    // Every insect subgroup is a CSV-group leaf (no order/class filter).
    for (const sg of subs) {
      expect(sg.filter.csvGroups.length, `${sg.id} should map to a single CSV group`).toBe(1);
      expect(sg.filter.orderNames, `${sg.id} should not use an order filter`).toBeUndefined();
      expect(sg.filter.excludeOrders, `${sg.id} should not use excludeOrders`).toBeUndefined();
    }
    const childGroups = subs.map(sg => sg.filter.csvGroups[0]);
    // Distinct, and exactly the parent's aggregated groups.
    expect(new Set(childGroups).size).toBe(childGroups.length);
    expect([...childGroups].sort()).toEqual([...parent.filter.csvGroups].sort());
  });

  it("all plant Table 1a groups are leaves (no drill-down)", () => {
    const plantGroups = [
      "flowering_plants", "gymnosperms", "ferns_and_allies",
      "mosses", "green_algae", "red_algae",
    ];
    for (const id of plantGroups) {
      const node = findNode(id)!;
      expect(node, `${id} not found`).toBeDefined();
      expect(node.children, `${id} should be a leaf`).toBeUndefined();
    }
  });

  it("every plant Table 1a group has a described-species estimate", () => {
    const plantGroups = [
      "flowering_plants", "gymnosperms", "ferns_and_allies",
      "mosses", "green_algae", "red_algae",
    ];
    for (const id of plantGroups) {
      const node = findNode(id)!;
      expect(node.estimatedDescribed, `${id} missing estimatedDescribed`).toBeGreaterThan(0);
    }
  });

  it("fungi subgroups partition the mushrooms group", () => {
    const subs = findNode("mushrooms")!.children!;
    expect(subs).toHaveLength(2);
    const included = subs[0].filter.orderNames ?? [];
    const excluded = subs[1].filter.excludeOrders ?? [];
    expect([...included].sort()).toEqual([...excluded].sort());
  });

  it("mammal subgroups: named orders match other-mammals excludeOrders", () => {
    const subs = findNode("mammals")!.children!;
    const otherMammals = subs.find(sg => sg.id === "other-mammals")!;
    const namedOrders = subs
      .filter(sg => sg.id !== "other-mammals")
      .flatMap(sg => sg.filter.orderNames ?? []);
    expect([...namedOrders].sort()).toEqual([...otherMammals.filter.excludeOrders!].sort());
  });

  it("other_invertebrates subgroups: included classes match catch-all excludeClasses", () => {
    const subs = findNode("other_invertebrates")!.children!;
    const catchAll = subs.find(sg => sg.id === "other-invertebrates-catch-all")!;
    const namedClasses = subs
      .filter(sg => sg.id !== "other-invertebrates-catch-all")
      .flatMap(sg => sg.filter.classNames ?? []);
    expect([...namedClasses].sort()).toEqual([...catchAll.filter.excludeClasses!].sort());
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

  it("all 28 Table 1a CSV groups are covered by exactly one default view root", () => {
    const allCsvGroups = new Set<string>();
    for (const rootId of defaultRoots) {
      for (const csv of findNode(rootId)!.filter.csvGroups) {
        allCsvGroups.add(csv);
      }
    }
    expect(allCsvGroups.size).toBe(28);
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
    ["molluscs", "inv-molluscs"],
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
    expect(NODE_INDEX.has("pl-flowering_plants")).toBe(true);
    expect(NODE_INDEX.has("fu-ascomycota")).toBe(true);
  });
});

// ─── Table 1a click-through: every group maps to a view root child ────

describe("Table 1a → default view mapping", () => {
  const defaultRoots = new Set(TAXONOMY_VIEWS.default.roots);
  const table1aGroups = TAXONOMY_VIEWS.table1a.roots;

  const stripPrefix = (id: string) => id.replace(/^(inv-|pl-|fu-)/, "");

  for (const group of table1aGroups) {
    it(`${group} maps to a default view root or its child`, () => {
      if (defaultRoots.has(group)) return; // direct root, fine

      let found = false;
      for (const rootId of defaultRoots) {
        const rootNode = findNode(rootId)!;
        // Mirror TaxaSummary navigation: match by node id (aggregating parents
        // like "insecta"), then by single CSV group, then by CSV-group membership.
        const match =
          rootNode.children?.find(c => stripPrefix(c.id) === group)
          ?? rootNode.children?.find(c =>
            c.filter.csvGroups.length === 1 && c.filter.csvGroups[0] === group
          )
          ?? rootNode.children?.find(c =>
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
   
  const data = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data/node-children-summaries.json"),
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
