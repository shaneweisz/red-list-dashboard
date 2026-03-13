import { describe, it, expect } from "vitest";
import {
  TAXA_SUBGROUPS,
  getSubgroupDef,
  speciesMatchesSubgroup,
} from "../taxa-hierarchy";

// =============================================================================
// Data integrity
// =============================================================================

describe("TAXA_SUBGROUPS data integrity", () => {
  it("contains exactly the 6 expandable taxa", () => {
    const keys = Object.keys(TAXA_SUBGROUPS).sort();
    expect(keys).toEqual([
      "amphibia",
      "fishes",
      "fungi",
      "invertebrates",
      "plantae",
      "reptilia",
    ]);
  });

  it("every subgroup has a unique id", () => {
    const ids = Object.values(TAXA_SUBGROUPS).flat().map((sg) => sg.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every subgroup has a non-empty name", () => {
    for (const subs of Object.values(TAXA_SUBGROUPS)) {
      for (const sg of subs) {
        expect(sg.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("every subgroup has estimatedDescribed > 0", () => {
    for (const subs of Object.values(TAXA_SUBGROUPS)) {
      for (const sg of subs) {
        expect(sg.estimatedDescribed).toBeGreaterThan(0);
      }
    }
  });

  it("every subgroup has a non-empty source citation", () => {
    for (const subs of Object.values(TAXA_SUBGROUPS)) {
      for (const sg of subs) {
        expect(sg.source.length, `${sg.id} missing source`).toBeGreaterThan(0);
      }
    }
  });

  it("every filter has at least one group", () => {
    for (const subs of Object.values(TAXA_SUBGROUPS)) {
      for (const sg of subs) {
        expect(sg.filter.groups.length).toBeGreaterThan(0);
      }
    }
  });

  it("no filter has both orderNames and excludeOrders set", () => {
    for (const subs of Object.values(TAXA_SUBGROUPS)) {
      for (const sg of subs) {
        const hasInclude = sg.filter.orderNames && sg.filter.orderNames.length > 0;
        const hasExclude = sg.filter.excludeOrders && sg.filter.excludeOrders.length > 0;
        expect(
          !!(hasInclude && hasExclude),
          `${sg.id} has both orderNames and excludeOrders`
        ).toBe(false);
      }
    }
  });

  it("fungi subgroups partition the mushrooms group (include + exclude same orders)", () => {
    const fungiSubs = TAXA_SUBGROUPS.fungi;
    expect(fungiSubs).toHaveLength(2);
    const included = fungiSubs[0].filter.orderNames ?? [];
    const excluded = fungiSubs[1].filter.excludeOrders ?? [];
    expect([...included].sort()).toEqual([...excluded].sort());
  });
});

// =============================================================================
// getSubgroupDef
// =============================================================================

describe("getSubgroupDef", () => {
  it("returns definition + parent taxon for a known subgroup", () => {
    const result = getSubgroupDef("sharks-rays");
    expect(result).not.toBeNull();
    expect(result!.def.name).toBe("Sharks & Rays");
    expect(result!.taxonId).toBe("fishes");
  });

  it("returns null for unknown subgroup id", () => {
    expect(getSubgroupDef("nonexistent")).toBeNull();
  });

  it("resolves every subgroup defined in TAXA_SUBGROUPS", () => {
    for (const [taxonId, subs] of Object.entries(TAXA_SUBGROUPS)) {
      for (const sg of subs) {
        const result = getSubgroupDef(sg.id);
        expect(result).not.toBeNull();
        expect(result!.taxonId).toBe(taxonId);
        expect(result!.def.id).toBe(sg.id);
      }
    }
  });
});

// =============================================================================
// speciesMatchesSubgroup — orderNames filter
// =============================================================================

describe("speciesMatchesSubgroup – orderNames filter", () => {
  it("matches reptile in squamata to lizards-snakes", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "Squamata" };
    expect(speciesMatchesSubgroup(species, "lizards-snakes")).toBe(true);
  });

  it("rejects reptile in testudines from lizards-snakes", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "Testudines" };
    expect(speciesMatchesSubgroup(species, "lizards-snakes")).toBe(false);
  });

  it("matches reptile in testudines to turtles-tortoises", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "Testudines" };
    expect(speciesMatchesSubgroup(species, "turtles-tortoises")).toBe(true);
  });

  it("matches amphibian anura to frogs-toads", () => {
    const species = { taxon_group: "amphibia", class_name: null, order_name: "Anura" };
    expect(speciesMatchesSubgroup(species, "frogs-toads")).toBe(true);
  });

  it("rejects amphibian from reptilia subgroup (wrong group)", () => {
    const species = { taxon_group: "amphibia", class_name: null, order_name: "Squamata" };
    expect(speciesMatchesSubgroup(species, "lizards-snakes")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesSubgroup — classNames filter
// =============================================================================

describe("speciesMatchesSubgroup – classNames filter", () => {
  it("matches actinopterygii to bony-fish", () => {
    const species = { taxon_group: "fishes", class_name: "Actinopterygii", order_name: null };
    expect(speciesMatchesSubgroup(species, "bony-fish")).toBe(true);
  });

  it("matches sarcopterygii to bony-fish", () => {
    const species = { taxon_group: "fishes", class_name: "Sarcopterygii", order_name: null };
    expect(speciesMatchesSubgroup(species, "bony-fish")).toBe(true);
  });

  it("rejects chondrichthyes from bony-fish", () => {
    const species = { taxon_group: "fishes", class_name: "Chondrichthyes", order_name: null };
    expect(speciesMatchesSubgroup(species, "bony-fish")).toBe(false);
  });

  it("matches chondrichthyes to sharks-rays", () => {
    const species = { taxon_group: "fishes", class_name: "Chondrichthyes", order_name: null };
    expect(speciesMatchesSubgroup(species, "sharks-rays")).toBe(true);
  });

  it("matches echinoderms by class from other_invertebrates group", () => {
    const species = { taxon_group: "other_invertebrates", class_name: "Echinoidea", order_name: null };
    expect(speciesMatchesSubgroup(species, "echinoderms")).toBe(true);
  });

  it("rejects echinoderm class from wrong group", () => {
    const species = { taxon_group: "insecta", class_name: "Echinoidea", order_name: null };
    expect(speciesMatchesSubgroup(species, "echinoderms")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesSubgroup — excludeOrders filter
// =============================================================================

describe("speciesMatchesSubgroup – excludeOrders filter", () => {
  it("matches insect with unlisted order to other-insects", () => {
    const species = { taxon_group: "insecta", class_name: null, order_name: "Neuroptera" };
    expect(speciesMatchesSubgroup(species, "other-insects")).toBe(true);
  });

  it("rejects insect with excluded order from other-insects", () => {
    const species = { taxon_group: "insecta", class_name: null, order_name: "Coleoptera" };
    expect(speciesMatchesSubgroup(species, "other-insects")).toBe(false);
  });

  it("rejects all explicitly named insect orders from other-insects", () => {
    const excluded = ["Coleoptera", "Lepidoptera", "Diptera", "Hymenoptera", "Hemiptera", "Orthoptera", "Odonata"];
    for (const order of excluded) {
      const species = { taxon_group: "insecta", class_name: null, order_name: order };
      expect(speciesMatchesSubgroup(species, "other-insects")).toBe(false);
    }
  });

  it("matches flowering plant with unlisted order to other-flowering-plants", () => {
    const species = { taxon_group: "flowering_plants", class_name: null, order_name: "Piperales" };
    expect(speciesMatchesSubgroup(species, "other-flowering-plants")).toBe(true);
  });

  it("rejects flowering plant with excluded order from other-flowering-plants", () => {
    const species = { taxon_group: "flowering_plants", class_name: null, order_name: "Fabales" };
    expect(speciesMatchesSubgroup(species, "other-flowering-plants")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesSubgroup — group-only filter (no class/order)
// =============================================================================

describe("speciesMatchesSubgroup – group-only filter", () => {
  it("matches any arachnida row to arachnids subgroup", () => {
    const species = { taxon_group: "arachnida", class_name: "Arachnida", order_name: "Araneae" };
    expect(speciesMatchesSubgroup(species, "arachnids")).toBe(true);
  });

  it("matches ferns_and_allies to ferns-horsetails", () => {
    const species = { taxon_group: "ferns_and_allies", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "ferns-horsetails")).toBe(true);
  });

  it("rejects wrong group for group-only filter", () => {
    const species = { taxon_group: "mollusca", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "arachnids")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesSubgroup — edge cases
// =============================================================================

describe("speciesMatchesSubgroup – edge cases", () => {
  it("returns true for unknown subgroup id (no filtering)", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "nonexistent-subgroup")).toBe(true);
  });

  it("handles null class_name with classNames filter (no match)", () => {
    const species = { taxon_group: "fishes", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "bony-fish")).toBe(false);
  });

  it("handles null order_name with orderNames filter (no match)", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "lizards-snakes")).toBe(false);
  });

  it("handles null order_name with excludeOrders filter (matches, since null not in exclude list)", () => {
    const species = { taxon_group: "insecta", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "other-insects")).toBe(true);
  });

  it("case-insensitive matching on class_name", () => {
    const species = { taxon_group: "fishes", class_name: "CHONDRICHTHYES", order_name: null };
    expect(speciesMatchesSubgroup(species, "sharks-rays")).toBe(true);
  });

  it("case-insensitive matching on order_name", () => {
    const species = { taxon_group: "reptilia", class_name: null, order_name: "SQUAMATA" };
    expect(speciesMatchesSubgroup(species, "lizards-snakes")).toBe(true);
  });

  it("case-insensitive matching on excludeOrders", () => {
    const species = { taxon_group: "insecta", class_name: null, order_name: "COLEOPTERA" };
    expect(speciesMatchesSubgroup(species, "other-insects")).toBe(false);
  });

  it("species must match group even if class/order matches", () => {
    // A mollusca row with order "squamata" should NOT match lizards-snakes
    const species = { taxon_group: "mollusca", class_name: null, order_name: "Squamata" };
    expect(speciesMatchesSubgroup(species, "lizards-snakes")).toBe(false);
  });
});

// =============================================================================
// speciesMatchesSubgroup — multi-group subgroups
// =============================================================================

describe("speciesMatchesSubgroup – multi-group subgroups", () => {
  it("matches velvet_worms to other-invertebrates", () => {
    const species = { taxon_group: "velvet_worms", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "other-invertebrates")).toBe(true);
  });

  it("matches horseshoe_crabs to other-invertebrates", () => {
    const species = { taxon_group: "horseshoe_crabs", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "other-invertebrates")).toBe(true);
  });

  it("matches other_invertebrates to other-invertebrates", () => {
    const species = { taxon_group: "other_invertebrates", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "other-invertebrates")).toBe(true);
  });

  it("rejects insecta from other-invertebrates (not in groups list)", () => {
    const species = { taxon_group: "insecta", class_name: null, order_name: null };
    expect(speciesMatchesSubgroup(species, "other-invertebrates")).toBe(false);
  });
});

// =============================================================================
// Partition coverage: subgroups for each taxon should be exhaustive
// =============================================================================

describe("subgroup partition coverage", () => {
  it("reptilia subgroups cover all common orders without overlap in include lists", () => {
    const reptileSubs = TAXA_SUBGROUPS.reptilia;
    const allOrders = reptileSubs.flatMap((sg) => sg.filter.orderNames ?? []);
    // No duplicates
    expect(new Set(allOrders).size).toBe(allOrders.length);
  });

  it("amphibia subgroups cover all common orders without overlap", () => {
    const subs = TAXA_SUBGROUPS.amphibia;
    const allOrders = subs.flatMap((sg) => sg.filter.orderNames ?? []);
    expect(new Set(allOrders).size).toBe(allOrders.length);
  });

  it("fishes subgroups cover distinct classes", () => {
    const subs = TAXA_SUBGROUPS.fishes;
    const allClasses = subs.flatMap((sg) => sg.filter.classNames ?? []);
    expect(new Set(allClasses).size).toBe(allClasses.length);
  });

  it("invertebrate insect subgroups: named orders match other-insects excludeOrders", () => {
    const invertSubs = TAXA_SUBGROUPS.invertebrates;
    const insectSubs = invertSubs.filter((sg) => sg.filter.groups.includes("insecta"));
    const otherInsects = insectSubs.find((sg) => sg.id === "other-insects")!;
    const namedOrders = insectSubs
      .filter((sg) => sg.id !== "other-insects")
      .flatMap((sg) => sg.filter.orderNames ?? []);
    expect([...namedOrders].sort()).toEqual([...otherInsects.filter.excludeOrders!].sort());
  });

  it("plantae flowering_plants: named orders match other-flowering-plants excludeOrders", () => {
    const plantSubs = TAXA_SUBGROUPS.plantae;
    const floweringSubs = plantSubs.filter((sg) => sg.filter.groups.includes("flowering_plants"));
    const otherFlowering = floweringSubs.find((sg) => sg.id === "other-flowering-plants")!;
    const namedOrders = floweringSubs
      .filter((sg) => sg.id !== "other-flowering-plants")
      .flatMap((sg) => sg.filter.orderNames ?? []);
    expect([...namedOrders].sort()).toEqual([...otherFlowering.filter.excludeOrders!].sort());
  });
});
