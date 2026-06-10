/**
 * Single taxonomy tree for the Red List dashboard.
 *
 * Rooted at "all", using IUCN Table 1a groups as the primary hierarchy.
 * The current 8 display taxa become a "view" (see taxonomy-views.ts).
 * Supports arbitrary nested drill-downs via children arrays.
 *
 * Each node's filter is **self-contained** — no inheritance from parent.
 * IUCN API endpoints and GBIF keys stay separate in sync-script config.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface SpeciesFilter {
  /** Which Table 1a CSV files to load */
  csvGroups: string[];
  /** Filter by class_name (lowercase) */
  classNames?: string[];
  /** Filter by order_name (lowercase) */
  orderNames?: string[];
  /** Filter by family (lowercase) — for future deeper drill-downs */
  families?: string[];
  /** Exclude mode: exclude these orders (for catch-all nodes) */
  excludeOrders?: string[];
  /** Exclude mode: exclude these families */
  excludeFamilies?: string[];
  /** Exclude mode: exclude these classes */
  excludeClasses?: string[];
}

export interface TaxonomyNode {
  /** Stable ID for URLs and lookups */
  id: string;
  /** Display name */
  name: string;
  /** Self-contained: which CSVs + how to filter */
  filter: SpeciesFilter;
  /** Optional estimated described species count */
  estimatedDescribed?: number;
  /** Short citation for the estimate */
  estimatedSource?: string;
  /** URL to the source */
  estimatedSourceUrl?: string;
  /** UI color (only on nodes shown at top level) */
  color?: string;
  /** Arbitrary depth children */
  children?: TaxonomyNode[];
}

// ─── Sources ─────────────────────────────────────────────────────────

const IUCN_SOURCE = "IUCN 2025-2";
const IUCN_SOURCE_URL = "https://nc.iucnredlist.org/redlist/content/attachment_files/2025-2_RL_Table1a.pdf";
const MDD = "Mammal Diversity Database (v2.0, 2025)";
const MDD_URL = "https://www.mammaldiversity.org/explore/taxonomy-table/";
const REPTILE_DB = "Reptile Database, Sep 2025";
const REPTILE_DB_URL = "http://www.reptile-database.org/db-info/SpeciesStat.html";
const AMPHIBIAWEB = "AmphibiaWeb, 2025";
const AMPHIBIAWEB_URL = "https://amphibiaweb.org/amphibian/speciesnums.html";
const ESCHMEYER = "Eschmeyer's Catalog of Fishes, Sep 2025";
const ESCHMEYER_URL = "https://researcharchive.calacademy.org/research/ichthyology/catalog/SpeciesByFamily.asp";
const ZHANG_2011 = "Zhang 2011, Zootaxa 3148";
const ZHANG_2011_URL = "https://doi.org/10.11646/zootaxa.3148.1.1";
const COL_2025 = "Catalogue of Life 2025";
const COL_2025_URL = "https://doi.org/10.48580/dgnfb";
const CHRISTENHUSZ = "Christenhusz & Byng 2016, Phytotaxa 261(3)";
const CHRISTENHUSZ_URL = "https://doi.org/10.11646/phytotaxa.261.3.1";
const SPECIES_FUNGORUM = "Species Fungorum Plus via Catalogue of Life";
const SPECIES_FUNGORUM_URL = "https://doi.org/10.48580/dg9ld-4hj";

// ─── Mammal subgroup helpers ─────────────────────────────────────────

const MAMMAL_NAMED_ORDERS = [
  "rodentia", "chiroptera", "eulipotyphla",
  "primates", "diprotodontia", "dasyuromorphia", "didelphimorphia",
  "peramelemorphia", "paucituberculata", "notoryctemorphia", "microbiotheria",
  "carnivora", "artiodactyla", "lagomorpha", "sirenia",
  "perissodactyla", "pholidota",
];

