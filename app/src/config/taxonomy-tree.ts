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
   * a specialist group's boundary is a single species (e.g. polar bear within Ursidae).
   * ANDed with every other clause above, same as the rest of this interface — use
   * this alone (no classNames/families/etc.) when the node IS just that species list. */
  speciesNames?: string[];
  /** Exclude mode: exclude these scientific names */
  excludeSpeciesNames?: string[];
  /** OR escape hatch: species included regardless of every other clause above
   * (bypasses classNames/orderNames/families/genera entirely, but still respects
   * csvGroups and the CoL-only universe exclusions). For a group whose own stated
   * remit includes named species outside its otherwise-clean taxonomic rule — e.g.
   * the Antelope Specialist Group's own site names Pronghorn (Antilocapridae),
   * Water Chevrotain (Tragulidae), and Wild Camel (Camelidae) as part of its remit
   * "for practical reasons," alongside its Bovidae-based core. Without this, a
   * species outside the node's family/order rule can never be included no matter
   * what speciesNames says, since every clause in this interface is ANDed together. */
  extraSpeciesNames?: string[];
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

const IUCN_SOURCE = "IUCN 2026-1";
const IUCN_SOURCE_URL = "https://nc.iucnredlist.org/redlist/content/attachment_files/2026-1_RL_Table1a.pdf";
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
  estimatedDescribed: 1_008_355,
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
    { id: "other-insects", name: "Other Insects", filter: { csvGroups: ["other_insects"] }, estimatedDescribed: 33_955, estimatedSource: "Remainder from IUCN Table 1a total of 1,008,355 (" + COL_2025 + ")", estimatedSourceUrl: COL_2025_URL },
  ],
};

const ARACHNIDA_NODE: TaxonomyNode = {
  id: "arachnids",
  name: "Arachnids",
  filter: { csvGroups: ["arachnids"] },
  estimatedDescribed: 98_006,
  estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ")",
  estimatedSourceUrl: COL_2025_URL,
};

const MOLLUSCA_NODE: TaxonomyNode = {
  id: "molluscs",
  name: "Molluscs",
  filter: { csvGroups: ["molluscs"] },
  estimatedDescribed: 89_129,
  estimatedSource: IUCN_SOURCE + " (MolluscaBase 2025)",
  estimatedSourceUrl: "http://www.molluscabase.org",
};

const CRUSTACEA_NODE: TaxonomyNode = {
  id: "crustaceans",
  name: "Crustaceans",
  filter: { csvGroups: ["crustaceans"] },
  estimatedDescribed: 83_805,
  estimatedSource: IUCN_SOURCE + " (" + COL_2025 + "; World Ostracoda Database)",
  estimatedSourceUrl: COL_2025_URL,
};

const CORALS_NODE: TaxonomyNode = {
  id: "corals",
  name: "Corals & Cnidarians",
  filter: { csvGroups: ["corals"] },
  estimatedDescribed: 5_695,
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
const OTHER_INVERTEBRATES_DESCRIBED = 171_981;
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
  estimatedDescribed: 19_539,
  estimatedSource: IUCN_SOURCE + " (" + CHRISTENHUSZ + ")",
  estimatedSourceUrl: CHRISTENHUSZ_URL,
};

