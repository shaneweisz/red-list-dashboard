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

// Cetacean families within order Artiodactyla (modern taxonomy)
const CETACEAN_FAMILIES = [
  "delphinidae", "ziphiidae", "balaenopteridae", "phocoenidae",
  "balaenidae", "platanistidae", "monodontidae", "kogiidae",
  "pontoporiidae", "physeteridae", "neobalaenidae", "lipotidae",
  "iniidae", "eschrichtiidae",
];

const MAMMAL_NAMED_ORDERS = [
  "rodentia", "chiroptera", "eulipotyphla", "afrosoricida", "macroscelidea",
  "primates", "diprotodontia", "dasyuromorphia", "didelphimorphia",
  "peramelemorphia", "paucituberculata", "notoryctemorphia", "microbiotheria",
  "carnivora", "artiodactyla", "lagomorpha", "sirenia",
  "perissodactyla", "pholidota",
];

// Bird subgroup helpers
const BIRD_NAMED_ORDERS = [
  "passeriformes", "caprimulgiformes", "piciformes", "psittaciformes",
  "charadriiformes", "columbiformes", "galliformes",
  "accipitriformes", "falconiformes", "cathartiformes",
  "strigiformes",
  "anseriformes", "gruiformes", "podicipediformes", "phoenicopteriformes", "gaviiformes",
  "procellariiformes", "sphenisciformes", "suliformes", "phaethontiformes",
  "pelecaniformes", "ciconiiformes",
];

// Insect named orders
const INSECT_NAMED_ORDERS = [
  "coleoptera", "lepidoptera", "diptera", "hymenoptera",
  "hemiptera", "orthoptera", "odonata",
];

// Flowering plant named orders
const FLOWERING_NAMED_ORDERS = [
  "asparagales", "asterales", "fabales", "poales", "arecales",
  "alismatales", "ceratophyllales", "nymphaeales",
  "fagales", "rosales", "malpighiales", "sapindales", "myrtales",
  "laurales", "magnoliales", "malvales", "ericales", "gentianales",
];

// Fungi ascomycota orders
const ASCOMYCOTA_ORDERS = [
  "eurotiales", "hypocreales", "xylariales", "pleosporales", "capnodiales",
  "helotiales", "orbiliales", "pezizales", "rhytismatales", "leotiales",
  "dothideales", "chaetothyriales", "verrucariales", "arthoniales",
  "ostropales", "pertusariales", "lecanorales", "peltigerales",
  "teloschistales", "caliciales", "acarosporales", "geoglossales",
  "cyttariales", "coryneliales", "trypetheliales",
];

// All 21 Table 1a CSV groups
export const ALL_CSV_GROUPS = [
  "mammalia", "aves", "reptilia", "amphibia", "fishes",
  "insecta", "arachnida", "mollusca", "crustacea", "corals",
  "other_invertebrates", "velvet_worms", "horseshoe_crabs",
  "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
  "green_algae", "red_algae", "brown_algae",
  "mushrooms",
];

const ALL_INVERTEBRATE_GROUPS = [
  "insecta", "arachnida", "mollusca", "crustacea", "corals",
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
  filter: { csvGroups: ["insecta"] },
  estimatedDescribed: 1_003_469,
  estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ")",
  estimatedSourceUrl: IUCN_SOURCE_URL,
  children: [
    { id: "beetles", name: "Beetles", filter: { csvGroups: ["insecta"], orderNames: ["coleoptera"] }, estimatedDescribed: 392_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "butterflies-moths", name: "Butterflies & Moths", filter: { csvGroups: ["insecta"], orderNames: ["lepidoptera"] }, estimatedDescribed: 160_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "flies-mosquitoes", name: "Flies & Mosquitoes", filter: { csvGroups: ["insecta"], orderNames: ["diptera"] }, estimatedDescribed: 155_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "bees-wasps-ants", name: "Bees, Wasps & Ants", filter: { csvGroups: ["insecta"], orderNames: ["hymenoptera"] }, estimatedDescribed: 153_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "true-bugs", name: "True Bugs", filter: { csvGroups: ["insecta"], orderNames: ["hemiptera"] }, estimatedDescribed: 82_000, estimatedSource: ZHANG_2011, estimatedSourceUrl: ZHANG_2011_URL },
    { id: "grasshoppers-crickets", name: "Grasshoppers, Crickets & Locusts", filter: { csvGroups: ["insecta"], orderNames: ["orthoptera"] }, estimatedDescribed: 26_000, estimatedSource: "Orthoptera Species File, 2025", estimatedSourceUrl: "https://orthoptera.speciesfile.org/" },
    { id: "dragonflies-damselflies", name: "Dragonflies & Damselflies", filter: { csvGroups: ["insecta"], orderNames: ["odonata"] }, estimatedDescribed: 6_400, estimatedSource: "World Odonata List, 2025", estimatedSourceUrl: "https://www.pugetsound.edu/puget-sound-museum-natural-history/biodiversity-resources/insects/dragonflies/world-odonata-list" },
    { id: "other-insects", name: "Other Insects", filter: { csvGroups: ["insecta"], excludeOrders: INSECT_NAMED_ORDERS }, estimatedDescribed: 29_069, estimatedSource: "Remainder from IUCN Table 1a total of 1,003,469 (" + COL_2025 + ")", estimatedSourceUrl: COL_2025_URL },
  ],
};