// Insect base CSV groups (the Table 1a "Insects" row, split by order)
const ALL_INSECT_GROUPS = [
  "beetles", "butterflies_and_moths", "flies_and_mosquitoes", "bees_wasps_and_ants",
  "true_bugs", "grasshoppers_crickets_locusts", "dragonflies_and_damselflies", "other_insects",
];

// ─── Plant taxonomy ──────────────────────────────────────────────────
//
// Plant Table 1a groups are leaves. We deliberately do not drill down:
// robust described-species counts at the class and order level don't
// exist across the full tree, and showing "X assessed of 0 described"
// would read as broken data to specialists.

// Fungi ascomycota orders
const ASCOMYCOTA_ORDERS = [
  "eurotiales", "hypocreales", "xylariales", "pleosporales", "capnodiales",
  "helotiales", "orbiliales", "pezizales", "rhytismatales", "leotiales",
  "dothideales", "chaetothyriales", "verrucariales", "arthoniales",
  "ostropales", "pertusariales", "lecanorales", "peltigerales",
  "teloschistales", "caliciales", "acarosporales", "geoglossales",
  "cyttariales", "coryneliales", "trypetheliales",
];

// All 28 Table 1a CSV groups (Insects split into 8 order-based groups)
export const ALL_CSV_GROUPS = [
  "mammals", "birds", "reptiles", "amphibians", "fishes",
  ...ALL_INSECT_GROUPS,
  "arachnids", "molluscs", "crustaceans", "corals",
  "other_invertebrates", "velvet_worms", "horseshoe_crabs",
  "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
  "green_algae", "red_algae", "brown_algae",
  "mushrooms",
];

const ALL_INVERTEBRATE_GROUPS = [
  ...ALL_INSECT_GROUPS,
  "arachnids", "molluscs", "crustaceans", "corals",
  "other_invertebrates", "velvet_worms", "horseshoe_crabs",
];

const ALL_PLANT_GROUPS = [
  "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
  "green_algae", "red_algae",
];

// ─── Helpers ─────────────────────────────────────────────────────────

/** Deep-clone a TaxonomyNode, prefixing all IDs recursively. */
function prefixTree(node: TaxonomyNode, prefix: string): TaxonomyNode {
  return {
    ...node,
    id: prefix + node.id,
    children: node.children?.map(c => prefixTree(c, prefix)),
  };
}

// ─── Canonical Table 1a nodes (reused in virtual grouping nodes) ─────

const INSECTA_NODE: TaxonomyNode = {
  id: "insecta",
  name: "Insects",
  filter: { csvGroups: ALL_INSECT_GROUPS },
  estimatedDescribed: 1_003_469,
  estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ")",
  estimatedSourceUrl: IUCN_SOURCE_URL,
  children: [
    { id: "beetles", name: "Beetles", filter: { csvGroups: ["beetles"] }, estimatedDescribed: 392_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "butterflies-moths", name: "Butterflies & Moths", filter: { csvGroups: ["butterflies_and_moths"] }, estimatedDescribed: 160_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "flies-mosquitoes", name: "Flies & Mosquitoes", filter: { csvGroups: ["flies_and_mosquitoes"] }, estimatedDescribed: 155_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "bees-wasps-ants", name: "Bees, Wasps & Ants", filter: { csvGroups: ["bees_wasps_and_ants"] }, estimatedDescribed: 153_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "true-bugs", name: "True Bugs", filter: { csvGroups: ["true_bugs"] }, estimatedDescribed: 82_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "grasshoppers-crickets", name: "Grasshoppers, Crickets & Locusts", filter: { csvGroups: ["grasshoppers_crickets_locusts"] }, estimatedDescribed: 26_000, estimatedSource: "Orthoptera Species File, 2025", estimatedSourceUrl: "https://orthoptera.speciesfile.org/" },
    { id: "dragonflies-damselflies", name: "Dragonflies & Damselflies", filter: { csvGroups: ["dragonflies_and_damselflies"] }, estimatedDescribed: 6_400, estimatedSource: "World Odonata List, 2025", estimatedSourceUrl: "https://www.pugetsound.edu/puget-sound-museum-natural-history/biodiversity-resources/insects/dragonflies/world-odonata-list" },
    { id: "other-insects", name: "Other Insects", filter: { csvGroups: ["other_insects"] }, estimatedDescribed: 29_069, estimatedSource: "Remainder from IUCN Table 1a total of 1,003,469 (" + COL_2025 + ")", estimatedSourceUrl: COL_2025_URL },
  ],
};

