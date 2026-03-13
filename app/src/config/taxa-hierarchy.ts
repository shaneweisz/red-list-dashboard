/**
 * Subgroup definitions for progressive drill-down within each of the 8 taxa.
 *
 * Each subgroup has a filter that specifies which CSV group(s) to read from
 * and optional class_name / order_name filters to narrow down to the subgroup.
 *
 * estimatedDescribed numbers are sourced from authoritative taxonomic databases
 * cited by IUCN Red List Table 1a (2025-2) and supplementary literature.
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
  /** Short citation shown in tooltip */
  source: string;
  /** URL to the source */
  sourceUrl: string;
  filter: SubGroupFilter;
}

// Only taxa with meaningful subgroups are listed here.
// Mammals and Birds have no further breakdown in this hierarchy.
export const TAXA_SUBGROUPS: Record<string, SubGroupDef[]> = {
  reptilia: [
    {
      id: "lizards-snakes",
      name: "Lizards & Snakes",
      estimatedDescribed: 12_109,
      source: "Reptile Database, Sep 2025 (12,502 total minus Testudines & Crocodylia)",
      sourceUrl: "http://www.reptile-database.org/db-info/SpeciesStat.html",
      filter: { groups: ["reptilia"], orderNames: ["squamata", "rhynchocephalia"] },
    },
    {
      id: "turtles-tortoises",
      name: "Turtles & Tortoises",
      estimatedDescribed: 366,
      source: "Reptile Database, Sep 2025",
      sourceUrl: "http://www.reptile-database.org/db-info/SpeciesStat.html",
      filter: { groups: ["reptilia"], orderNames: ["testudines"] },
    },
    {
      id: "crocodilians",
      name: "Crocodilians",
      estimatedDescribed: 27,
      source: "Reptile Database, Sep 2025",
      sourceUrl: "http://www.reptile-database.org/db-info/SpeciesStat.html",
      filter: { groups: ["reptilia"], orderNames: ["crocodylia"] },
    },
  ],

  amphibia: [
    {
      id: "frogs-toads",
      name: "Frogs & Toads",
      estimatedDescribed: 7_948,
      source: "AmphibiaWeb, 2025",
      sourceUrl: "https://amphibiaweb.org/amphibian/speciesnums.html",
      filter: { groups: ["amphibia"], orderNames: ["anura"] },
    },
    {
      id: "salamanders-newts",
      name: "Salamanders & Newts",
      estimatedDescribed: 829,
      source: "AmphibiaWeb, 2025",
      sourceUrl: "https://amphibiaweb.org/amphibian/speciesnums.html",
      filter: { groups: ["amphibia"], orderNames: ["caudata"] },
    },
    {
      id: "caecilians",
      name: "Caecilians",
      estimatedDescribed: 231,
      source: "AmphibiaWeb, 2025",
      sourceUrl: "https://amphibiaweb.org/amphibian/speciesnums.html",
      filter: { groups: ["amphibia"], orderNames: ["gymnophiona"] },
    },
  ],

  fishes: [
    {
      id: "bony-fish",
      name: "Bony Fish",
      estimatedDescribed: 35_880,
      source: "Eschmeyer's Catalog of Fishes, Sep 2025 (37,288 total minus Chondrichthyes & jawless)",
      sourceUrl: "https://researcharchive.calacademy.org/research/ichthyology/catalog/SpeciesByFamily.asp",
      filter: { groups: ["fishes"], classNames: ["actinopterygii", "sarcopterygii"] },
    },
    {
      id: "sharks-rays",
      name: "Sharks & Rays",
      estimatedDescribed: 1_282,
      source: "Eschmeyer's Catalog of Fishes, Sep 2025",
      sourceUrl: "https://researcharchive.calacademy.org/research/ichthyology/catalog/SpeciesByFamily.asp",
      filter: { groups: ["fishes"], classNames: ["chondrichthyes"] },
    },
    {
      id: "jawless-fish",
      name: "Jawless Fish",
      estimatedDescribed: 126,
      source: "Eschmeyer's Catalog of Fishes, Sep 2025 (~82 Myxini + ~44 Petromyzonti)",
      sourceUrl: "https://researcharchive.calacademy.org/research/ichthyology/catalog/SpeciesByFamily.asp",
      filter: { groups: ["fishes"], classNames: ["myxini", "petromyzonti"] },
    },
  ],

  invertebrates: [
    // --- Insects (from insecta.csv) ---
    // Order-level counts derived from Zhang 2011 (Zootaxa 3148) and Catalogue of Life 2025.
    // Total insects = 1,003,469 per IUCN Table 1a citing CoL 2025.
    {
      id: "beetles",
      name: "Beetles",
      estimatedDescribed: 392_000,
      source: "Zhang 2011, Zootaxa 3148",
      sourceUrl: "https://doi.org/10.11646/zootaxa.3148.1.1",
      filter: { groups: ["insecta"], orderNames: ["coleoptera"] },
    },
    {
      id: "butterflies-moths",
      name: "Butterflies & Moths",
      estimatedDescribed: 160_000,
      source: "Zhang 2011, Zootaxa 3148",
      sourceUrl: "https://doi.org/10.11646/zootaxa.3148.1.1",
      filter: { groups: ["insecta"], orderNames: ["lepidoptera"] },
    },
    {
      id: "flies-mosquitoes",
      name: "Flies & Mosquitoes",
      estimatedDescribed: 155_000,
      source: "Zhang 2011, Zootaxa 3148",
      sourceUrl: "https://doi.org/10.11646/zootaxa.3148.1.1",
      filter: { groups: ["insecta"], orderNames: ["diptera"] },
    },
    {
      id: "bees-wasps-ants",
      name: "Bees, Wasps & Ants",
      estimatedDescribed: 153_000,
      source: "Zhang 2011, Zootaxa 3148",
      sourceUrl: "https://doi.org/10.11646/zootaxa.3148.1.1",
      filter: { groups: ["insecta"], orderNames: ["hymenoptera"] },
    },
    {
      id: "true-bugs",
      name: "True Bugs",
      estimatedDescribed: 82_000,
      source: "Zhang 2011, Zootaxa 3148",
      sourceUrl: "https://doi.org/10.11646/zootaxa.3148.1.1",
      filter: { groups: ["insecta"], orderNames: ["hemiptera"] },
    },
    {
      id: "grasshoppers-crickets",
      name: "Grasshoppers, Crickets & Locusts",
      estimatedDescribed: 26_000,
      source: "Orthoptera Species File, 2025",
      sourceUrl: "https://orthoptera.speciesfile.org/",
      filter: { groups: ["insecta"], orderNames: ["orthoptera"] },
    },
    {
      id: "dragonflies-damselflies",
      name: "Dragonflies & Damselflies",
      estimatedDescribed: 6_400,
      source: "World Odonata List, 2025",
      sourceUrl: "https://www.pugetsound.edu/puget-sound-museum-natural-history/biodiversity-resources/insects/dragonflies/world-odonata-list",
      filter: { groups: ["insecta"], orderNames: ["odonata"] },
    },
    {
      id: "other-insects",
      name: "Other Insects",
      // Remainder: 1,003,469 - 392,000 - 160,000 - 155,000 - 153,000 - 82,000 - 26,000 - 6,400 = 29,069
      estimatedDescribed: 29_069,
      source: "Remainder from IUCN Table 1a total of 1,003,469 (Catalogue of Life 2025)",
      sourceUrl: "https://doi.org/10.48580/dgnfb",
      filter: {
        groups: ["insecta"],
        excludeOrders: [
          "coleoptera", "lepidoptera", "diptera", "hymenoptera",
          "hemiptera", "orthoptera", "odonata",
        ],
      },
    },
    // --- Other invertebrates (from Table 1a directly) ---
    {
      id: "arachnids",
      name: "Arachnids",
      estimatedDescribed: 97_085,
      source: "IUCN Table 1a 2025-2 (Catalogue of Life 2025)",
      sourceUrl: "https://doi.org/10.48580/dgnfb",
      filter: { groups: ["arachnida"] },
    },
    {
      id: "molluscs",
      name: "Molluscs",
      estimatedDescribed: 88_244,
      source: "IUCN Table 1a 2025-2 (MolluscaBase 2025)",
      sourceUrl: "http://www.molluscabase.org",
      filter: { groups: ["mollusca"] },
    },
    {
      id: "crustaceans",
      name: "Crustaceans",
      estimatedDescribed: 83_263,
      source: "IUCN Table 1a 2025-2 (Catalogue of Life 2025; World Ostracoda Database)",
      sourceUrl: "https://doi.org/10.48580/dgnfb",
      filter: { groups: ["crustacea"] },
    },
    {
      id: "corals-cnidarians",
      name: "Corals & Cnidarians",
      estimatedDescribed: 5_672,
      source: "IUCN Table 1a 2025-2 (WoRMS 2025)",
      sourceUrl: "https://www.marinespecies.org",
      filter: { groups: ["corals"] },
    },
    {
      id: "echinoderms",
      name: "Echinoderms",
      estimatedDescribed: 7_000,
      source: "~7,000 extant spp. (WoRMS; Animal Diversity Web)",
      sourceUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=1806",
      filter: {
        groups: ["other_invertebrates"],
        classNames: ["asteroidea", "echinoidea", "holothuroidea"],
      },
    },
    {
      id: "worms",
      name: "Worms",
      // Annelida ~22,000 + Nemertea ~1,300 + Turbellaria ~4,500 = ~27,800
      estimatedDescribed: 27_800,
      source: "~22K Annelida + ~1.3K Nemertea + ~4.5K Turbellaria (WoRMS; various)",
      sourceUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=882",
      filter: {
        groups: ["other_invertebrates"],
        classNames: ["clitellata", "polychaeta", "nemertea", "turbellaria"],
      },
    },
    {
      id: "other-invertebrates",
      name: "Other Invertebrates",
      // Table 1a: Others 230,485 + Velvet Worms 220 + Horseshoe Crabs 4 = 230,709
      // minus Echinoderms 7,000 and Worms 27,800 = 195,909
      estimatedDescribed: 195_909,
      source: "Remainder from IUCN Table 1a 'Others' + Velvet Worms + Horseshoe Crabs, minus Echinoderms & Worms",
      sourceUrl: "https://doi.org/10.48580/dgnfb",
      filter: {
        groups: ["other_invertebrates", "velvet_worms", "horseshoe_crabs"],
        excludeOrders: [], // read all, but we exclude the classes already covered above
      },
    },
  ],

  plantae: [
    // Flowering plant order-level counts from Christenhusz & Byng 2016, Phytotaxa 261(3): 201-217.
    // IUCN Table 1a total for flowering plants = 369,000 (State of the World's Plants 2017).
    {
      id: "orchids-lilies-bulbs",
      name: "Orchids, Lilies & Bulbs",
      estimatedDescribed: 36_000,
      source: "Christenhusz & Byng 2016, Phytotaxa 261(3)",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
      filter: { groups: ["flowering_plants"], orderNames: ["asparagales"] },
    },
    {
      id: "composites-wildflowers",
      name: "Composites & Wildflowers",
      estimatedDescribed: 26_900,
      source: "Christenhusz & Byng 2016, Phytotaxa 261(3)",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
      filter: { groups: ["flowering_plants"], orderNames: ["asterales"] },
    },
    {
      id: "legumes",
      name: "Legumes",
      estimatedDescribed: 20_800,
      source: "Christenhusz & Byng 2016, Phytotaxa 261(3)",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
      filter: { groups: ["flowering_plants"], orderNames: ["fabales"] },
    },
    {
      id: "grasses-cereals",
      name: "Grasses & Cereals",
      estimatedDescribed: 18_900,
      source: "Christenhusz & Byng 2016, Phytotaxa 261(3)",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
      filter: { groups: ["flowering_plants"], orderNames: ["poales"] },
    },
    {
      id: "palms-relatives",
      name: "Palms & Relatives",
      estimatedDescribed: 2_600,
      source: "Christenhusz & Byng 2016, Phytotaxa 261(3)",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
      filter: { groups: ["flowering_plants"], orderNames: ["arecales"] },
    },
    {
      id: "aquatic-flowering",
      name: "Aquatic Flowering Plants",
      // Alismatales ~4,500 + Nymphaeales ~80 + Ceratophyllales ~5 ≈ 4,600
      estimatedDescribed: 4_600,
      source: "Christenhusz & Byng 2016, Phytotaxa 261(3)",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
      filter: { groups: ["flowering_plants"], orderNames: ["alismatales", "ceratophyllales", "nymphaeales"] },
    },
    {
      id: "broadleaf-trees-shrubs",
      name: "Broadleaf Trees & Shrubs",
      // Sum of 10 orders: Fagales ~1,900 + Rosales ~7,700 + Malpighiales ~16,000 +
      // Sapindales ~6,200 + Myrtales ~13,000 + Laurales ~2,800 + Magnoliales ~3,000 +
      // Malvales ~6,000 + Ericales ~12,000 + Gentianales ~20,000 ≈ 88,600
      estimatedDescribed: 88_600,
      source: "Christenhusz & Byng 2016, Phytotaxa 261(3) — sum of 10 orders",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
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
      // Remainder: 369,000 - 36,000 - 26,900 - 20,800 - 18,900 - 2,600 - 4,600 - 88,600 = 170,600
      estimatedDescribed: 170_600,
      source: "Remainder from IUCN Table 1a total of 369,000 (State of the World's Plants 2017)",
      sourceUrl: "https://doi.org/10.48580/dgnfb",
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
      estimatedDescribed: 11_800,
      source: "IUCN Table 1a 2025-2 (State of the World's Plants 2017)",
      sourceUrl: "https://stateoftheworldsplants.org/2017/report/SOTWP_2017.pdf",
      filter: { groups: ["ferns_and_allies"] },
    },
    {
      id: "mosses-liverworts",
      name: "Mosses, Liverworts & Hornworts",
      estimatedDescribed: 21_925,
      source: "IUCN Table 1a 2025-2 (Christenhusz & Byng 2016)",
      sourceUrl: "https://doi.org/10.11646/phytotaxa.261.3.1",
      filter: { groups: ["mosses"] },
    },
    {
      id: "conifers-cycads",
      name: "Conifers & Cycads",
      estimatedDescribed: 1_113,
      source: "IUCN Table 1a 2025-2 (Christenhusz et al. 2011)",
      sourceUrl: "https://stateoftheworldsplants.org/2017/report/SOTWP_2017.pdf",
      filter: { groups: ["gymnosperms"] },
    },
  ],

  fungi: [
    {
      id: "moulds-yeasts-cup",
      name: "Moulds, Yeasts & Cup Fungi",
      // Ascomycota ~93,000–98,000 spp.; these orders are predominantly Ascomycota
      estimatedDescribed: 98_000,
      source: "~98K Ascomycota spp. (Species Fungorum Plus via Catalogue of Life; He et al. 2019)",
      sourceUrl: "https://doi.org/10.48580/dg9ld-4hj",
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
      // Basidiomycota ~31,500–43,000 + other phyla (Chytridiomycota, Glomeromycota, etc.) ~4,000
      // ≈ 60,000; 157,648 - 98,000 = 59,648
      estimatedDescribed: 59_648,
      source: "Remainder of 157,648 total fungi (Species Fungorum Plus via Catalogue of Life)",
      sourceUrl: "https://doi.org/10.48580/dg9ld-4hj",
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
