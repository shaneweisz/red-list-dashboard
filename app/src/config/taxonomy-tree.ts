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
  /** Filter by genus (lowercase) — derived from the first token of scientific_name.
   * Needed for SSC specialist groups that split a family (e.g. Bovidae's Caprinae
   * vs. Bovini vs. the rest, or Ursidae's polar bear vs. other bears). */
  genera?: string[];
  /** Exclude mode: exclude these genera */
  excludeGenera?: string[];
  /** Filter by full scientific name (lowercase "genus species") — for the rare case
   * a specialist group's boundary is a single species (e.g. polar bear within Ursidae). */
  speciesNames?: string[];
  /** Exclude mode: exclude these scientific names */
  excludeSpeciesNames?: string[];
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
  /** Optional link to the node's own definitive/official page (e.g. an SSC
   * Specialist Group's page on iucn.org) — distinct from estimatedSourceUrl,
   * which cites the described-species count specifically. */
  sourceUrl?: string;
  /** Arbitrary depth children */
  children?: TaxonomyNode[];
}

// ─── Sources ─────────────────────────────────────────────────────────

const IUCN_SOURCE = "IUCN 2025-2";
const IUCN_SOURCE_URL = "https://nc.iucnredlist.org/redlist/content/attachment_files/2025-2_RL_Table1a.pdf";
const MDD = "Mammal Diversity Database (v2.0, 2025)";
const MDD_URL = "https://www.mammaldiversity.org/explore/taxonomy-table/";
const SSC_GROUP_URL_BASE = "https://iucn.org/our-union/commissions/group/";
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

