/**
 * Taxonomy views — config-only, no new UI switcher.
 *
 * Defines which tree nodes appear as top-level rows for each view mode.
 * The existing landing page / expand all / Table 1a controls remain.
 */

export interface TaxonomyView {
  id: string;
  name: string;
  /** Top-level node IDs to display */
  roots: string[];
  /** Optional section grouping for Table 1a layout */
  sections?: { title: string; nodeIds: string[] }[];
}

export const TAXONOMY_VIEWS: Record<string, TaxonomyView> = {
  default: {
    id: "default",
    name: "Default",
    roots: [
      "mammals", "birds", "reptiles", "amphibians", "fishes",
      "invertebrates", "plantae", "fungi",
    ],
  },

  table1a: {
    id: "table1a",
    name: "Table 1a",
    roots: [
      "mammals", "birds", "reptiles", "amphibians", "fishes",
      "insecta", "molluscs", "crustaceans", "corals", "arachnids",
      "velvet_worms", "horseshoe_crabs", "other_invertebrates",
      "mosses", "ferns_and_allies", "gymnosperms", "flowering_plants",
      "green_algae", "red_algae",
      "mushrooms", "brown_algae",
    ],
    sections: [
      {
        title: "VERTEBRATES",
        nodeIds: ["mammals", "birds", "reptiles", "amphibians", "fishes"],
      },
      {
        title: "INVERTEBRATES",
        nodeIds: [
          "insecta", "molluscs", "crustaceans", "corals", "arachnids",
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
};

export function getView(viewId: string): TaxonomyView {
  return TAXONOMY_VIEWS[viewId] ?? TAXONOMY_VIEWS.default;
}
