/**
 * Taxonomy views — config-only, no new UI switcher.
 *
 * Defines which tree nodes appear as top-level rows for each view mode.
 * The existing landing page / expand all / Table 1a controls remain.
 *
 * Specialist group presets combine a taxonomy view with default filters
 * to surface the most relevant data for each IUCN SSC group.
 */

/** Filters that a preset can pre-apply when selected. */
export interface PresetFilters {
  taxa?: string[];
  categories?: string[];
  systems?: string[];
  yearRanges?: string[];
  threats?: string[];
  populationTrends?: string[];
  movementPatterns?: string[];
  growthForms?: string[];
}

export interface TaxonomyView {
  id: string;
  name: string;
  /** Short description shown in the preset selector */
  description?: string;
  /** Top-level node IDs to display */
  roots: string[];
  /** Optional section grouping for Table 1a layout */
  sections?: { title: string; nodeIds: string[] }[];
  /** Filters to pre-apply when this preset is selected */
  defaultFilters?: PresetFilters;
}

export const TAXONOMY_VIEWS: Record<string, TaxonomyView> = {
  default: {
    id: "default",
    name: "Default",
    roots: [
      "mammalia", "aves", "reptilia", "amphibia", "fishes",
      "invertebrates", "plantae", "fungi",
    ],
  },

  table1a: {
    id: "table1a",
    name: "Table 1a",
    description: "All 21 IUCN Table 1a taxonomic groups",
    roots: [
      "mammalia", "aves", "reptilia", "amphibia", "fishes",
      "insecta", "mollusca", "crustacea", "corals", "arachnida",
      "velvet_worms", "horseshoe_crabs", "other_invertebrates",
      "mosses", "ferns_and_allies", "gymnosperms", "flowering_plants",
      "green_algae", "red_algae",
      "mushrooms", "brown_algae",
    ],
    sections: [
      {
        title: "VERTEBRATES",
        nodeIds: ["mammalia", "aves", "reptilia", "amphibia", "fishes"],
      },
      {
        title: "INVERTEBRATES",
        nodeIds: [
          "insecta", "mollusca", "crustacea", "corals", "arachnida",
          "velvet_worms", "horseshoe_crabs", "other_invertebrates",
        ],
      },
      {
        title: "PLANTS",
        nodeIds: [
          "mosses", "ferns_and_allies", "gymnosperms", "flowering_plants",
          "green_algae", "red_algae",
        ],
      },
      {
        title: "FUNGI & PROTISTS",
        nodeIds: ["mushrooms", "brown_algae"],
      },
    ],
  },

  // ─── Specialist group presets ──────────────────────────────────────

  marine: {
    id: "marine",
    name: "Marine Species",
    description: "Fishes, corals, marine mammals, molluscs, crustaceans",
    roots: [
      "fishes", "corals", "mollusca", "crustacea", "mammalia", "reptilia", "aves",
    ],
    defaultFilters: {
      taxa: ["fishes", "corals", "mollusca", "crustacea", "mammalia", "reptilia", "aves"],
      systems: ["Marine"],
    },
  },

  freshwater: {
    id: "freshwater",
    name: "Freshwater Species",
    description: "Freshwater fishes, amphibians, molluscs, crustaceans, insects",
    roots: [
      "fishes", "amphibia", "mollusca", "crustacea", "insecta", "reptilia",
    ],
    defaultFilters: {
      taxa: ["fishes", "amphibia", "mollusca", "crustacea", "insecta", "reptilia"],
      systems: ["Freshwater"],
    },
  },

  plants: {
    id: "plants",
    name: "Plants",
    description: "Flowering plants, gymnosperms, ferns, mosses, algae",
    roots: [
      "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
      "green_algae", "red_algae",
    ],
    sections: [
      {
        title: "PLANTS",
        nodeIds: [
          "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
          "green_algae", "red_algae",
        ],
      },
    ],
    defaultFilters: {
      taxa: [
        "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
        "green_algae", "red_algae",
      ],
    },
  },

  threatened: {
    id: "threatened",
    name: "Threatened Species",
    description: "CR, EN, and VU species needing reassessment",
    roots: [
      "mammalia", "aves", "reptilia", "amphibia", "fishes",
      "invertebrates", "plantae", "fungi",
    ],
    defaultFilters: {
      categories: ["CR", "EN", "VU"],
      yearRanges: ["10-15", "15-20", "20+"],
    },
  },

  data_deficient: {
    id: "data_deficient",
    name: "Data Deficient",
    description: "DD species with GBIF observations that may enable reassessment",
    roots: [
      "mammalia", "aves", "reptilia", "amphibia", "fishes",
      "invertebrates", "plantae", "fungi",
    ],
    defaultFilters: {
      categories: ["DD"],
    },
  },
};

/** Ordered list of preset IDs for the selector UI (excludes "default"). */
export const PRESET_ORDER = [
  "table1a",
  "marine",
  "freshwater",
  "plants",
  "threatened",
  "data_deficient",
] as const;

export function getView(viewId: string): TaxonomyView {
  return TAXONOMY_VIEWS[viewId] ?? TAXONOMY_VIEWS.default;
}