const INSECTS_NODE: TaxonomyNode = {
  id: "insects",
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

// The "Other Invertebrates" Table 1a group is a grab-bag of animal phyla with no
// group of their own. We carve it into recognizable phylum sub-groups by their CoL
// classes (the read layer filters by taxon_group; class sub-filtering is client-side
// via matchesFilter, so this needs no data change). Class lists are derived from the
// CoL universe (species/) so they're complete per phylum. Caveat: species with a NULL
// class — notably ~6k flatworms (Platyhelminthes) and all gastrotrichs — can't be
// routed by class, so they land in the catch-all rather than their phylum node (the
// IUCN-assessed species, which the reassessments view shows, all carry a class, so
// only the NE browse is affected). A `phylum` column on the parquets would close that
// gap but needs a data rebuild.
// Described-species estimates: Zhang 2011 (Zootaxa 3148) phylum totals where they're
// extant-dominated; WoRMS extant figures where Zhang includes a large fossil record
// (Bryozoa, Echinodermata) or where we use a subset (Cnidaria here excludes corals,
// which are their own group). Rounded — these populate the "Described (IUCN)" column.
const WORMS_URL = "https://www.marinespecies.org/";
// IUCN Table 1a "Others" (invertebrates) described total — the parent estimate the
// phylum children partition (the catch-all takes the remainder).
const OTHER_INVERTEBRATES_DESCRIBED = 230_485;
const OTHER_INVERTEBRATE_PHYLA: { id: string; name: string; classes: string[]; estimatedDescribed?: number; estimatedSource?: string; estimatedSourceUrl?: string }[] = [
  { id: "flatworms", name: "Flatworms", classes: ["trematoda", "monogenea", "cestoda", "turbellaria", "rhabditophora", "catenulida"],
    estimatedDescribed: 29_000, estimatedSource: "~29,285 Platyhelminthes spp. (" + ZHANG_2011 + ")", estimatedSourceUrl: ZHANG_2011_URL },
  { id: "roundworms", name: "Roundworms", classes: ["chromadorea", "enoplea"],
    estimatedDescribed: 25_000, estimatedSource: "~24,783 Nematoda spp. (" + ZHANG_2011 + ")", estimatedSourceUrl: ZHANG_2011_URL },
  { id: "annelids", name: "Annelids", classes: ["polychaeta", "clitellata"],
    estimatedDescribed: 22_000, estimatedSource: "~22K Annelida spp. (WoRMS; Catalogue of Life)", estimatedSourceUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=882" },
  { id: "myriapods", name: "Myriapods (Centipedes & Millipedes)", classes: ["diplopoda", "chilopoda", "symphyla", "pauropoda"],
    estimatedDescribed: 12_000, estimatedSource: "~11,885 Myriapoda spp. (" + ZHANG_2011 + ")", estimatedSourceUrl: ZHANG_2011_URL },
  { id: "sponges", name: "Sponges", classes: ["demospongiae", "calcarea", "hexactinellida", "homoscleromorpha"],
    estimatedDescribed: 9_000, estimatedSource: "~9,000 extant Porifera spp. (WoRMS)", estimatedSourceUrl: WORMS_URL },
  { id: "cnidarians", name: "Cnidarians (non-coral)", classes: ["hydrozoa", "myxozoa", "anthozoa", "scyphozoa", "staurozoa", "cubozoa"],
    estimatedDescribed: 8_000, estimatedSource: "~8,000 non-coral extant spp. (WoRMS; corals counted separately)", estimatedSourceUrl: WORMS_URL },
  { id: "echinoderms", name: "Echinoderms", classes: ["asteroidea", "echinoidea", "holothuroidea", "ophiuroidea", "crinoidea"],
    estimatedDescribed: 7_000, estimatedSource: "~7,000 extant spp. (WoRMS; Animal Diversity Web)", estimatedSourceUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=1806" },
  { id: "bryozoans", name: "Bryozoans (Moss Animals)", classes: ["gymnolaemata", "stenolaemata", "phylactolaemata"],
    estimatedDescribed: 6_000, estimatedSource: "~6,000 extant spp. (WoRMS; Zhang 2011 total incl. fossils)", estimatedSourceUrl: WORMS_URL },
  { id: "tunicates", name: "Tunicates & Lancelets", classes: ["ascidiacea", "thaliacea", "appendicularia", "leptocardii"],
    estimatedDescribed: 3_000, estimatedSource: "~3,000 spp., Tunicata + lancelets (" + ZHANG_2011 + ")", estimatedSourceUrl: ZHANG_2011_URL },
];

function OTHER_INVERTEBRATE_PHYLA_CHILDREN(): TaxonomyNode[] {
  const allClasses = OTHER_INVERTEBRATE_PHYLA.flatMap((p) => p.classes);
  const children: TaxonomyNode[] = OTHER_INVERTEBRATE_PHYLA.map((p) => ({
    id: p.id,
    name: p.name,
    filter: { csvGroups: ["other_invertebrates"], classNames: p.classes },
    ...(p.estimatedDescribed != null ? { estimatedDescribed: p.estimatedDescribed, estimatedSource: p.estimatedSource, estimatedSourceUrl: p.estimatedSourceUrl } : {}),
  }));
  // Catch-all described estimate = the group total minus the named phyla above, so the
  // children sum to the parent (mirrors the "Other Insects" remainder approach).
  const named = OTHER_INVERTEBRATE_PHYLA.reduce((s, p) => s + (p.estimatedDescribed ?? 0), 0);
  children.push({
    id: "other-invertebrates-catch-all",
    name: "Others",
    filter: { csvGroups: ["other_invertebrates"], excludeClasses: allClasses },
    estimatedDescribed: Math.max(OTHER_INVERTEBRATES_DESCRIBED - named, 0),
    estimatedSource: `Remainder of IUCN Table 1a 'Others' (${OTHER_INVERTEBRATES_DESCRIBED.toLocaleString()}) minus the named phyla above`,
    estimatedSourceUrl: COL_2025_URL,
  });
  return children;
}

const OTHER_INVERTEBRATES_NODE: TaxonomyNode = {
  id: "other_invertebrates",
  name: "Other Invertebrates",
  filter: { csvGroups: ["other_invertebrates"] },
  estimatedDescribed: OTHER_INVERTEBRATES_DESCRIBED,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: COL_2025_URL,
  children: OTHER_INVERTEBRATE_PHYLA_CHILDREN(),
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

    // ─── SSC SPECIALIST GROUPS (pilot: mammals) ─────────────────────────
    // A second, independent lens over the same "mammals" CSV group, organized
    // by IUCN SSC (Species Survival Commission) Specialist Group boundaries
    // instead of by taxonomic order — so an SSC group (e.g. the Small Mammal
    // Specialist Group) can pull up exactly the species it's responsible for.
    // Kept as a separate wrapper (not nested under "mammals") so it doesn't
    // pollute the normal Mammals subgroup list (rodents/bats/primates/...).
    //
    // Scope for each group was sourced from its own page at
    // https://iucn.org/our-union/commissions/group/<slug> (linked from the
    // SSC groups directory, https://iucn.org/our-union/commissions/group/1445),
    // cross-checked against standard mammalian taxonomy where a page didn't
    // spell out its exact boundary with a neighboring group (e.g. Bear SG vs.
    // Polar Bear SG, or Antelope SG vs. Caprinae/Bison/Wild Cattle SG within
    // Bovidae). estimatedDescribed figures below are approximate best-effort
    // counts (MDD-based where possible) — treat as a rough denominator for
    // "% Assessed" until spot-checked; totalAssessed/outdated/by-category come
    // from real per-species data and are unaffected by any error here.
    {
      id: "ssc-groups",
      name: "SSC Specialist Groups",
      filter: { csvGroups: ["mammals"] },
      children: [
        {
          id: "ssc-african-elephant",
          name: "African Elephant Specialist Group",
          filter: { csvGroups: ["mammals"], genera: ["loxodonta"] },
          estimatedDescribed: 2,
          estimatedSource: MDD + " — Loxodonta (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-african-elephant-specialist-group",
        },
        {
          id: "ssc-asian-elephant",
          name: "Asian Elephant Specialist Group",
          filter: { csvGroups: ["mammals"], genera: ["elephas"] },
          estimatedDescribed: 1,
          estimatedSource: MDD + " — Elephas (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-asian-elephant-specialist-group",
        },
        {
          id: "ssc-african-rhino",
          name: "African Rhino Specialist Group",
          filter: { csvGroups: ["mammals"], genera: ["diceros", "ceratotherium"] },
          estimatedDescribed: 2,
          estimatedSource: MDD + " — Diceros + Ceratotherium (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-african-rhino-specialist-group",
        },
        {
          id: "ssc-asian-rhino",
          name: "Asian Rhino Specialist Group",
          filter: { csvGroups: ["mammals"], genera: ["rhinoceros", "dicerorhinus"] },
          estimatedDescribed: 3,
          estimatedSource: MDD + " — Rhinoceros + Dicerorhinus (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-asian-rhino-specialist-group",
        },
        {
          id: "ssc-afro-asian-wild-cattle",
          name: "Afro-Asian Wild Cattle Specialist Group",
          filter: { csvGroups: ["mammals"], genera: ["bos", "bubalus", "pseudoryx"] },
          estimatedDescribed: 9,
          estimatedSource: MDD + " — Bos + Bubalus + Pseudoryx (approx.; excludes Syncerus caffer, covered by the Antelope SG)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-afro-asian-wild-cattle-specialist-group-0",
        },
        {
          id: "ssc-afrotheria",
          name: "Afrotheria Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["afrosoricida", "macroscelidea", "hyracoidea", "tubulidentata"] },
          estimatedDescribed: 83,
          estimatedSource: MDD + " — Afrosoricida + Macroscelidea + Hyracoidea + Tubulidentata (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-afrotheria-specialist-group",
        },
        {
          id: "ssc-anteater-sloth-armadillo",
          name: "Anteater, Sloth and Armadillo Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["pilosa", "cingulata"] },
          estimatedDescribed: 31,
          estimatedSource: MDD + " — Pilosa + Cingulata (Xenarthra, approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-anteater-sloth-and-armadillo-specialist-group",
        },
        {
          id: "ssc-antelope",
          name: "Antelope Specialist Group",
          filter: {
            csvGroups: ["mammals"],
            families: ["bovidae"],
            excludeGenera: [
              "bos", "bubalus", "pseudoryx", "bison",
              "capra", "ovis", "ovibos", "rupicapra", "naemorhedus",
              "capricornis", "oreamnos", "budorcas", "pantholops",
              "ammotragus", "hemitragus", "nilgiritragus",
            ],
          },
          estimatedDescribed: 90,
          estimatedSource: MDD + " — Bovidae minus wild cattle/bison (Wild Cattle/Bison SG) and Caprinae (Caprinae SG) (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-antelope-specialist-group",
        },
        {
          id: "ssc-australasian-marsupial-monotreme",
          name: "Australasian Marsupial and Monotreme Specialist Group",
          filter: {
            csvGroups: ["mammals"],
            orderNames: ["diprotodontia", "dasyuromorphia", "peramelemorphia", "notoryctemorphia", "monotremata"],
          },
          estimatedDescribed: 250,
          estimatedSource: MDD + " — Australasian marsupial orders + Monotremata (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-australasian-marsupial-and-monotreme-specialist-group",
        },
        {
          id: "ssc-bat",
          name: "Bat Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["chiroptera"] },
          estimatedDescribed: 1_485,
          estimatedSource: MDD + " — Chiroptera",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-bat-specialist-group",
        },
        {
          id: "ssc-bear",
          name: "Bear Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["ursidae"], excludeSpeciesNames: ["ursus maritimus"] },
          estimatedDescribed: 7,
          estimatedSource: MDD + " — Ursidae minus polar bear (Polar Bear SG)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-bear-specialist-group",
        },
        {
          id: "ssc-polar-bear",
          name: "Polar Bear Specialist Group",
          filter: { csvGroups: ["mammals"], speciesNames: ["ursus maritimus"] },
          estimatedDescribed: 1,
          estimatedSource: MDD + " — Ursus maritimus",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-polar-bear-specialist-group",
        },
        {
          id: "ssc-bison",
          name: "Bison Specialist Group",
          filter: { csvGroups: ["mammals"], genera: ["bison"] },
          estimatedDescribed: 2,
          estimatedSource: MDD + " — Bison (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-bison-specialist-group",
        },
        {
          id: "ssc-canid",
          name: "Canid Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["canidae"] },
          estimatedDescribed: 37,
          estimatedSource: MDD + " — Canidae (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-canid-specialist-group",
        },
        {
          id: "ssc-caprinae",
          name: "Caprinae Specialist Group",
          filter: {
            csvGroups: ["mammals"],
            genera: [
              "capra", "ovis", "ovibos", "rupicapra", "naemorhedus",
              "capricornis", "oreamnos", "budorcas", "pantholops",
              "ammotragus", "hemitragus", "nilgiritragus",
            ],
          },
          estimatedDescribed: 40,
          estimatedSource: MDD + " — Caprinae genera within Bovidae (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-caprinae-specialist-group",
        },
        {
          id: "ssc-cat",
          name: "Cat Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["felidae"] },
          estimatedDescribed: 41,
          estimatedSource: MDD + " — Felidae (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-cat-specialist-group",
        },
        {
          id: "ssc-cetacean",
          name: "Cetacean Specialist Group",
          filter: {
            csvGroups: ["mammals"],
            families: [
              "balaenidae", "balaenopteridae", "eschrichtiidae", "physeteridae",
              "kogiidae", "ziphiidae", "delphinidae", "monodontidae",
              "phocoenidae", "iniidae", "lipotidae", "platanistidae", "pontoporiidae",
            ],
          },
          estimatedDescribed: 94,
          estimatedSource: MDD + " — cetacean families (order_name is shared with Artiodactyla under Cetartiodactyla, so filtered by family instead) (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-cetacean-specialist-group",
        },
        {
          id: "ssc-deer",
          name: "Deer Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["cervidae"] },
          estimatedDescribed: 55,
          estimatedSource: MDD + " — Cervidae (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-deer-specialist-group",
        },
        {
          id: "ssc-equid",
          name: "Equid Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["equidae"] },
          estimatedDescribed: 7,
          estimatedSource: MDD + " — Equidae",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-equid-specialist-group",
        },
        {
          id: "ssc-giraffe-okapi",
          name: "Giraffe and Okapi Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["giraffidae"] },
          estimatedDescribed: 5,
          estimatedSource: MDD + " — Giraffidae (GSG 4-species giraffe taxonomy + okapi) (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-giraffe-and-okapi-specialist-group",
        },
        {
          id: "ssc-hippo",
          name: "Hippo Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["hippopotamidae"] },
          estimatedDescribed: 2,
          estimatedSource: MDD + " — Hippopotamidae",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-hippo-specialist-group",
        },
        {
          id: "ssc-hyaena",
          name: "Hyaena Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["hyaenidae"] },
          estimatedDescribed: 4,
          estimatedSource: MDD + " — Hyaenidae",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-hyaena-specialist-group",
        },
        {
          id: "ssc-lagomorph",
          name: "Lagomorph Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["lagomorpha"] },
          estimatedDescribed: 112,
          estimatedSource: MDD + " — Lagomorpha",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-lagomorph-specialist-group",
        },
        {
          id: "ssc-new-world-marsupial",
          name: "New World Marsupial Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["didelphimorphia", "paucituberculata", "microbiotheria"] },
          estimatedDescribed: 128,
          estimatedSource: MDD + " — Didelphimorphia + Paucituberculata + Microbiotheria (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-new-world-marsupial-specialist-group",
        },
        {
          id: "ssc-otter",
          name: "Otter Specialist Group",
          filter: {
            csvGroups: ["mammals"],
            genera: ["lutra", "pteronura", "aonyx", "lutrogale", "enhydra", "hydrictis", "lontra"],
          },
          estimatedDescribed: 14,
          estimatedSource: MDD + " — Lutrinae genera within Mustelidae (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-otter-specialist-group",
        },
        {
          id: "ssc-pangolin",
          name: "Pangolin Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["pholidota"] },
          estimatedDescribed: 8,
          estimatedSource: MDD + " — Pholidota",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-pangolin-specialist-group",
        },
        {
          id: "ssc-peccary",
          name: "Peccary Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["tayassuidae"] },
          estimatedDescribed: 3,
          estimatedSource: MDD + " — Tayassuidae",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-peccary-specialist-group",
        },
        {
          id: "ssc-pinniped",
          name: "Pinniped Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["otariidae", "phocidae", "odobenidae"] },
          estimatedDescribed: 36,
          estimatedSource: MDD + " — Otariidae + Phocidae + Odobenidae (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-pinniped-specialist-group",
        },
        {
          id: "ssc-primate",
          name: "Primate Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["primates"] },
          estimatedDescribed: 522,
          estimatedSource: MDD + " — Primates",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-primate-specialist-group",
        },
        {
          id: "ssc-sirenia",
          name: "Sirenia Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["sirenia"] },
          estimatedDescribed: 5,
          estimatedSource: MDD + " — Sirenia (manatees + dugong)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-sirenia-specialist-group",
        },
        {
          id: "ssc-small-carnivore",
          name: "Small Carnivore Specialist Group",
          filter: {
            csvGroups: ["mammals"],
            families: ["mustelidae", "viverridae", "herpestidae", "eupleridae", "procyonidae", "mephitidae", "nandiniidae", "prionodontidae"],
            excludeGenera: ["lutra", "pteronura", "aonyx", "lutrogale", "enhydra", "hydrictis", "lontra"],
          },
          estimatedDescribed: 158,
          estimatedSource: MDD + " — small-carnivore families minus Lutrinae/otters (Otter SG) (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-small-carnivore-specialist-group",
        },
        {
          id: "ssc-small-mammal",
          name: "Small Mammal Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["rodentia", "eulipotyphla", "scandentia"] },
          estimatedDescribed: 3_366,
          estimatedSource: MDD + " — Rodentia + Eulipotyphla + Scandentia (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-small-mammal-specialist-group",
        },
        {
          id: "ssc-tapir",
          name: "Tapir Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["tapiridae"] },
          estimatedDescribed: 4,
          estimatedSource: MDD + " — Tapiridae",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-tapir-specialist-group",
        },
        {
          id: "ssc-wild-camelid",
          name: "Wild Camelid Specialist Group",
          filter: { csvGroups: ["mammals"], genera: ["lama", "vicugna"] },
          estimatedDescribed: 2,
          estimatedSource: MDD + " — Lama + Vicugna (South American camelids; excludes wild Bactrian camel, Camelus ferus, not part of this group's remit)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-wild-camelid-specialist-group-0",
        },
        {
          id: "ssc-wild-pig",
          name: "Wild Pig Specialist Group",
          filter: { csvGroups: ["mammals"], families: ["suidae"] },
          estimatedDescribed: 18,
          estimatedSource: MDD + " — Suidae (approx.)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-wild-pig-specialist-group",
        },
        // Catch-all: mammal orders/families/genera not claimed by any of the 35
        // groups above — e.g. treeshrew-adjacent oddities, moles' relatives with
        // no dedicated group, and the wild Bactrian camel (Camelus, deliberately
        // excluded from Wild Camelid SG's South-American-only remit). Kept in
        // sync manually — if a 36th SSC group is added above, add its
        // order/family/genus here too so it doesn't double-count into this row.
        {
          id: "ssc-other-mammals",
          name: "No SSC Group",
          filter: {
            csvGroups: ["mammals"],
            excludeOrders: [
              "afrosoricida", "macroscelidea", "hyracoidea", "tubulidentata",
              "pilosa", "cingulata",
              "diprotodontia", "dasyuromorphia", "peramelemorphia", "notoryctemorphia", "monotremata",
              "chiroptera",
              "didelphimorphia", "paucituberculata", "microbiotheria",
              "pholidota",
              "primates",
              "sirenia",
              "rodentia", "eulipotyphla", "scandentia",
              "lagomorpha",
              "proboscidea",
            ],
            excludeFamilies: [
              "ursidae", "canidae", "felidae", "cervidae", "equidae", "giraffidae",
              "hippopotamidae", "hyaenidae", "tayassuidae",
              "otariidae", "phocidae", "odobenidae",
              "tapiridae", "rhinocerotidae", "bovidae", "suidae",
              "balaenidae", "balaenopteridae", "eschrichtiidae", "physeteridae", "kogiidae", "ziphiidae",
              "delphinidae", "monodontidae", "phocoenidae", "iniidae", "lipotidae", "platanistidae", "pontoporiidae",
              "mustelidae", "viverridae", "herpestidae", "eupleridae", "procyonidae", "mephitidae", "nandiniidae", "prionodontidae",
            ],
            excludeGenera: ["lama", "vicugna"],
          },
          estimatedDescribed: 192,
          estimatedSource: "Remainder of IUCN Table 1a mammals total (6,819) minus the 35 SSC pilot groups above (approx.)",
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
    INSECTS_NODE,

    // ─── ARACHNIDA (leaf) ──────────────────────────────────────────────
    ARACHNIDA_NODE,

    // ─── MOLLUSCA (leaf) ───────────────────────────────────────────────
    MOLLUSCA_NODE,

    // ─── CRUSTACEA (leaf) ──────────────────────────────────────────────
    CRUSTACEA_NODE,

    // ─── CORALS (leaf) ─────────────────────────────────────────────────
    CORALS_NODE,

    // ─── VELVET WORMS (leaf) ───────────────────────────────────────────
    VELVET_WORMS_NODE,

    // ─── HORSESHOE CRABS (leaf) ────────────────────────────────────────
    HORSESHOE_CRABS_NODE,

    // ─── OTHER INVERTEBRATES (catch-all — kept last) ───────────────────
    OTHER_INVERTEBRATES_NODE,

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
        prefixTree(INSECTS_NODE, "inv-"),
        prefixTree(ARACHNIDA_NODE, "inv-"),
        prefixTree(MOLLUSCA_NODE, "inv-"),
        prefixTree(CRUSTACEA_NODE, "inv-"),
        prefixTree(CORALS_NODE, "inv-"),
        prefixTree(VELVET_WORMS_NODE, "inv-"),
        prefixTree(HORSESHOE_CRABS_NODE, "inv-"),
        prefixTree(OTHER_INVERTEBRATES_NODE, "inv-"),
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
