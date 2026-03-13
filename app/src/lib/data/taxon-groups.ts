/**
 * Maps taxa.ts taxon IDs to the table1a_taxon_group values used in per-taxon CSV filenames.
 *
 * The sync scripts produce 21 per-taxon CSV files (one per IUCN Table 1a group).
 * Combined taxa (fishes, invertebrates, fungi, all) map to multiple groups.
 */

const TAXON_GROUP_MAP: Record<string, string[]> = {
  mammalia: ["mammalia"],
  aves: ["aves"],
  reptilia: ["reptilia"],
  amphibia: ["amphibia"],
  fishes: ["fishes"],
  invertebrates: [
    "insecta",
    "arachnida",
    "mollusca",
    "crustacea",
    "corals",
    "other_invertebrates",
    "velvet_worms",
    "horseshoe_crabs",
  ],
  plantae: [
    "flowering_plants",
    "gymnosperms",
    "ferns_and_allies",
    "mosses",
    "green_algae",
    "red_algae",
    "brown_algae",
  ],
  fungi: ["mushrooms"],
  all: [
    "mammalia",
    "aves",
    "reptilia",
    "amphibia",
    "fishes",
    "insecta",
    "arachnida",
    "mollusca",
    "crustacea",
    "corals",
    "other_invertebrates",
    "velvet_worms",
    "horseshoe_crabs",
    "flowering_plants",
    "gymnosperms",
    "ferns_and_allies",
    "mosses",
    "green_algae",
    "red_algae",
    "brown_algae",
    "mushrooms",
  ],
};

/**
 * Get the table1a_taxon_group values for a taxa.ts taxon ID.
 * Falls back to treating the taxonId itself as a single group.
 */
export function getTaxonGroups(taxonId: string): string[] {
  return TAXON_GROUP_MAP[taxonId] || [taxonId];
}
