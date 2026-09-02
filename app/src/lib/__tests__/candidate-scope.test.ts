import { describe, it, expect } from "vitest";
import { candidateScopeToken } from "@/lib/candidate-scope";

const LION = { class: "Mammalia", order: "Carnivora", family: "Felidae", genus: "Panthera" };

describe("candidateScopeToken", () => {
  it("links a group-level row at the taxon group itself", () => {
    expect(candidateScopeToken("mammals", "group", LION)).toBe("mammals");
  });

  it("builds the whole lineage prefix down to the chosen rank", () => {
    expect(candidateScopeToken("mammals", "order", LION)).toBe("mammals~carnivora");
    expect(candidateScopeToken("mammals", "family", LION)).toBe("mammals~carnivora~felidae");
    expect(candidateScopeToken("mammals", "genus", LION)).toBe("mammals~carnivora~felidae~panthera");
  });

  it("includes the class segment for a class-first root", () => {
    // Molluscs/crustaceans/other invertebrates drill class-first, so a family
    // token there is class~order~family, not order~family.
    const snail = { class: "Gastropoda", order: "Stylommatophora", family: "Achatinidae", genus: "Achatina" };
    expect(candidateScopeToken("molluscs", "family", snail)).toBe("molluscs~gastropoda~stylommatophora~achatinidae");
  });

  it("skips the class rank on a root that drills order-first", () => {
    // Mammals starts at order, so there is no position for a class segment.
    expect(candidateScopeToken("mammals", "class", LION)).toBe("mammals");
  });

  it("falls back to the group rather than link at a lineage gap", () => {
    // An empty segment is the "Unclassified <rank>" bucket — species with NO
    // value at that rank — so a missing order must not be passed through as one.
    const noOrder = { ...LION, order: null };
    expect(candidateScopeToken("mammals", "family", noOrder)).toBe("mammals");
  });

  it("round-trips through the dashboard's own token expansion", async () => {
    const { expandTaxaToken } = await import("@/lib/taxonomy-utils");
    const { taxa, subgroup } = expandTaxaToken(candidateScopeToken("mammals", "family", LION));
    expect(taxa).toBe("mammals");
    expect(subgroup).toBe("mammals~order:carnivora~family:felidae");
  });
});
