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
          // The group dropped "Afro-" from its own self-identification (see
          // asianwildcattle.org, its own IUCN report PDFs, and social handles —
          // all "Asian Wild Cattle Specialist Group"). Only the legacy iucn.org
          // directory listing still uses the old "Afro-Asian" name. Keeping the
          // "Afro-Asian" node id for stability, but the display name and source
          // now reflect the group's own current branding.
          name: "Asian Wild Cattle Specialist Group",
          filter: {
            csvGroups: ["mammals"],
            genera: ["bos", "bubalus", "pseudoryx"],
            // The group's own site is explicit: "Asia's nine wild cattle
            // species... All nine of these species are threatened with
            // extinction" — Bos primigenius (the aurochs, EX) is extinct,
            // not Asia-endemic (ranged across Europe/N. Africa/Asia), and the
            // ancestor of domestic cattle worldwide, not one of the 9 the
            // group names. Excluded to avoid a genus-match false positive.
            excludeSpeciesNames: ["bos primigenius"],
          },
          estimatedDescribed: 9,
          estimatedSource: MDD + " — Bos + Bubalus + Pseudoryx minus the extinct aurochs (approx.; excludes Syncerus caffer, covered by the Antelope SG)",
          estimatedSourceUrl: MDD_URL,
          sourceUrl: "https://www.asianwildcattle.org/",
        },
        {
          id: "ssc-afrotheria",
          name: "Afrotheria Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["afrosoricida", "macroscelidea", "hyracoidea", "tubulidentata"] },
          // Own site (afrotheria.net): "1 aardvark, 6 hyraxes, 19 sengis, 21
          // golden moles, 34 tenrecs" = 81 (golden moles + tenrecs are both
          // subsumed under order Afrosoricida in our data, not separate
          // "groups" as the group's own site describes them informally).
          estimatedDescribed: 81,
          estimatedSource: "Own site (afrotheria.net) — 1 aardvark + 6 hyraxes + 19 sengis + 21 golden moles + 34 tenrecs",
          estimatedSourceUrl: "https://afrotheria.net/",
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-afrotheria-specialist-group",
        },
        {
          id: "ssc-anteater-sloth-armadillo",
          name: "Anteater, Sloth and Armadillo Specialist Group",
          filter: { csvGroups: ["mammals"], orderNames: ["pilosa", "cingulata"] },
          // Own site (xenarthrans.org): "seven sloth species, ten anteater
          // species, and 25 armadillo species" = 42; stale MDD-derived figure
          // (31) reflected pre-2025 traditional Xenarthra taxonomy.
          estimatedDescribed: 42,
          estimatedSource: "Own site (xenarthrans.org) — 7 sloths + 10 anteaters + 25 armadillos",
          estimatedSourceUrl: "https://xenarthrans.org/species/",
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
              "ammotragus", "hemitragus", "nilgiritragus", "arabitragus", "pseudois",
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
          // Own materials (IUCN 2024-2025 SSC report): "the world's five
          // monotreme species and approximately 265 marsupial species of
          // Australia, New Guinea, Indonesia and the Solomon Islands" = ~270;
          // stale MDD-derived figure (250) undercounted.
          estimatedDescribed: 270,
          estimatedSource: "Own 2024-2025 SSC annual report — 5 monotremes + ~265 marsupials",
          estimatedSourceUrl: "https://iucn.org/sites/default/files/2025-09/2024-2025-iucn-ssc-australasian-marsupial-and-monotreme-sg-report_post-pub-rev-r1.pdf",
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
              "ammotragus", "hemitragus", "nilgiritragus", "arabitragus", "pseudois",
            ],
          },
          estimatedDescribed: 42,
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
          filter: {
            csvGroups: ["mammals"],
            families: ["cervidae", "moschidae", "tragulidae"],
            // Deer SG's own stated remit extends beyond true deer to musk deer
            // (Moschidae) and chevrotains (Tragulidae). Hyemoschus aquaticus
            // (Water Chevrotain) is the one exception: Antelope SG's own site
            // claims it "for practical reasons" (see ssc-antelope's comment),
            // so it stays there via extraSpeciesNames rather than double-counting.
            excludeSpeciesNames: ["hyemoschus aquaticus"],
          },
          estimatedDescribed: 72,
          estimatedSource: MDD + " — Cervidae + Moschidae + Tragulidae minus Water Chevrotain (Antelope SG) (approx.)",
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
          // estimatedDescribed corrected — a prior fix misread this same
          // paper's figure as 108 (which suspiciously matched how many rows
          // happen to be in our own dataset, not the paper's own stated
          // total). The paper's abstract states verbatim: "New World
          // Marsupials (NWMs) comprise over 135 species... classified within
          // the orders Didelphimorphia, Microbiotheria and Paucituberculata"
          // — Didelphimorphia 127 + Microbiotheria 1 + Paucituberculata 7 = 135.
          estimatedDescribed: 135,
          estimatedSource: "Martin & Carmignotto 2024, Mammal Review — \"over 135 species\" (127 Didelphimorphia + 1 Microbiotheria + 7 Paucituberculata)",
          estimatedSourceUrl: "https://iucn.org/sites/default/files/2024-06/2024-martin-carmignotto-new-world-marsupials.pdf",
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
          // MDD's figure (522) was logically impossible — lower than our own
          // data's 527 assessed Primates rows (assessed can't exceed
          // described). Corrected to the Primate SG's own self-reported
          // count.
          estimatedDescribed: 527,
          estimatedSource: "IUCN SSC Primate Specialist Group's own count — \"there are 527 known species of primates\"",
          estimatedSourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-primate-specialist-group",
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
          // The group's own site (camelid.org) brands itself in English as
          // "South American Camelid Specialist Group" (GECS) — IUCN's own
          // directory listing still uses "Wild Camelid," so the node id and
          // sourceUrl slug are kept for stability, same treatment as Asian
          // Wild Cattle SG above.
          name: "South American Camelid Specialist Group",
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
              "tapiridae", "rhinocerotidae", "bovidae", "suidae", "moschidae", "tragulidae",
              "balaenidae", "balaenopteridae", "eschrichtiidae", "physeteridae", "kogiidae", "ziphiidae",
              "hyperoodontidae", "neobalaenidae",
              "delphinidae", "monodontidae", "phocoenidae", "iniidae", "lipotidae", "platanistidae", "pontoporiidae",
              "mustelidae", "viverridae", "herpestidae", "eupleridae", "procyonidae", "mephitidae", "nandiniidae", "prionodontidae",
              "ailuridae",
            ],
            excludeGenera: ["lama", "vicugna"],
            excludeSpeciesNames: ["antilocapra americana", "hyemoschus aquaticus", "camelus ferus"],
            // Bos primigenius (the extinct aurochs) is genus Bos/family
            // Bovidae like every species Asian Wild Cattle SG claims, but
            // that group's own site explicitly excludes it (see its filter's
            // comment) — since bovidae is otherwise wholly claimed by named
            // groups, it needs this explicit species-level exception to land
            // here instead of vanishing from every node.
            extraSpeciesNames: ["bos primigenius"],
          },
          // estimatedDescribed recomputed — the prior figure (223) had
          // drifted out of sync with its own stated formula after several
          // sibling groups' estimates were corrected in later review rounds
          // (e.g. Primate SG 522→527, Anteater/Sloth/Armadillo SG 31→42,
          // Australasian Marsupial SG 250→270). Recomputed as the actual sum
          // of all 35 sibling nodes' current estimatedDescribed values.
          estimatedDescribed: 163,
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
          sourceUrl: "https://www.iucn-mtsg.org/",
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
          // Superfamily Platynota" — explicit, both families. NOTE:
          // iucn-mlsg.org currently serves a broken self-signed/placeholder
          // TLS certificate (confirmed live and legitimate content once
          // bypassed) — users clicking through may see a browser security
          // warning; this is a hosting issue on the group's end, not a data
          // problem here.
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
          // family-scoped, so filtering by genus (not family) is most
          // faithful to the group's own words and immune to any future
          // family-label churn. Our data currently files all 379 Anolis-genus
          // species under the single family label "anolidae" (no
          // "dactyloidae" label exists in this dataset, despite it being a
          // synonym used elsewhere in the literature). A separate family
          // label, "polychrotidae" (7 spp), is entirely genus Polychrus — a
          // related but distinct genus the group's own scope doesn't name —
          // correctly NOT included (falls to the Snake and Lizard RLA
          // catch-all below). The estimatedDescribed gap below (432 vs. 379)
          // reflects Reptile Database's larger global described-species count
          // vs. this file's assessed/candidate subset, not an in-file
          // family-label split.
          estimatedDescribed: 432,
          estimatedSource: REPTILE_DB + " — genus Anolis (filed under family \"anolidae\" in our data; excludes Polychrus)",
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
          id: "ssc-gekkota",
          name: "Gekkota Lizard Specialist Group",
          filter: {
            csvGroups: ["reptiles"],
            families: ["gekkonidae", "eublepharidae", "phyllodactylidae", "sphaerodactylidae", "diplodactylidae", "carphodactylidae", "pygopodidae"],
          },
          // Found missing entirely in a post-review pass — a real group
          // (formed 2025, after the DB's ssc_group_lookup snapshot was
          // taken) confirmed via its own iucn.org page: "ensure the
          // long-term survival of all Gekkota species... over 2,300 species
          // distributed across seven families" — the 7 standard,
          // universally-recognized Gekkota families (all geckos), all
          // present in our data.
          estimatedDescribed: 2_300,
          estimatedSource: IUCN_SOURCE + " — Gekkota (7 families, per the group's own stated scope)",
          estimatedSourceUrl: IUCN_SOURCE_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-gekkota-lizard-specialist-group",
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
          // Also flagged: the iucn.org directory profile above now returns a
          // dead "No results were found" search page (was merely a thin
          // empty template before, now broken outright); pointed sourceUrl
          // instead at a live iucn.org content page that's actually about
          // this group. Its long-time Executive Office, Fundación
          // Biodiversidad, reportedly stepped down from that role in
          // December 2020 — an organizational change not otherwise
          // documented here, though the group appears to still be active per
          // SSC quadrennium reporting.
          estimatedDescribed: 112,
          estimatedSource: REPTILE_DB + " — Boidae + Pythonidae + 5 genera IUCN's own assessments still classify under Boidae (approx.; excludes ~10 more distant families named in an unconfirmed brochure — see comment)",
          estimatedSourceUrl: REPTILE_DB_URL,
          sourceUrl: "https://iucn.org/content/kering-and-iucn-boa-python-specialist-group-announce-first-report-captive-breeding",
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
        // SG uses. Kept in sync manually — if a 14th reptile SSC group is
        // added above, exclude its family/genus here too (this already
        // happened once: Gekkota Lizard SG was a real group formed in 2025
        // that got missed in the initial build, found in a later review).
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
              "gekkonidae", "eublepharidae", "phyllodactylidae", "sphaerodactylidae", "diplodactylidae", "carphodactylidae", "pygopodidae",
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
          // estimatedDescribed recomputed — the prior figure (5,659) was a
          // quick subtraction done when Gekkota SG was added that didn't
          // account for other sibling groups' own estimates changing since.
          // Recomputed as the actual sum of all 12 sibling nodes' current
          // estimatedDescribed values.
          estimatedDescribed: 6_770,
          estimatedSource: "Remainder of " + REPTILE_DB + " reptile total minus the 12 SSC groups above, plus the tuatara (approx.)",
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
          // "chondrichthyes" is only used as a class label in assessed.parquet;
          // unassessed species carry "elasmobranchii"/"holocephali" instead —
          // all three are listed to match the full universe. Excludes 2
          // extinct fossil mako sharks + 1 unresolved-name placeholder found
          // in the unassessed data (see ssc-shark's filter comment).
          filter: {
            csvGroups: ["fishes"],
            classNames: ["chondrichthyes", "elasmobranchii", "holocephali"],
            excludeSpeciesNames: ["isurus desori", "oxyrhina hastalis", "carcharhinus spec"],
          },
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
    // here — TWO real, named, HABITAT-based groups are DELIBERATELY EXCLUDED
    // (found via a post-review pass that the second one, MFRLA, had gone
    // undocumented despite being the same class of blocker as the first):
    //  - Freshwater Fish Specialist Group (FFSG): own site states its remit
    //    as "all freshwater fishes (>15,000 species)".
    //  - Marine Fishes Red List Authority (MFRLA): own iucn.org page states
    //    its mission as "completing Red List assessments for all marine
    //    fishes" (>17,000 species) — meaning most of what lands in the
    //    catch-all below would, in reality, be MFRLA's remit.
    // Both are HABITAT-based scopes (marine vs. freshwater), not taxonomic
    // ones. Our data has a `systems` field ("Freshwater"/"Marine"/...) but
    // it's only populated for ASSESSED species (assessed.parquet) —
    // unassessed species (the majority of the ~33,000-row fish universe)
    // have no `systems` value at all, so a habitat-based filter can't be
    // built without either leaving most of the universe unclassified or
    // guessing from family-level heuristics (many families, e.g. Gobiidae,
    // span both marine and freshwater — too risky to encode as fact). This is
    // the same class of blocker as the 12 geographic regional Plant Red List
    // Authorities: real, named IUCN entities whose remit needs a data
    // dimension (range/habitat) this snapshot doesn't reliably have across the
    // whole species universe. Revisit if/when the pipeline gains reliable
    // habitat data for unassessed species too. The Anguillid Eel group was
    // historically a sub-page of FFSG's own site but is organizationally
    // independent (per its own materials) and cleanly family-scoped, so it's
    // included below on its own regardless of FFSG's/MFRLA's absence.
    {
      id: "ssc-fish-groups",
      name: "SSC Specialist Groups",
      filter: { csvGroups: ["fishes"] },
      children: [
        {
          id: "ssc-shark",
          name: "Shark Specialist Group",
          // "chondrichthyes" only appears as a class label in assessed.parquet;
          // unassessed species use "elasmobranchii"/"holocephali" instead — all
          // three are needed or the filter silently matches zero unassessed
          // sharks (same fix as jawless-fish/sharks-rays above).
          filter: {
            csvGroups: ["fishes"],
            classNames: ["chondrichthyes", "elasmobranchii", "holocephali"],
            // Data-quality exclusions found in the unassessed universe: two
            // extinct Oligocene/Miocene fossil mako sharks (not extant
            // species) and one unresolved-name placeholder, all of which
            // would otherwise appear in this group's species list.
            excludeSpeciesNames: ["isurus desori", "oxyrhina hastalis", "carcharhinus spec"],
          },
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
          name: "Croaker and Drum Fishes Red List Authority",
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
          // Organizationally independent since a 2015 IUCN-SSC Leaders' Meeting
          // decision, per its own materials: "all species within the family
          // Anguillidae" — a monogeneric family (genus Anguilla), all 16 extant
          // species. Its own site (a page of iucnffsg.org) was found compromised
          // with injected gambling/casino content during review, so sourceUrl
          // points to the iucn.org directory listing instead.
          estimatedDescribed: 16,
          estimatedSource: ESCHMEYER + " — Anguillidae (genus Anguilla)",
          estimatedSourceUrl: ESCHMEYER_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-anguillid-eel-specialist-group",
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
            excludeClasses: ["chondrichthyes", "elasmobranchii", "holocephali"],
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
          estimatedSource: "Fish species (assessed + unassessed, per our own data) not in any of the 9 SSC groups above (approx.; includes species that would belong to the Freshwater Fish SG or Marine Fishes RLA's much broader habitat-defined remits in reality — see exclusion note above)",
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

    // ─── SSC SPECIALIST GROUPS (invertebrates) ──────────────────────────
    // Same second lens as "ssc-groups"/"ssc-reptile-groups"/"ssc-fish-groups"
    // above, but architecturally different: invertebrates aren't one Table 1a
    // CSV group, they're 15 (8 insect groups + arachnids/molluscs/
    // crustaceans/corals/other_invertebrates/velvet_worms/horseshoe_crabs),
    // so each child's filter spans however many of those its own remit
    // touches, instead of a single shared csvGroups value.
    //
    // Of the 17 real invertebrate SSC/RLA groups, 3 are DELIBERATELY EXCLUDED
    // for the same reason as the fish pilot's Freshwater Fish SG: their own
    // remit is habitat/location-based, not taxonomic, and our data has no
    // reliable way to determine that dimension across the whole species
    // universe (no cave/subterranean field at all; the `systems` realm field
    // that exists for FISH is fish-assessment-specific and doesn't apply
    // here; even where a rough habitat proxy exists, e.g. class-level marine
    // vs. terrestrial skew, several of the relevant groups (crustaceans
    // especially — Amphipoda and Isopoda both have huge marine AND
    // freshwater/terrestrial components) are genuinely mixed at every rank
    // our data resolves, so guessing risks a highly visible, trust-breaking
    // error (a terrestrial woodlouse attributed to a "marine invertebrates"
    // group, or vice versa) — worse than not building the group at all:
    //  - Cave Invertebrate SG: own site (caveinvertebrates.org) frames its
    //    entire remit around karst/subterranean habitat, cutting across
    //    arachnids, insects, crustaceans, molluscs, myriapods, etc.
    //  - Terrestrial and Freshwater Invertebrate RLA (TIRLA): own SSC annual
    //    report confirms it's a genuine residual/coordination body ("support
    //    any invertebrate Red List assessment not currently covered by any
    //    Specialist Group") for the terrestrial+freshwater realm specifically
    //    — the SAME kind of real, named catch-all as reptiles' Snake and
    //    Lizard RLA, but split from its marine counterpart (MIRLA) by a
    //    habitat boundary we can't reliably draw.
    //  - Marine Invertebrates RLA (MIRLA): the marine-realm counterpart to
    //    TIRLA, confirmed via its own launch announcement ("all other marine
    //    invertebrates now have a home in the remit of the new Marine
    //    Invertebrate Red List Authority") — same blocker.
    // The single catch-all below is a plain "No SSC Group" remainder (mirrors
    // the fish pilot's shape), not a claim on any of these three groups'
    // behalf — it holds species that would belong to TIRLA, MIRLA, or Cave
    // Invertebrate SG in reality, alongside genuinely uncovered species.
    {
      id: "ssc-invertebrate-groups",
      name: "SSC Specialist Groups",
      filter: { csvGroups: ALL_INVERTEBRATE_GROUPS },
      children: [
        {
          id: "ssc-mollusc",
          name: "Mollusc Specialist Group",
          filter: { csvGroups: ["molluscs"] },
          // Own materials + its own SSC annual reports list cephalopod,
          // cone-snail, and abalone assessments as the group's own achievements
          // (no separate "Cephalopod RLA"/"Cone Snail RLA" exists as its own
          // directory-listed group) — the group's real remit is the entire
          // phylum Mollusca, matching our "Molluscs" Table 1a group exactly,
          // no narrowing needed.
          // estimatedDescribed corrected — the prior figure (35,195)
          // undercounted real Mollusca diversity by ~2.5x; MolluscaBase's own
          // homepage reports 145,412 accepted names, and this app's own
          // COL_2025 data for taxon_group=molluscs totals ~89,648 rows,
          // matching independent literature (~90,000 valid Recent species).
          estimatedDescribed: 89_648,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Mollusca (whole phylum, incl. cephalopods)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-mollusc-specialist-group",
        },
        {
          id: "ssc-spider-scorpion",
          name: "Spider and Scorpion Specialist Group",
          filter: { csvGroups: ["arachnids"], orderNames: ["araneae", "scorpiones"] },
          // Own site's mission language aspirationally says "protect all
          // arachnids," but every concrete target in the group's own 2021
          // annual report is exclusively about spiders or scorpions (trap-door
          // spiders, Liphistiidae, Hogna, Malawi scorpions, etc.) — no mite,
          // harvestman, Solifugae, or other minor-order activity found
          // anywhere. Encoded to the evidenced core (Araneae + Scorpiones)
          // rather than the aspirational "all Arachnida" framing, the same
          // judgment call as the reptile pilot's Boa and Python SG.
          // estimatedDescribed corrected — the prior figure (16,053)
          // undercounted real diversity by ~3.5x; World Spider Catalog
          // reports ~53,000-53,700 described spider species alone, plus
          // ~2,600-2,900 scorpions, matching this app's own COL_2025 data
          // (~54,938 Araneae + 2,955 Scorpiones).
          estimatedDescribed: 57_893,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Araneae + Scorpiones (evidenced core; own mission language claims broader \"all arachnids\" but no other order has any demonstrated group activity)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-spider-and-scorpion-specialist-group",
        },
        {
          id: "ssc-butterfly",
          name: "Butterfly and Moth Specialist Group",
          filter: {
            csvGroups: ["butterflies_and_moths"],
            families: ["papilionidae", "pieridae", "nymphalidae", "lycaenidae", "riodinidae", "hesperiidae", "hedylidae", "saturniidae"],
          },
          // RENAMED by IUCN to "Butterfly and Moth Specialist Group" (our
          // source DB still lists the legacy name), and the group's own
          // mission statement, unchanged since at least 2018, explicitly says
          // "butterflies and moths," which taken literally could mean all of
          // Lepidoptera (moths alone are ~145,000 of the ~160,000 species in
          // this CSV group). The group's DEMONSTRATED work is overwhelmingly
          // butterfly-focused (comprehensive Papilionidae/swallowtail
          // assessments, a broader butterfly Red List Index) plus one named
          // moth family as a starting point (Saturniidae, "e.g. emperor
          // moths," ~100-species target). Its 2022 SSC annual report also
          // credits it with 39 published moth assessments outside Saturniidae
          // (30 Hawaiian endemics + 9 Korean species, spanning Noctuidae,
          // Cosmopterigidae, Geometridae, and Crambidae) — real, but scattered
          // single-region collaborations, NOT a stated whole-family claim on
          // any of those 4 families (which together total ~23,000 species in
          // our data — orders of magnitude more than the ~39 actually
          // assessed). Encoded to the evidenced whole-family core —
          // Papilionoidea (6 butterfly families) + Hedylidae (a small,
          // sometimes-debated "moth-like butterfly" family never explicitly
          // confirmed OR excluded by the group) + Saturniidae — rather than
          // claiming the 4 additional families wholesale or the full,
          // functionally-uncapped "all Lepidoptera" reading of its mission
          // statement. Those ~39 already-assessed non-Saturniidae moth
          // species currently fall to the catch-all rather than here — a
          // known, small undercount, same class of judgment call as the
          // reptile pilot's Boa and Python SG.
          // estimatedDescribed corrected — the prior figure (14,269)
          // undercounted by ~1.5x against this app's own COL_2025 data for
          // the exact 8-family filter (~21,600-23,000 rows).
          estimatedDescribed: 21_631,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Papilionoidea (6 butterfly families) + Hedylidae + Saturniidae (evidenced core; group's own mission statement literally says \"butterflies and moths\" and it has published scattered assessments in 4 other moth families, but has never claimed those families wholesale — see comment)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-butterfly-and-moth-specialist-group",
        },
        {
          id: "ssc-grasshopper",
          name: "Grasshopper Specialist Group",
          filter: {
            csvGroups: ["grasshoppers_crickets_locusts", "other_insects"],
            orderNames: ["orthoptera", "phasmida", "mantodea"],
          },
          // Own iucn.org page: "Our aim is to conserve Orthopteroid insects
          // (grasshoppers, katydids, crickets, mantids, stick insects)... We
          // want to increase the number of Orthoptera, Phasmida and Mantodea
          // species on the IUCN Red List" — explicitly 3 orders, broader than
          // its name suggests (crickets/katydids are already all Orthoptera;
          // mantids/stick insects are separate orders entirely, sourced from
          // the "other_insects" CSV group rather than "grasshoppers_crickets_
          // locusts"). Locusts are explicitly just a behavioral subset of
          // Acrididae (Orthoptera), not a separate taxon needing its own rule.
          // estimatedDescribed corrected — the prior figure (11,319)
          // undercounted by ~3x; Orthoptera Species File alone lists
          // ~28,000-29,500 valid species, matching this app's own COL_2025
          // data (~28,701 Orthoptera + 3,439 Phasmida + 2,522 Mantodea).
          estimatedDescribed: 34_662,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Orthoptera + Phasmida + Mantodea",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-grasshopper-specialist-group",
        },
        {
          id: "ssc-wild-bee",
          name: "Wild Bee Specialist Group",
          filter: {
            csvGroups: ["bees_wasps_and_ants"],
            families: ["apidae", "halictidae", "megachilidae", "andrenidae", "colletidae", "melittidae", "stenotritidae"],
          },
          // RENAMED by IUCN to "Wild Bee Specialist Group" (our source DB
          // still lists the legacy name) — own materials: "In 2021, IUCN SSC
          // widened the group to include all bees... expanding the number of
          // species considered from ~290 to more than 20,000." ~290 matches
          // the old Bombus-only scope; ~20,000 matches the full bee clade
          // Anthophila (all 7 recognized families) — no single source states
          // the 7 family names literally, but the species-count jump is
          // strong confirmation. A "Bumble Bee working group" persists as a
          // named internal sub-group (genus Bombus specifically), not a
          // separate scope.
          // estimatedDescribed corrected to match the group's own "more than
          // 20,000" figure quoted directly above — the prior value (7,411)
          // directly contradicted it.
          estimatedDescribed: 20_400,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Apidae + Halictidae + Megachilidae + Andrenidae + Colletidae + Melittidae + Stenotritidae (clade Anthophila, all bees; matches the group's own \">20,000\" claim)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-wild-bee-specialist-group",
        },
        {
          id: "ssc-mayfly-stonefly-caddisfly",
          name: "Mayfly, Stonefly and Caddisfly Specialist Group",
          filter: { csvGroups: ["other_insects"], orderNames: ["ephemeroptera", "plecoptera", "trichoptera"] },
          // iucn.org: "Mayflies (Ephemeroptera), stoneflies (Plecoptera) and
          // caddisflies (Trichoptera) — EPT for short" — explicit, exactly
          // these 3 orders, no exceptions found.
          // estimatedDescribed corrected — the COL_2025-derived figure
          // (6,390) badly undercounted real diversity, especially Trichoptera
          // (~16,000 species alone per the Trichoptera World Checklist).
          estimatedDescribed: 23_000,
          estimatedSource: "Trichoptera World Checklist (~16,000) + Ephemeroptera (~3,500) + Plecoptera (~3,700) literature figures",
          estimatedSourceUrl: "https://trichopt.app.clemson.edu/welcome.php",
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-mayfly-stonefly-and-caddisfly-specialist-group",
        },
        {
          id: "ssc-dragonfly",
          name: "Dragonfly Specialist Group",
          filter: { csvGroups: ["dragonflies_and_damselflies"] },
          // Own SSC annual report: "increase the knowledge on taxonomy,
          // ecology and biogeography of all Odonata (damselflies and
          // dragonflies)" — the entire order, both suborders (Anisoptera +
          // Zygoptera), which is exactly this whole Table 1a CSV group (no
          // other order appears in our "dragonflies_and_damselflies" data).
          estimatedDescribed: 6_353,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Odonata (whole CSV group)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: "https://worlddragonfly.org/",
        },
        {
          id: "ssc-ant",
          name: "Ant Specialist Group",
          filter: { csvGroups: ["bees_wasps_and_ants"], families: ["formicidae"] },
          // Own iucn.org page: "assess and monitor the conservation status of
          // ant species around the world" — family Formicidae in full, no
          // narrower carve-out found (a monotypic mapping — ants ARE
          // Formicidae — so there's no competing claim to check against).
          // estimatedDescribed corrected — the COL_2025-derived figure
          // (5,976) undercounted real global ant diversity by ~2.7x.
          estimatedDescribed: 16_308,
          estimatedSource: "AntWiki — total valid extant ant species",
          estimatedSourceUrl: "https://www.antwiki.org/wiki/Category:Extant_species",
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-ant-specialist-group",
        },
        {
          id: "ssc-freshwater-crustacean",
          name: "Freshwater Crustacean Specialist Group",
          filter: {
            csvGroups: ["crustaceans"],
            families: [
              "astacidae", "cambaridae", "parastacidae", "aeglidae",
              "potamidae", "potamonautidae", "gecarcinucidae", "pseudothelphusidae", "trichodactylidae",
              "atyidae", "gecarcinidae",
              // 4 small, unambiguously freshwater-only Caridea families (per
              // De Grave et al. 2015, "Dead Shrimp Blues," PLOS ONE — the
              // same global freshwater-shrimp assessment cited below) —
              // distinct from the deliberately-excluded, mixed-marine
              // Palaemonidae.
              "desmocarididae", "euryrhynchidae", "typhlocarididae", "xiphocarididae",
            ],
            // Palaemonidae is a mixed marine/freshwater family, so it isn't
            // in the `families` list above — but its freshwater members
            // (dominated by Macrobrachium, river prawns) are named
            // individually via extraSpeciesNames instead, using this
            // dataset's own `systems` field to identify them precisely: of
            // 301 assessed Palaemonidae species, 300 are tagged purely
            // "Freshwater" (1 "Freshwater;Marine") — the same near-total
            // freshwater purity as the already-included Atyidae (442/445
            // "Freshwater") — so this is a real, data-backed inclusion, not
            // a guess. `systems` is only populated for assessed species, so
            // this can't extend to the unassessed Palaemonidae universe; any
            // unassessed Palaemonidae species still falls to the catch-all.
            extraSpeciesNames: [
              "arachnochium kulsiense", "arachnochium mirabile", "calathaemon holthuisi", "coutierella tonkinensis", "creaseria morleyi",
              "cryphiops brasiliensis", "cryphiops caementarius", "cryphiops luscus", "cryphiops perspicax", "cryphiops sbordonii", "cryphiops villalobosi",
              "exopalaemon annandalei", "exopalaemon mani", "exopalaemon modestus", "exopalaemon xinjiangensis",
              "leptocarpus fluminicola", "leptocarpus kempi", "leptocarpus potamiscus",
              "leptopalaemon gagadjui", "leptopalaemon gibbosus", "leptopalaemon glabrus", "leptopalaemon gudjangah", "leptopalaemon magelensis",
              "macrobrachium acanthochirus", "macrobrachium acanthurus", "macrobrachium acherontium", "macrobrachium aemulum", "macrobrachium agwi",
              "macrobrachium ahkowi", "macrobrachium altifrons", "macrobrachium amazonicum", "macrobrachium americanum", "macrobrachium amplimanus",
              "macrobrachium andamanicum", "macrobrachium aracamuni", "macrobrachium asperulum", "macrobrachium assamense", "macrobrachium atabapense",
              "macrobrachium auratum", "macrobrachium australe", "macrobrachium australiense", "macrobrachium banjarae", "macrobrachium bariense",
              "macrobrachium birmanicum", "macrobrachium bombayense", "macrobrachium borellii", "macrobrachium brasiliense", "macrobrachium brevicarpum",
              "macrobrachium bullatum", "macrobrachium cacharense", "macrobrachium caledonicum", "macrobrachium callirrhoe", "macrobrachium canarae",
              "macrobrachium carcinus", "macrobrachium catonium", "macrobrachium cavernicola", "macrobrachium chevalieri", "macrobrachium clymene",
              "macrobrachium cocoense", "macrobrachium cortezi", "macrobrachium cosolapaense", "macrobrachium cowlesi", "macrobrachium crebrum",
              "macrobrachium crenulatum", "macrobrachium dalatense", "macrobrachium dayanum", "macrobrachium denticulatum", "macrobrachium depressimanum",
              "macrobrachium dienbienphuense", "macrobrachium dierythrum", "macrobrachium digitus", "macrobrachium digueti", "macrobrachium dolatum",
              "macrobrachium dolichodactylus", "macrobrachium duri", "macrobrachium dux", "macrobrachium edentatum", "macrobrachium elatum",
              "macrobrachium elegantum", "macrobrachium empulipke", "macrobrachium equidens", "macrobrachium esculentum", "macrobrachium faustinum",
              "macrobrachium felicinum", "macrobrachium ferreirai", "macrobrachium feunteuni", "macrobrachium foai", "macrobrachium forcipatum",
              "macrobrachium formosense", "macrobrachium fukienense", "macrobrachium gallus", "macrobrachium gangeticum", "macrobrachium glabrum",
              "macrobrachium gracilirostre", "macrobrachium grandimanus", "macrobrachium gua", "macrobrachium guangxiense", "macrobrachium gurudeve",
              "macrobrachium hainanense", "macrobrachium hancocki", "macrobrachium handschini", "macrobrachium hendersodayanum", "macrobrachium hendersoni",
              "macrobrachium heterochirus", "macrobrachium heterorhynchos", "macrobrachium hildebrandti", "macrobrachium hirsutimanus", "macrobrachium hirtimanus",
              "macrobrachium hobbsi", "macrobrachium horstii", "macrobrachium hungi", "macrobrachium idae", "macrobrachium idella",
              "macrobrachium iheringi", "macrobrachium inca", "macrobrachium indicum", "macrobrachium inflatum", "macrobrachium inpa",
              "macrobrachium insulare", "macrobrachium jacatepecense", "macrobrachium jacobsoni", "macrobrachium japonicum", "macrobrachium jaroense",
              "macrobrachium jayasreei", "macrobrachium jelskii", "macrobrachium jiangxiense", "macrobrachium johnsoni", "macrobrachium joppae",
              "macrobrachium kelianense", "macrobrachium kempi", "macrobrachium kistnense", "macrobrachium koombooloomba", "macrobrachium kulkarnii",
              "macrobrachium kunjuramani", "macrobrachium lamarrei", "macrobrachium lanatum", "macrobrachium lanceifrons", "macrobrachium lanchesteri",
              "macrobrachium lar", "macrobrachium latidactylus", "macrobrachium latimanus", "macrobrachium lepidactyloides", "macrobrachium lepidactylus",
              "macrobrachium leptodactylus", "macrobrachium leucodactylus", "macrobrachium lingyunense", "macrobrachium lopopodus", "macrobrachium lorentzi",
              "macrobrachium lucifugum", "macrobrachium lujae", "macrobrachium macrobrachion", "macrobrachium maculatum", "macrobrachium madhusoodani",
              "macrobrachium malayanum", "macrobrachium malcolmsonii", "macrobrachium mammillodactylus", "macrobrachium manipurense", "macrobrachium manningi",
              "macrobrachium mazatecum", "macrobrachium meridionale", "macrobrachium michoacanus", "macrobrachium microps", "macrobrachium mieni",
              "macrobrachium minutum", "macrobrachium miyakoense", "macrobrachium moorei", "macrobrachium naso", "macrobrachium nattereri",
              "macrobrachium natulorum", "macrobrachium neglectum", "macrobrachium nepalense", "macrobrachium niloticum", "macrobrachium niphanae",
              "macrobrachium nipponense", "macrobrachium nobilii", "macrobrachium novaehollandiae", "macrobrachium oaxacae", "macrobrachium occidentale",
              "macrobrachium oenone", "macrobrachium ohione", "macrobrachium olfersii", "macrobrachium oxyphilus", "macrobrachium panamense",
              "macrobrachium patheinense", "macrobrachium patsa", "macrobrachium pectinatum", "macrobrachium peguense", "macrobrachium pentazona",
              "macrobrachium petersii", "macrobrachium petiti", "macrobrachium pilimanus", "macrobrachium pilosum", "macrobrachium placidulum",
              "macrobrachium placidum", "macrobrachium platycheles", "macrobrachium platyrostris", "macrobrachium poeti", "macrobrachium potiuna",
              "macrobrachium prabhakarani", "macrobrachium praecox", "macrobrachium pumilum", "macrobrachium purpureamanus", "macrobrachium quelchi",
              "macrobrachium raridens", "macrobrachium rathbunae", "macrobrachium reyesi", "macrobrachium rhodochir", "macrobrachium rodriguezi",
              "macrobrachium rogersi", "macrobrachium rosenbergii", "macrobrachium rostratum", "macrobrachium rude", "macrobrachium sabanus",
              "macrobrachium saigonense", "macrobrachium sankollii", "macrobrachium santanderensis", "macrobrachium sbordonii", "macrobrachium scabriculum",
              "macrobrachium scorteccii", "macrobrachium shaoi", "macrobrachium shokitai", "macrobrachium sintangense", "macrobrachium sirindhorn",
              "macrobrachium siwalikense", "macrobrachium sollaudii", "macrobrachium spinipes", "macrobrachium spinosum", "macrobrachium srilankense",
              "macrobrachium striatum", "macrobrachium sulcatus", "macrobrachium sulcicarpale", "macrobrachium sundaicum", "macrobrachium suongae",
              "macrobrachium superbum", "macrobrachium surinamicum", "macrobrachium tenellum", "macrobrachium tenuirostrum", "macrobrachium thai",
              "macrobrachium therezieni", "macrobrachium thuylami", "macrobrachium thysi", "macrobrachium tiwarii", "macrobrachium tolmerum",
              "macrobrachium totonacum", "macrobrachium transandicum", "macrobrachium tratense", "macrobrachium trichodactylum", "macrobrachium tuxtlaense",
              "macrobrachium unikarnatakae", "macrobrachium urayang", "macrobrachium veliense", "macrobrachium venustum", "macrobrachium vicconi",
              "macrobrachium vietnamiense", "macrobrachium villalobosi", "macrobrachium villosimanus", "macrobrachium vollenhoveni", "macrobrachium walvanense",
              "macrobrachium wannanense", "macrobrachium weberi", "macrobrachium yui", "macrobrachium zariquieyi",
              "neopalaemon nahuatlus",
              "palaemon antennarius", "palaemon capensis", "palaemon minos",
              "palaemonetes antrorum", "palaemonetes argentinus", "palaemonetes australis", "palaemonetes carteri", "palaemonetes cummingi",
              "palaemonetes hobbsi", "palaemonetes ivonicus", "palaemonetes kadiakensis", "palaemonetes lindsayi", "palaemonetes mercedae",
              "palaemonetes mesogenitor", "palaemonetes mesopotamicus", "palaemonetes mexicanus", "palaemonetes paludosus", "palaemonetes sinensis",
              "palaemonetes suttkusi", "palaemonetes texanus", "palaemonetes turcorum",
              "pseudopalaemon amazonensis", "pseudopalaemon bouvieri", "pseudopalaemon chryseus", "pseudopalaemon funchiae", "pseudopalaemon gouldingi",
              "pseudopalaemon iquitoensis", "pseudopalaemon nigramnis",
              "tenuipedium palaemonoides",
              "troglindicus phreaticus",
              "troglocubanus calcis", "troglocubanus eigenmanni", "troglocubanus gibarensis", "troglocubanus inermis", "troglocubanus jamaicensis",
              "troglomexicanus huastecae", "troglomexicanus perezfarfanteae", "troglomexicanus tamaulipasensis",
            ],
          },
          // Own 2024-2025 SSC annual report: "the long-term conservation of
          // freshwater decapods – freshwater crabs, crayfish, freshwater
          // shrimps and aeglids – worldwide" — narrower than its name
          // suggests (order Decapoda specifically, not all Crustacea; no
          // amphipods/isopods/copepods/etc.). Crayfish: Astacidae + Cambaridae
          // + Parastacidae. Aeglids: Aeglidae (explicitly named). Freshwater
          // crabs: the 5 standard freshwater-crab families (Potamidae,
          // Potamonautidae, Gecarcinucidae, Pseudothelphusidae,
          // Trichodactylidae — the report names specific genera within these
          // but not the family names literally). A post-review pass checked
          // whether "Deckeniidae" (a freshwater-crab family whose own
          // rediscovery, Afrithelphusa leonensis, is featured in the group's
          // 2024-2025 report) was missing — it isn't: our data doesn't use
          // the "Deckeniidae" label at all, and files every one of those
          // genera (Afrithelphusa, Deckenia, Hydrothelphusa, Malagasya,
          // Platythelphusa) under "Potamonautidae" instead, which is already
          // included above — confirmed by direct query, no gap. Land crabs
          // are also explicitly in scope (target: "25 species of land
          // crabs") — Gecarcinidae. Freshwater shrimp (Atyidae —
          // near-exclusively freshwater) included; Palaemonidae as a WHOLE
          // FAMILY is still not in the `families` list (it also contains
          // marine genera the group's own report confirms are out of scope —
          // a "Marine Crustacean Specialist Group" is described as still
          // being formed). Earlier drafts left the family's freshwater
          // members (dominated by Macrobrachium, per the group's own
          // materials and De Grave et al. 2015, "Dead Shrimp Blues," PLOS
          // ONE) to the catch-all, reasoning there was no practical way to
          // split one family without an ~344-genus rewrite. That was wrong —
          // this dataset's own `systems` field lets the freshwater members
          // be identified directly and named individually via
          // extraSpeciesNames instead (see below), the same OR escape hatch
          // already used for Antelope SG's out-of-family exceptions.
          estimatedDescribed: 2_965,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — 3 crayfish families + Aeglidae + 5 freshwater-crab families + Atyidae + Gecarcinidae (land crabs) + 4 small freshwater-shrimp families + 300 freshwater-tagged Palaemonidae species",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-freshwater-crustacean-specialist-group",
        },
        {
          id: "ssc-hoverfly",
          name: "Hoverfly Specialist Group",
          filter: { csvGroups: ["flies_and_mosquitoes"], families: ["syrphidae"] },
          // LOWER CONFIDENCE, flagged rather than guessed: the group's own
          // current official mission statement (identical wording on both its
          // iucn.org page and its 2024-2025 SSC annual report) explicitly
          // scopes itself to "European hoverflies," not the whole global
          // family — a real, geography-based narrowing our data model can't
          // encode (no per-species range field reliable enough to draw a
          // continent boundary, same class of blocker as the regional Plant
          // Red List Authorities). Since no other group claims non-European
          // Syrphidae, the whole family is kept here as the best available
          // proxy rather than moved to the catch-all, but this is a
          // real overclaim relative to the group's own current stated remit
          // (whole-family ~6,535 species vs. a European-only true scope of
          // 892, per the group's own 2022 European Red List of Hoverflies) —
          // revisit if per-species range data ever becomes reliable enough to
          // narrow this correctly. estimatedDescribed corrected — the prior
          // figure (2,330) undercounted real global Syrphidae by ~2.8x.
          estimatedDescribed: 6_535,
          estimatedSource: "Syrphidae World Checklist — whole family (group's own current mission is explicitly \"European hoverflies\" only, ~892 species — see comment)",
          estimatedSourceUrl: "https://www.syrphidae.com/checklist.php",
          sourceUrl: "https://iucn-hsg.pmf.uns.ac.rs/",
        },
        {
          id: "ssc-coral",
          name: "Coral Specialist Group",
          filter: { csvGroups: ["corals"], orderNames: ["scleractinia"] },
          // Own site (iucncoralsg.org): "maintains and refines the IUCN Red
          // List of Threatened Species for reef-building corals" — narrower
          // than our "Corals & Cnidarians" Table 1a group, which spans all of
          // class Anthozoa (soft corals, sea anemones, black corals, sea
          // pens, zoanthids, etc., none of which "reef-building" naturally
          // includes). Mapped to order Scleractinia (stony/hard corals) —
          // the standard technical term for "reef-building corals." No
          // source confirms or denies broader Anthozoa inclusion, so the
          // rest is left to the catch-all rather than guessed either way.
          estimatedDescribed: 1_841,
          estimatedSource: IUCN_SOURCE + " (WoRMS 2025) — Scleractinia (reef-building corals; narrower than all of Anthozoa)",
          estimatedSourceUrl: "https://www.marinespecies.org",
          sourceUrl: "https://iucncoralsg.org/",
        },
        {
          id: "ssc-firefly",
          name: "Firefly Specialist Group",
          filter: { csvGroups: ["beetles"], families: ["lampyridae"] },
          // Own site (fireflyersinternational.net/iucn): "Fireflies
          // (Coleoptera: Lampyridae)" — the whole family, no narrower
          // carve-out found.
          estimatedDescribed: 2_400,
          estimatedSource: "Wikipedia (Lampyridae) — \"more than 2,400 described species\"; previous estimate of 538 was a stale undercount",
          estimatedSourceUrl: "https://en.wikipedia.org/wiki/Firefly",
          sourceUrl: "https://fireflyersinternational.net/iucn",
        },
        {
          id: "ssc-dung-beetle",
          name: "Dung Beetle Specialist Group",
          filter: {
            csvGroups: ["beetles"],
            // families/genera AND together in this filter engine, so the
            // whole-family Geotrupidae portion is expressed as its own
            // (complete) genus list here rather than via `families`, folded
            // into one array alongside the Scarabaeinae genus list below —
            // same workaround used elsewhere (e.g. Seagrass SG).
            genera: [
              // Geotrupidae (whole family, all 64 genera present in our data).
              "allotrypes", "anoplotrupes", "athyreus", "australobolbus", "blackbolbus", "blackburnium",
              "bolbaffer", "bolbaffroides", "bolbapium", "bolbelasmus", "bolbobaineus", "bolbocerastes",
              "bolboceratex", "bolbocerodema", "bolboceroides", "bolbocerosoma", "bolbochromus", "bolbogonium",
              "bolbohamatum", "bolboleaus", "bolborhachium", "bolborhinum", "bolborhombus", "bolbotrypes",
              "bradycinetulus", "ceratophyus", "ceratotrupes", "chelotrupes", "cnemotrupes", "elephastomus",
              "enoplotrupes", "eubolbitus", "eucanthus", "frickius", "geohowdenius", "geotrupes",
              "gilletinus", "halffterius", "haplogeotrupes", "jekelius", "lethrus", "megatrupes",
              "meridiobolbus", "mimobolbus", "mycotrupes", "namibiobolbus", "namibiotrupes", "neoathyreus",
              "odonteus", "odontotrypes", "onthotrupes", "peltotrupes", "pereirabolbus", "phelotrupes",
              "prototrupes", "pseudoathyreus", "sericotrupes", "stenaspidius", "taurocerastes", "thorectes",
              "trypocopris", "typhaeus", "zefevazia", "zuninoeus",
              // Subfamily Scarabaeinae within Scarabaeidae ("true dung
              // beetles" — 199 genera, cross-referenced against Catalogue of
              // Life's Scarabaeinae subtree against every genus actually
              // present in our data; genera left unresolved by that
              // cross-reference are excluded, not guessed).
              "afrodrepanus", "agamopus", "aliuscanthoniola", "allogymnopleurus", "amietina", "amphistomus",
              "anisocanthon", "anomiopsoides", "anomiopus", "anonychonitis", "aphengium", "aphengoecus",
              "apotolamprus", "aptenocanthon", "aptychonitis", "ateuchetus", "ateuchus", "attavicinus",
              "aulacopris", "ausmontins", "bdelyropsis", "bdelyrus", "besourenga", "bohepilissus",
              "bolbites", "boletoscapter", "boreocanthon", "bradypodidium", "bubas", "byrrhidium",
              "caccobiomorphus", "caccobius", "cambefortius", "canthidium", "canthochilum", "canthodimorpha",
              "canthon", "canthonella", "canthonidia", "catharsius", "cephalodesmius", "chalcocopris",
              "chalconotus", "cheironitis", "circellium", "cleptocaccobius", "clypeodrepanus", "copris",
              "coproecus", "coprophanaeus", "coptodactyla", "coptorhina", "cryptocanthon", "cyptochirus",
              "delopleurus", "deltochilum", "deltorhinum", "deltorrhinum", "demarziella", "dendropaemon",
              "diabroctis", "diastellopalpus", "dichotomius", "dicranocara", "digitonthophagus", "diorygopyx",
              "drepanocerus", "drepanoplatynus", "drogo", "dwesasilvasedis", "endroedyolus", "eodrepanus",
              "epilissus", "epirinus", "escarabaeus", "eucranium", "eudinopus", "euoniticellus",
              "euonthophagus", "eurysternus", "eutrichillum", "feeridium", "frankenbergerius", "garreta",
              "genieridium", "gilletellus", "glyphoderus", "gromphas", "gymnopleurus", "gyronotus",
              "hammondantus", "hamonthophagus", "hansreia", "haroldius", "helictopleurus", "heliocopris",
              "heteroclitopus", "heteronitis", "holocephalus", "homocopris", "hyalonthophagus", "isocopris",
              "ixodina", "kheper", "kolbeellus", "kurtops", "latodrepanus", "lepanus",
              "liatongus", "litocopris", "macroderes", "malagoniella", "martinezidium", "matthewsius",
              "megalonitis", "megatharsis", "megathopa", "megathoposoma", "melanocanthon", "mentophilus",
              "metacatharsius", "microcopris", "milichus", "mimonthophagus", "mnematidium", "mnematium",
              "monoplistes", "namakwanus", "namaphilus", "nanos", "nebulasilvius", "neonitis",
              "odontoloma", "oniticellus", "onitis", "onoreidium", "ontherus", "onthophagus",
              "onychothecus", "oruscatus", "outenikwanus", "oxysternon", "pachylomera", "pachysoma",
              "panelus", "paracanthon", "paragymnopleurus", "paraixodina", "paraphytus", "parascatonomus",
              "parateuchus", "parvuhowdenius", "peckolus", "pedaria", "pedaridium", "phalops",
              "phanaeus", "platyonitis", "proagoderus", "pseudocanthon", "pseudochironitis", "pseudopedaria",
              "pseudosaproecius", "pycnopanelus", "saphobius", "sarophorus", "sauvagesinella", "scarabaeolus",
              "scarabaeus", "scatimus", "scatonomus", "sceliages", "scybalocanthon", "scybalophagus",
              "silvaphilus", "sinapisoma", "sisyphus", "stiptopodius", "sulcophanaeus", "sylvicanthon",
              "synapsis", "temnoplectron", "tesserodon", "tesserodoniella", "thyregis", "tiaronthophagus",
              "tibiodrepanus", "tiniocellus", "tomogonus", "tragiscus", "trichillidium", "trichillum",
              "trichonthophagus", "tropidonitis", "upsa", "uroxys", "versicorpus", "xinidium", "zonocopris",
            ],
          },
          // Own co-chairs' founding announcement (Oryx 57(2), 2023): "dung
          // beetles (families Geotrupidae and Scarabaeidae)... over 6,000
          // described species." Previously encoded to Geotrupidae only,
          // deliberately excluding Scarabaeidae for lack of subfamily-level
          // data to isolate Scarabaeinae ("true dung beetles," ~5-6k species)
          // from the >30,000-species family. Fixed by cross-referencing every
          // Scarabaeidae genus actually present in our data (1,273 of them)
          // against Catalogue of Life's Scarabaeinae subtree — 199 confirmed
          // Scarabaeinae genera, 1,074 confirmed as other subfamilies
          // (Aphodiinae, Cetoniinae, Dynastinae, Melolonthinae, Rutelinae,
          // etc.), 0 left to guesswork. NOTE: estimatedDescribed reflects the
          // group's own real-world described-species claim (>6,000), not the
          // count of rows the genus filter happens to match in our own
          // dataset (2,605) — our data's described-species coverage for
          // Scarabaeinae is real but incomplete relative to true global
          // diversity (Wikipedia: "The Scarabaeinae alone comprises more
          // than 5,000 species").
          estimatedDescribed: 6_000,
          estimatedSource: "Own co-chairs' founding announcement (Oryx 57(2), 2023) — \"over 6,000 described species\" across Geotrupidae + Scarabaeinae",
          estimatedSourceUrl: "https://doi.org/10.1017/S0030605323000032",
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-dung-beetle-specialist-group",
        },
        {
          id: "ssc-sea-cucumber",
          name: "Sea Cucumber Specialist Group",
          filter: { csvGroups: ["other_invertebrates"], classNames: ["holothuroidea"] },
          // Real, active IUCN SSC group missed in the initial pass — clean
          // whole-class mapping, same pattern as Mollusc SG. Class
          // Holothuroidea (sea cucumbers) within the "other_invertebrates"
          // Table 1a CSV group.
          estimatedDescribed: 990,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Holothuroidea",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-sea-cucumber-specialist-group",
        },
        {
          id: "ssc-horseshoe-crab",
          name: "Horseshoe Crab Specialist Group",
          filter: { csvGroups: ["horseshoe_crabs"] },
          // Own iucn.org page names all 4 living species by name (Limulus
          // polyphemus, Tachypleus tridentatus, T. gigas, Carcinoscorpius
          // rotundicauda) — exactly this whole, already-dedicated Table 1a
          // CSV group (horseshoe crabs are chelicerates, not true
          // crustaceans, despite the common name — already modeled
          // separately in this tree).
          estimatedDescribed: 4,
          estimatedSource: IUCN_SOURCE + " — all 4 living horseshoe crab species (whole CSV group)",
          estimatedSourceUrl: IUCN_SOURCE_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-horseshoe-crab-specialist-group",
        },
        {
          id: "ssc-earthworm",
          name: "Earthworm Specialist Group",
          filter: { csvGroups: ["other_invertebrates"], orderNames: ["crassiclitellata", "moniligastrida"] },
          // Found missing entirely in a post-review pass — a real group
          // (thin iucn.org page, no formal scope statement, but its name
          // unambiguously maps to the 2 orders taxonomically recognized as
          // "true earthworms" within class Clitellata) — Crassiclitellata
          // (the main earthworm order) + Moniligastrida (Asian earthworms).
          // Explicitly excludes every other Clitellata order present in our
          // data: leeches (Arhynchobdellida, Rhynchobdellida,
          // Acanthobdellida, Branchiobdellida) and aquatic
          // oligochaetes/potworms (Tubificida, Lumbriculida, Enchytraeida,
          // Haplotaxida, etc.) are not earthworms.
          estimatedDescribed: 935,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Crassiclitellata + Moniligastrida",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-earthworm-specialist-group",
        },
        {
          id: "ssc-sponge",
          name: "Sponge Specialist Group",
          filter: { csvGroups: ["other_invertebrates"], classNames: ["demospongiae", "hexactinellida", "calcarea"] },
          // Found missing entirely in a post-review pass — a real group
          // (2021-2025 term page, live at a "-2021-2025" URL slug the
          // dashboard's original directory-listing guess missed): mission is
          // "protect sponge biodiversity... worldwide," no narrower
          // taxonomic limitation stated. Maps to whole phylum Porifera via
          // its 3 classes present in our data (a 4th recognized class,
          // Homoscleromorpha, doesn't appear as a distinct label here — its
          // species are filed under Demospongiae, the older classification
          // still used by this dataset).
          estimatedDescribed: 3_567,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Demospongiae + Hexactinellida + Calcarea (whole phylum Porifera, per our data's class labels)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-sponge-specialist-group-2021-2025",
        },
        // Catch-all: a plain "No SSC Group" remainder (NOT a claim on behalf
        // of Cave Invertebrate SG, Terrestrial and Freshwater Invertebrate
        // RLA, or Marine Invertebrates RLA — see the exclusion note above).
        // Omits csvGroups claimed in full by a named group above (molluscs,
        // horseshoe_crabs, dragonflies_and_damselflies, and
        // grasshoppers_crickets_locusts — the last is 100% order Orthoptera,
        // all of which Grasshopper SG already claims) rather than listing
        // redundant excludes for them. Kept in sync manually — if another
        // invertebrate SSC group is added above, exclude its family/order/
        // class here too (or omit its csvGroup entirely if fully claimed).
        {
          id: "ssc-other-invertebrates",
          name: "No SSC Group",
          filter: {
            csvGroups: [
              "beetles", "butterflies_and_moths", "flies_and_mosquitoes", "bees_wasps_and_ants", "true_bugs", "other_insects",
              "arachnids", "crustaceans", "corals", "other_invertebrates", "velvet_worms",
            ],
            excludeFamilies: [
              "geotrupidae", "lampyridae",
              "papilionidae", "pieridae", "nymphalidae", "lycaenidae", "riodinidae", "hesperiidae", "hedylidae", "saturniidae",
              "syrphidae",
              "formicidae", "apidae", "halictidae", "megachilidae", "andrenidae", "colletidae", "melittidae", "stenotritidae",
              "astacidae", "cambaridae", "parastacidae", "aeglidae",
              "potamidae", "potamonautidae", "gecarcinucidae", "pseudothelphusidae", "trichodactylidae",
              "atyidae", "gecarcinidae",
              "desmocarididae", "euryrhynchidae", "typhlocarididae", "xiphocarididae",
            ],
            excludeOrders: ["araneae", "scorpiones", "phasmida", "mantodea", "ephemeroptera", "plecoptera", "trichoptera", "scleractinia", "crassiclitellata", "moniligastrida"],
            excludeClasses: ["holothuroidea", "demospongiae", "hexactinellida", "calcarea"],
            // Subfamily Scarabaeinae within Scarabaeidae — claimed by Dung
            // Beetle SG above (see its filter's comment); the rest of
            // Scarabaeidae (chafers, rhinoceros beetles, flower beetles,
            // etc.) still correctly falls through to this catch-all.
            excludeGenera: [
              "afrodrepanus", "agamopus", "aliuscanthoniola", "allogymnopleurus", "amietina", "amphistomus",
              "anisocanthon", "anomiopsoides", "anomiopus", "anonychonitis", "aphengium", "aphengoecus",
              "apotolamprus", "aptenocanthon", "aptychonitis", "ateuchetus", "ateuchus", "attavicinus",
              "aulacopris", "ausmontins", "bdelyropsis", "bdelyrus", "besourenga", "bohepilissus",
              "bolbites", "boletoscapter", "boreocanthon", "bradypodidium", "bubas", "byrrhidium",
              "caccobiomorphus", "caccobius", "cambefortius", "canthidium", "canthochilum", "canthodimorpha",
              "canthon", "canthonella", "canthonidia", "catharsius", "cephalodesmius", "chalcocopris",
              "chalconotus", "cheironitis", "circellium", "cleptocaccobius", "clypeodrepanus", "copris",
              "coproecus", "coprophanaeus", "coptodactyla", "coptorhina", "cryptocanthon", "cyptochirus",
              "delopleurus", "deltochilum", "deltorhinum", "deltorrhinum", "demarziella", "dendropaemon",
              "diabroctis", "diastellopalpus", "dichotomius", "dicranocara", "digitonthophagus", "diorygopyx",
              "drepanocerus", "drepanoplatynus", "drogo", "dwesasilvasedis", "endroedyolus", "eodrepanus",
              "epilissus", "epirinus", "escarabaeus", "eucranium", "eudinopus", "euoniticellus",
              "euonthophagus", "eurysternus", "eutrichillum", "feeridium", "frankenbergerius", "garreta",
              "genieridium", "gilletellus", "glyphoderus", "gromphas", "gymnopleurus", "gyronotus",
              "hammondantus", "hamonthophagus", "hansreia", "haroldius", "helictopleurus", "heliocopris",
              "heteroclitopus", "heteronitis", "holocephalus", "homocopris", "hyalonthophagus", "isocopris",
              "ixodina", "kheper", "kolbeellus", "kurtops", "latodrepanus", "lepanus",
              "liatongus", "litocopris", "macroderes", "malagoniella", "martinezidium", "matthewsius",
              "megalonitis", "megatharsis", "megathopa", "megathoposoma", "melanocanthon", "mentophilus",
              "metacatharsius", "microcopris", "milichus", "mimonthophagus", "mnematidium", "mnematium",
              "monoplistes", "namakwanus", "namaphilus", "nanos", "nebulasilvius", "neonitis",
              "odontoloma", "oniticellus", "onitis", "onoreidium", "ontherus", "onthophagus",
              "onychothecus", "oruscatus", "outenikwanus", "oxysternon", "pachylomera", "pachysoma",
              "panelus", "paracanthon", "paragymnopleurus", "paraixodina", "paraphytus", "parascatonomus",
              "parateuchus", "parvuhowdenius", "peckolus", "pedaria", "pedaridium", "phalops",
              "phanaeus", "platyonitis", "proagoderus", "pseudocanthon", "pseudochironitis", "pseudopedaria",
              "pseudosaproecius", "pycnopanelus", "saphobius", "sarophorus", "sauvagesinella", "scarabaeolus",
              "scarabaeus", "scatimus", "scatonomus", "sceliages", "scybalocanthon", "scybalophagus",
              "silvaphilus", "sinapisoma", "sisyphus", "stiptopodius", "sulcophanaeus", "sylvicanthon",
              "synapsis", "temnoplectron", "tesserodon", "tesserodoniella", "thyregis", "tiaronthophagus",
              "tibiodrepanus", "tiniocellus", "tomogonus", "tragiscus", "trichillidium", "trichillum",
              "trichonthophagus", "tropidonitis", "upsa", "uroxys", "versicorpus", "xinidium", "zonocopris",
            ],
            // The freshwater-tagged Palaemonidae species claimed by
            // Freshwater Crustacean SG above via extraSpeciesNames (same
            // list) — excluded here so they aren't double-counted.
            excludeSpeciesNames: [
              "arachnochium kulsiense", "arachnochium mirabile", "calathaemon holthuisi", "coutierella tonkinensis", "creaseria morleyi",
              "cryphiops brasiliensis", "cryphiops caementarius", "cryphiops luscus", "cryphiops perspicax", "cryphiops sbordonii", "cryphiops villalobosi",
              "exopalaemon annandalei", "exopalaemon mani", "exopalaemon modestus", "exopalaemon xinjiangensis",
              "leptocarpus fluminicola", "leptocarpus kempi", "leptocarpus potamiscus",
              "leptopalaemon gagadjui", "leptopalaemon gibbosus", "leptopalaemon glabrus", "leptopalaemon gudjangah", "leptopalaemon magelensis",
              "macrobrachium acanthochirus", "macrobrachium acanthurus", "macrobrachium acherontium", "macrobrachium aemulum", "macrobrachium agwi",
              "macrobrachium ahkowi", "macrobrachium altifrons", "macrobrachium amazonicum", "macrobrachium americanum", "macrobrachium amplimanus",
              "macrobrachium andamanicum", "macrobrachium aracamuni", "macrobrachium asperulum", "macrobrachium assamense", "macrobrachium atabapense",
              "macrobrachium auratum", "macrobrachium australe", "macrobrachium australiense", "macrobrachium banjarae", "macrobrachium bariense",
              "macrobrachium birmanicum", "macrobrachium bombayense", "macrobrachium borellii", "macrobrachium brasiliense", "macrobrachium brevicarpum",
              "macrobrachium bullatum", "macrobrachium cacharense", "macrobrachium caledonicum", "macrobrachium callirrhoe", "macrobrachium canarae",
              "macrobrachium carcinus", "macrobrachium catonium", "macrobrachium cavernicola", "macrobrachium chevalieri", "macrobrachium clymene",
              "macrobrachium cocoense", "macrobrachium cortezi", "macrobrachium cosolapaense", "macrobrachium cowlesi", "macrobrachium crebrum",
              "macrobrachium crenulatum", "macrobrachium dalatense", "macrobrachium dayanum", "macrobrachium denticulatum", "macrobrachium depressimanum",
              "macrobrachium dienbienphuense", "macrobrachium dierythrum", "macrobrachium digitus", "macrobrachium digueti", "macrobrachium dolatum",
              "macrobrachium dolichodactylus", "macrobrachium duri", "macrobrachium dux", "macrobrachium edentatum", "macrobrachium elatum",
              "macrobrachium elegantum", "macrobrachium empulipke", "macrobrachium equidens", "macrobrachium esculentum", "macrobrachium faustinum",
              "macrobrachium felicinum", "macrobrachium ferreirai", "macrobrachium feunteuni", "macrobrachium foai", "macrobrachium forcipatum",
              "macrobrachium formosense", "macrobrachium fukienense", "macrobrachium gallus", "macrobrachium gangeticum", "macrobrachium glabrum",
              "macrobrachium gracilirostre", "macrobrachium grandimanus", "macrobrachium gua", "macrobrachium guangxiense", "macrobrachium gurudeve",
              "macrobrachium hainanense", "macrobrachium hancocki", "macrobrachium handschini", "macrobrachium hendersodayanum", "macrobrachium hendersoni",
              "macrobrachium heterochirus", "macrobrachium heterorhynchos", "macrobrachium hildebrandti", "macrobrachium hirsutimanus", "macrobrachium hirtimanus",
              "macrobrachium hobbsi", "macrobrachium horstii", "macrobrachium hungi", "macrobrachium idae", "macrobrachium idella",
              "macrobrachium iheringi", "macrobrachium inca", "macrobrachium indicum", "macrobrachium inflatum", "macrobrachium inpa",
              "macrobrachium insulare", "macrobrachium jacatepecense", "macrobrachium jacobsoni", "macrobrachium japonicum", "macrobrachium jaroense",
              "macrobrachium jayasreei", "macrobrachium jelskii", "macrobrachium jiangxiense", "macrobrachium johnsoni", "macrobrachium joppae",
              "macrobrachium kelianense", "macrobrachium kempi", "macrobrachium kistnense", "macrobrachium koombooloomba", "macrobrachium kulkarnii",
              "macrobrachium kunjuramani", "macrobrachium lamarrei", "macrobrachium lanatum", "macrobrachium lanceifrons", "macrobrachium lanchesteri",
              "macrobrachium lar", "macrobrachium latidactylus", "macrobrachium latimanus", "macrobrachium lepidactyloides", "macrobrachium lepidactylus",
              "macrobrachium leptodactylus", "macrobrachium leucodactylus", "macrobrachium lingyunense", "macrobrachium lopopodus", "macrobrachium lorentzi",
              "macrobrachium lucifugum", "macrobrachium lujae", "macrobrachium macrobrachion", "macrobrachium maculatum", "macrobrachium madhusoodani",
              "macrobrachium malayanum", "macrobrachium malcolmsonii", "macrobrachium mammillodactylus", "macrobrachium manipurense", "macrobrachium manningi",
              "macrobrachium mazatecum", "macrobrachium meridionale", "macrobrachium michoacanus", "macrobrachium microps", "macrobrachium mieni",
              "macrobrachium minutum", "macrobrachium miyakoense", "macrobrachium moorei", "macrobrachium naso", "macrobrachium nattereri",
              "macrobrachium natulorum", "macrobrachium neglectum", "macrobrachium nepalense", "macrobrachium niloticum", "macrobrachium niphanae",
              "macrobrachium nipponense", "macrobrachium nobilii", "macrobrachium novaehollandiae", "macrobrachium oaxacae", "macrobrachium occidentale",
              "macrobrachium oenone", "macrobrachium ohione", "macrobrachium olfersii", "macrobrachium oxyphilus", "macrobrachium panamense",
              "macrobrachium patheinense", "macrobrachium patsa", "macrobrachium pectinatum", "macrobrachium peguense", "macrobrachium pentazona",
              "macrobrachium petersii", "macrobrachium petiti", "macrobrachium pilimanus", "macrobrachium pilosum", "macrobrachium placidulum",
              "macrobrachium placidum", "macrobrachium platycheles", "macrobrachium platyrostris", "macrobrachium poeti", "macrobrachium potiuna",
              "macrobrachium prabhakarani", "macrobrachium praecox", "macrobrachium pumilum", "macrobrachium purpureamanus", "macrobrachium quelchi",
              "macrobrachium raridens", "macrobrachium rathbunae", "macrobrachium reyesi", "macrobrachium rhodochir", "macrobrachium rodriguezi",
              "macrobrachium rogersi", "macrobrachium rosenbergii", "macrobrachium rostratum", "macrobrachium rude", "macrobrachium sabanus",
              "macrobrachium saigonense", "macrobrachium sankollii", "macrobrachium santanderensis", "macrobrachium sbordonii", "macrobrachium scabriculum",
              "macrobrachium scorteccii", "macrobrachium shaoi", "macrobrachium shokitai", "macrobrachium sintangense", "macrobrachium sirindhorn",
              "macrobrachium siwalikense", "macrobrachium sollaudii", "macrobrachium spinipes", "macrobrachium spinosum", "macrobrachium srilankense",
              "macrobrachium striatum", "macrobrachium sulcatus", "macrobrachium sulcicarpale", "macrobrachium sundaicum", "macrobrachium suongae",
              "macrobrachium superbum", "macrobrachium surinamicum", "macrobrachium tenellum", "macrobrachium tenuirostrum", "macrobrachium thai",
              "macrobrachium therezieni", "macrobrachium thuylami", "macrobrachium thysi", "macrobrachium tiwarii", "macrobrachium tolmerum",
              "macrobrachium totonacum", "macrobrachium transandicum", "macrobrachium tratense", "macrobrachium trichodactylum", "macrobrachium tuxtlaense",
              "macrobrachium unikarnatakae", "macrobrachium urayang", "macrobrachium veliense", "macrobrachium venustum", "macrobrachium vicconi",
              "macrobrachium vietnamiense", "macrobrachium villalobosi", "macrobrachium villosimanus", "macrobrachium vollenhoveni", "macrobrachium walvanense",
              "macrobrachium wannanense", "macrobrachium weberi", "macrobrachium yui", "macrobrachium zariquieyi",
              "neopalaemon nahuatlus",
              "palaemon antennarius", "palaemon capensis", "palaemon minos",
              "palaemonetes antrorum", "palaemonetes argentinus", "palaemonetes australis", "palaemonetes carteri", "palaemonetes cummingi",
              "palaemonetes hobbsi", "palaemonetes ivonicus", "palaemonetes kadiakensis", "palaemonetes lindsayi", "palaemonetes mercedae",
              "palaemonetes mesogenitor", "palaemonetes mesopotamicus", "palaemonetes mexicanus", "palaemonetes paludosus", "palaemonetes sinensis",
              "palaemonetes suttkusi", "palaemonetes texanus", "palaemonetes turcorum",
              "pseudopalaemon amazonensis", "pseudopalaemon bouvieri", "pseudopalaemon chryseus", "pseudopalaemon funchiae", "pseudopalaemon gouldingi",
              "pseudopalaemon iquitoensis", "pseudopalaemon nigramnis",
              "tenuipedium palaemonoides",
              "troglindicus phreaticus",
              "troglocubanus calcis", "troglocubanus eigenmanni", "troglocubanus gibarensis", "troglocubanus inermis", "troglocubanus jamaicensis",
              "troglomexicanus huastecae", "troglomexicanus perezfarfanteae", "troglomexicanus tamaulipasensis",
            ],
          },
          estimatedDescribed: 247_666,
          estimatedSource: "Invertebrate species (assessed + unassessed, per our own data) not in any of the 17 SSC groups above (approx.; includes species that would belong to Cave Invertebrate SG, the Terrestrial and Freshwater Invertebrate RLA, or the Marine Invertebrates RLA in reality — see exclusion note above)",
          estimatedSourceUrl: COL_2025_URL,
        },
      ],
    },

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

    // ─── SSC SPECIALIST GROUPS (plants) ─────────────────────────────────
    // Same second lens as the mammal/reptile/fish/invertebrate pilots above.
    // Like invertebrates, plants aren't one Table 1a CSV group — this spans
    // the 6 "plantae" CSV groups (flowering_plants, gymnosperms,
    // ferns_and_allies, mosses, green_algae, red_algae; brown_algae is
    // classified under "Fungi & Protists" in Table 1a, not plants, and none
    // of these groups' remits touch it anyway).
    //
    // Of the 13 real taxon-based plant SSC groups (12 more geographic
    // regional Plant Red List Authorities — Brazil, Southern African, West
    // Africa, etc. — are separately blocked for the has_map-removal reason
    // documented on the "mammals"/reptile/fish pilots' sibling PRs, and
    // Botanic Gardens Conservation International isn't a taxonomic group at
    // all), 5 are DELIBERATELY EXCLUDED — plants have by far the highest rate
    // of non-taxonomic SSC groups of any taxon covered so far, reflecting
    // real conservation-community priorities (agriculture, medicine,
    // horticulture, growth form) rather than pure taxonomy:
    //  - Seaweed SG (found in a post-review pass): own mission is "marine
    //    macroalgae" generally, with a current emphasis on kelp — a
    //    growth-form category, not a clade, spanning THREE unrelated algal
    //    lineages (red algae, green algae, AND brown algae/kelp — the last
    //    of which isn't even part of this tree's "plantae" branch at all;
    //    it's classified under the "fungi" virtual node's csvGroups, per the
    //    comment above). Encoding even the "safe" two-thirds (red + green
    //    algae) would still miss the group's most-emphasized taxon (kelp),
    //    misleadingly implying full coverage — worse than not building it.
    //  - Crop Wild Relative SG: own materials define its remit as "wild
    //    taxa genetically related to cultivated crops" — a functional/
    //    agricultural category spanning hundreds of unrelated families
    //    (Poaceae for cereals, Solanaceae for potato/tomato, Fabaceae for
    //    legumes, etc.), with no closed family/genus list ever adopted as
    //    official scope (the closest thing, the Harlan & de Wet CWR
    //    Inventory, is an external prioritization product, not an IUCN SSC
    //    published boundary).
    //  - Freshwater Plant SG: own materials describe "all aquatic and
    //    wetland plants, including vascular plants, bryophytes, lichens and
    //    algae" — habitat-based and even broader than most excluded groups
    //    elsewhere in this tree (it crosses kingdom boundaries, not just
    //    family ones).
    //  - Global Trees SG: "tree" is BGCI's own growth-form definition ("a
    //    woody plant with usually a single stem... to a height of at least
    //    two metres"), not a clade — its own GlobalTreeSearch checklist spans
    //    ~58,000 species across hundreds of unrelated families. Our data has
    //    no growth-habit field to distinguish tree-form species from
    //    shrub/herb-form congeners within the same family.
    //  - Medicinal Plant SG: own materials confirm a use-based category
    //    (plants used medicinally) with only a rotating ~300-species
    //    "priority" worklist assembled from trade/regulatory criteria, not a
    //    taxonomic boundary — spans dozens of unrelated families by
    //    construction.
    // Same class of blocker as the fish pilot's Freshwater Fish SG and the
    // invertebrate pilot's Cave Invertebrate SG / two catch-all RLAs: real,
    // named entities whose remit needs a data dimension (growth habit, use,
    // agricultural relationship) this tree's family/genus/order model can't
    // express and our data can't reliably support across the whole species
    // universe. The catch-all below is a plain "No SSC Group" remainder, not
    // a claim on any of these five groups' behalf.
    {
      id: "ssc-plant-groups",
      name: "SSC Specialist Groups",
      filter: { csvGroups: ALL_PLANT_GROUPS },
      children: [
        {
          id: "ssc-orchid",
          name: "Orchid Specialist Group",
          filter: { csvGroups: ["flowering_plants"], families: ["orchidaceae"] },
          // Own site + iucn.org: taxonomic base described consistently as
          // "Orchidaceae, one of the largest families of plants" — the whole
          // family, no exceptions found (no page states this as a formal
          // boundary in so many words, but it's implied consistently
          // throughout).
          // estimatedDescribed corrected — the prior figure (12,767)
          // undercounted by ~2.5x against both literature (Christenhusz &
          // Byng 2016 cite >28,000) and this app's own COL_2025 data.
          estimatedDescribed: 31_992,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Orchidaceae",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: "https://www.orchidspecialistgroup.com/about",
        },
        {
          id: "ssc-bryophyte",
          name: "Bryophyte Specialist Group",
          filter: { csvGroups: ["mosses"] },
          // Own founding action plan is literally titled "Mosses, Liverworts,
          // and Hornworts: Status Survey and Conservation Action Plan for
          // Bryophytes" — all 3 bryophyte divisions. Our "mosses" Table 1a
          // CSV group already spans all 3 (8 classes: true mosses, 2
          // liverwort classes, hornworts, etc., confirmed by direct query) —
          // a trivial whole-CSV-group match, no further restriction needed.
                    // estimatedDescribed reconciled with MOSSES_NODE above — both use
          // the identical csvGroups:["mosses"] filter and should never have
          // diverged.
          estimatedDescribed: 19_539,
          estimatedSource: IUCN_SOURCE + " (" + CHRISTENHUSZ + ") — Bryophyta + Marchantiophyta + Anthocerotophyta (whole CSV group)",
          estimatedSourceUrl: CHRISTENHUSZ_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-bryophyte-specialist-group",
        },
        {
          id: "ssc-cactus-succulent",
          name: "Cactus and Succulent Plants Specialist Group",
          filter: { csvGroups: ["flowering_plants"], families: ["cactaceae", "didiereaceae"] },
          // Own site (iucn-cssg.org) defines "succulent" functionally (water
          // storage in leaves/stems/roots) and explicitly names member
          // families spanning many unrelated lineages beyond Cactaceae —
          // Euphorbiaceae, Apocynaceae, Asphodelaceae, Agavaceae,
          // Portulacaceae, Crassulaceae, Fouquieriaceae, Didiereaceae — the
          // same growth-form-based pattern as Freshwater Fish SG, just not
          // total: unlike those 4 fully-excluded groups above, TWO of the
          // named families ARE safely whole-family-encodable, because
          // they're near-exclusively succulent with no large non-succulent
          // majority to overclaim (Cactaceae; Didiereaceae, the small
          // Madagascar "octopus tree" family). The rest — Euphorbiaceae
          // (~6,500 species, vast majority non-succulent), Apocynaceae,
          // Asphodelaceae, Agavaceae, Portulacaceae, Crassulaceae,
          // Fouquieriaceae — would need a genus-level allowlist (Aloe,
          // Agave, Pachypodium, Hoodia, Dudleya, Fouquieria, ...) that no
          // source could verify with confidence, so they're deliberately
          // left to the catch-all rather than guessed.
          estimatedDescribed: 1_830,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Cactaceae + Didiereaceae (the group's own remit is broader, growth-form-based, spanning several other mixed families we can't safely isolate — see comment)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: "https://iucn-cssg.org/en/cacti_and_succulents/",
        },
        {
          id: "ssc-palm",
          name: "Palm Specialist Group",
          filter: { csvGroups: ["flowering_plants"], families: ["arecaceae"] },
          // iucn.org: "dedicated to the conservation and sustainable use of
          // palms... assessing the conservation status of palm species
          // throughout the world" — the whole family Arecaceae, no
          // exceptions found (no page uses the Latin family name verbatim,
          // but activity spans every palm-growing region with no carve-out).
          // estimatedDescribed corrected — the prior figure (1,726)
          // undercounted by ~30-35% against both literature (Dransfield et
          // al., Genera Palmarum, ~2,600 species) and this app's own
          // COL_2025 data.
          estimatedDescribed: 2_538,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Arecaceae",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-palm-specialist-group",
        },
        {
          id: "ssc-carnivorous-plant",
          name: "Carnivorous Plant Specialist Group",
          filter: {
            csvGroups: ["flowering_plants"],
            families: ["droseraceae", "nepenthaceae", "sarraceniaceae", "lentibulariaceae", "byblidaceae", "roridulaceae", "cephalotaceae", "drosophyllaceae"],
          },
          // Own site (cached, iucn-cpsg.org unreachable at research time) +
          // iucn.org: "assisting in the conservation of all Genera of
          // Carnivorous Plants" — the 8 standard carnivorous-plant families
          // (a polyphyletic but well-established set), all present in our
          // data. A handful of "protocarnivorous" genera in otherwise
          // non-carnivorous families (Triphyophyllum/Dioncophyllaceae,
          // Philcoxia/Plantaginaceae, Brocchinia+Catopsis/Bromeliaceae) were
          // named in an unverifiable cached source — excluded here pending a
          // first-party confirmation, consistent with treating the
          // well-evidenced core as the safe default.
          estimatedDescribed: 828,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Droseraceae + Nepenthaceae + Sarraceniaceae + Lentibulariaceae + Byblidaceae + Roridulaceae + Cephalotaceae + Drosophyllaceae",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-carnivorous-plant-specialist-group",
        },
        {
          id: "ssc-conifer",
          name: "Conifer Specialist Group",
          filter: { csvGroups: ["gymnosperms"], orderNames: ["pinales"] },
          // Own dedicated site's species index (threatenedconifers.rbge.
          // ac.uk) lists species across exactly the 7 families of order
          // Pinales (Araucariaceae, Cephalotaxaceae, Cupressaceae, Pinaceae,
          // Podocarpaceae, Sciadopityaceae, Taxaceae) — no Ginkgoaceae,
          // Ephedraceae, Gnetaceae, or Welwitschiaceae species appear
          // anywhere in it. Ginkgo and the gnetophytes (Ephedra, Gnetum,
          // Welwitschia) are consequently NOT covered by this group, and no
          // other group in our list claims them either — a genuine, open
          // gap (3-4 species total) rather than an oversight; they fall to
          // the catch-all.
          estimatedDescribed: 672,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Pinales (excludes Ginkgo + gnetophytes, which no SSC group in this pilot claims)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: "https://threatenedconifers.rbge.org.uk/",
        },
        {
          id: "ssc-cycad",
          name: "Cycad Specialist Group",
          filter: { csvGroups: ["gymnosperms"], orderNames: ["cycadales"] },
          // Own checklist, The World List of Cycads (cycadlist.org): "10
          // accepted genera" across exactly the 2 families of order
          // Cycadales (Cycadaceae, Zamiaceae) — matches our data exactly, no
          // exceptions found.
          estimatedDescribed: 358,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — Cycadales (Cycadaceae + Zamiaceae)",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: "http://www.cycadgroup.org/",
        },
        {
          id: "ssc-seagrass",
          name: "Seagrass Species Specialist Group",
          filter: {
            csvGroups: ["flowering_plants"],
            genera: [
              // 4 whole families (confirmed by direct query against our own
              // redlist dataset — no stray genera currently present there):
              // Cymodoceaceae, Posidoniaceae, Zosteraceae, Ruppiaceae
              // (Ruppia's taxonomy is "problematic" per the group's own
              // assessment papers, but treated as in-scope regardless).
              // "oceana" is included too even though it doesn't currently
              // match anything in our redlist dataset: Oceana serrulata
              // (Clump Seagrass) was split out of Cymodocea into its own
              // genus (~2018) and appears in GBIF's broader taxonomy, so
              // this future-proofs the filter if it's ever added/assessed.
              "amphibolis", "cymodocea", "halodule", "syringodium", "thalassodendron", "oceana",
              "posidonia",
              "heterozostera", "nanozostera", "phyllospadix", "zostera",
              "ruppia",
              // Hydrocharitaceae is genus-restricted, NOT a whole-family
              // claim — that family is mostly freshwater plants (Najas,
              // Ottelia, Blyxa, Vallisneria, Elodea, Hydrilla, ...), which
              // are NOT seagrasses and correctly fall to the catch-all. Only
              // the 3 genuinely marine seagrass genera are included.
              "enhalus", "halophila", "thalassia",
            ],
          },
          // No single explicit "our scope is these families" statement found
          // from the group itself (no dedicated site exists) — inferred with
          // high confidence from the group's own peer-reviewed output (Short
          // et al. 2011, "Extinction risk assessment of the world's seagrass
          // species," produced by the ~70-member group) and its ongoing 2025
          // regional Red List reassessments, which consistently work from
          // exactly this genus list.
          estimatedDescribed: 76,
          estimatedSource: IUCN_SOURCE + " (" + COL_2025 + ") — 4 whole seagrass families + the 3 marine genera within Hydrocharitaceae (Enhalus, Halophila, Thalassia); inferred from the group's own assessment practice, not a quoted scope statement",
          estimatedSourceUrl: COL_2025_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-seagrass-species-specialist-group",
        },
        // Catch-all: a plain "No SSC Group" remainder (NOT a claim on behalf
        // of Crop Wild Relative SG, Freshwater Plant SG, Global Trees SG, or
        // Medicinal Plant SG — see the exclusion note above). Omits "mosses"
        // entirely (100% claimed by Bryophyte SG) rather than listing a
        // redundant exclude for it. Kept in sync manually — if a 9th plant
        // SSC group is added above, exclude its family/order/genus here too.
        {
          id: "ssc-other-plants",
          name: "No SSC Group",
          filter: {
            csvGroups: ["flowering_plants", "gymnosperms", "ferns_and_allies", "green_algae", "red_algae"],
            excludeFamilies: [
              "cactaceae", "didiereaceae",
              "droseraceae", "nepenthaceae", "sarraceniaceae", "lentibulariaceae", "byblidaceae", "roridulaceae", "cephalotaceae", "drosophyllaceae",
              "orchidaceae", "arecaceae",
            ],
            excludeOrders: ["pinales", "cycadales"],
            excludeGenera: [
              "amphibolis", "cymodocea", "halodule", "syringodium", "thalassodendron", "oceana",
              "posidonia",
              "heterozostera", "nanozostera", "phyllospadix", "zostera",
              "ruppia",
              "enhalus", "halophila", "thalassia",
            ],
          },
          // estimatedDescribed recomputed — the prior figure (209,795) was
          // ~176,000 species (46%) short of what this tree's own top-level
          // CSV-group totals (flowering_plants + gymnosperms +
          // ferns_and_allies + green_algae + red_algae = 404,464) imply once
          // the 8 named sibling groups' current estimates are subtracted.
          estimatedDescribed: 346_631,
          estimatedSource: "Plant species (assessed + unassessed, per our own data) not in any of the 8 SSC groups above (approx.; includes species that would belong to Crop Wild Relative SG, Freshwater Plant SG, Global Trees SG, or Medicinal Plant SG in reality — see exclusion note above)",
          estimatedSourceUrl: COL_2025_URL,
        },
      ],
    },

    // ─── SSC SPECIALIST GROUPS (fungi) ──────────────────────────────────
    // Same second lens as the mammal/reptile/fish/invertebrate/plant pilots
    // above — the final taxon in this pilot. Both of IUCN's 2 taxon-based
    // fungal SSC groups map onto our "mushrooms" CSV group.
    {
      id: "ssc-fungi-groups",
      name: "SSC Specialist Groups",
      filter: { csvGroups: ["mushrooms"] },
      children: [
        {
          id: "ssc-cup-fungus-truffle",
          name: "Cup-fungi, Truffles and Allies Specialist Group",
          filter: { csvGroups: ["mushrooms"], orderNames: ["pezizales"] },
          // RENAMED by IUCN to "Cup-fungi, Truffles and Allies Specialist
          // Group" (our source DB still lists the older singular name). Own
          // 2022 SSC report mission statement: "to promote the conservation
          // of ascomycete fungi" with a target to document sources "for
          // assessing non-lichen-forming ascomycetes" — i.e. its REAL remit
          // is far broader than order Pezizales, essentially all of
          // Ascomycota minus the lichenized fungi (confirmed by a real
          // published assessment credited to this group for Ophiocordyceps
          // sinensis, order Hypocreales — nowhere near Pezizales). Encoded to
          // the well-evidenced eponymous core (order Pezizales: cup fungi,
          // truffles, morels) rather than "all non-lichenized Ascomycota,"
          // the same conservative-core judgment as the invertebrate pilot's
          // Dung Beetle SG: reliably determining lichenized-vs-not status
          // per species isn't possible with our data (some ascomycete
          // classes, e.g. Eurotiomycetes, contain a genuine mix of both),
          // and the full-scope reading would swallow a large fraction of
          // the entire "mushrooms" CSV group under one group's banner —
          // exactly the kind of overclaim this pilot has consistently
          // avoided elsewhere.
          estimatedDescribed: 1_463,
          estimatedSource: SPECIES_FUNGORUM + " — Pezizales (the group's own remit is broader — non-lichenized Ascomycota generally — but not safely encodable without per-species lichenization data; see comment)",
          estimatedSourceUrl: SPECIES_FUNGORUM_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-cup-fungi-truffles-and-allies-specialist-group",
        },
        {
          id: "ssc-chytrid-zygomycete-downy-mildew-myxomycete",
          name: "Chytrid, Zygomycete, Downy Mildew and Myxomycete Specialist Group",
          filter: { csvGroups: ["mushrooms"], classNames: ["chytridiomycetes", "mucoromycetes", "zoopagomycetes", "oomycetes", "myxomycetes"] },
          // RENAMED by IUCN to "...and Myxomycete Specialist Group" ("Slime
          // Mould" → "Myxomycete"; our source DB still lists the older name).
          // Own 2024-2025 SSC report mission statement, repeated verbatim
          // across every target: "promote the conservation of chytrids,
          // downy mildews, myxomycetes and zygomycetes" — confirmed to be
          // EXACTLY these 4 lineages, no broader (explicitly does not extend
          // to related early-diverging lineages like Blastocladiomycota,
          // Neocallimastigomycota, Glomeromycota, or Entomophthoromycota).
          // Two of the four ("downy mildews" = Oomycota, "myxomycetes"/slime
          // moulds = Myxogastria) aren't even in kingdom Fungi taxonomically
          // (Oomycota are stramenopiles; Myxogastria are Amoebozoa) — grouped
          // here purely by the SSC's own real-world organizational choice,
          // which existing conservation practice already treats this way.
          //
          // ESTIMATED 0 SPECIES CURRENTLY — verified directly against the
          // full dataset (all taxon groups, not just "mushrooms"): zero
          // species anywhere carry a class name from any of these 4
          // lineages. This is NOT a bug or a scoping gap: a peer-reviewed
          // fungal Red List survey (Mueller et al. 2022, Diversity 14(9))
          // confirms "Chytridiomycota and Mucoromycota are not represented
          // among currently published globally assessed fungal species on
          // the IUCN Red List" — these lineages are genuinely almost
          // entirely unassessed globally (the group's own 2024-2025 report
          // describes only NATIONAL-level Cuban myxomycete assessments, not
          // global ones). Built anyway, for the same reason small groups
          // elsewhere in this pilot were built despite low counts (e.g.
          // fish's Anguillid Eel SG, 16 species) — this node will correctly
          // and automatically pick up real species the moment IUCN publishes
          // any global assessments for these lineages, without needing
          // another future update. The exact class-name spellings above are
          // a best-effort standard set (chytrid, zygomycete-derived,
          // oomycete, and myxomycete classes) — UNVERIFIED against real data
          // since none currently exists to check against; revisit naming if
          // this ever needs to match a real assessed species.
          estimatedDescribed: 0,
          estimatedSource: "No known described-species estimate published for this specific 4-lineage grouping; near-zero global IUCN Red List assessment activity confirmed for all 4 (see comment)",
          estimatedSourceUrl: SPECIES_FUNGORUM_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-chytrid-zygomycete-downy-mildew-and-myxomycete-specialist",
        },
        {
          id: "ssc-lichen",
          name: "Lichen Specialist Group",
          filter: { csvGroups: ["mushrooms"], classNames: ["lecanoromycetes"] },
          // No explicit class-level scope statement found in the group's own
          // materials (2021 or 2024-2025 SSC annual reports, iucn.org page,
          // or its associated Red List checklist), but every named target
          // and example species in both reports is drawn exclusively from
          // Lecanoromycetes (e.g. Parmeliaceae — order Lecanorales — is its
          // flagship T-001 target). Encoded to this well-evidenced core.
          // LOWER CONFIDENCE, flagged rather than guessed: the group's own
          // associated checklist is titled "...lichen-forming, LICHENICOLOUS
          // and allied fungi" — lichenicolous fungi (non-lichenized fungi
          // living on lichens) are a real part of its working scope but are
          // polyphyletic, scattered as individual genera across otherwise
          // free-living classes (Dothideomycetes, Sordariomycetes,
          // Eurotiomycetes) with no way to isolate them at class/order level.
          // A handful of small, nearly-entirely-lichenized classes beyond
          // Lecanoromycetes also exist in real fungal taxonomy (Arthoniomycetes,
          // Lichinomycetes, Coniocybomycetes, Candelariomycetes) but weren't
          // confirmed as explicitly in-scope by the group's own materials, so
          // they're left to the catch-all rather than assumed.
          estimatedDescribed: 7_301,
          estimatedSource: SPECIES_FUNGORUM + " — Lecanoromycetes (evidenced core; see comment for flagged gaps)",
          estimatedSourceUrl: SPECIES_FUNGORUM_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-lichen-specialist-group",
        },
        {
          id: "ssc-mushroom-bracket-puffball",
          name: "Mushroom, Bracket and Puffball Specialist Group",
          filter: { csvGroups: ["mushrooms"], classNames: ["agaricomycetes"] },
          // No single explicit "our scope is class X" statement found, but
          // the group's own 2024-2025 SSC report treats the two labels as
          // equivalent in its own reporting ("The 2025.1 Red List update
          // comprised 1,300 fungal species, including 1,104 mushroom,
          // brackets, and puffballs"), and every target/example species
          // (Cantharellus/Craterellus — Cantharellales; polypores/brackets —
          // Russulales/Polyporales; Termitomyces — Agaricales) sits within
          // Agaricomycetes with no narrower restriction implied. Standard
          // mycological usage: mushrooms/brackets/puffballs collectively
          // describe class Agaricomycetes.
          estimatedDescribed: 18_793,
          estimatedSource: SPECIES_FUNGORUM + " — Agaricomycetes",
          estimatedSourceUrl: SPECIES_FUNGORUM_URL,
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-mushroom-bracket-and-puffball-specialist-group",
        },
        {
          id: "ssc-rust-smut",
          name: "Rusts and Smuts Specialist Group",
          filter: {
            csvGroups: ["mushrooms"],
            // orderNames/classNames AND together in this filter engine, so
            // "rusts OR smuts" is expressed as one flat order list: order
            // Pucciniales (rusts) + every order actually present in our data
            // under classes Ustilaginomycetes/Exobasidiomycetes (smuts) —
            // same workaround as Dung Beetle SG above. Misses the 1
            // unassessed Exobasidiomycetes species in our data with a null
            // order_name; undercounting rather than guessing its order.
            orderNames: [
              "pucciniales",
              "ustilaginales", "urocystidales", "violaceomycetales", "uleiellales",
              "entylomatales", "exobasidiales", "tilletiales", "doassansiales",
              "georgefischeriales", "microstromatales", "ceraceosorales", "robbauerales",
            ],
          },
          // Own 2021-2025 target (T-002), quoted verbatim from its
          // 2024-2025 SSC annual report: "Produce Red List assessments for
          // 50 species of smut fungi (subphylum Ustilaginomycotina) and
          // rust fungi (subphylum Pucciniomycotina)" — a clean, explicit,
          // self-declared subphylum split. Subphylum Ustilaginomycotina
          // (smuts) maps EXACTLY onto classes Ustilaginomycetes +
          // Exobasidiomycetes, no more, no less. Subphylum Pucciniomycotina
          // (rusts) is technically broader than order Pucciniales (it also
          // contains several minor yeast-like sister classes that aren't
          // "rust fungi" in any meaningful sense, e.g. Microbotryomycetes,
          // Cystobasidiomycetes), and class Pucciniomycetes itself contains
          // a few non-rust orders (Helicobasidiales, Platygloeales) — so
          // "rusts" is encoded as order Pucciniales specifically (the
          // universally-recognized "true rusts," ~8,000 species worldwide,
          // and the dominant order within Pucciniomycetes), consistent with
          // this codebase's precision-over-scope-creep convention (same
          // reasoning as Cup-fungi SG's Pezizales-only scope). NOTE: the
          // group's own report photo gallery shows Microbotryum duriaeanum
          // as an example "smut" — but Microbotryum (order Microbotryales)
          // is actually in Pucciniomycotina, not Ustilaginomycotina,
          // confirming "smut" is a polyphyletic guild term in real usage
          // that doesn't perfectly match even the group's own clean
          // subphylum split. Not safely encodable beyond the core above.
          // estimatedDescribed corrected — the prior figure (2,764) directly
          // contradicted this very comment's own "~8,000 species worldwide"
          // claim for Pucciniales alone (it was the count of rows the order
          // filter happens to match in our own dataset, not a real-world
          // described-species estimate — same category error as Dung Beetle
          // SG's first-pass estimate).
          estimatedDescribed: 10_200,
          estimatedSource: "GBIF backbone (Pucciniales, ~8,500) + literature (Ustilaginomycotina smuts, ~1,700)",
          estimatedSourceUrl: "https://www.gbif.org/species/search?q=Pucciniales&rank=ORDER",
          sourceUrl: SSC_GROUP_URL_BASE + "iucn-ssc-rusts-and-smuts-specialist-group",
        },
        // Catch-all: a plain "No SSC Group" remainder. Kept in sync
        // manually — if another fungi SSC group is added above, exclude its
        // order/class here too.
        {
          id: "ssc-other-fungi",
          name: "No SSC Group",
          filter: {
            csvGroups: ["mushrooms"],
            // Rusts and Smuts SG is excluded by order (not class) below, on
            // purpose — it matches by order too (see its filter's comment),
            // so a species with a null order_name under Ustilaginomycetes/
            // Exobasidiomycetes correctly falls through to here rather than
            // vanishing from both nodes.
            excludeOrders: [
              "pezizales",
              "pucciniales",
              "ustilaginales", "urocystidales", "violaceomycetales", "uleiellales",
              "entylomatales", "exobasidiales", "tilletiales", "doassansiales",
              "georgefischeriales", "microstromatales", "ceraceosorales", "robbauerales",
            ],
            excludeClasses: ["chytridiomycetes", "mucoromycetes", "zoopagomycetes", "oomycetes", "myxomycetes", "lecanoromycetes", "agaricomycetes"],
          },
          estimatedDescribed: 23_835,
          estimatedSource: SPECIES_FUNGORUM + " — fungi species (assessed + unassessed, per our own data) not in any of the 5 SSC groups above (approx.)",
          estimatedSourceUrl: SPECIES_FUNGORUM_URL,
        },
      ],
    },

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
