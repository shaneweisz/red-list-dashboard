/**
 * Generate taxonomic name variants based on Latin gender agreement.
 *
 * In taxonomy, the species epithet must agree in grammatical gender with the
 * genus. When a species is moved to a different genus, the epithet ending may
 * change. For example, "Stenocephalemys albocaudata" (feminine) could also
 * appear as "Stenocephalemys albocaudatus" (masculine) or
 * "Stenocephalemys albocaudatum" (neuter) in the literature.
 *
 * This function generates common gender variants so the OpenAlex search can
 * find papers using any accepted spelling.
 */

function getEpithetGenderVariants(epithet: string): string[] {
  const variants = new Set<string>();
  variants.add(epithet);

  // -ensis/-ense (geographic endings — check before -is/-e to avoid overlap)
  if (epithet.endsWith("ensis")) {
    variants.add(epithet.slice(0, -5) + "ense");
    return Array.from(variants);
  }
  if (epithet.endsWith("ense")) {
    variants.add(epithet.slice(0, -4) + "ensis");
    return Array.from(variants);
  }

  // -us/-a/-um (second declension gender agreement)
  if (epithet.endsWith("us")) {
    const stem = epithet.slice(0, -2);
    variants.add(stem + "a");
    variants.add(stem + "um");
  } else if (epithet.endsWith("um")) {
    const stem = epithet.slice(0, -2);
    variants.add(stem + "us");
    variants.add(stem + "a");
  } else if (epithet.endsWith("a")) {
    const stem = epithet.slice(0, -1);
    variants.add(stem + "us");
    variants.add(stem + "um");
  }

  // -is/-e (third declension)
  if (epithet.endsWith("is")) {
    variants.add(epithet.slice(0, -2) + "e");
  } else if (epithet.endsWith("e") && !epithet.endsWith("ae")) {
    variants.add(epithet.slice(0, -1) + "is");
  }

  return Array.from(variants);
}

export function generateNameVariants(scientificName: string): string[] {
  const parts = scientificName.trim().split(/\s+/);
  if (parts.length < 2) return [scientificName];

  const genus = parts[0];
  const epithet = parts[1];
  const rest = parts.slice(2);

  const epithetVariants = getEpithetGenderVariants(epithet);

  return epithetVariants.map((variant) => {
    return [genus, variant, ...rest].join(" ");
  });
}
