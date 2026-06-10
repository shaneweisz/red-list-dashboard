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
  kingdomKey: number; // GBIF kingdom: 1=Animalia, 4=Chromista, 5=Fungi, 6=Plantae
  redlist: RedlistQuery[];
  gbif: GbifQuery[];
}

// =============================================================================
// FISH ORDER KEYS (GBIF)
// =============================================================================

// Bony fish (Actinopterygii) order keys — GBIF has no working class-level key for
// ray-finned fishes, so we must query at order level. Shark/ray orders are covered
// by classKey=121 (Elasmobranchii) and are NOT included here.
const BONY_FISH_ORDER_KEYS = [
  494,  // Amiiformes
  495,  // Anguilliformes
  496,  // Atheriniformes
  497,  // Aulopiformes
  498,  // Beloniformes
  499,  // Beryciformes
  537,  // Characiformes
  538,  // Clupeiformes
  547,  // Cyprinodontiformes
  548,  // Esociformes
  549,  // Gadiformes
  550,  // Gasterosteiformes
  587,  // Perciformes
  588,  // Pleuronectiformes
  589,  // Polymixiiformes
  590,  // Scorpaeniformes
  708,  // Siluriformes
  772,  // Tetraodontiformes
  773,  // Syngnathiformes
  774,  // Stomiiformes
  888,  // Zeiformes
  889,  // Synbranchiformes
  890,  // Stephanoberyciformes
  1067, // Mugiliformes
  1068, // Osmeriformes
  1069, // Osteoglossiformes
  1103, // Acipenseriformes
  1104, // Albuliformes
  1106, // Batrachoidiformes
  1107, // Cetomimiformes
  1153, // Cypriniformes
  1163, // Gobiesociformes
  1164, // Gonorynchiformes
  1165, // Gymnotiformes
  1167, // Lepisosteiformes
  1305, // Lophiiformes
  1306, // Myctophiformes
  1307, // Notacanthiformes
  1308, // Ophidiiformes
  1310, // Percopsiformes
  1311, // Polypteriformes
  1312, // Saccopharyngiformes
  1313, // Salmoniformes
];

// =============================================================================
// INSECT "OTHER" ORDERS
// =============================================================================

// The Table 1a "Insects" row is split into 7 named order-groups (Beetles,
// Butterflies & Moths, etc.) plus an "Other Insects" catch-all. Because both
// the Red List SQL and the GBIF query schemas are include-only (no NOT-IN), the
// catch-all is defined by positive enumeration of every remaining order —
// mirroring BONY_FISH_ORDER_KEYS above. Keep these lists in sync when new insect
// orders appear in the source data; the build-taxa-summary lossless-split check
// (sum of the 8 groups == old single insecta total) will flag any drift.

// Red List order_name values for insects NOT in the 7 named groups.
const OTHER_INSECT_ORDERS_REDLIST = [
  "PHASMIDA", "TRICHOPTERA", "MANTODEA", "PLECOPTERA", "BLATTODEA", "ISOPTERA",
  "EPHEMEROPTERA", "DERMAPTERA", "GRYLLOBLATTODEA", "PSOCODEA", "NEUROPTERA",
  "ARCHAEOGNATHA", "SIPHONAPTERA", "THYSANOPTERA", "MEGALOPTERA",
];

// GBIF orderKeys for insects NOT in the 7 named groups. Termites (Isoptera) are
// folded into Blattodea in the GBIF backbone and have no separate key.
const OTHER_INSECT_ORDER_KEYS = [
  1003,    // Trichoptera
  800,     // Blattodea (incl. termites/Isoptera)
  1501,    // Neuroptera
  787,     // Plecoptera
  1460,    // Phasmida
  1225,    // Ephemeroptera
  788,     // Mantodea
  7612838, // Psocodea
  1228,    // Thysanoptera
  1224,    // Dermaptera
  1000,    // Mecoptera
  1451,    // Megaloptera
  1366,    // Siphonaptera
  1227,    // Strepsiptera
  1004,    // Zygentoma
  786,     // Raphidioptera
  1187,    // Archaeognatha
  584,     // Embioptera
  585,     // Grylloblattodea
  1226,    // Mantophasmatodea
  1229,    // Zoraptera
];

