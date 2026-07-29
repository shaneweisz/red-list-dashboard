import DERIVED_KEYS from "../src/config/gbif-taxon-keys.json";

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

/**
 * A GBIF taxon key for one of the taxa making up a Table 1a group.
 *
 * These are no longer written by hand. They are derived from this file's own
 * `redlist` definitions by scripts/derive-gbif-taxon-keys.ts and stored in
 * src/config/gbif-taxon-keys.json, because a hand-maintained parallel list drifts
 * from the definition it mirrors — corals were defined as three orders while the
 * GBIF side carried one class key, and stopped covering octocorals the moment CoL
 * moved them.
 */
export interface GbifQuery {
  taxonKey: string;
  /** The IUCN name it came from, so a key in a query can be traced back. */
  fromName: string;
}

export interface Taxon {
  id: string;
  name: string;
  kingdomKey: number; // GBIF kingdom: 1=Animalia, 4=Chromista, 5=Fungi, 6=Plantae
  redlist: RedlistQuery[];
  /** Derived — see GbifQuery. Populated from the generated config at load time. */
  gbif: GbifQuery[];
}

// =============================================================================
// INSECT "OTHER" ORDERS
// =============================================================================

// The Table 1a "Insects" row is split into 7 named order-groups (Beetles,
// Butterflies & Moths, etc.) plus an "Other Insects" catch-all. Because the Red
// List SQL is include-only (no NOT-IN), the catch-all is defined by positive
// enumeration of every remaining order. Add new insect orders here as they
// appear in the source data; the build-taxa-summary lossless-split check (sum of
// the 8 groups == old single insecta total) will flag any drift.
//
// The GBIF keys for these orders are derived from this list rather than
// maintained beside it — see GbifQuery.

// Red List order_name values for insects NOT in the 7 named groups.
const OTHER_INSECT_ORDERS_REDLIST = [
  "PHASMIDA", "TRICHOPTERA", "MANTODEA", "PLECOPTERA", "BLATTODEA", "ISOPTERA",
  "EPHEMEROPTERA", "DERMAPTERA", "GRYLLOBLATTODEA", "PSOCODEA", "NEUROPTERA",
  "ARCHAEOGNATHA", "SIPHONAPTERA", "THYSANOPTERA", "MEGALOPTERA",
];

// =============================================================================
// TAXA
// =============================================================================

/**
 * The group definitions, before GBIF keys are attached. Exported for
 * derive-gbif-taxon-keys, which generates those keys from exactly this and so
 * cannot depend on them already existing.
 */
