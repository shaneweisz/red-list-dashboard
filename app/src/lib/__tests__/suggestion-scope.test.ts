import { describe, it, expect } from "vitest";
import { suggestionScope, taxonDisplayName } from "@/lib/suggestion-scope";
import { findNode } from "@/lib/taxonomy-utils";

describe("taxonDisplayName", () => {
  it("names a static node", () => {
    expect(taxonDisplayName("mammals")).toBe("Mammals");
  });

  it("names a dynamic drilldown node by its deepest segment", () => {
    expect(taxonDisplayName("mammals~order:rodentia")).toBe("Rodentia (Rodents)");
  });

  it("capitalizes an arbitrary rank token the tree can't place", () => {
    expect(taxonDisplayName("turdidae")).toBe("Turdidae");
  });
});

describe("suggestionScope", () => {
  it("keeps a static sub-group selection as its own scope", () => {
    const scope = suggestionScope("inv-corals", "corals");
    expect(scope.taxaId).toBe("inv-corals");
    expect(scope.taxaName).toBe(findNode("inv-corals")!.name);
    expect(scope.narrowerName).toBeUndefined();
  });

  it("falls back to the species' own taxon group when nothing is selected", () => {
    const scope = suggestionScope(undefined, "mammals");
    expect(scope).toEqual({ taxaId: "mammals", taxaName: "Mammals" });
  });

  // The regression: a live-drilldown selection has no NODE_INDEX entry, so the
  // candidate query used to run against a taxon group named after the whole id
  // and come back empty. It now runs over the nearest static ancestor, and says so.
  it("suggests a drilled-in selection from its nearest static ancestor", () => {
    const scope = suggestionScope("mammals~order:rodentia~family:muridae", "mammals");
    expect(scope.taxaId).toBe("mammals");
    expect(scope.taxaName).toBe("Mammals");
    expect(scope.narrowerName).toBe("Muridae");
  });

  it("resolves a prefixed root's drilldown to the prefixed node", () => {
    const scope = suggestionScope("pl-flowering_plants~order:malpighiales", "flowering_plants");
    expect(scope.taxaId).toBe("pl-flowering_plants");
    expect(scope.narrowerName).toBe("Malpighiales");
  });

  it("falls back to the species' taxon group for an arbitrary rank selection", () => {
    const scope = suggestionScope("turdidae", "birds");
    expect(scope.taxaId).toBe("birds");
    expect(scope.taxaName).toBe("Birds");
    expect(scope.narrowerName).toBe("Turdidae");
  });

  it("does not flag a legacy id as narrower than the node it canonicalizes to", () => {
    const scope = suggestionScope("mammalia", "mammals");
    expect(scope.taxaId).toBe("mammals");
    expect(scope.narrowerName).toBeUndefined();
  });
});