// =============================================================================
// TAXA
// =============================================================================

export const TAXA: Taxon[] = [
  // ── Vertebrates ──
  {
    id: "mammals", name: "Mammals", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["MAMMALIA"] }],
    gbif: [{ keyType: "classKey", keyValue: 359 }],
  },
  {
    id: "birds", name: "Birds", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["AVES"] }],
    gbif: [{ keyType: "classKey", keyValue: 212 }],
  },
  {
    id: "reptiles", name: "Reptiles", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["REPTILIA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 11592253 },
      { keyType: "classKey", keyValue: 11493978 },
      { keyType: "classKey", keyValue: 11418114 },
    ],
  },
  {
    id: "amphibians", name: "Amphibians", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["AMPHIBIA"] }],
    gbif: [{ keyType: "classKey", keyValue: 131 }],
  },
  {
    id: "fishes", name: "Fishes", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["ACTINOPTERYGII", "CHONDRICHTHYES", "MYXINI", "PETROMYZONTI", "SARCOPTERYGII"] }],
    gbif: [
      ...BONY_FISH_ORDER_KEYS.map((k) => ({ keyType: "orderKey" as const, keyValue: k })),
      { keyType: "classKey" as const, keyValue: 121 },  // Elasmobranchii (sharks, rays, skates)
      { keyType: "classKey" as const, keyValue: 120 },  // Holocephali (chimaeras)
      { keyType: "classKey" as const, keyValue: 119 },  // Myxini (hagfish)
      { keyType: "orderKey" as const, keyValue: 771 },  // Petromyzontiformes (lampreys)
    ],
  },

  // ── Invertebrates: Insects (Table 1a "Insects" row, split by order) ──
  {
    id: "beetles", name: "Beetles", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["COLEOPTERA"] }],
    gbif: [{ keyType: "orderKey", keyValue: 1470 }],
  },
  {
    id: "butterflies_and_moths", name: "Butterflies & Moths", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["LEPIDOPTERA"] }],
    gbif: [{ keyType: "orderKey", keyValue: 797 }],
  },
  {
    id: "flies_and_mosquitoes", name: "Flies & Mosquitoes", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["DIPTERA"] }],
    gbif: [{ keyType: "orderKey", keyValue: 811 }],
  },
  {
    id: "bees_wasps_and_ants", name: "Bees, Wasps & Ants", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["HYMENOPTERA"] }],
    gbif: [{ keyType: "orderKey", keyValue: 1457 }],
  },
  {
    id: "true_bugs", name: "True Bugs", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["HEMIPTERA"] }],
    gbif: [{ keyType: "orderKey", keyValue: 809 }],
  },
  {
    id: "grasshoppers_crickets_locusts", name: "Grasshoppers, Crickets & Locusts", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["ORTHOPTERA"] }],
    gbif: [{ keyType: "orderKey", keyValue: 1458 }],
  },
  {
    id: "dragonflies_and_damselflies", name: "Dragonflies & Damselflies", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["ODONATA"] }],
    gbif: [{ keyType: "orderKey", keyValue: 789 }],
  },
  {
    id: "other_insects", name: "Other Insects", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: OTHER_INSECT_ORDERS_REDLIST }],
    gbif: OTHER_INSECT_ORDER_KEYS.map((k) => ({ keyType: "orderKey" as const, keyValue: k })),
  },

  // ── Invertebrates: Other ──
  {
    id: "molluscs", name: "Molluscs", kingdomKey: 1,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["MOLLUSCA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 225 },
      { keyType: "classKey", keyValue: 137 },
    ],
  },
  {
    id: "crustaceans", name: "Crustaceans", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["MALACOSTRACA", "MAXILLOPODA", "BRANCHIOPODA", "OSTRACODA", "HEXANAUPLIA"] }],
    gbif: [{ keyType: "classKey", keyValue: 229 }],
  },
  {
    id: "arachnids", name: "Arachnids", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["ARACHNIDA"] }],
    gbif: [{ keyType: "classKey", keyValue: 367 }],
  },
  {
    id: "corals", name: "Corals & Cnidarians", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["SCLERACTINIA", "ALCYONACEA", "PENNATULACEA"] }],
    gbif: [{ keyType: "classKey", keyValue: 206 }],
  },
  {
    id: "velvet_worms", name: "Velvet Worms", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["UDEONYCHOPHORA"] }],
    gbif: [{ keyType: "classKey", keyValue: 62 }],
  },
  {
    id: "horseshoe_crabs", name: "Horseshoe Crabs", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["MEROSTOMATA"] }],
    gbif: [{ keyType: "classKey", keyValue: 351 }],
  },
  {
    id: "other_invertebrates", name: "Other Invertebrates", kingdomKey: 1,
    redlist: [
      // Non-coral Anthozoa (filtered by order to separate from corals in class ANTHOZOA)
      { filterColumn: "order_name", filterValues: [
        "ACTINIARIA", "ZOANTHARIA", "PENICILLARIA", "MALACALCYONCAEA", "SCLERALCYONACEA",
      ] },
      { filterColumn: "class_name", filterValues: [
        "HOLOTHUROIDEA", "CLITELLATA", "DIPLOPODA", "COLLEMBOLA", "CHILOPODA",
        "DEMOSPONGIAE", "HEXACTINELLIDA", "HYDROZOA", "NEMERTEA",
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
    id: "mosses", name: "Mosses", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["BRYOPHYTA", "ANTHOCEROTOPHYTA", "MARCHANTIOPHYTA"] }],
    gbif: [
      { keyType: "phylumKey", keyValue: 35 },  // Bryophyta
      { keyType: "phylumKey", keyValue: 13 },  // Anthocerotophyta
      { keyType: "phylumKey", keyValue: 9 },   // Marchantiophyta
    ],
  },
  {
    id: "ferns_and_allies", name: "Ferns and Allies", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["LYCOPODIOPSIDA", "ISOETOPSIDA", "EQUISETOPSIDA", "MARATTIOPSIDA", "POLYPODIOPSIDA", "PSILOTOPSIDA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 245 },     // Lycopodiopsida
      { keyType: "classKey", keyValue: 7228684 },  // Polypodiopsida
    ],
  },
  {
    id: "gymnosperms", name: "Gymnosperms", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["PINOPSIDA", "CYCADOPSIDA", "GINKGOOPSIDA", "GNETOPSIDA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 194 },  // Pinopsida
      { keyType: "classKey", keyValue: 228 },  // Cycadopsida
      { keyType: "classKey", keyValue: 244 },  // Ginkgoopsida
      { keyType: "classKey", keyValue: 282 },  // Gnetopsida
    ],
  },
  {
    id: "flowering_plants", name: "Flowering Plants", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["MAGNOLIOPSIDA", "LILIOPSIDA"] }],
    gbif: [
      { keyType: "classKey", keyValue: 220 },  // Magnoliopsida
      { keyType: "classKey", keyValue: 196 },  // Liliopsida
    ],
  },
  {
    id: "green_algae", name: "Green Algae", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["CHLOROPHYTA", "CHAROPHYTA"] }],
    gbif: [
      { keyType: "phylumKey", keyValue: 36 },      // Chlorophyta
      { keyType: "phylumKey", keyValue: 7819616 },  // Charophyta
    ],
  },
  {
    id: "red_algae", name: "Red Algae", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["RHODOPHYTA"] }],
    gbif: [{ keyType: "phylumKey", keyValue: 106 }],
  },

  // ── Fungi & Protists ──
  {
    id: "mushrooms", name: "Mushrooms, etc.", kingdomKey: 5,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["ASCOMYCOTA", "BASIDIOMYCOTA"] }],
    gbif: [
      { keyType: "phylumKey", keyValue: 34 },  // Basidiomycota
      { keyType: "phylumKey", keyValue: 95 },  // Ascomycota
    ],
  },
  {
    id: "brown_algae", name: "Brown Algae", kingdomKey: 4,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["HETEROKONTOPHYTA"] }],
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