const ARACHNIDA_NODE: TaxonomyNode = {
  id: "arachnids",
  name: "Arachnids",
  filter: { csvGroups: ["arachnids"] },
  estimatedDescribed: 97_085,
  estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ")",
  estimatedSourceUrl: COL_2025_URL,
};

const MOLLUSCA_NODE: TaxonomyNode = {
  id: "molluscs",
  name: "Molluscs",
  filter: { csvGroups: ["molluscs"] },
  estimatedDescribed: 88_244,
  estimatedSource: IUCN_SOURCE + " (MolluscaBase 2025)",
  estimatedSourceUrl: "http://www.molluscabase.org",
};

const CRUSTACEA_NODE: TaxonomyNode = {
  id: "crustaceans",
  name: "Crustaceans",
  filter: { csvGroups: ["crustaceans"] },
  estimatedDescribed: 83_263,
  estimatedSource: IUCN_SOURCE + " (" + COL_2025 + "; World Ostracoda Database)",
  estimatedSourceUrl: COL_2025_URL,
};

const CORALS_NODE: TaxonomyNode = {
  id: "corals",
  name: "Corals & Cnidarians",
  filter: { csvGroups: ["corals"] },
  estimatedDescribed: 5_672,
  estimatedSource: IUCN_SOURCE + " (WoRMS 2025)",
  estimatedSourceUrl: "https://www.marinespecies.org",
};

const OTHER_INVERTEBRATES_NODE: TaxonomyNode = {
  id: "other_invertebrates",
  name: "Other Invertebrates",
  filter: { csvGroups: ["other_invertebrates"] },
  estimatedDescribed: 230_485,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: COL_2025_URL,
  children: [
    {
      id: "echinoderms",
      name: "Echinoderms",
      filter: {
        csvGroups: ["other_invertebrates"],
        classNames: ["asteroidea", "echinoidea", "holothuroidea"],
      },
      estimatedDescribed: 7_000,
      estimatedSource: "~7,000 extant spp. (WoRMS; Animal Diversity Web)",
      estimatedSourceUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=1806",
    },
    {
      id: "annelids",
      name: "Annelids",
      filter: {
        csvGroups: ["other_invertebrates"],
        classNames: ["clitellata", "polychaeta"],
      },
      estimatedDescribed: 22_000,
      estimatedSource: "~22K Annelida spp. (WoRMS; Catalogue of Life)",
      estimatedSourceUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=882",
    },
    {
      id: "other-invertebrates-catch-all",
      name: "Other Invertebrates",
      filter: {
        csvGroups: ["other_invertebrates"],
        excludeClasses: ["asteroidea", "echinoidea", "holothuroidea", "clitellata", "polychaeta"],
      },
      estimatedDescribed: 201_485,
      estimatedSource: "Remainder from IUCN Table 1a 'Others', minus Echinoderms & Worms",
      estimatedSourceUrl: COL_2025_URL,
    },
  ],
};

