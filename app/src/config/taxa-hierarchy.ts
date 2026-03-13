/**
 * Subgroup definitions for progressive drill-down within each of the 8 taxa.
 *
 * Each subgroup has a filter that specifies which CSV group(s) to read from
 * and optional class_name / order_name filters to narrow down to the subgroup.
 */

export interface SubGroupFilter {
  /** Which table1a CSV group(s) to read from */
  groups: string[];
  /** If set, only include rows whose class_name is in this list (lowercase) */
  classNames?: string[];
  /** If set, only include rows whose order_name is in this list (lowercase) */
  orderNames?: string[];
  /** If true, match rows NOT matching the specified orderNames (catch-all for "Other") */
  excludeOrders?: string[];
}

export interface SubGroupDef {
  id: string;
  name: string;
  estimatedDescribed: number;
  filter: SubGroupFilter;
}

// Only taxa with meaningful subgroups are listed here.
// Mammals and Birds have no further breakdown in this hierarchy.
export const TAXA_SUBGROUPS: Record<string, SubGroupDef[]> = {
  reptilia: [
    {
      id: "lizards-snakes",
      name: "Lizards & Snakes",
      estimatedDescribed: 10_000,
      filter: { groups: ["reptilia"], orderNames: ["squamata", "rhynchocephalia"] },
    },
    {
      id: "turtles-tortoises",
      name: "Turtles & Tortoises",
      estimatedDescribed: 350,
      filter: { groups: ["reptilia"], orderNames: ["testudines"] },
    },
    {
      id: "crocodilians",
      name: "Crocodilians",
      estimatedDescribed: 25,
      filter: { groups: ["reptilia"], orderNames: ["crocodylia"] },
    },
  ],

  amphibia: [
    {
      id: "frogs-toads",
      name: "Frogs & Toads",
      estimatedDescribed: 7_000,
      filter: { groups: ["amphibia"], orderNames: ["anura"] },
    },
    {
      id: "salamanders-newts",
      name: "Salamanders & Newts",
      estimatedDescribed: 700,
      filter: { groups: ["amphibia"], orderNames: ["caudata"] },
    },
    {
      id: "caecilians",
      name: "Caecilians",
      estimatedDescribed: 220,
      filter: { groups: ["amphibia"], orderNames: ["gymnophiona"] },
    },
  ],

  fishes: [
    {
      id: "bony-fish",
      name: "Bony Fish",
      estimatedDescribed: 30_000,
      filter: { groups: ["fishes"], classNames: ["actinopterygii", "sarcopterygii"] },
    },
    {
      id: "sharks-rays",
      name: "Sharks & Rays",
      estimatedDescribed: 1_100,
      filter: { groups: ["fishes"], classNames: ["chondrichthyes"] },
    },
    {
      id: "jawless-fish",
      name: "Jawless Fish",
      estimatedDescribed: 120,
      filter: { groups: ["fishes"], classNames: ["myxini", "petromyzonti"] },
    },
  ],

  invertebrates: [
    // --- Insects (from insecta.csv) ---
    {
      id: "beetles",
      name: "Beetles",
      estimatedDescribed: 400_000,
      filter: { groups: ["insecta"], orderNames: ["coleoptera"] },
    },
    {
      id: "butterflies-moths",
      name: "Butterflies & Moths",
      estimatedDescribed: 160_000,
      filter: { groups: ["insecta"], orderNames: ["lepidoptera"] },
    },
    {
      id: "flies-mosquitoes",
      name: "Flies & Mosquitoes",
      estimatedDescribed: 160_000,
      filter: { groups: ["insecta"], orderNames: ["diptera"] },
    },
    {
      id: "bees-wasps-ants",
      name: "Bees, Wasps & Ants",
      estimatedDescribed: 150_000,
      filter: { groups: ["insecta"], orderNames: ["hymenoptera"] },
    },
    {
      id: "true-bugs",
      name: "True Bugs",
      estimatedDescribed: 80_000,
      filter: { groups: ["insecta"], orderNames: ["hemiptera"] },
    },
    {
      id: "grasshoppers-crickets",
      name: "Grasshoppers, Crickets & Locusts",
      estimatedDescribed: 25_000,
      filter: { groups: ["insecta"], orderNames: ["orthoptera"] },
    },
    {
      id: "dragonflies-damselflies",
      name: "Dragonflies & Damselflies",
      estimatedDescribed: 6_000,
      filter: { groups: ["insecta"], orderNames: ["odonata"] },
    },
    {
      id: "other-insects",
      name: "Other Insects",
      estimatedDescribed: 150_000,
      filter: {
        groups: ["insecta"],
        excludeOrders: [
          "coleoptera", "lepidoptera", "diptera", "hymenoptera",
          "hemiptera", "orthoptera", "odonata",
        ],
      },
    },
    // --- Other invertebrates ---
    {
      id: "arachnids",
      name: "Arachnids",
      estimatedDescribed: 110_000,
      filter: { groups: ["arachnida"] },
    },
    {
      id: "molluscs",
      name: "Molluscs",
      estimatedDescribed: 85_000,
      filter: { groups: ["mollusca"] },
    },
    {
      id: "crustaceans",
      name: "Crustaceans",
      estimatedDescribed: 67_000,
      filter: { groups: ["crustacea"] },
    },
    {
      id: "corals-cnidarians",
      name: "Corals & Cnidarians",
      estimatedDescribed: 11_000,
      filter: { groups: ["corals"] },
    },
    {
      id: "echinoderms",
      name: "Echinoderms",
      estimatedDescribed: 7_000,
      filter: {
        groups: ["other_invertebrates"],
        classNames: ["asteroidea", "echinoidea", "holothuroidea"],
      },
    },
    {
      id: "worms",
      name: "Worms",
      estimatedDescribed: 25_000,
      filter: {
        groups: ["other_invertebrates"],
        classNames: ["clitellata", "polychaeta", "nemertea", "turbellaria"],
      },
    },
    {
      id: "other-invertebrates",
      name: "Other Invertebrates",
      estimatedDescribed: 15_000,
      filter: {
        groups: ["other_invertebrates", "velvet_worms", "horseshoe_crabs"],
        excludeOrders: [], // read all, but we exclude the classes already covered above
      },
    },
  ],

  plantae: [
    {
      id: "orchids-lilies-bulbs",
      name: "Orchids, Lilies & Bulbs",
      estimatedDescribed: 35_000,
      filter: { groups: ["flowering_plants"], orderNames: ["asparagales"] },
    },
    {
      id: "composites-wildflowers",
      name: "Composites & Wildflowers",
      estimatedDescribed: 35_000,
      filter: { groups: ["flowering_plants"], orderNames: ["asterales"] },
    },
    {
      id: "legumes",
      name: "Legumes",
      estimatedDescribed: 20_000,
      filter: { groups: ["flowering_plants"], orderNames: ["fabales"] },
    },
    {
      id: "grasses-cereals",
      name: "Grasses & Cereals",
      estimatedDescribed: 12_000,
      filter: { groups: ["flowering_plants"], orderNames: ["poales"] },
    },
    {
      id: "palms-relatives",
      name: "Palms & Relatives",
      estimatedDescribed: 3_000,
      filter: { groups: ["flowering_plants"], orderNames: ["arecales"] },
    },
    {
      id: "aquatic-flowering",
      name: "Aquatic Flowering Plants",
      estimatedDescribed: 5_000,
      filter: { groups: ["flowering_plants"], orderNames: ["alismatales", "ceratophyllales", "nymphaeales"] },
    },
    {
      id: "broadleaf-trees-shrubs",
      name: "Broadleaf Trees & Shrubs",
      estimatedDescribed: 80_000,
      filter: {
        groups: ["flowering_plants"],
        orderNames: [
          "fagales", "rosales", "malpighiales", "sapindales", "myrtales",
          "laurales", "magnoliales", "malvales", "ericales", "gentianales",
        ],
      },
    },
    {
      id: "other-flowering-plants",
      name: "Other Flowering Plants",
      estimatedDescribed: 160_000,
      filter: {
        groups: ["flowering_plants"],
        excludeOrders: [
          "asparagales", "asterales", "fabales", "poales", "arecales",
          "alismatales", "ceratophyllales", "nymphaeales",
          "fagales", "rosales", "malpighiales", "sapindales", "myrtales",
          "laurales", "magnoliales", "malvales", "ericales", "gentianales",
        ],
      },
    },
    {
      id: "ferns-horsetails",
      name: "Ferns & Horsetails",
      estimatedDescribed: 12_000,
      filter: { groups: ["ferns_and_allies"] },
    },
    {
      id: "mosses-liverworts",
      name: "Mosses, Liverworts & Hornworts",
      estimatedDescribed: 20_000,
      filter: { groups: ["mosses"] },
    },
    {
      id: "conifers-cycads",
      name: "Conifers & Cycads",
      estimatedDescribed: 800,
      filter: { groups: ["gymnosperms"] },
    },
  ],

  fungi: [
    {
      id: "moulds-yeasts-cup",
      name: "Moulds, Yeasts & Cup Fungi",
      estimatedDescribed: 64_000,
      filter: {
        groups: ["mushrooms"],
        orderNames: [
          "eurotiales", "hypocreales", "xylariales", "pleosporales", "capnodiales",
          "helotiales", "orbiliales", "pezizales", "rhytismatales", "leotiales",
          "dothideales", "chaetothyriales", "verrucariales", "arthoniales",
          "ostropales", "pertusariales", "lecanorales", "peltigerales",
          "teloschistales", "caliciales", "acarosporales", "geoglossales",
          "cyttariales", "coryneliales", "trypetheliales",
        ],
      },
    },
    {
      id: "bracket-mushroom-fungi",
      name: "Bracket Fungi & Mushrooms",
      estimatedDescribed: 30_000,
      filter: {
        groups: ["mushrooms"],
        excludeOrders: [
          "eurotiales", "hypocreales", "xylariales", "pleosporales", "capnodiales",
          "helotiales", "orbiliales", "pezizales", "rhytismatales", "leotiales",
          "dothideales", "chaetothyriales", "verrucariales", "arthoniales",
          "ostropales", "pertusariales", "lecanorales", "peltigerales",
          "teloschistales", "caliciales", "acarosporales", "geoglossales",
          "cyttariales", "coryneliales", "trypetheliales",
        ],
      },
    },
  ],
};

