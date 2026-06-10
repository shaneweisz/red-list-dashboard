/**
 * Shared constants used by both species-store.ts (runtime) and
 * build-search-index.ts (build time).
 */

/** GBIF species keys for domesticated species excluded from new assessments. */
export const EXCLUDED_DOMESTICATED_GBIF_KEYS = new Set([
  2441022, // Bos taurus (Cow)
  2435035, // Felis catus (Cat)
  2441110, // Ovis aries (Domestic Sheep)
  2441056, // Capra hircus (Domestic Goat)
  2440886, // Equus caballus (Horse)
  7422937, // Bubalus bubalis (Water Buffalo)
  2440891, // Equus asinus (Donkey)
  9055455, // Camelus dromedarius (Arabian Camel)
  2441238, // Camelus bactrianus (Bactrian Camel)
  5220190, // Lama glama (Llama)
  7515593, // Vicugna pacos (Alpaca)
  2441019, // Bos grunniens (Yak)
  5219702, // Cavia porcellus (Guinea Pig)
  10694102, // Columba domestica (Domestic Pigeon)
  2436436, // Homo sapiens (Human)
]);

/**
 * Maps CSV group names (IUCN Table 1a) to display taxon IDs.
 * Groups not listed here map to themselves (e.g., "mammals" → "mammals").
 */
export const DB_GROUP_TO_TAXON_ID: Record<string, string> = {
  fishes: "fishes",
  beetles: "invertebrates",
  butterflies_and_moths: "invertebrates",
  flies_and_mosquitoes: "invertebrates",
  bees_wasps_and_ants: "invertebrates",
  true_bugs: "invertebrates",
  grasshoppers_crickets_locusts: "invertebrates",
  dragonflies_and_damselflies: "invertebrates",
  other_insects: "invertebrates",
  arachnids: "invertebrates",
  molluscs: "invertebrates",
  crustaceans: "invertebrates",
  corals: "invertebrates",
  other_invertebrates: "invertebrates",
  velvet_worms: "invertebrates",
  horseshoe_crabs: "invertebrates",
  flowering_plants: "plantae",
  gymnosperms: "plantae",
  ferns_and_allies: "plantae",
  mosses: "plantae",
  green_algae: "plantae",
  red_algae: "plantae",
  brown_algae: "fungi",
  mushrooms: "fungi",
};

/** Map a CSV group name to its display taxon ID. */
export function mapTaxonId(group: string): string {
  return DB_GROUP_TO_TAXON_ID[group] ?? group;
}

/**
 * Back-compat aliases: legacy taxon/group identifiers (the scientific class
 * names used as IDs before the 2026-06 rename) → their current IDs. Lets old
 * shared/bookmarked URLs (e.g. ?taxa=mammalia) and direct API calls keep
 * resolving. Single source of truth — extend here to add more synonyms.
 */
export const TAXON_ID_ALIASES: Record<string, string> = {
  mammalia: "mammals",
  aves: "birds",
  reptilia: "reptiles",
  amphibia: "amphibians",
  arachnida: "arachnids",
  mollusca: "molluscs",
  crustacea: "crustaceans",
};

// Virtual grouping roots (invertebrates/plants/fungi) clone their children with
// these prefixes to keep node IDs unique, so the subgroups param can carry e.g.
// "inv-crustacea". Alias the base after stripping the prefix, then re-attach.
const NODE_ID_PREFIXES = ["inv-", "pl-", "fu-"];

/** Resolve a possibly-legacy taxon/group identifier (bare or prefixed) to its current ID. */
export function canonicalizeTaxonId(id: string): string {
  for (const prefix of NODE_ID_PREFIXES) {
    if (id.startsWith(prefix)) {
      const base = id.slice(prefix.length);
      return prefix + (TAXON_ID_ALIASES[base] ?? base);
    }
  }
  return TAXON_ID_ALIASES[id] ?? id;
}