const ARACHNIDA_NODE: TaxonomyNode = {
  id: "arachnida",
  name: "Arachnids",
  filter: { csvGroups: ["arachnida"] },
  estimatedDescribed: 97_085,
  estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ")",
  estimatedSourceUrl: COL_2025_URL,
};

const MOLLUSCA_NODE: TaxonomyNode = {
  id: "mollusca",
  name: "Molluscs",
  filter: { csvGroups: ["mollusca"] },
  estimatedDescribed: 88_244,
  estimatedSource: IUCN_SOURCE + " (MolluscaBase 2025)",
  estimatedSourceUrl: "http://www.molluscabase.org",
};

const CRUSTACEA_NODE: TaxonomyNode = {
  id: "crustacea",
  name: "Crustaceans",
  filter: { csvGroups: ["crustacea"] },
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
      id: "worms",
      name: "Worms",
      filter: {
        csvGroups: ["other_invertebrates"],
        classNames: ["clitellata", "polychaeta", "nemertea", "turbellaria"],
      },
      estimatedDescribed: 27_800,
      estimatedSource: "~22K Annelida + ~1.3K Nemertea + ~4.5K Turbellaria (WoRMS; various)",
      estimatedSourceUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=882",
    },
    {
      id: "other-invertebrates-catch-all",
      name: "Other Invertebrates",
      filter: {
        csvGroups: ["other_invertebrates"],
        excludeClasses: ["asteroidea", "echinoidea", "holothuroidea", "clitellata", "polychaeta", "nemertea", "turbellaria"],
      },
      estimatedDescribed: 195_685,
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

const FLOWERING_PLANTS_NODE: TaxonomyNode = {
  id: "flowering_plants",
  name: "Flowering Plants",
  filter: { csvGroups: ["flowering_plants"] },
  estimatedDescribed: 369_000,
  estimatedSource: IUCN_SOURCE + " (State of the World's Plants 2017)",
  estimatedSourceUrl: IUCN_SOURCE_URL,
  children: [
    { id: "orchids-lilies-bulbs", name: "Orchids, Lilies & Bulbs", filter: { csvGroups: ["flowering_plants"], orderNames: ["asparagales"] }, estimatedDescribed: 36_000, estimatedSource: CHRISTENHUSZ, estimatedSourceUrl: CHRISTENHUSZ_URL },
    { id: "composites-wildflowers", name: "Composites & Wildflowers", filter: { csvGroups: ["flowering_plants"], orderNames: ["asterales"] }, estimatedDescribed: 26_900, estimatedSource: CHRISTENHUSZ, estimatedSourceUrl: CHRISTENHUSZ_URL },
    { id: "legumes", name: "Legumes", filter: { csvGroups: ["flowering_plants"], orderNames: ["fabales"] }, estimatedDescribed: 20_800, estimatedSource: CHRISTENHUSZ, estimatedSourceUrl: CHRISTENHUSZ_URL },
    { id: "grasses-cereals", name: "Grasses & Cereals", filter: { csvGroups: ["flowering_plants"], orderNames: ["poales"] }, estimatedDescribed: 18_900, estimatedSource: CHRISTENHUSZ, estimatedSourceUrl: CHRISTENHUSZ_URL },
    { id: "palms-relatives", name: "Palms & Relatives", filter: { csvGroups: ["flowering_plants"], orderNames: ["arecales"] }, estimatedDescribed: 2_600, estimatedSource: CHRISTENHUSZ, estimatedSourceUrl: CHRISTENHUSZ_URL },
    { id: "aquatic-flowering", name: "Aquatic Flowering Plants", filter: { csvGroups: ["flowering_plants"], orderNames: ["alismatales", "ceratophyllales", "nymphaeales"] }, estimatedDescribed: 4_600, estimatedSource: CHRISTENHUSZ, estimatedSourceUrl: CHRISTENHUSZ_URL },
    {
      id: "broadleaf-trees-shrubs",
      name: "Broadleaf Trees & Shrubs",
      filter: {
        csvGroups: ["flowering_plants"],
        orderNames: [
          "fagales", "rosales", "malpighiales", "sapindales", "myrtales",
          "laurales", "magnoliales", "malvales", "ericales", "gentianales",
        ],
      },
      estimatedDescribed: 88_600,
      estimatedSource: CHRISTENHUSZ + " — sum of 10 orders",
      estimatedSourceUrl: CHRISTENHUSZ_URL,
    },
    {
      id: "other-flowering-plants",
      name: "Other Flowering Plants",
      filter: {
        csvGroups: ["flowering_plants"],
        excludeOrders: FLOWERING_NAMED_ORDERS,
      },
      estimatedDescribed: 170_600,
      estimatedSource: "Remainder from IUCN Table 1a total of 369,000 (State of the World's Plants 2017)",
      estimatedSourceUrl: COL_2025_URL,
    },
  ],
};

const GYMNOSPERMS_NODE: TaxonomyNode = {
  id: "gymnosperms",
  name: "Conifers & Cycads",
  filter: { csvGroups: ["gymnosperms"] },
  estimatedDescribed: 1_113,
  estimatedSource: IUCN_SOURCE + " (Christenhusz et al. 2011)",
  estimatedSourceUrl: "https://stateoftheworldsplants.org/2017/report/SOTWP_2017.pdf",
};

const FERNS_AND_ALLIES_NODE: TaxonomyNode = {
  id: "ferns_and_allies",
  name: "Ferns & Horsetails",
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
  name: "Mushrooms, etc.",
  filter: { csvGroups: ["mushrooms"] },
  estimatedDescribed: 157_648,
  estimatedSource: IUCN_SOURCE + " (" + SPECIES_FUNGORUM + ")",
  estimatedSourceUrl: SPECIES_FUNGORUM_URL,
  children: [
    {
      id: "moulds-yeasts-cup",
      name: "Moulds, Yeasts & Cup Fungi",
      filter: { csvGroups: ["mushrooms"], orderNames: ASCOMYCOTA_ORDERS },
      estimatedDescribed: 98_000,
      estimatedSource: "~98K Ascomycota spp. (" + SPECIES_FUNGORUM + "; He et al. 2019)",
      estimatedSourceUrl: SPECIES_FUNGORUM_URL,
    },
    {
      id: "bracket-mushroom-fungi",
      name: "Bracket Fungi & Mushrooms",
      filter: { csvGroups: ["mushrooms"], excludeOrders: ASCOMYCOTA_ORDERS },
      estimatedDescribed: 59_648,
      estimatedSource: "Remainder of 157,648 total fungi (" + SPECIES_FUNGORUM + ")",
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
    // ─── MAMMALIA ──────────────────────────────────────────────────────
    {
      id: "mammalia",
      name: "Mammals",
      filter: { csvGroups: ["mammalia"] },
      estimatedDescribed: 6_819,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#f97316",
      children: [
        {
          id: "rodents",
          name: "Rodents",
          filter: { csvGroups: ["mammalia"], orderNames: ["rodentia"] },
          estimatedDescribed: 2_747,
          estimatedSource: MDD + " — Rodentia",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "bats",
          name: "Bats",
          filter: { csvGroups: ["mammalia"], orderNames: ["chiroptera"] },
          estimatedDescribed: 1_485,
          estimatedSource: MDD + " — Chiroptera",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "insectivores",
          name: "Insectivores",
          filter: { csvGroups: ["mammalia"], orderNames: ["eulipotyphla", "afrosoricida", "macroscelidea"] },
          estimatedDescribed: 674,
          estimatedSource: MDD + " — Eulipotyphla (599) + Afrosoricida (55) + Macroscelidea (20)",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "primates",
          name: "Primates",
          filter: { csvGroups: ["mammalia"], orderNames: ["primates"] },
          estimatedDescribed: 522,
          estimatedSource: MDD + " — Primates",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "marsupials",
          name: "Marsupials",
          filter: {
            csvGroups: ["mammalia"],
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
          filter: { csvGroups: ["mammalia"], orderNames: ["carnivora"] },
          estimatedDescribed: 319,
          estimatedSource: MDD + " — Carnivora",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "even-toed-ungulates",
          name: "Even-toed Ungulates",
          filter: {
            csvGroups: ["mammalia"],
            orderNames: ["artiodactyla"],
            excludeFamilies: CETACEAN_FAMILIES,
          },
          estimatedDescribed: 278,
          estimatedSource: MDD + " — Artiodactyla (371) minus ~93 cetacean spp.",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "rabbits-hares",
          name: "Rabbits & Hares",
          filter: { csvGroups: ["mammalia"], orderNames: ["lagomorpha"] },
          estimatedDescribed: 112,
          estimatedSource: MDD + " — Lagomorpha",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "whales-dolphins",
          name: "Whales & Dolphins",
          filter: {
            csvGroups: ["mammalia"],
            orderNames: ["artiodactyla", "sirenia"],
            // Families filter separates cetaceans from other artiodactyls and
            // covers all extant/known sirenians (Trichechidae = manatees,
            // Dugongidae = dugong + Steller's sea cow). If a newly-described
            // sirenian family is added to IUCN data, it must be listed here.
            families: [...CETACEAN_FAMILIES, "trichechidae", "dugongidae"],
          },
          estimatedDescribed: 98,
          estimatedSource: MDD + " — ~93 cetacean spp. within Artiodactyla + Sirenia (5)",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "odd-toed-ungulates",
          name: "Odd-toed Ungulates",
          filter: { csvGroups: ["mammalia"], orderNames: ["perissodactyla"] },
          estimatedDescribed: 18,
          estimatedSource: MDD + " — Perissodactyla",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "pangolins",
          name: "Pangolins",
          filter: { csvGroups: ["mammalia"], orderNames: ["pholidota"] },
          estimatedDescribed: 8,
          estimatedSource: MDD + " — Pholidota",
          estimatedSourceUrl: MDD_URL,
        },
        {
          id: "other-mammals",
          name: "Other Mammals",
          filter: {
            csvGroups: ["mammalia"],
            excludeOrders: MAMMAL_NAMED_ORDERS,
          },
          estimatedDescribed: 142,
          estimatedSource: "Remainder of IUCN Table 1a total of 6,819 minus " + MDD + " named orders",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
      ],
    },

    // ─── AVES ──────────────────────────────────────────────────────────
    {
      id: "aves",
      name: "Birds",
      filter: { csvGroups: ["aves"] },
      estimatedDescribed: 11_185,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#3b82f6",
      children: [
        {
          id: "songbirds",
          name: "Songbirds",
          filter: { csvGroups: ["aves"], orderNames: ["passeriformes"] },
          estimatedDescribed: 6_688,
          estimatedSource: "BirdLife/IUCN — assessed Passeriformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "hummingbirds-swifts",
          name: "Hummingbirds & Swifts",
          filter: { csvGroups: ["aves"], orderNames: ["caprimulgiformes"] },
          estimatedDescribed: 603,
          estimatedSource: "BirdLife/IUCN — assessed Caprimulgiformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "woodpeckers-toucans",
          name: "Woodpeckers & Toucans",
          filter: { csvGroups: ["aves"], orderNames: ["piciformes"] },
          estimatedDescribed: 481,
          estimatedSource: "BirdLife/IUCN — assessed Piciformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "parrots",
          name: "Parrots",
          filter: { csvGroups: ["aves"], orderNames: ["psittaciformes"] },
          estimatedDescribed: 421,
          estimatedSource: "BirdLife/IUCN — assessed Psittaciformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "shorebirds",
          name: "Shorebirds",
          filter: { csvGroups: ["aves"], orderNames: ["charadriiformes"] },
          estimatedDescribed: 387,
          estimatedSource: "BirdLife/IUCN — assessed Charadriiformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "pigeons-doves",
          name: "Pigeons & Doves",
          filter: { csvGroups: ["aves"], orderNames: ["columbiformes"] },
          estimatedDescribed: 369,
          estimatedSource: "BirdLife/IUCN — assessed Columbiformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "raptors",
          name: "Raptors",
          filter: { csvGroups: ["aves"], orderNames: ["accipitriformes", "falconiformes", "cathartiformes"] },
          estimatedDescribed: 324,
          estimatedSource: "BirdLife/IUCN — assessed raptor orders",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "gamebirds",
          name: "Gamebirds",
          filter: { csvGroups: ["aves"], orderNames: ["galliformes"] },
          estimatedDescribed: 309,
          estimatedSource: "BirdLife/IUCN — assessed Galliformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "owls",
          name: "Owls",
          filter: { csvGroups: ["aves"], orderNames: ["strigiformes"] },
          estimatedDescribed: 242,
          estimatedSource: "BirdLife/IUCN — assessed Strigiformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "waterbirds",
          name: "Waterbirds",
          filter: {
            csvGroups: ["aves"],
            orderNames: ["anseriformes", "gruiformes", "podicipediformes", "phoenicopteriformes", "gaviiformes"],
          },
          estimatedDescribed: 404,
          estimatedSource: "BirdLife/IUCN — assessed waterbird orders",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "seabirds",
          name: "Seabirds",
          filter: {
            csvGroups: ["aves"],
            orderNames: ["procellariiformes", "sphenisciformes", "suliformes", "phaethontiformes"],
          },
          estimatedDescribed: 223,
          estimatedSource: "BirdLife/IUCN — assessed seabird orders",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "herons-storks",
          name: "Herons & Storks",
          filter: { csvGroups: ["aves"], orderNames: ["pelecaniformes", "ciconiiformes"] },
          estimatedDescribed: 136,
          estimatedSource: "BirdLife/IUCN — assessed Pelecaniformes + Ciconiiformes",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
        {
          id: "other-birds",
          name: "Other Birds",
          filter: {
            csvGroups: ["aves"],
            excludeOrders: BIRD_NAMED_ORDERS,
          },
          estimatedDescribed: 598,
          estimatedSource: "Remainder of IUCN Table 1a total of 11,185",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
      ],
    },

    // ─── REPTILIA ──────────────────────────────────────────────────────
    {
      id: "reptilia",
      name: "Reptiles",
      filter: { csvGroups: ["reptilia"] },
      estimatedDescribed: 12_502,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#84cc16",
      children: [
        {
          id: "lizards-snakes",
          name: "Lizards & Snakes",
          filter: { csvGroups: ["reptilia"], orderNames: ["squamata", "rhynchocephalia"] },
          estimatedDescribed: 12_109,
          estimatedSource: "Reptile Database, Sep 2025 (12,502 total minus Testudines & Crocodylia)",
          estimatedSourceUrl: REPTILE_DB_URL,
        },
        {
          id: "turtles-tortoises",
          name: "Turtles & Tortoises",
          filter: { csvGroups: ["reptilia"], orderNames: ["testudines"] },
          estimatedDescribed: 366,
          estimatedSource: REPTILE_DB,
          estimatedSourceUrl: REPTILE_DB_URL,
        },
        {
          id: "crocodilians",
          name: "Crocodilians",
          filter: { csvGroups: ["reptilia"], orderNames: ["crocodylia"] },
          estimatedDescribed: 27,
          estimatedSource: REPTILE_DB,
          estimatedSourceUrl: REPTILE_DB_URL,
        },
      ],
    },

    // ─── AMPHIBIA ──────────────────────────────────────────────────────
    {
      id: "amphibia",
      name: "Amphibians",
      filter: { csvGroups: ["amphibia"] },
      estimatedDescribed: 8_918,
      estimatedSource: IUCN_SOURCE,
      estimatedSourceUrl: IUCN_SOURCE_URL,
      color: "#14b8a6",
      children: [
        {
          id: "frogs-toads",
          name: "Frogs & Toads",
          filter: { csvGroups: ["amphibia"], orderNames: ["anura"] },
          estimatedDescribed: 7_948,
          estimatedSource: AMPHIBIAWEB,
          estimatedSourceUrl: AMPHIBIAWEB_URL,
        },
        {
          id: "salamanders-newts",
          name: "Salamanders & Newts",
          filter: { csvGroups: ["amphibia"], orderNames: ["caudata"] },
          estimatedDescribed: 829,
          estimatedSource: AMPHIBIAWEB,
          estimatedSourceUrl: AMPHIBIAWEB_URL,
        },
        {
          id: "caecilians",
          name: "Caecilians",
          filter: { csvGroups: ["amphibia"], orderNames: ["gymnophiona"] },
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
          id: "bony-fish",
          name: "Bony Fish",
          filter: { csvGroups: ["fishes"], classNames: ["actinopterygii", "sarcopterygii"] },
          estimatedDescribed: 35_880,
          estimatedSource: ESCHMEYER + " (37,288 total minus Chondrichthyes & jawless)",
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
