/**
 * Unified taxa configuration for Red List and GBIF pipelines.
 *
 * Each taxon maps to a Table 1a row and defines how to query both
 * the IUCN Red List database and the GBIF occurrence API.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface RedlistQuery {
  filterColumn: "kingdom_name" | "phylum_name" | "class_name" | "order_name";
  filterValues: string[];
}

export interface GbifQuery {
  keyType: "kingdomKey" | "phylumKey" | "classKey" | "orderKey";
  keyValue: number;
}

export interface Taxon {
  id: string;
  name: string;
  redlist: RedlistQuery[];
  gbif: GbifQuery[];
}

// =============================================================================
// FISH ORDER KEYS (GBIF)
// =============================================================================

const FISH_ORDER_KEYS = [
  389, 391, 427, 428, 446, 494, 495, 496, 497, 498, 499,
  537, 538, 547, 548, 549, 550, 587, 588, 589, 590, 696,
  708, 742, 752, 753, 772, 773, 774, 781, 836, 848, 857,
  860, 861, 888, 889, 890, 898, 929, 975, 976, 1067, 1153, 1313,
];

// =============================================================================
// TAXA
// =============================================================================

export const TAXA: Taxon[] = [
  // ── Vertebrates ──
  {
    id: "mammalia", name: "Mammals",
    redlist: [{ filterColumn: "class_name", filterValues: ["MAMMALIA"] }],
    gbif: [{ keyType: "classKey", keyValue: 359 }],
  },
  {
    id: "aves", name: "Birds",
    redlist: [{ filterColumn: "class_name", filterValues: ["AVES"] }],
    gbif: [{ keyType: "classKey", keyValue: 212 }],
  },
  {
    id: "reptilia", name: "Reptiles",
    redlist: [{ filterColumn: "class_name", filterValues: ["REPTILIA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 11592253 },
      { keyType: "classKey", keyValue: 11493978 },
      { keyType: "classKey", keyValue: 11418114 },
    ],
  },
  {
    id: "amphibia", name: "Amphibians",
    redlist: [{ filterColumn: "class_name", filterValues: ["AMPHIBIA"] }],
    gbif: [{ keyType: "classKey", keyValue: 131 }],
  },
  {
    id: "fishes", name: "Fishes",
    redlist: [{ filterColumn: "class_name", filterValues: ["ACTINOPTERYGII", "CHONDRICHTHYES", "MYXINI", "PETROMYZONTI", "SARCOPTERYGII"] }],
    gbif: [
      ...FISH_ORDER_KEYS.map((k) => ({ keyType: "orderKey" as const, keyValue: k })),
      { keyType: "classKey" as const, keyValue: 121 },
      { keyType: "classKey" as const, keyValue: 120 },
    ],
  },

  // ── Invertebrates ──
  {
    id: "insecta", name: "Insects",
    redlist: [{ filterColumn: "class_name", filterValues: ["INSECTA"] }],
    gbif: [{ keyType: "classKey", keyValue: 216 }],
  },
  {
    id: "mollusca", name: "Molluscs",
    redlist: [{ filterColumn: "phylum_name", filterValues: ["MOLLUSCA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 225 },
      { keyType: "classKey", keyValue: 137 },
    ],
  },
  {
    id: "crustacea", name: "Crustaceans",
    redlist: [{ filterColumn: "class_name", filterValues: ["MALACOSTRACA", "MAXILLOPODA", "BRANCHIOPODA", "OSTRACODA", "HEXANAUPLIA"] }],
    gbif: [{ keyType: "classKey", keyValue: 229 }],
  },
  {
    id: "arachnida", name: "Arachnids",
    redlist: [{ filterColumn: "class_name", filterValues: ["ARACHNIDA"] }],
    gbif: [{ keyType: "classKey", keyValue: 367 }],
  },
  {
    id: "corals", name: "Corals",
    redlist: [{ filterColumn: "order_name", filterValues: ["SCLERACTINIA", "ALCYONACEA", "PENNATULACEA"] }],
    gbif: [{ keyType: "classKey", keyValue: 206 }],
  },
  {
    id: "velvet_worms", name: "Velvet Worms",
    redlist: [{ filterColumn: "class_name", filterValues: ["UDEONYCHOPHORA"] }],
    gbif: [{ keyType: "classKey", keyValue: 62 }],
  },
  {
    id: "horseshoe_crabs", name: "Horseshoe Crabs",
    redlist: [{ filterColumn: "class_name", filterValues: ["MEROSTOMATA"] }],
    gbif: [{ keyType: "classKey", keyValue: 351 }],
  },
  {
    id: "other_invertebrates", name: "Other Invertebrates",
    redlist: [
      // Non-coral Anthozoa (filtered by order to separate from corals in class ANTHOZOA)
      { filterColumn: "order_name", filterValues: [
        "ACTINIARIA", "ZOANTHARIA", "PENICILLARIA", "MALACALCYONCAEA", "SCLERALCYONACEA",
      ] },
      { filterColumn: "class_name", filterValues: [
        "HOLOTHUROIDEA", "CLITELLATA", "DIPLOPODA", "COLLEMBOLA", "CHILOPODA",
        "DEMOSPONGIAE", "HYDROZOA", "NEMERTEA",
        "ASTEROIDEA", "CALCAREA", "POLYCHAETA", "TURBELLARIA", "ECHINOIDEA",
      ] },
    ],
    gbif: [
      { keyType: "classKey", keyValue: 222 },    // Holothuroidea
      { keyType: "classKey", keyValue: 255 },    // Clitellata
      { keyType: "classKey", keyValue: 361 },    // Diplopoda
      { keyType: "classKey", keyValue: 10713444 }, // Collembola
      { keyType: "classKey", keyValue: 360 },    // Chilopoda
      { keyType: "classKey", keyValue: 199 },    // Demospongiae
      { keyType: "classKey", keyValue: 205 },    // Hydrozoa
      { keyType: "classKey", keyValue: 214 },    // Asteroidea
      { keyType: "classKey", keyValue: 308 },    // Calcarea
      { keyType: "classKey", keyValue: 256 },    // Polychaeta
      { keyType: "classKey", keyValue: 341 },    // Turbellaria
      { keyType: "classKey", keyValue: 221 },    // Echinoidea
      { keyType: "classKey", keyValue: 63 },     // Nemertea
    ],
  },

  // ── Plants ──
  {
    id: "mosses", name: "Mosses",
    redlist: [{ filterColumn: "phylum_name", filterValues: ["BRYOPHYTA", "ANTHOCEROTOPHYTA", "MARCHANTIOPHYTA"] }],
    gbif: [
      { keyType: "phylumKey", keyValue: 35 },  // Bryophyta
      { keyType: "phylumKey", keyValue: 13 },  // Anthocerotophyta
      { keyType: "phylumKey", keyValue: 9 },   // Marchantiophyta
    ],
  },
  {
    id: "ferns_and_allies", name: "Ferns and Allies",
    redlist: [{ filterColumn: "class_name", filterValues: ["LYCOPODIOPSIDA", "ISOETOPSIDA", "EQUISETOPSIDA", "MARATTIOPSIDA", "POLYPODIOPSIDA", "PSILOTOPSIDA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 245 },     // Lycopodiopsida
      { keyType: "classKey", keyValue: 7228684 },  // Polypodiopsida
    ],
  },
  {
    id: "gymnosperms", name: "Gymnosperms",
    redlist: [{ filterColumn: "class_name", filterValues: ["PINOPSIDA", "CYCADOPSIDA", "GINKGOOPSIDA", "GNETOPSIDA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 194 },  // Pinopsida
      { keyType: "classKey", keyValue: 228 },  // Cycadopsida
      { keyType: "classKey", keyValue: 244 },  // Ginkgoopsida
      { keyType: "classKey", keyValue: 282 },  // Gnetopsida
    ],
  },
  {
    id: "flowering_plants", name: "Flowering Plants",
    redlist: [{ filterColumn: "class_name", filterValues: ["MAGNOLIOPSIDA", "LILIOPSIDA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 220 },  // Magnoliopsida
      { keyType: "classKey", keyValue: 196 },  // Liliopsida
    ],
  },
  {
    id: "green_algae", name: "Green Algae",
    redlist: [{ filterColumn: "phylum_name", filterValues: ["CHLOROPHYTA", "CHAROPHYTA"] }],
    gbif: [
      { keyType: "phylumKey", keyValue: 36 },      // Chlorophyta
      { keyType: "phylumKey", keyValue: 7819616 },  // Charophyta
    ],
  },
  {
    id: "red_algae", name: "Red Algae",
    redlist: [{ filterColumn: "phylum_name", filterValues: ["RHODOPHYTA"] }],
    gbif: [{ keyType: "phylumKey", keyValue: 106 }],
  },

  // ── Fungi & Protists ──
  {
    id: "mushrooms", name: "Mushrooms, etc.",
    redlist: [{ filterColumn: "phylum_name", filterValues: ["ASCOMYCOTA", "BASIDIOMYCOTA"] }],
    gbif: [
      { keyType: "phylumKey", keyValue: 34 },  // Basidiomycota
      { keyType: "phylumKey", keyValue: 95 },  // Ascomycota
    ],
  },
  {
    id: "brown_algae", name: "Brown Algae",
    redlist: [{ filterColumn: "phylum_name", filterValues: ["OCHROPHYTA"] }],
    gbif: [{ keyType: "phylumKey", keyValue: 98 }],
  },
];

// =============================================================================
// HELPERS
// =============================================================================

const TAXA_BY_ID = new Map(TAXA.map((t) => [t.id, t]));

export function getTaxon(id: string): Taxon {
  const taxon = TAXA_BY_ID.get(id);
  if (!taxon) throw new Error(`Unknown taxon: ${id}. Available: ${TAXA.map((t) => t.id).join(", ")}`);
  return taxon;
}

export function getTaxa(ids?: string[]): Taxon[] {
  if (!ids) return TAXA;
  return ids.map(getTaxon);
}
