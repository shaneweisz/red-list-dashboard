/**
 * Maps taxa.ts taxon IDs to the table1a_taxon_group values stored in the database.
 *
 * The DB stores 15 specific groups. Combined taxa (fishes, invertebrates, fungi, all)
 * map to multiple DB groups.
 */

const TAXON_GROUP_MAP: Record<string, string[]> = {
  mammalia: ["mammalia"],
  aves: ["aves"],
  reptilia: ["reptilia"],
  amphibia: ["amphibia"],
  fishes: ["actinopterygii", "chondrichthyes"],
  invertebrates: [
    "insecta",
    "arachnida",
    "gastropoda",
    "bivalvia",
    "malacostraca",
    "anthozoa",
  ],
  plantae: ["plantae"],
  fungi: ["ascomycota", "basidiomycota"],
  all: [
    "mammalia",
    "aves",
    "reptilia",
    "amphibia",
    "actinopterygii",
    "chondrichthyes",
    "insecta",
    "arachnida",
    "gastropoda",
    "bivalvia",
    "malacostraca",
    "anthozoa",
    "plantae",
    "ascomycota",
    "basidiomycota",
  ],
};

/**
 * Get the DB table1a_taxon_group values for a taxa.ts taxon ID.
 * Falls back to treating the taxonId itself as a single group.
 */
export function getTaxonGroups(taxonId: string): string[] {
  return TAXON_GROUP_MAP[taxonId] || [taxonId];
}