export const TAXA_DEFINITIONS: Array<Omit<Taxon, "gbif">> = [
  // ── Vertebrates ──
  {
    id: "mammals", name: "Mammals", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["MAMMALIA"] }],
  },
  {
    id: "birds", name: "Birds", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["AVES"] }],
  },
  {
    id: "reptiles", name: "Reptiles", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["REPTILIA"] }],
  },
  {
    id: "amphibians", name: "Amphibians", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["AMPHIBIA"] }],
  },
  {
    id: "fishes", name: "Fishes", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["ACTINOPTERYGII", "CHONDRICHTHYES", "MYXINI", "PETROMYZONTI", "SARCOPTERYGII"] }],
  },

  // ── Invertebrates: Insects (Table 1a "Insects" row, split by order) ──
  {
    id: "beetles", name: "Beetles", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["COLEOPTERA"] }],
  },
  {
    id: "butterflies_and_moths", name: "Butterflies & Moths", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["LEPIDOPTERA"] }],
  },
  {
    id: "flies_and_mosquitoes", name: "Flies & Mosquitoes", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["DIPTERA"] }],
  },
  {
    id: "bees_wasps_and_ants", name: "Bees, Wasps & Ants", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["HYMENOPTERA"] }],
  },
  {
    id: "true_bugs", name: "True Bugs", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["HEMIPTERA"] }],
  },
  {
    id: "grasshoppers_crickets_locusts", name: "Grasshoppers, Crickets & Locusts", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["ORTHOPTERA"] }],
  },
  {
    id: "dragonflies_and_damselflies", name: "Dragonflies & Damselflies", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["ODONATA"] }],
  },
  {
    id: "other_insects", name: "Other Insects", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: OTHER_INSECT_ORDERS_REDLIST }],
  },

  // ── Invertebrates: Other ──
  {
    id: "molluscs", name: "Molluscs", kingdomKey: 1,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["MOLLUSCA"] }],
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
  },
  {
    id: "arachnids", name: "Arachnids", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["ARACHNIDA"] }],
  },
  {
    id: "corals", name: "Corals & Cnidarians", kingdomKey: 1,
    redlist: [{ filterColumn: "order_name", filterValues: ["SCLERACTINIA", "ALCYONACEA", "PENNATULACEA"] }],
  },
  {
    id: "velvet_worms", name: "Velvet Worms", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["UDEONYCHOPHORA"] }],
  },
  {
    id: "horseshoe_crabs", name: "Horseshoe Crabs", kingdomKey: 1,
    redlist: [{ filterColumn: "class_name", filterValues: ["MEROSTOMATA"] }],
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
  },

  // ── Plants ──
  {
    id: "mosses", name: "Mosses", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["BRYOPHYTA", "ANTHOCEROTOPHYTA", "MARCHANTIOPHYTA"] }],
  },
  {
    id: "ferns_and_allies", name: "Ferns and Allies", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["LYCOPODIOPSIDA", "ISOETOPSIDA", "EQUISETOPSIDA", "MARATTIOPSIDA", "POLYPODIOPSIDA", "PSILOTOPSIDA"] }],
  },
  {
    id: "gymnosperms", name: "Gymnosperms", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["PINOPSIDA", "CYCADOPSIDA", "GINKGOOPSIDA", "GNETOPSIDA"] }],
  },
  {
    id: "flowering_plants", name: "Flowering Plants", kingdomKey: 6,
    redlist: [{ filterColumn: "class_name", filterValues: ["MAGNOLIOPSIDA", "LILIOPSIDA"] }],
  },
  {
    id: "green_algae", name: "Green Algae", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["CHLOROPHYTA", "CHAROPHYTA"] }],
  },
  {
    id: "red_algae", name: "Red Algae", kingdomKey: 6,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["RHODOPHYTA"] }],
  },

  // ── Fungi & Protists ──
  {
    id: "mushrooms", name: "Mushrooms, etc.", kingdomKey: 5,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["ASCOMYCOTA", "BASIDIOMYCOTA"] }],
  },
  {
    id: "brown_algae", name: "Brown Algae", kingdomKey: 4,
    redlist: [{ filterColumn: "phylum_name", filterValues: ["HETEROKONTOPHYTA"] }],
  },
];

// =============================================================================
// HELPERS
// =============================================================================

export const TAXA: Taxon[] = TAXA_DEFINITIONS.map(withGbifKeys);

const TAXA_BY_ID = new Map(TAXA.map((t) => [t.id, t]));

export function getTaxon(id: string): Taxon {
  const taxon = TAXA_BY_ID.get(id);
  if (!taxon) throw new Error(`Unknown taxon: ${id}. Available: ${TAXA.map((t) => t.id).join(", ")}`);
  assertHasGbifKeys(taxon);
  return taxon;
}

/**
 * A group with no GBIF keys fetches nothing and reports zero — the silent
 * failure this migration exists to stop. Checked when a group is handed out
 * rather than at import, so derive-gbif-taxon-keys can still run to generate the
 * keys that are missing.
 */
function assertHasGbifKeys(taxon: Taxon): void {
  if (taxon.gbif.length === 0) {
    throw new Error(
      `taxa: no GBIF keys for "${taxon.id}". Run scripts/derive-gbif-taxon-keys.ts --write; ` +
      `a group with no keys fetches nothing and silently reports zero.`
    );
  }
}

/** Attach the derived GBIF keys to each group. */
function withGbifKeys(taxon: Omit<Taxon, "gbif">): Taxon {
  const derived = (DERIVED_KEYS as Record<string, Array<{ redlistName: string; taxonKey: string | null }>>)[taxon.id] ?? [];
  const gbif = derived
    .filter((d) => d.taxonKey)
    .map((d) => ({ taxonKey: d.taxonKey as string, fromName: d.redlistName }));
  return { ...taxon, gbif };
}

export function getTaxa(ids?: string[]): Taxon[] {
  if (!ids) {
    TAXA.forEach(assertHasGbifKeys);
    return TAXA;
  }
  return ids.map(getTaxon);
}
