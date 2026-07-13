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
    "insects", "arachnids", "molluscs", "crustaceans", "corals",
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

  it("insects has beetles, butterflies-moths, other-insects", () => {
    const node = findNode("insects")!;
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
    expect(hasChildren("insects")).toBe(true);
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
    expect(ancestors).toContain("insects");
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
    expect(path).toContain("insects");
  });
});

describe("getCsvGroupsForNode", () => {
  it("returns single group for Table 1a leaf node", () => {
    expect(getCsvGroupsForNode("mammals")).toEqual(["mammals"]);
    expect(getCsvGroupsForNode("beetles")).toEqual(["beetles"]);
  });

  it("returns the 8 order groups for the insects parent node", () => {
    const groups = getCsvGroupsForNode("insects");
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
// matchesFilter — genera / speciesNames filters (SSC Specialist Groups)
// =============================================================================

describe("matchesFilter – genera filter", () => {
  it("matches species with genus (first token of scientific_name) in include list", () => {
    const row = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus arctos" };
    const filter = { csvGroups: ["mammals"], genera: ["ursus", "helarctos"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });

  it("rejects species with genus not in include list", () => {
    const row = { class_name: "Mammalia", order_name: "Carnivora", family: "Felidae", scientific_name: "Panthera leo" };
    const filter = { csvGroups: ["mammals"], genera: ["ursus", "helarctos"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("excludeGenera rejects matching genus", () => {
    const row = { class_name: "Mammalia", order_name: "Carnivora", family: "Mustelidae", scientific_name: "Lutra lutra" };
    const filter = { csvGroups: ["mammals"], families: ["mustelidae"], excludeGenera: ["lutra", "pteronura"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("excludeGenera passes non-matching genus", () => {
    const row = { class_name: "Mammalia", order_name: "Carnivora", family: "Mustelidae", scientific_name: "Mustela nivalis" };
    const filter = { csvGroups: ["mammals"], families: ["mustelidae"], excludeGenera: ["lutra", "pteronura"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });

  it("treats a missing scientific_name as no genus (fails an include filter)", () => {
    const row = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae" };
    const filter = { csvGroups: ["mammals"], genera: ["ursus"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });
});

describe("matchesFilter – speciesNames filter", () => {
  it("matches species with scientific_name in include list (case-insensitive)", () => {
    const row = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus Maritimus" };
    const filter = { csvGroups: ["mammals"], speciesNames: ["ursus maritimus"] };
    expect(matchesFilter(row, filter)).toBe(true);
  });

  it("rejects species with scientific_name not in include list", () => {
    const row = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus arctos" };
    const filter = { csvGroups: ["mammals"], speciesNames: ["ursus maritimus"] };
    expect(matchesFilter(row, filter)).toBe(false);
  });

  it("excludeSpeciesNames carves a single species out of a family-level filter", () => {
    const polarBear = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus maritimus" };
    const brownBear = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus arctos" };
    const filter = { csvGroups: ["mammals"], families: ["ursidae"], excludeSpeciesNames: ["ursus maritimus"] };
    expect(matchesFilter(polarBear, filter)).toBe(false);
    expect(matchesFilter(brownBear, filter)).toBe(true);
  });
});

// =============================================================================
// SSC Specialist Groups (pilot: mammals)
// =============================================================================

describe("SSC Specialist Groups tree", () => {
  const sscNode = findNode("ssc-groups");

  it("ssc-groups exists, is not part of the default view, and has 36 children (35 pilot groups + remainder)", () => {
    expect(sscNode).toBeDefined();
    expect(sscNode?.children?.length).toBe(36);
    expect(TAXONOMY_VIEWS.default.roots).not.toContain("ssc-groups");
  });

  it("ssc-other-mammals (the remainder row) doesn't overlap any of the 35 named groups", () => {
    // Species that should land in each named group's scope must NOT also match
    // the remainder filter — otherwise the remainder double-counts them.
    const cases: Array<{ class_name: string; order_name: string; family: string; scientific_name: string }> = [
      { class_name: "Mammalia", order_name: "Chiroptera", family: "Pteropodidae", scientific_name: "Pteropus vampyrus" },
      { class_name: "Mammalia", order_name: "Carnivora", family: "Felidae", scientific_name: "Panthera tigris" },
      { class_name: "Mammalia", order_name: "Artiodactyla", family: "Delphinidae", scientific_name: "Tursiops truncatus" },
      { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae", scientific_name: "Bison bison" },
      { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae", scientific_name: "Gazella dorcas" },
      { class_name: "Mammalia", order_name: "Proboscidea", family: "Elephantidae", scientific_name: "Loxodonta africana" },
      { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus maritimus" },
      { class_name: "Mammalia", order_name: "Carnivora", family: "Mustelidae", scientific_name: "Lutra lutra" },
      { class_name: "Mammalia", order_name: "Carnivora", family: "Mustelidae", scientific_name: "Mustela nivalis" },
      { class_name: "Mammalia", order_name: "Artiodactyla", family: "Camelidae", scientific_name: "Vicugna vicugna" },
      // extraSpeciesNames additions (Antelope SG) and the Ailuridae addition
      // (Small Carnivore SG) — must not double-count into the remainder either.
      { class_name: "Mammalia", order_name: "Artiodactyla", family: "Antilocapridae", scientific_name: "Antilocapra americana" },
      { class_name: "Mammalia", order_name: "Artiodactyla", family: "Tragulidae", scientific_name: "Hyemoschus aquaticus" },
      { class_name: "Mammalia", order_name: "Artiodactyla", family: "Camelidae", scientific_name: "Camelus ferus" },
      { class_name: "Mammalia", order_name: "Carnivora", family: "Ailuridae", scientific_name: "Ailurus fulgens" },
    ];
    for (const row of cases) {
      expect(speciesMatchesNode({ ...row, taxon_group: "mammals" }, "ssc-other-mammals"), row.scientific_name).toBe(false);
    }
  });

  it("ssc-other-mammals catches a genuinely uncovered species (musk deer, no dedicated SSC group among the 35)", () => {
    const muskDeer = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Moschidae", scientific_name: "Moschus moschiferus", taxon_group: "mammals" };
    expect(speciesMatchesNode(muskDeer, "ssc-other-mammals")).toBe(true);
  });

  it("Antelope SG's extraSpeciesNames pulls in Pronghorn, Water Chevrotain, and Wild Camel despite them not being Bovidae", () => {
    const pronghorn = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Antilocapridae", scientific_name: "Antilocapra americana", taxon_group: "mammals" };
    const chevrotain = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Tragulidae", scientific_name: "Hyemoschus aquaticus", taxon_group: "mammals" };
    const camel = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Camelidae", scientific_name: "Camelus ferus", taxon_group: "mammals" };
    expect(speciesMatchesNode(pronghorn, "ssc-antelope")).toBe(true);
    expect(speciesMatchesNode(chevrotain, "ssc-antelope")).toBe(true);
    expect(speciesMatchesNode(camel, "ssc-antelope")).toBe(true);
    // Wild Camel is still correctly excluded from Wild Camelid SG (South American
    // camelids only — Lama/Vicugna) despite now belonging to Antelope SG.
    expect(speciesMatchesNode(camel, "ssc-wild-camelid")).toBe(false);
    // A South American camelid must NOT be pulled into Antelope SG by the same
    // escape hatch — extraSpeciesNames is a specific named list, not a rank filter.
    const guanaco = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Camelidae", scientific_name: "Lama guanicoe", taxon_group: "mammals" };
    expect(speciesMatchesNode(guanaco, "ssc-antelope")).toBe(false);
    expect(speciesMatchesNode(guanaco, "ssc-wild-camelid")).toBe(true);
  });

  it("Small Carnivore SG includes red pandas (Ailuridae), confirmed via the group's own site", () => {
    const redPanda = { class_name: "Mammalia", order_name: "Carnivora", family: "Ailuridae", scientific_name: "Ailurus fulgens", taxon_group: "mammals" };
    expect(speciesMatchesNode(redPanda, "ssc-small-carnivore")).toBe(true);
  });

  it("all SSC group children use the mammals csvGroup and have a unique id", () => {
    const ids = new Set<string>();
    for (const child of sscNode?.children ?? []) {
      expect(child.filter.csvGroups).toEqual(["mammals"]);
      expect(ids.has(child.id), `duplicate id ${child.id}`).toBe(false);
      ids.add(child.id);
    }
  });

  it("does not add any new children to the real 'mammals' node", () => {
    const mammalNode = findNode("mammals");
    const mammalChildIds = new Set(mammalNode?.children?.map(c => c.id) ?? []);
    for (const child of sscNode?.children ?? []) {
      expect(mammalChildIds.has(child.id)).toBe(false);
    }
  });

  it("Bear SG and Polar Bear SG partition Ursidae without overlap", () => {
    const polarBear = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus maritimus" };
    const brownBear = { class_name: "Mammalia", order_name: "Carnivora", family: "Ursidae", scientific_name: "Ursus arctos" };
    expect(speciesMatchesNode({ ...polarBear, taxon_group: "mammals" }, "ssc-bear")).toBe(false);
    expect(speciesMatchesNode({ ...polarBear, taxon_group: "mammals" }, "ssc-polar-bear")).toBe(true);
    expect(speciesMatchesNode({ ...brownBear, taxon_group: "mammals" }, "ssc-bear")).toBe(true);
    expect(speciesMatchesNode({ ...brownBear, taxon_group: "mammals" }, "ssc-polar-bear")).toBe(false);
  });

  it("Otter SG and Small Carnivore SG partition Mustelidae without overlap", () => {
    const otter = { class_name: "Mammalia", order_name: "Carnivora", family: "Mustelidae", scientific_name: "Lutra lutra", taxon_group: "mammals" };
    const weasel = { class_name: "Mammalia", order_name: "Carnivora", family: "Mustelidae", scientific_name: "Mustela nivalis", taxon_group: "mammals" };
    expect(speciesMatchesNode(otter, "ssc-otter")).toBe(true);
    expect(speciesMatchesNode(otter, "ssc-small-carnivore")).toBe(false);
    expect(speciesMatchesNode(weasel, "ssc-otter")).toBe(false);
    expect(speciesMatchesNode(weasel, "ssc-small-carnivore")).toBe(true);
  });

  it("Antelope SG excludes Caprinae, Bison and Wild Cattle genera within Bovidae", () => {
    const gazelle = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae", scientific_name: "Gazella dorcas", taxon_group: "mammals" };
    const ibex = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae", scientific_name: "Capra ibex", taxon_group: "mammals" };
    const bison = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae", scientific_name: "Bison bison", taxon_group: "mammals" };
    const gaur = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae", scientific_name: "Bos gaurus", taxon_group: "mammals" };
    expect(speciesMatchesNode(gazelle, "ssc-antelope")).toBe(true);
    expect(speciesMatchesNode(ibex, "ssc-antelope")).toBe(false);
    expect(speciesMatchesNode(ibex, "ssc-caprinae")).toBe(true);
    expect(speciesMatchesNode(bison, "ssc-antelope")).toBe(false);
    expect(speciesMatchesNode(bison, "ssc-bison")).toBe(true);
    expect(speciesMatchesNode(gaur, "ssc-antelope")).toBe(false);
    expect(speciesMatchesNode(gaur, "ssc-afro-asian-wild-cattle")).toBe(true);
  });

  it("African buffalo (Syncerus) stays under Antelope SG, not Wild Cattle SG", () => {
    const buffalo = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Bovidae", scientific_name: "Syncerus caffer", taxon_group: "mammals" };
    expect(speciesMatchesNode(buffalo, "ssc-antelope")).toBe(true);
    expect(speciesMatchesNode(buffalo, "ssc-afro-asian-wild-cattle")).toBe(false);
  });

  it("Cetacean SG matches by family since cetaceans share Artiodactyla's order_name", () => {
    const dolphin = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Delphinidae", scientific_name: "Tursiops truncatus", taxon_group: "mammals" };
    const deer = { class_name: "Mammalia", order_name: "Artiodactyla", family: "Cervidae", scientific_name: "Cervus elaphus", taxon_group: "mammals" };
    expect(speciesMatchesNode(dolphin, "ssc-cetacean")).toBe(true);
    expect(speciesMatchesNode(deer, "ssc-cetacean")).toBe(false);
    expect(speciesMatchesNode(deer, "ssc-deer")).toBe(true);
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
    const parent = findNode("insects")!;
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
    ["insects", "inv-insects"],
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
    const invInsecta = findNode("inv-insects")!;
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
        // like "insects"), then by single CSV group, then by CSV-group membership.
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

// ─── Flat taxa-token URL mapping (the single-`taxa`-param invariant) ────────

import {
  stripNodePrefix,
  expandTaxaToken,
  collapseTaxaToTokens,
  getViewRootForNode,
} from "@/lib/taxonomy-utils";

describe("flat taxa-token mapping is a bijection over the default view", () => {
  // Every default-view node (a display root or a node under one) must round-trip
  // through its flat URL token. If a future tree change makes two nodes share a
  // token, this fails in CI instead of silently emitting a wrong-taxon URL.
  it("each default-view node round-trips: node → token → node", () => {
    const collisions: string[] = [];
    for (const id of NODE_INDEX.keys()) {
      if (!getViewRootForNode(id)) continue; // skip nodes outside the default view
      const { taxa, subgroup } = expandTaxaToken(stripNodePrefix(id));
      const resolved = subgroup ?? taxa;
      if (resolved !== id) collisions.push(`${id} → '${stripNodePrefix(id)}' → ${resolved}`);
    }
    expect(collisions).toEqual([]);
  });

  it("collapse ∘ expand is identity for a root + sub-group selection", () => {
    // Sample a few representative pairs across the prefixed roots.
    const cases: Array<[string, string]> = [
      ["invertebrates", "inv-corals"],
      ["invertebrates", "inv-beetles"],
      ["fishes", "sharks-rays"],
      ["plantae", "pl-flowering_plants"],
      ["fungi", "fu-mushrooms"],
      ["mammals", "ssc-bear"],
    ];
    for (const [root, sg] of cases) {
      const tokens = collapseTaxaToTokens([root], [sg]);
      expect(tokens).toEqual([stripNodePrefix(sg)]);
      const { taxa, subgroup } = expandTaxaToken(tokens[0]);
      expect(taxa).toBe(root);
      expect(subgroup).toBe(sg);
    }
  });

  it("an SSC group survives a URL round-trip as a mammals sub-group (regression: ssc-groups sits outside the default view)", () => {
    // onNavigateToSubgroup("mammals", "ssc-bear") is how the SSC groups mode
    // click-through selects a group; the URL must reconstruct the same pair,
    // not silently widen back out to all of mammals.
    expect(getViewRootForNode("ssc-bear")).toBe("mammals");
    const tokens = collapseTaxaToTokens(["mammals"], ["ssc-bear"]);
    expect(tokens).toEqual(["ssc-bear"]);
    const { taxa, subgroup } = expandTaxaToken(tokens[0]);
    expect(taxa).toBe("mammals");
    expect(subgroup).toBe("ssc-bear");
  });
});