// ── Client-side helpers ──────────────────────────────────────────────

/** Flat lookup: subgroup ID → its definition + parent taxon ID */
const _subgroupIndex = new Map<string, { def: SubGroupDef; taxonId: string }>();
for (const [taxonId, subs] of Object.entries(TAXA_SUBGROUPS)) {
  for (const sg of subs) {
    _subgroupIndex.set(sg.id, { def: sg, taxonId });
  }
}

/** Look up a subgroup definition by its ID. */
export function getSubgroupDef(subgroupId: string) {
  return _subgroupIndex.get(subgroupId) ?? null;
}

/**
 * Client-side filter: does a species row match a subgroup filter?
 *
 * Uses the same logic as the server-side `matchesFilter` but works with
 * the client-side species fields (taxon_group, class_name, order_name).
 */
export function speciesMatchesSubgroup(
  species: { taxon_group: string; class_name: string | null; order_name: string | null },
  subgroupId: string,
): boolean {
  const entry = _subgroupIndex.get(subgroupId);
  if (!entry) return true; // unknown subgroup → don't filter

  const { def } = entry;
  const f = def.filter;

  // Must belong to one of the filter's CSV groups
  if (!f.groups.includes(species.taxon_group)) return false;

  // Class filter
  if (f.classNames && f.classNames.length > 0) {
    const cls = (species.class_name ?? "").toLowerCase();
    if (!f.classNames.includes(cls)) return false;
  }

  // Order include filter
  if (f.orderNames && f.orderNames.length > 0) {
    const ord = (species.order_name ?? "").toLowerCase();
    if (!f.orderNames.includes(ord)) return false;
  }

  // Order exclude filter
  if (f.excludeOrders && f.excludeOrders.length > 0) {
    const ord = (species.order_name ?? "").toLowerCase();
    if (f.excludeOrders.includes(ord)) return false;
  }

  return true;
}
