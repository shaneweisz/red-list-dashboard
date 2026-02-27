import { describe, it, expect } from "vitest";
import { generateNameVariants } from "../nameVariants";

describe("generateNameVariants", () => {
  it("returns the original name for single-word input", () => {
    expect(generateNameVariants("Panthera")).toEqual(["Panthera"]);
  });

  it("generates -us/-a/-um variants (second declension)", () => {
    const variants = generateNameVariants("Stenocephalemys albocaudatus");
    expect(variants).toContain("Stenocephalemys albocaudatus");
    expect(variants).toContain("Stenocephalemys albocaudata");
    expect(variants).toContain("Stenocephalemys albocaudatum");
    expect(variants).toHaveLength(3);
  });

  it("generates variants from -a ending", () => {
    const variants = generateNameVariants("Stenocephalemys albocaudata");
    expect(variants).toContain("Stenocephalemys albocaudata");
    expect(variants).toContain("Stenocephalemys albocaudatus");
    expect(variants).toContain("Stenocephalemys albocaudatum");
  });

  it("generates variants from -um ending", () => {
    const variants = generateNameVariants("Lilium candidum");
    expect(variants).toContain("Lilium candidum");
    expect(variants).toContain("Lilium candidus");
    expect(variants).toContain("Lilium candida");
  });

  it("generates -ensis/-ense variants (geographic)", () => {
    const variants = generateNameVariants("Rana capensis");
    expect(variants).toContain("Rana capensis");
    expect(variants).toContain("Rana capense");
    expect(variants).toHaveLength(2);
  });

  it("generates -ense to -ensis variant", () => {
    const variants = generateNameVariants("Rana capense");
    expect(variants).toContain("Rana capense");
    expect(variants).toContain("Rana capensis");
    expect(variants).toHaveLength(2);
  });

  it("generates -is/-e variants (third declension)", () => {
    const variants = generateNameVariants("Quercus viridis");
    expect(variants).toContain("Quercus viridis");
    expect(variants).toContain("Quercus viride");
  });

  it("generates -e to -is variant (third declension)", () => {
    const variants = generateNameVariants("Quercus viride");
    expect(variants).toContain("Quercus viride");
    expect(variants).toContain("Quercus viridis");
  });

  it("does not generate -is variant for -ae endings", () => {
    // -ae is a genitive/plural ending, not -e third declension
    const variants = generateNameVariants("Rosa caninae");
    expect(variants).not.toContain("Rosa caninis");
  });

  it("varies the species epithet, preserving subspecific parts unchanged", () => {
    // The function varies the second word (species epithet), not later words
    // "albus" (-us) should get -a/-um variants; "yakushimae" is preserved as-is
    const variants = generateNameVariants("Cervus albus yakushimae");
    expect(variants).toContain("Cervus albus yakushimae");
    expect(variants).toContain("Cervus alba yakushimae");
    expect(variants).toContain("Cervus album yakushimae");
    expect(variants).toHaveLength(3);
  });

  it("does not vary non-declining species epithet even with subspecies", () => {
    // "leo" has no matching declension, so only one variant returned
    const variants = generateNameVariants("Panthera leo persicus");
    expect(variants).toEqual(["Panthera leo persicus"]);
  });

  it("handles names with no gender-variable endings", () => {
    // "leo" doesn't match any of the declension patterns
    const variants = generateNameVariants("Panthera leo");
    expect(variants).toEqual(["Panthera leo"]);
  });

  it("handles extra whitespace", () => {
    const variants = generateNameVariants("  Rana  capensis  ");
    expect(variants).toContain("Rana capensis");
    expect(variants).toContain("Rana capense");
  });
});
