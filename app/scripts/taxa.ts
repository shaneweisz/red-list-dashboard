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
  /**
   * A Catalogue of Life Extended Release taxon key (alphanumeric, e.g. "6224G"
   * = Mammalia), passed to GBIF as `taxonKey` alongside the COL XR
   * `checklistKey`. Replaced the legacy GBIF Backbone integer keys (and their
   * rank-specific classKey/orderKey params) when gbif.org made COL XR its
   * default taxonomy in June 2026 — the backbone is frozen at 2023.
   */
  taxonKey: string;
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

// Bony fish (Actinopterygii) order keys. Kept as an explicit per-order list
// rather than collapsed into CoL's gigaclass Actinopterygii (8VR36): the list is
// a verified 1:1 carry-over of the orders the backbone-keyed pipeline queried,
// so it keeps the "Fishes" row's membership identical across the COL XR move.
// Shark/ray orders are covered by Elasmobranchii (LB) and are NOT included here.
const BONY_FISH_ORDER_KEYS: string[] = [
  "NX",      // Amiiformes
  "PJ",      // Anguilliformes
  "RY",      // Atheriniformes
  "S8",      // Aulopiformes
  "T6",      // Beloniformes
  "6228Z",   // Beryciformes
  "X2",      // Characiformes
  "YR",      // Clupeiformes
  "335",     // Cyprinodontiformes
  "37D",     // Esociformes
  "38T",     // Gadiformes
  // dropped: Gasterosteiformes -> suborder Gasterosteoidei, under Perciformes
  "PC",      // Perciformes
  "622V4",   // Pleuronectiformes
  "3VJ",     // Polymixiiformes
  // dropped: Scorpaeniformes -> suborder Scorpaenoidei, under Perciformes
  "6236K",   // Siluriformes
  "47D",     // Tetraodontiformes
  "46T",     // Syngnathiformes
  "463",     // Stomiiformes
  "4BY",     // Zeiformes
  "46Q",     // Synbranchiformes
  // dropped: Stephanoberyciformes -> suborder Stephanoberycoidei, under Beryciformes
  "3LB",     // Mugiliformes
  "3QF",     // Osmeriformes
  "3QH",     // Osteoglossiformes
  "MJ",      // Acipenseriformes
  "NH",      // Albuliformes
  "SV",      // Batrachoidiformes
  // dropped: Cetomimiformes -> family Cetomimidae, under Beryciformes
  "334",     // Cypriniformes
  "62246",   // Gobiesociformes
  "6223X",   // Gonorynchiformes
  "623BF",   // Gymnotiformes
  "3FS",     // Lepisosteiformes
  "3GY",     // Lophiiformes
  "3LN",     // Myctophiformes
  "3NQ",     // Notacanthiformes
  "3PT",     // Ophidiiformes
  "3SB",     // Percopsiformes
  "3VN",     // Polypteriformes
  // dropped: Saccopharyngiformes -> order Anguilliformes, already queried
  "3ZR",     // Salmoniformes
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
const OTHER_INSECT_ORDER_KEYS: string[] = [
  "TR2",     // Trichoptera
  "KZRLZ",   // Blattodea
  "3ND",     // Neuroptera
  "9CHXG",   // Plecoptera
  "8NKFG",   // Phasmida
  "372",     // Ephemeroptera
  "3HS",     // Mantodea
  "CSYS4",   // Psocodea
  "622VS",   // Thysanoptera
  "8MP8D",   // Dermaptera
  "3J4",     // Mecoptera
  "3J8",     // Megaloptera
  "43J",     // Siphonaptera
  "B8VFN",   // Strepsiptera
  "4C8",     // Zygentoma
  "6236X",   // Raphidioptera
  "B6MTR",   // Archaeognatha
  "8MP8H",   // Embioptera
  "6223L",   // Grylloblattodea
  "8MP8M",   // Mantophasmatodea
  "8MP8V",   // Zoraptera
];

// =============================================================================
// TAXA
// =============================================================================

export const TAXA: Taxon[] = [
  // ── Vertebrates ──
  {
    id: "mammals", name: "Mammals", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["MAMMALIA"] }],
    gbif: [{ taxonKey: "6224G" }],
  },
  {
    id: "birds", name: "Birds", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["AVES"] }],
    gbif: [{ taxonKey: "V2" }],
  },
  {
    id: "reptiles", name: "Reptiles", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["REPTILIA"] }],
    gbif: [
      { taxonKey: "45C" },      // Squamata
      { taxonKey: "329" },      // Crocodylia
      { taxonKey: "477" },      // Testudines
    ],
  },
  {
    id: "amphibians", name: "Amphibians", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["AMPHIBIA"] }],
    gbif: [{ taxonKey: "PH" }],
  },
  {
    id: "fishes", name: "Fishes", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["ACTINOPTERYGII", "CHONDRICHTHYES", "MYXINI", "PETROMYZONTI", "SARCOPTERYGII"] }],
    gbif: [
      ...BONY_FISH_ORDER_KEYS.map((k) => ({ taxonKey: k })),
      { taxonKey: "LB" },  // Elasmobranchii (sharks, rays, skates)
      { taxonKey: "CK" },  // Holocephali (chimaeras)
      { taxonKey: "6225G" },  // Myxini (hagfish)
      { taxonKey: "3SP" },  // Petromyzontiformes (lampreys)
    ],
  },

  // ── Invertebrates: Insects (Table 1a "Insects" row, split by order) ──
  {
    id: "beetles", name: "Beetles", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["COLEOPTERA"] }],
    gbif: [{ taxonKey: "C2L" }],
  },
  {
    id: "butterflies_and_moths", name: "Butterflies & Moths", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["LEPIDOPTERA"] }],
    gbif: [{ taxonKey: "B6L67" }],
  },
  {
    id: "flies_and_mosquitoes", name: "Flies & Mosquitoes", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["DIPTERA"] }],
    gbif: [{ taxonKey: "D2P" }],
  },
  {
    id: "bees_wasps_and_ants", name: "Bees, Wasps & Ants", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["HYMENOPTERA"] }],
    gbif: [{ taxonKey: "HYM" }],
  },
  {
    id: "true_bugs", name: "True Bugs", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["HEMIPTERA"] }],
    gbif: [{ taxonKey: "BXVWV" }],
  },
  {
    id: "grasshoppers_crickets_locusts", name: "Grasshoppers, Crickets & Locusts", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["ORTHOPTERA"] }],
    gbif: [{ taxonKey: "CJBKK" }],
  },
  {
    id: "dragonflies_and_damselflies", name: "Dragonflies & Damselflies", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["ODONATA"] }],
    gbif: [{ taxonKey: "B6LCL" }],
  },
  {
    id: "other_insects", name: "Other Insects", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: OTHER_INSECT_ORDERS_REDLIST }],
    gbif: OTHER_INSECT_ORDER_KEYS.map((k) => ({ taxonKey: k })),
  },

  // ── Invertebrates: Other ──
  {
    id: "molluscs", name: "Molluscs", kingdomKey: 1,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["MOLLUSCA"] }],
    gbif: [
      { taxonKey: "7NF3Y" },    // Gastropoda
      { taxonKey: "7NF3C" },    // Bivalvia
    ],
  },
  {
    id: "crustaceans", name: "Crustaceans", kingdomKey: 1,
    // IUCN's Table 1a note 6 defines crustaceans as 7 classes — Maxillopoda has
    // since been split (Copepoda/Thecostraca/Hexanauplia/Ichthyostraca), and the
    // IUCN SIS database has already moved a few species out of the legacy
    // Maxillopoda bucket into "THEOCOSTRACA" (their own misspelling of
    // Thecostraca — verified against the live DB, not a typo here). Copepoda and
    // Ichthyostraca have no SIS-assessed species yet (verified: 0 taxons rows),
    // so they're omitted rather than added speculatively — add them if/when SIS
    // starts using those class names. Missing THEOCOSTRACA silently dropped 2
    // barnacle species (Armatobalanus nefrens, Menesiniella aquila) from every
    // crustaceans fetch.
    redlist: [{ filterColumn: "class_name", filterValues: ["MALACOSTRACA", "MAXILLOPODA", "BRANCHIOPODA", "OSTRACODA", "HEXANAUPLIA", "THEOCOSTRACA"] }],
    gbif: [{ taxonKey: "MC" }],
  },
  {
    id: "arachnids", name: "Arachnids", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["ARACHNIDA"] }],
    gbif: [{ taxonKey: "CCQKT" }],
  },
  {
    id: "corals", name: "Corals & Cnidarians", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["SCLERACTINIA", "ALCYONACEA", "PENNATULACEA"] }],
    gbif: [{ taxonKey: "7S" }],
  },
  {
    id: "velvet_worms", name: "Velvet Worms", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["UDEONYCHOPHORA"] }],
    gbif: [{ taxonKey: "BV844" }],
  },
  {
    id: "horseshoe_crabs", name: "Horseshoe Crabs", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["MEROSTOMATA"] }],
    gbif: [{ taxonKey: "B8VF7" }],
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
      { taxonKey: "B8V3W" },    // Holothuroidea
      { taxonKey: "9H" },    // Clitellata
      { taxonKey: "7NF3S" },    // Diplopoda
      { taxonKey: "KZS5W" }, // Collembola
      { taxonKey: "93" },    // Chilopoda
      { taxonKey: "84JN8" },    // Demospongiae
      { taxonKey: "B8V3X" },    // Hydrozoa
      { taxonKey: "B8V3Q" },    // Asteroidea
      { taxonKey: "84JMY" },    // Calcarea
      { taxonKey: "B8TXG" },    // Polychaeta
      { taxonKey: "BDSSX" },    // Turbellaria
      { taxonKey: "B8V3V" },    // Echinoidea
      { taxonKey: "5C" },     // Nemertea
    ],
  },

  // ── Plants ──
  {
    id: "mosses", name: "Mosses", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["BRYOPHYTA", "ANTHOCEROTOPHYTA", "MARCHANTIOPHYTA"] }],
    gbif: [
      { taxonKey: "BJ5TM" },  // Bryophyta
      { taxonKey: "9JHQ8" },  // Anthocerotophyta
      { taxonKey: "9J9G3" },   // Marchantiophyta
    ],
  },
  {
    id: "ferns_and_allies", name: "Ferns and Allies", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["LYCOPODIOPSIDA", "ISOETOPSIDA", "EQUISETOPSIDA", "MARATTIOPSIDA", "POLYPODIOPSIDA", "PSILOTOPSIDA"] }],
    gbif: [
      { taxonKey: "LYC" },     // Lycopodiopsida
      { taxonKey: "GV" },  // Polypodiopsida
    ],
  },
  {
    id: "gymnosperms", name: "Gymnosperms", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["PINOPSIDA", "CYCADOPSIDA", "GINKGOOPSIDA", "GNETOPSIDA"] }],
    gbif: [
      { taxonKey: "C7ZVJ" },  // Pinopsida
      { taxonKey: "CGVH9" },  // Cycadopsida
      { taxonKey: "BT" },  // Ginkgoopsida
      { taxonKey: "C7CGK" },  // Gnetopsida
    ],
  },
  {
    id: "flowering_plants", name: "Flowering Plants", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["MAGNOLIOPSIDA", "LILIOPSIDA"] }],
    gbif: [
      { taxonKey: "MG" },  // Magnoliopsida
      { taxonKey: "L2L" },  // Liliopsida
    ],
  },
  {
    id: "green_algae", name: "Green Algae", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["CHLOROPHYTA", "CHAROPHYTA"] }],
    gbif: [
      { taxonKey: "CGV7L" },      // Chlorophyta
      { taxonKey: "KZS5S" },  // Charophyta
    ],
  },
  {
    id: "red_algae", name: "Red Algae", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["RHODOPHYTA"] }],
    gbif: [{ taxonKey: "L2MHG" }],
  },

  // ── Fungi & Protists ──
  {
    id: "mushrooms", name: "Mushrooms, etc.", kingdomKey: 5,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["ASCOMYCOTA", "BASIDIOMYCOTA"] }],
    gbif: [
      { taxonKey: "BM" },  // Basidiomycota
      { taxonKey: "SM" },  // Ascomycota
    ],
  },
  {
    id: "brown_algae", name: "Brown Algae", kingdomKey: 4,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["HETEROKONTOPHYTA"] }],
    gbif: [{ taxonKey: "5H" }],
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