const GREEN_ALGAE_NODE: TaxonomyNode = {
  id: "green_algae",
  name: "Green Algae",
  filter: { csvGroups: ["green_algae"] },
  estimatedDescribed: 14_739,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

const RED_ALGAE_NODE: TaxonomyNode = {
  id: "red_algae",
  name: "Red Algae",
  filter: { csvGroups: ["red_algae"] },
  estimatedDescribed: 7_812,
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
  estimatedDescribed: 5_104,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
};

// ─── The Tree ────────────────────────────────────────────────────────

export const TAXONOMY_TREE: TaxonomyNode = {
  id: "all",
  name: "All Species",
  filter: { csvGroups: ALL_CSV_GROUPS },
  estimatedDescribed: 2_121_262,
  estimatedSource: IUCN_SOURCE,
  estimatedSourceUrl: IUCN_SOURCE_URL,
  color: "#dc2626",
  children: [
    // ─── MAMMALS ───────────────────────────────────────────────────────
    {
      id: "mammals",
      name: "Mammals",
      filter: { csvGroups: ["mammals"] },
      estimatedDescribed: 6_854,
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
            // Verified against the group's own site (antelopesg.org), not just
            // iucn.org: "ASG currently recognizes 93 antelope species... Its remit
            // also covers five non-antelope species... for practical reasons" —
            // named as Pronghorn, Tibetan antelope, African Buffalo, Water
            // Chevrotain, and Wild Camel. ASG's own words: "there is in fact no
            // clear definition of an antelope." Reconciled against our other 34
            // groups' own filters:
            //  - African Buffalo (Syncerus caffer) needs no change — family Bovidae,
            //    genus not in the exclude list above, so it already matches this
            //    node; confirmed Afro-Asian Wild Cattle SG's own site frames itself
            //    as "Asia's nine wild cattle species" (Asia-only despite the "Afro-"
            //    in its name), so there's no double-claim.
            //  - Pronghorn (Antilocapridae), Water Chevrotain (Tragulidae), and Wild
            //    Camel (Camelidae) aren't Bovidae at all, so the family rule above
            //    can never match them — added via extraSpeciesNames below, the only
            //    node in this tree that needs it so far.
            //  - Tibetan antelope (Pantholops hodgsonii) is deliberately NOT moved
            //    here despite ASG's claim: it stays under Caprinae SG, whose own
            //    page names the formal subfamily "Caprinae" outright — a cleaner,
            //    more specific claim than ASG's hedged "for practical reasons"
            //    mention, and modern phylogenetics places Pantholops within
            //    Caprinae. A real, acknowledged overlap between the two groups'
            //    stated remits, not a bug — flagging here rather than duplicating
            //    the species into both (this tree assumes one node per species).
            extraSpeciesNames: ["antilocapra americana", "hyemoschus aquaticus", "camelus ferus"],
          },
          estimatedDescribed: 93,
          estimatedSource: MDD + " — Bovidae minus wild cattle/bison (Wild Cattle/Bison SG) and Caprinae (Caprinae SG), plus Pronghorn, Water Chevrotain, and Wild Camel per the group's own stated remit (approx.)",
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
              "kogiidae", "ziphiidae", "hyperoodontidae", "neobalaenidae", "delphinidae", "monodontidae",
              "phocoenidae", "iniidae", "lipotidae", "platanistidae", "pontoporiidae",
            ],
          },
          estimatedDescribed: 94,
          estimatedSource: MDD + " — cetacean families (order_name is shared with Artiodactyla under Cetartiodactyla, so filtered by family instead; hyperoodontidae is CoL's current name for the beaked whales traditionally in ziphiidae — both kept since IUCN's own data still uses ziphiidae; neobalaenidae is the pygmy right whale) (approx.)",
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
            // Verified against the group's own site (smallcarnivore.org), not just
            // iucn.org: explicitly claims "red pandas, the Malagasy carnivores,
            // mongooses, skunks and stink badgers, weasels, martens and badgers,
            // civets and genets, linsangs, raccoons and coatis" and states "We do
            // not cover any species of cat, dog, or otter" — confirming both the
            // Ailuridae addition here and the otter exclusion below.
            families: ["mustelidae", "viverridae", "herpestidae", "eupleridae", "procyonidae", "mephitidae", "nandiniidae", "prionodontidae", "ailuridae"],
            excludeGenera: ["lutra", "pteronura", "aonyx", "lutrogale", "enhydra", "hydrictis", "lontra"],
          },
          estimatedDescribed: 159,
          estimatedSource: MDD + " — small-carnivore families (incl. Ailuridae/red pandas) minus Lutrinae/otters (Otter SG) (approx.)",
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
        // groups above — e.g. treeshrew-adjacent oddities and moles' relatives with
        // no dedicated group. Kept in sync manually — if a 36th SSC group is added
        // above, add its order/family/genus here too so it doesn't double-count
        // into this row. Species claimed via a group's extraSpeciesNames (an OR
        // escape hatch outside the normal order/family/genus rules — see
        // SpeciesFilter's doc comment) must be excluded here by name explicitly,
        // since they don't share a family/order with anything else in this list:
        // Pronghorn, Water Chevrotain, and Wild Camel are claimed by Antelope SG.
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
              "hyperoodontidae", "neobalaenidae",
              "delphinidae", "monodontidae", "phocoenidae", "iniidae", "lipotidae", "platanistidae", "pontoporiidae",
              "mustelidae", "viverridae", "herpestidae", "eupleridae", "procyonidae", "mephitidae", "nandiniidae", "prionodontidae",
              "ailuridae",
            ],
            excludeGenera: ["lama", "vicugna"],
            excludeSpeciesNames: ["antilocapra americana", "hyemoschus aquaticus", "camelus ferus"],
          },
          estimatedDescribed: 223,
          estimatedSource: "Remainder of IUCN Table 1a mammals total (6,854) minus the 35 SSC pilot groups above (approx.)",
          estimatedSourceUrl: IUCN_SOURCE_URL,
        },
      ],
    },

    // ─── SSC SPECIALIST GROUPS (reptiles) ───────────────────────────────
    // Same second lens as "ssc-groups" (mammals) above, over the "reptiles"
    // CSV group instead. Scope for each group was sourced from its own
    // dedicated site (not just its iucn.org listing, which is often a bare
    // contact page), cross-checked against the real family/genus
    // distribution in our reptile data — see each node's comment for the
    // specific source quote. estimatedDescribed below is our own
    // assessed+unassessed species count matching each filter (Reptile
    // Database-derived, same source as the "reptiles" node's own subgroup
    // estimates) — a real count, not a third-party citation, since no
    // external source publishes per-SSC-group described-species totals.
    {
      id: "ssc-reptile-groups",
      name: "SSC Specialist Groups",
      filter: { csvGroups: ["reptiles"] },
      children: [
        {
          id: "ssc-crocodile",
          name: "Crocodile Specialist Group",
          filter: { csvGroups: ["reptiles"], families: ["crocodylidae", "alligatoridae", "gavialidae"] },
          // Own site (iucncsg.org): "There are 26 recognised species of extant
          // crocodilians... divided into three Families - Alligatoridae...
          // Crocodylidae... and Gavialidae" — all of order Crocodylia, no exceptions.
          estimatedDescribed: 27,
          estimatedSource: REPTILE_DB + " — Crocodylidae + Alligatoridae + Gavialidae (all of Crocodylia)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "http://www.iucncsg.org/",
        },
        {
          id: "ssc-tortoise-freshwater-turtle",
          name: "Tortoise and Freshwater Turtle Specialist Group",
          filter: {
            csvGroups: ["reptiles"],
            families: [
              "geoemydidae", "testudinidae", "chelidae", "emydidae", "kinosternidae",
              "trionychidae", "pelomedusidae", "podocnemididae", "chelydridae",
              "platysternidae", "dermatemydidae", "carettochelyidae",
            ],
          },
          // Own site (iucn-tftsg.org): mission covers "all species of tortoises
          // and freshwater turtles" — i.e. every Testudines family except the 2
          // marine turtle families (Cheloniidae, Dermochelyidae), which belong to
          // the separate Marine Turtle SG below. No source states the marine
          // exclusion in so many words; it's implied by "freshwater and
          // terrestrial" plus the existence of a dedicated Marine Turtle SG.
          estimatedDescribed: 357,
          estimatedSource: REPTILE_DB + " — all Testudines families except Cheloniidae/Dermochelyidae (Marine Turtle SG)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "https://iucn-tftsg.org/",
        },
        {
          id: "ssc-marine-turtle",
          name: "Marine Turtle Specialist Group",
          filter: { csvGroups: ["reptiles"], families: ["cheloniidae", "dermochelyidae"] },
          // Own site (iucn-mtsg.org): "responsible for providing information on
          // the seven species of sea turtles" — Cheloniidae (6) + Dermochelyidae
          // (1, leatherback), all 7 recognized species, no exceptions.
          estimatedDescribed: 7,
          estimatedSource: REPTILE_DB + " — Cheloniidae + Dermochelyidae (all 7 sea turtle species)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "http://iucn-mtsg.org/",
        },
        {
          id: "ssc-skink",
          name: "Skink Specialist Group",
          filter: { csvGroups: ["reptiles"], families: ["scincidae"] },
          // Own site (skinks.org) + SSC annual report: "aims to complete Red
          // List assessments for all skink species... 1,725 species are
          // recognised by the SSG" — whole family Scincidae, no exceptions
          // found. Dibamidae (legless "skink-like" lizards) is a separate
          // family, not mentioned by the group either way — left out of scope.
          estimatedDescribed: 1_704,
          estimatedSource: REPTILE_DB + " — Scincidae",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "https://www.skinks.org/",
        },
        {
          id: "ssc-chameleon",
          name: "Chameleon Specialist Group",
          filter: { csvGroups: ["reptiles"], families: ["chamaeleonidae"] },
          // Own site (iucnchameleons.org): "there are currently 228 species of
          // chameleon recognized by the Chameleon Specialist Group" — whole
          // family Chamaeleonidae, no carve-outs.
          estimatedDescribed: 217,
          estimatedSource: REPTILE_DB + " — Chamaeleonidae",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "http://iucnchameleons.org/",
        },
        {
          id: "ssc-monitor-lizard",
          name: "Monitor Lizard Specialist Group",
          filter: { csvGroups: ["reptiles"], families: ["varanidae", "lanthanotidae"] },
          // Own site (iucn-mlsg.org): "the monotypic Lanthanotus borneensis is
          // also dealt within the IUCN SSC Monitor Lizard Specialist Group...
          // sole member of the family Lanthanotidae [Earless monitor lizards]
          // ...together with the Varanidae reflect two families of the
          // Superfamily Platynota" — explicit, both families.
          estimatedDescribed: 87,
          estimatedSource: REPTILE_DB + " — Varanidae + Lanthanotidae",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "https://iucn-mlsg.org/",
        },
        {
          id: "ssc-iguana",
          name: "Iguana Specialist Group",
          filter: { csvGroups: ["reptiles"], families: ["iguanidae"] },
          // Own site's Iguana Taxonomy Working Group checklist: "A CHECKLIST OF
          // THE IGUANAS OF THE WORLD (IGUANIDAE; IGUANINAE)" — 9 genera
          // (Amblyrhynchus, Brachylophus, Cachryx, Conolophus, Ctenosaura,
          // Cyclura, Dipsosaurus, Iguana, Sauromalus). Confirmed against our
          // data: every species under the "iguanidae" family label is one of
          // these 9 genera (no stray genus), so a plain family filter is exact.
          estimatedDescribed: 48,
          estimatedSource: REPTILE_DB + " — Iguanidae (confirmed = the 9 genera in the group's own checklist, no stray genera)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "http://www.iucn-isg.org/",
        },
        {
          id: "ssc-anoline-lizard",
          name: "Anoline Lizard Specialist Group",
          filter: { csvGroups: ["reptiles"], genera: ["anolis"] },
          // Own site (iucn.org): mission covers "Anolis (anole) lizards...
          // across the entire distribution of Anolis" — genus-scoped, not
          // family-scoped. Our data splits anoles across two synonymous family
          // labels, "anolidae" (379 spp) and "dactyloidae" (53 spp) — both are
          // entirely genus Anolis, confirmed by direct query, so filtering by
          // genus (not family) is both more faithful to the group's own words
          // and immune to the family-label split. A third family label,
          // "polychrotidae" (9 spp), is entirely genus Polychrus — a related
          // but distinct genus the group's own scope doesn't name — correctly
          // NOT included (falls to the Snake and Lizard RLA catch-all below).
          estimatedDescribed: 432,
          estimatedSource: REPTILE_DB + " — genus Anolis (spans the anolidae/dactyloidae family-label split in our data; excludes Polychrus)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-anoline-lizard-specialist-group",
        },
        {
          id: "ssc-viper",
          name: "Viper Specialist Group",
          filter: { csvGroups: ["reptiles"], families: ["viperidae"] },
          // No first-party page could be fetched directly (the group's own
          // domain, viperconservation.org, didn't resolve; the old Orianne
          // Society URL on file now 404s). Scope confirmed instead via the
          // neighboring Snake Specialist Group's own site (iucnsnake.org): "the
          // SSG does not include vipers or elapids in the subfamily
          // Hydrophiinae, which are covered by the IUCN SSC Viper and Sea Snake
          // Specialist Groups, respectively" — i.e. Viperidae in full, no
          // subfamily carve-out (covers Viperinae, Crotalinae, and Azemiopinae
          // alike).
          estimatedDescribed: 377,
          estimatedSource: REPTILE_DB + " — Viperidae",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-viper-specialist-group",
        },
        {
          id: "ssc-sea-snake",
          name: "Sea Snake Specialist Group",
          filter: {
            csvGroups: ["reptiles"],
            genera: [
              // "True sea snakes" and sea kraits (Elapidae subfamily
              // Hydrophiinae, marine lineages only — NOT the many terrestrial
              // Hydrophiinae genera like Naja, Bungarus, Dendroaspis, Micrurus,
              // Oxyuranus, Notechis, etc., which stay in the catch-all below).
              "hydrophis", "aipysurus", "emydocephalus", "laticauda", "microcephalophis",
              "hydrelaps", "ephalophis", "parahydrophis", "enhydrina", "kerilia",
              "kolpophis", "lapemis", "pelamis", "thalassophina",
              // "Estuarine/marine mud snakes" — whole family Homalopsidae,
              // expressed as its full genus list since SpeciesFilter's
              // families+genera fields are ANDed, not OR'd, and this node
              // already needs `genera` for the Elapidae subset above.
              "enhydris", "homalopsis", "cerberus", "calamophis", "brachyorrhos",
              "myron", "gyiophis", "myrrophis", "hypsiscopus", "homalophis",
              "sumatranus", "subsessor", "raclitia", "pseudoferania", "phytolopsis",
              "myanophis", "miralia", "mintonophis", "kualatahan", "heurnia",
              "gerarda", "fordonia", "ferania", "erpeton", "djokoiskandarus",
              "dieurostus", "cantoria", "bitia",
              // "File snakes" — whole family Acrochordidae (1 genus).
              "acrochordus",
            ],
          },
          // Own mission statement (2024-25 SSC Annual Report, iucn.org): "the
          // conservation of the world's marine and aquatic snakes — true sea
          // snakes, sea kraits, estuarine/marine mud and file snakes" — spans
          // 3 families (a genus-level subset of Elapidae + all of Homalopsidae
          // + all of Acrochordidae), confirmed by the neighboring Snake
          // Specialist Group's own exclusion statement (see Viper SG above).
          estimatedDescribed: 130,
          estimatedSource: REPTILE_DB + " — marine Elapidae genera + Homalopsidae + Acrochordidae",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-sea-snake-specialist-group",
        },
        {
          id: "ssc-boa-python",
          name: "Boa and Python Specialist Group",
          filter: {
            csvGroups: ["reptiles"],
            families: ["boidae", "pythonidae", "erycidae", "charinaidae", "candoiidae", "sanziniidae", "ungaliophiidae"],
          },
          // LOWER CONFIDENCE than the other reptile groups here — flagging
          // explicitly rather than presenting this as settled. The group's
          // current iucn.org page is an empty template and its only listed
          // contact is a Facebook page; the only scope statement found is an
          // undated, third-party-hosted brochure: "true boas and pythons,
          // families Boidae and Pythonidae, represent about half of the
          // overall remit" of "~186 species... distributed in 12 families."
          // Boidae + Pythonidae plus the 5 genera IUCN's own Red List
          // assessments still classify under "Boidae" (Erycidae, Charinaidae,
          // Candoiidae, Sanziniidae, Ungaliophiidae — modern splits not yet
          // reflected in IUCN's working taxonomy, confirmed via a real
          // assessment PDF for Eryx johnii) are included with good confidence.
          // The brochure's other ~10 relict families (Aniliidae, Anomochilidae,
          // Bolyeriidae, Calabariidae, Cylindrophiidae, Loxocemidae,
          // Tropidophiidae, Uropeltidae, Xenopeltidae, Xenophiidae) are
          // DELIBERATELY left out of this filter and fall to the Snake and
          // Lizard RLA catch-all instead: no source could confirm the brochure
          // is current, no independent source corroborates it, and several of
          // those families (e.g. Uropeltidae, shield-tailed snakes) aren't
          // "boas or pythons" in any common or modern-phylogenetic sense. If a
          // current, authoritative BPSG scope statement surfaces, revisit —
          // this is the single lowest-confidence call in the reptile pilot.
          estimatedDescribed: 112,
          estimatedSource: REPTILE_DB + " — Boidae + Pythonidae + 5 genera IUCN's own assessments still classify under Boidae (approx.; excludes ~10 more distant families named in an unconfirmed brochure — see comment)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-boa-and-python-specialist-group",
        },
        // Catch-all: NOT a "no group" placeholder like ssc-other-mammals — this
        // IS the real "IUCN SSC Snake and Lizard Red List Authority", confirmed
        // via its own SSC annual report: "undertake and support IUCN Red List
        // assessments for reptile groups not covered by other Specialist
        // Groups, including most snakes and lizards and the New Zealand
        // Tuatara (Sphenodon punctatus)" — a real, named, residual-by-design
        // entity, not a gap in our coverage. The tuatara is a genuinely
        // reported exception (Rhynchocephalia, not even Squamata) — added via
        // extraSpeciesNames, the same escape hatch the mammal pilot's Antelope
        // SG uses. Kept in sync manually — if a 13th reptile SSC group is
        // added above, exclude its family/genus here too.
        {
          id: "ssc-snake-lizard-rla",
          name: "Snake and Lizard Red List Authority",
          filter: {
            csvGroups: ["reptiles"],
            excludeFamilies: [
              "crocodylidae", "alligatoridae", "gavialidae",
              "geoemydidae", "testudinidae", "chelidae", "emydidae", "kinosternidae",
              "trionychidae", "pelomedusidae", "podocnemididae", "chelydridae",
              "platysternidae", "dermatemydidae", "carettochelyidae",
              "cheloniidae", "dermochelyidae",
              "scincidae", "chamaeleonidae", "varanidae", "lanthanotidae", "iguanidae",
              "anolidae", "dactyloidae",
              "viperidae",
              "homalopsidae", "acrochordidae",
              "boidae", "pythonidae", "erycidae", "charinaidae", "candoiidae", "sanziniidae", "ungaliophiidae",
              "sphenodontidae",
            ],
            excludeGenera: [
              "hydrophis", "aipysurus", "emydocephalus", "laticauda", "microcephalophis",
              "hydrelaps", "ephalophis", "parahydrophis", "enhydrina", "kerilia",
              "kolpophis", "lapemis", "pelamis", "thalassophina",
            ],
            extraSpeciesNames: ["sphenodon punctatus"],
          },
          estimatedDescribed: 7_959,
          estimatedSource: "Remainder of " + REPTILE_DB + " reptile total minus the 11 SSC groups above, plus the tuatara (approx.)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-snake-and-lizard-red-list-authority",
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
      estimatedDescribed: 12_568,
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
      estimatedDescribed: 9_075,
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
      estimatedDescribed: 37_630,
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

    // ─── SSC SPECIALIST GROUPS (fishes) ─────────────────────────────────
    // Same second lens as "ssc-groups"/"ssc-reptile-groups" above, over the
    // "fishes" CSV group. Only 9 of the 10 fish/marine SSC groups are built
    // here — the IUCN SSC Freshwater Fish Specialist Group (FFSG) is
    // DELIBERATELY EXCLUDED. FFSG's own site states its remit as "all
    // freshwater fishes (>15,000 species)" — a HABITAT-based scope (marine vs.
    // freshwater), not a taxonomic one. Our data has a `systems` field
    // ("Freshwater"/"Marine"/...) but it's only populated for ASSESSED species
    // (assessed.parquet) — unassessed species (the majority of the ~33,000-row
    // fish universe) have no `systems` value at all, so a habitat-based filter
    // can't be built without either leaving most of the universe unclassified
    // or guessing from family-level heuristics (many families, e.g. Gobiidae,
    // span both marine and freshwater — too risky to encode as fact). This is
    // the same class of blocker as the 12 geographic regional Plant Red List
    // Authorities: real, named IUCN entities whose remit needs a data
    // dimension (range/habitat) this snapshot doesn't reliably have across the
    // whole species universe. Revisit if/when the pipeline gains reliable
    // habitat data for unassessed species too. The Anguillid Eel group was
    // historically a sub-page of FFSG's own site but is organizationally
    // independent (per its own materials) and cleanly family-scoped, so it's
    // included below on its own regardless of FFSG's absence.
    {
      id: "ssc-fish-groups",
      name: "SSC Specialist Groups",
      filter: { csvGroups: ["fishes"] },
      children: [
        {
          id: "ssc-shark",
          name: "Shark Specialist Group",
          filter: { csvGroups: ["fishes"], classNames: ["chondrichthyes"] },
          // Own site (iucnssg.org): "leading authority on the status of sharks,
          // rays, and chimaeras" — the entire class Chondrichthyes, repeatedly
          // and explicitly including chimaeras (not just elasmobranchs).
          estimatedDescribed: 1_266,
          estimatedSource: ESCHMEYER + " — Chondrichthyes (sharks, rays, skates, and chimaeras)",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: "https://www.iucnssg.org",
        },
        {
          id: "ssc-grouper-wrasse",
          name: "Grouper and Wrasse Specialist Group",
          filter: { csvGroups: ["fishes"], families: ["serranidae", "epinephelidae", "labridae", "scaridae"] },
          // iucn.org: "The GWSG works with groupers and wrasses and their
          // relatives (Families: Epinephelidae; Serranidae; Labridae;
          // Scaridae)" — explicit, both grouper family labels (Epinephelidae
          // was split out of Serranidae, and our data still carries both) plus
          // wrasses and parrotfishes.
          estimatedDescribed: 1_066,
          estimatedSource: ESCHMEYER + " — Serranidae + Epinephelidae + Labridae + Scaridae",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-groupers-and-wrasses-specialist-group",
        },
        {
          id: "ssc-snapper-seabream-grunt",
          name: "Snapper, Seabream and Grunt Specialist Group",
          filter: { csvGroups: ["fishes"], families: ["lutjanidae", "sparidae", "haemulidae", "nemipteridae", "lethrinidae", "caesionidae"] },
          // Own iucn.org page names 6 families, not just the 3 in its name:
          // "snappers, seabreams, grunts, threadfin breams, emperors and
          // fusiliers" — Lutjanidae, Sparidae, Haemulidae, Nemipteridae,
          // Lethrinidae, Caesionidae. Gerreidae (mojarras) is NOT named
          // anywhere in the group's own materials despite being a similar
          // reef-fish family — deliberately left out, falls to the catch-all.
          estimatedDescribed: 547,
          estimatedSource: ESCHMEYER + " — Lutjanidae + Sparidae + Haemulidae + Nemipteridae + Lethrinidae + Caesionidae",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-snapper-seabream-and-grunt-specialist-group",
        },
        {
          id: "ssc-seahorse-pipefish-seadragon",
          name: "Seahorse, Pipefish and Seadragon Specialist Group",
          filter: {
            csvGroups: ["fishes"],
            families: ["syngnathidae", "solenostomidae", "aulostomidae", "fistulariidae", "centriscidae"],
          },
          // Own site (iucn-seahorse.org): "dedicated to the conservation of
          // seahorses, pipefishes, pipehorses and seadragons — as well as
          // related species such as trumpetfishes, cornetfishes, and
          // shrimpfishes" — order Syngnathiformes in full: Syngnathidae (the
          // core family) plus Solenostomidae (ghost pipefish), Aulostomidae
          // (trumpetfish), Fistulariidae (cornetfish), and Centriscidae
          // (shrimpfish) — all explicitly named, not just the core family.
          estimatedDescribed: 324,
          estimatedSource: ESCHMEYER + " — Syngnathidae + Solenostomidae + Aulostomidae + Fistulariidae + Centriscidae (order Syngnathiformes)",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: "https://iucn-seahorse.org/",
        },
        {
          id: "ssc-sciaenid",
          name: "Sciaenid Red List Authority",
          filter: { csvGroups: ["fishes"], families: ["sciaenidae"] },
          // Renamed by IUCN to "Croaker and Drum Fishes Red List Authority"
          // (our source DB still lists the legacy name) — iucn.org: "purposes
          // include revising and submitting assessments of all 300 species of
          // Croaker and Drum Fishes" — the whole family Sciaenidae, no
          // exceptions found.
          estimatedDescribed: 302,
          estimatedSource: ESCHMEYER + " — Sciaenidae",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-croaker-and-drum-fishes-red-list-authority",
        },
        {
          id: "ssc-salmonid",
          name: "Salmonid Specialist Group",
          filter: { csvGroups: ["fishes"], families: ["salmonidae"] },
          // The group's listed dedicated site (stateofthesalmon.org) is
          // defunct (redirects to a broken tool, no scope statement) — scope
          // confirmed via iucn.org instead: covers "salmonids (fishes in the
          // family Salmonidae)... throughout their native range," naming
          // genera across all 3 subfamilies (Salmoninae, Coregoninae,
          // Thymallinae) — the whole family, no carve-outs found.
          estimatedDescribed: 248,
          estimatedSource: ESCHMEYER + " — Salmonidae",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-salmonid-specialist-group",
        },
        {
          id: "ssc-tuna-billfish",
          name: "Tuna and Billfish Specialist Group",
          filter: { csvGroups: ["fishes"], families: ["scombridae", "istiophoridae", "xiphiidae"] },
          // No single explicit Latin-family statement found on iucn.org (thin
          // page), but the group's own activity reports state a precise,
          // self-declared total — "the first comprehensive extinction risk
          // assessments for the 61 species of tunas, mackerels and
          // billfishes" and "51 scombrids and 10 billfishes" — which matches
          // exactly: 51 = the full accepted species count of family Scombridae
          // (not just the tuna genera — includes mackerels/bonitos too), and
          // 10 = Istiophoridae (9 species) + monotypic Xiphiidae (swordfish).
          // 51 + 10 = 61, confirming full-family scope for all 3 families.
          estimatedDescribed: 63,
          estimatedSource: ESCHMEYER + " — Scombridae + Istiophoridae + Xiphiidae (matches the group's own self-declared total of 61 species)",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-tuna-and-billfish-specialist-group",
        },
        {
          id: "ssc-sturgeon",
          name: "Sturgeon Specialist Group",
          filter: { csvGroups: ["fishes"], families: ["acipenseridae", "polyodontidae"] },
          // iucn.org mission: "conservation, management, recovery and
          // sustainable use of sturgeon and paddlefish populations worldwide"
          // — explicitly both families of order Acipenseriformes (Acipenseridae
          // = sturgeons; Polyodontidae = paddlefish, only 2 species exist:
          // American paddlefish + the now-extinct Chinese paddlefish), not
          // sturgeons alone.
          estimatedDescribed: 27,
          estimatedSource: ESCHMEYER + " — Acipenseridae + Polyodontidae (order Acipenseriformes)",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-sturgeon-specialist-group",
        },
        {
          id: "ssc-anguillid-eel",
          name: "Anguillid Eel Specialist Group",
          filter: { csvGroups: ["fishes"], families: ["anguillidae"] },
          // Own site (hosted as a page of iucnffsg.org, but organizationally
          // independent since a 2015 IUCN-SSC Leaders' Meeting decision, per
          // its own materials): "all species within the family Anguillidae" —
          // a monogeneric family (genus Anguilla), all 16 extant species.
          estimatedDescribed: 16,
          estimatedSource: ESCHMEYER + " — Anguillidae (genus Anguilla)",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: "http://www.iucnffsg.org/about-ffsg/anguillid-specialist-sub-group/",
        },
        // Catch-all: NOT a claim on behalf of Freshwater Fish SG (see the
        // exclusion note above) — a plain "no dedicated SSC group" remainder,
        // same shape as ssc-other-mammals. Kept in sync manually — if a 10th
        // fish SSC group is added above, exclude its family/class here too.
        {
          id: "ssc-other-fish",
          name: "No SSC Group",
          filter: {
            csvGroups: ["fishes"],
            excludeClasses: ["chondrichthyes"],
            excludeFamilies: [
              "serranidae", "epinephelidae", "labridae", "scaridae",
              "lutjanidae", "sparidae", "haemulidae", "nemipteridae", "lethrinidae", "caesionidae",
              "syngnathidae", "solenostomidae", "aulostomidae", "fistulariidae", "centriscidae",
              "sciaenidae", "salmonidae",
              "scombridae", "istiophoridae", "xiphiidae",
              "acipenseridae", "polyodontidae",
              "anguillidae",
            ],
          },
          estimatedDescribed: 29_185,
          estimatedSource: "Fish species (assessed + unassessed, per our own data) not in any of the 9 SSC groups above (approx.; does not include the Freshwater Fish SG's much broader habitat-defined remit — see exclusion note above)",
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
      estimatedDescribed: 1_457_195,
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
      estimatedDescribed: 424_003,
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
      estimatedDescribed: 162_752,
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
