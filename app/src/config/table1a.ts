/**
 * IUCN Red List Table 1a structure.
 *
 * Defines the exact sections, rows and estimated-described counts
 * from the IUCN Red List Table 1a (version 2025-2).
 */

export interface Table1aRow {
  /** Matches the table1a_taxon_group key in taxa-summary.json */
  group: string;
  /** Display name matching the PDF */
  name: string;
  /** Estimated number of described species (from Table 1a) */
  estimatedDescribed: number;
}

export interface Table1aSection {
  title: string;
  rows: Table1aRow[];
}

export const TABLE_1A_SECTIONS: Table1aSection[] = [
  {
    title: "VERTEBRATES",
    rows: [
      { group: "mammalia", name: "Mammals", estimatedDescribed: 6_819 },
      { group: "aves", name: "Birds", estimatedDescribed: 11_185 },
      { group: "reptilia", name: "Reptiles", estimatedDescribed: 12_502 },
      { group: "amphibia", name: "Amphibians", estimatedDescribed: 8_918 },
      { group: "fishes", name: "Fishes", estimatedDescribed: 37_288 },
    ],
  },
  {
    title: "INVERTEBRATES",
    rows: [
      { group: "insecta", name: "Insects", estimatedDescribed: 1_003_469 },
      { group: "mollusca", name: "Molluscs", estimatedDescribed: 88_244 },
      { group: "crustacea", name: "Crustaceans", estimatedDescribed: 83_263 },
      { group: "corals", name: "Corals", estimatedDescribed: 5_672 },
      { group: "arachnida", name: "Arachnids", estimatedDescribed: 97_085 },
      { group: "velvet_worms", name: "Velvet Worms", estimatedDescribed: 220 },
      { group: "horseshoe_crabs", name: "Horseshoe Crabs", estimatedDescribed: 4 },
      { group: "other_invertebrates", name: "Others", estimatedDescribed: 230_485 },
    ],
  },
  {
    title: "PLANTS",
    rows: [
      { group: "mosses", name: "Mosses", estimatedDescribed: 21_925 },
      { group: "ferns_and_allies", name: "Ferns and Allies", estimatedDescribed: 11_800 },
      { group: "gymnosperms", name: "Gymnosperms", estimatedDescribed: 1_113 },
      { group: "flowering_plants", name: "Flowering Plants", estimatedDescribed: 369_000 },
      { group: "green_algae", name: "Green Algae", estimatedDescribed: 14_550 },
      { group: "red_algae", name: "Red Algae", estimatedDescribed: 7_744 },
    ],
  },
  {
    title: "FUNGI & PROTISTS",
    rows: [
      { group: "mushrooms", name: "Mushrooms, etc.", estimatedDescribed: 157_648 },
      { group: "brown_algae", name: "Brown Algae", estimatedDescribed: 5_005 },
    ],
  },
];
