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
      "insects", "molluscs", "crustaceans", "corals", "arachnids",
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
          "insects", "molluscs", "crustaceans", "corals", "arachnids",
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

  // "By SSC specialist group" view — a sibling of Table 1a. Same sectioned
  // layout, but instead of stopping at the coarse Table 1a class rows it breaks
  // the vertebrates down to the order/family taxa where IUCN SSC Specialist
  // Groups actually operate (Primates, Sharks & Rays, Crocodilians, Turtles &
  // Tortoises, Amphibians, …). Rows reuse existing taxonomy nodes, so every
  // number comes from the same precomputed summaries — nothing is invented.
  // Rows resolve via node-children-summaries.json (see the taxa-summary route),
  // which is why finer nodes like "primates" / "sharks-rays" are valid here.
  sscSpecialistGroups: {
    id: "sscSpecialistGroups",
    name: "SSC Specialist Groups",
    roots: [
      "primates", "carnivores", "bats", "rodents", "artiodactyls", "marsupials",
      "eulipotyphla", "rabbits-hares", "odd-toed-ungulates", "sirenians",
      "pangolins", "other-mammals",
      "birds",
      "squamates", "turtles-tortoises", "crocodilians", "tuataras",
      "amphibians",
      "sharks-rays", "ray-finned-fishes", "jawless-fish", "lobe-finned-fishes",
      "insects", "molluscs", "crustaceans", "corals", "arachnids",
      "velvet_worms", "horseshoe_crabs", "other_invertebrates",
      "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
      "green_algae", "red_algae",
      "mushrooms", "brown_algae",
    ],
    sections: [
      {
        title: "MAMMALS",
        nodeIds: [
          "primates", "carnivores", "bats", "rodents", "artiodactyls",
          "marsupials", "eulipotyphla", "rabbits-hares", "odd-toed-ungulates",
          "sirenians", "pangolins", "other-mammals",
        ],
      },
      {
        title: "BIRDS",
        nodeIds: ["birds"],
      },
      {
        title: "REPTILES",
        nodeIds: ["squamates", "turtles-tortoises", "crocodilians", "tuataras"],
      },
      {
        title: "AMPHIBIANS",
        nodeIds: ["amphibians"],
      },
      {
        title: "FISHES",
        nodeIds: [
          "sharks-rays", "ray-finned-fishes", "jawless-fish", "lobe-finned-fishes",
        ],
      },
      {
        title: "INVERTEBRATES",
        nodeIds: [
          "insects", "molluscs", "crustaceans", "corals", "arachnids",
          "velvet_worms", "horseshoe_crabs", "other_invertebrates",
        ],
      },
      {
        title: "PLANTS",
        nodeIds: [
          "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
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