const VELVET_WORMS_NODE: TaxonomyNode = {
  id: "velvet_worms",
  name: "Velvet Worms",
  filter: { csvGroups: ["velvet_worms"] },
  estimatedDescribed: 220,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

const HORSESHOE_CRABS_NODE: TaxonomyNode = {
  id: "horseshoe_crabs",
  name: "Horseshoe Crabs",
  filter: { csvGroups: ["horseshoe_crabs"] },
  estimatedDescribed: 4,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

// ─── Plant nodes (all leaves — see comment above) ────────────────────

const FLOWERING_PLANTS_NODE: TaxonomyNode = {
  id: "flowering_plants",
  name: "Flowering Plants",
  filter: { csvGroups: ["flowering_plants"] },
  estimatedDescribed: 369_000,
  estimatedSource: IUCN_SOURCE + " (State of the World's Plants 2017)",
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

const GYMNOSPERMS_NODE: TaxonomyNode = {
  id: "gymnosperms",
  name: "Gymnosperms",
  filter: { csvGroups: ["gymnosperms"] },
  estimatedDescribed: 1_113,
  estimatedSource: IUCN_SOURCE + " (Christenhusz et al. 2011)",
  estimatedSourceUrl: "https://stateoftheworldsplants.org/2017/report/SOTWP_2017.pdf",
};

const FERNS_AND_ALLIES_NODE: TaxonomyNode = {
  id: "ferns_and_allies",
  name: "Ferns & Allies",
  filter: { csvGroups: ["ferns_and_allies"] },
  estimatedDescribed: 11_800,
  estimatedSource: IUCN_SOURCE + " (State of the World's Plants 2017)",
  estimatedSourceUrl: "https://stateoftheworldsplants.org/2017/report/SOTWP_2017.pdf",
};

const MOSSES_NODE: TaxonomyNode = {
  id: "mosses",
  name: "Mosses, Liverworts & Hornworts",
  filter: { csvGroups: ["mosses"] },
  estimatedDescribed: 21_925,
  estimatedSource: IUCN_SOURCE + " (" + CHRISTENHUSZ + ")",
  estimatedSourceUrl: CHRISTENHUSZ_URL,
};

const GREEN_ALGAE_NODE: TaxonomyNode = {
  id: "green_algae",
  name: "Green Algae",
  filter: { csvGroups: ["green_algae"] },
  estimatedDescribed: 14_550,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

const RED_ALGAE_NODE: TaxonomyNode = {
  id: "red_algae",
  name: "Red Algae",
  filter: { csvGroups: ["red_algae"] },
  estimatedDescribed: 7_744,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

const MUSHROOMS_NODE: TaxonomyNode = {
  id: "mushrooms",
  name: "Fungi",
  filter: { csvGroups: ["mushrooms"] },
  estimatedDescribed: 157_648,
  estimatedSource: IUCN_SOURCE + " (" + SPECIES_FUNGORUM + ")",
  estimatedSourceUrl: SPECIES_FUNGORUM_URL,
  children: [
    {
      id: "ascomycota",
      name: "Ascomycota",
      filter: { csvGroups: ["mushrooms"], orderNames: ASCOMYCOTA_ORDERS },
      estimatedDescribed: 98_000,
      estimatedSource: "~98K Ascomycota spp. (" + SPECIES_FUNGORUM + "; He et al. 2019)",
      estimatedSourceUrl: SPECIES_FUNGORUM_URL,
    },
    {
      id: "other-fungi",
      name: "Other Fungi",
      filter: { csvGroups: ["mushrooms"], excludeOrders: ASCOMYCOTA_ORDERS },
      estimatedDescribed: 59_648,
      estimatedSource: "Remainder of 157,648 total fungi — mostly Basidiomycota, plus Chytridiomycota, Zygomycota, etc. (" + SPECIES_FUNGORUM + ")",
      estimatedSourceUrl: SPECIES_FUNGORUM_URL,
    },
  ],
};

const BROWN_ALGAE_NODE: TaxonomyNode = {
  id: "brown_algae",
  name: "Brown Algae",
  filter: { csvGroups: ["brown_algae"] },
  estimatedDescribed: 5_005,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

// ─── The Tree ────────────────────────────────────────────────────────

export const TAXONOMY_TREE: TaxonomyNode = {
  id: "all",
  name: "All Species",
  filter: { csvGroups: ALL_CSV_GROUPS },
  estimatedDescribed: 2_173_939,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
  color: "#dc2626",
  children: [
    // ─── MAMMALS ───────────────────────────────────────────────────────
    {
      id: "mammals",
      name: "Mammals",
      filter: { csvGroups: ["mammals"] },
      estimatedDescribed: 6_819,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#f97316",
      children: [
        {
          id: "rodents",
          name: "Rodents",
          filter: { csvGroups: ["mammals"], orderNames: ["rodentia"] },
          estimatedDescribed: 2_747,
          estimatedSource: MDD + " — Rodentia",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "bats",
          name: "Bats",
          filter: { csvGroups: ["mammals"], orderNames: ["chiroptera"] },
          estimatedDescribed: 1_485,
          estimatedSource: MDD + " — Chiroptera",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "eulipotyphla",
          name: "Eulipotyphla",
          filter: { csvGroups: ["mammals"], orderNames: ["eulipotyphla"] },
          estimatedDescribed: 599,
          estimatedSource: MDD + " — Eulipotyphla (hedgehogs, shrews, moles, solenodons)",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "primates",
          name: "Primates",
          filter: { csvGroups: ["mammals"], orderNames: ["primates"] },
          estimatedDescribed: 522,
          estimatedSource: MDD + " — Primates",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "marsupials",
          name: "Marsupials",
          filter: {
            csvGroups: ["mammals"],
            orderNames: [
              "diprotodontia", "dasyuromorphia", "didelphimorphia",
              "peramelemorphia", "paucituberculata", "notoryctemorphia", "microbiotheria",
            ],
          },
          estimatedDescribed: 416,
          estimatedSource: MDD + " — sum of 7 marsupial orders",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "carnivores",
          name: "Carnivores",
          filter: { csvGroups: ["mammals"], orderNames: ["carnivora"] },
          estimatedDescribed: 319,
          estimatedSource: MDD + " — Carnivora",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "artiodactyls",
          name: "Artiodactyls",
          filter: { csvGroups: ["mammals"], orderNames: ["artiodactyla"] },
          estimatedDescribed: 371,
          estimatedSource: MDD + " — Artiodactyla (includes cetaceans under Cetartiodactyla)",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "rabbits-hares",
          name: "Rabbits & Hares",
          filter: { csvGroups: ["mammals"], orderNames: ["lagomorpha"] },
          estimatedDescribed: 112,
          estimatedSource: MDD + " — Lagomorpha",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "sirenians",
          name: "Sirenians",
          filter: { csvGroups: ["mammals"], orderNames: ["sirenia"] },
          estimatedDescribed: 5,
          estimatedSource: MDD + " — Sirenia (manatees + dugong)",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "odd-toed-ungulates",
          name: "Odd-toed Ungulates",
          filter: { csvGroups: ["mammals"], orderNames: ["perissodactyla"] },
          estimatedDescribed: 18,
          estimatedSource: MDD + " — Perissodactyla",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "pangolins",
          name: "Pangolins",
          filter: { csvGroups: ["mammals"], orderNames: ["pholidota"] },
          estimatedDescribed: 8,
          estimatedSource: MDD + " — Pholidota",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "other-mammals",
          name: "Other Mammals",
          filter: {
            csvGroups: ["mammals"],
            excludeOrders: MAMMAL_NAMED_ORDERS,
          },
          estimatedDescribed: 217,
          estimatedSource: "Remainder of IUCN Table 1a total of 6,819 minus " + MDD + " named orders (incl. Afrosoricida ~55 + Macroscelidea ~20 + other small orders)",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
      ],
    },

    // ─── BIRDS ─────────────────────────────────────────────────────────
    {
      id: "birds",
      name: "Birds",
      filter: { csvGroups: ["birds"] },
      estimatedDescribed: 11_185,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#3b82f6",
    },

    // ─── REPTILES ──────────────────────────────────────────────────────
    {
      id: "reptiles",
      name: "Reptiles",
      filter: { csvGroups: ["reptiles"] },
      estimatedDescribed: 12_502,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#84cc16",
      children: [
        {
          id: "squamates",
          name: "Squamates",
          filter: { csvGroups: ["reptiles"], orderNames: ["squamata"] },
          estimatedDescribed: 12_108,
          estimatedSource: "Reptile Database, Sep 2025 — Squamata (lizards, snakes, amphisbaenians)",
          estimatedSourceUrl: REPTILE_DB_URL,
        },
        {
          id: "turtles-tortoises",
          name: "Turtles & Tortoises",
          filter: { csvGroups: ["reptiles"], orderNames: ["testudines"] },
          estimatedDescribed: 366,
          estimatedSource: REPTILE_DB,
          estimatedSourceUrl: REPTILE_DB_URL,
        },
        {
          id: "crocodilians",
          name: "Crocodilians",
          filter: { csvGroups: ["reptiles"], orderNames: ["crocodylia"] },
          estimatedDescribed: 27,
          estimatedSource: REPTILE_DB,
          estimatedSourceUrl: REPTILE_DB_URL,
        },
        {
          id: "tuataras",
          name: "Tuataras",
          filter: { csvGroups: ["reptiles"], orderNames: ["rhynchocephalia"] },
          estimatedDescribed: 1,
          estimatedSource: REPTILE_DB + " — Rhynchocephalia (Sphenodon punctatus)",
          estimatedSourceUrl: REPTILE_DB_URL,
        },
      ],
    },

    // ─── AMPHIBIANS ────────────────────────────────────────────────────
    {
      id: "amphibians",
      name: "Amphibians",
      filter: { csvGroups: ["amphibians"] },
      estimatedDescribed: 8_918,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#14b8a6",
      children: [
        {
          id: "frogs-toads",
          name: "Frogs & Toads",
          filter: { csvGroups: ["amphibians"], orderNames: ["anura"] },
          estimatedDescribed: 7_948,
          estimatedSource: AMPHIBIAWEB,
          estimatedSourceUrl: AMPHIBIAWEB_URL,
        },
        {
          id: "salamanders-newts",
          name: "Salamanders & Newts",
          filter: { csvGroups: ["amphibians"], orderNames: ["caudata"] },
          estimatedDescribed: 829,
          estimatedSource: AMPHIBIAWEB,
          estimatedSourceUrl: AMPHIBIAWEB_URL,
        },
        {
          id: "caecilians",
          name: "Caecilians",
          filter: { csvGroups: ["amphibians"], orderNames: ["gymnophiona"] },
          estimatedDescribed: 231,
          estimatedSource: AMPHIBIAWEB,
          estimatedSourceUrl: AMPHIBIAWEB_URL,
        },
      ],
    },

    // ─── FISHES ────────────────────────────────────────────────────────
    {
      id: "fishes",
      name: "Fishes",
      filter: { csvGroups: ["fishes"] },
      estimatedDescribed: 37_288,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#06b6d4",
      children: [
        {
          id: "ray-finned-fishes",
          name: "Ray-finned Fishes",
          filter: { csvGroups: ["fishes"], classNames: ["actinopterygii"] },
          estimatedDescribed: 35_872,
          estimatedSource: ESCHMEYER + " — Actinopterygii",
          estimatedSourceUrl: ESCHMEYER_URL,
        },
        {
          id: "lobe-finned-fishes",
          name: "Lobe-finned Fishes",
          filter: { csvGroups: ["fishes"], classNames: ["sarcopterygii"] },
          estimatedDescribed: 8,
          estimatedSource: ESCHMEYER + " — Sarcopterygii (coelacanths + lungfish; paraphyletic once tetrapods are excluded)",
          estimatedSourceUrl: ESCHMEYER_URL,
        },
        {
          id: "sharks-rays",
          name: "Sharks & Rays",
          filter: { csvGroups: ["fishes"], classNames: ["chondrichthyes"] },
          estimatedDescribed: 1_282,
          estimatedSource: ESCHMEYER,
          estimatedSourceUrl: ESCHMEYER_URL,
        },
        {
          id: "jawless-fish",
          name: "Jawless Fish",
          filter: { csvGroups: ["fishes"], classNames: ["myxini", "petromyzonti"] },
          estimatedDescribed: 126,
          estimatedSource: ESCHMEYER + " (~82 Myxini + ~44 Petromyzonti)",
          estimatedSourceUrl: ESCHMEYER_URL,
        },
      ],
    },

    // ─── INSECTA ───────────────────────────────────────────────────────
    INSECTA_NODE,

    // ─── ARACHNIDA (leaf) ──────────────────────────────────────────────
    ARACHNIDA_NODE,

    // ─── MOLLUSCA (leaf) ───────────────────────────────────────────────
    MOLLUSCA_NODE,

    // ─── CRUSTACEA (leaf) ──────────────────────────────────────────────
    CRUSTACEA_NODE,

    // ─── CORALS (leaf) ─────────────────────────────────────────────────
    CORALS_NODE,

    // ─── OTHER INVERTEBRATES ───────────────────────────────────────────
    OTHER_INVERTEBRATES_NODE,

    // ─── VELVET WORMS (leaf) ───────────────────────────────────────────
    VELVET_WORMS_NODE,

    // ─── HORSESHOE CRABS (leaf) ────────────────────────────────────────
    HORSESHOE_CRABS_NODE,

    // ─── FLOWERING PLANTS ──────────────────────────────────────────────
    FLOWERING_PLANTS_NODE,

    // ─── GYMNOSPERMS (leaf) ────────────────────────────────────────────
    GYMNOSPERMS_NODE,

    // ─── FERNS & ALLIES (leaf) ─────────────────────────────────────────
    FERNS_AND_ALLIES_NODE,

    // ─── MOSSES (leaf) ─────────────────────────────────────────────────
    MOSSES_NODE,

    // ─── GREEN ALGAE (leaf) ────────────────────────────────────────────
    GREEN_ALGAE_NODE,

    // ─── RED ALGAE (leaf) ──────────────────────────────────────────────
    RED_ALGAE_NODE,

    // ─── BROWN ALGAE (leaf) ────────────────────────────────────────────
    BROWN_ALGAE_NODE,

    // ─── MUSHROOMS ─────────────────────────────────────────────────────
    MUSHROOMS_NODE,

    // ─── VIRTUAL GROUPING NODES ────────────────────────────────────────
    // These aggregate Table 1a groups for the default view

    {
      id: "invertebrates",
      name: "Invertebrates",
      filter: { csvGroups: ALL_INVERTEBRATE_GROUPS },
      estimatedDescribed: 1_508_442,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#78716c",
      children: [
        prefixTree(INSECTA_NODE, "inv-"),
        prefixTree(ARACHNIDA_NODE, "inv-"),
        prefixTree(MOLLUSCA_NODE, "inv-"),
        prefixTree(CRUSTACEA_NODE, "inv-"),
        prefixTree(CORALS_NODE, "inv-"),
        prefixTree(OTHER_INVERTEBRATES_NODE, "inv-"),
        prefixTree(VELVET_WORMS_NODE, "inv-"),
        prefixTree(HORSESHOE_CRABS_NODE, "inv-"),
      ],
    },

    {
      id: "plantae",
      name: "Plants",
      filter: { csvGroups: ALL_PLANT_GROUPS },
      estimatedDescribed: 426_132,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#22c55e",
      children: [
        prefixTree(FLOWERING_PLANTS_NODE, "pl-"),
        prefixTree(GYMNOSPERMS_NODE, "pl-"),
        prefixTree(FERNS_AND_ALLIES_NODE, "pl-"),
        prefixTree(MOSSES_NODE, "pl-"),
        prefixTree(GREEN_ALGAE_NODE, "pl-"),
        prefixTree(RED_ALGAE_NODE, "pl-"),
      ],
    },

    {
      id: "fungi",
      name: "Fungi & Protists",
      filter: { csvGroups: ["mushrooms", "brown_algae"] },
      estimatedDescribed: 162_653,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#d97706",
      children: [
        prefixTree(MUSHROOMS_NODE, "fu-"),
        prefixTree(BROWN_ALGAE_NODE, "fu-"),
      ],
    },
  ],
};
