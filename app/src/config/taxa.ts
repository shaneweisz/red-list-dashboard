/**
 * Taxa configuration for IUCN Red List data
 *
 * Each taxon has:
 * - id: Unique identifier used in API routes and file names
 * - name: Display name
 * - apiEndpoint: IUCN API endpoint path (kingdom or class)
 * - estimatedDescribed: Estimated number of described species (hardcoded for now)
 * - estimatedSource: Source/citation for the estimate
 * - dataFile: Path to the pre-computed JSON file
 * - color: Theme color for UI elements
 */

export interface TaxonConfig {
  id: string;
  name: string;
  apiEndpoint: string;
  estimatedDescribed: number;
  estimatedSource: string;
  dataFile: string;
  color: string;
  icon?: string;
}

export const TAXA: TaxonConfig[] = [
  {
    id: "plantae",
    name: "Plants",
    apiEndpoint: "kingdom/Plantae",
    estimatedDescribed: 380801,
    estimatedSource: "WFO 2025-06",
    dataFile: "redlist-plantae.json",
    color: "#22c55e", // green-500
  },
  {
    id: "fungi",
    name: "Fungi",
    apiEndpoint: "phylum/Ascomycota", // Only Ascomycota has assessments (mostly lichens)
    estimatedDescribed: 148000,
    estimatedSource: "Species Fungorum 2024",
    dataFile: "redlist-fungi.json",
    color: "#d97706", // amber-600
  },
  {
    id: "mammalia",
    name: "Mammals",
    apiEndpoint: "class/Mammalia",
    estimatedDescribed: 6500,
    estimatedSource: "ASM 2024",
    dataFile: "redlist-mammalia.json",
    color: "#f97316", // orange-500
  },
  {
    id: "aves",
    name: "Birds",
    apiEndpoint: "class/Aves",
    estimatedDescribed: 11000,
    estimatedSource: "BirdLife 2024",
    dataFile: "redlist-aves.json",
    color: "#3b82f6", // blue-500
  },
  {
    id: "reptilia",
    name: "Reptiles",
    apiEndpoint: "class/Reptilia",
    estimatedDescribed: 12000,
    estimatedSource: "Reptile Database 2024",
    dataFile: "redlist-reptilia.json",
    color: "#84cc16", // lime-500
  },
  {
    id: "amphibia",
    name: "Amphibians",
    apiEndpoint: "class/Amphibia",
    estimatedDescribed: 8700,
    estimatedSource: "AmphibiaWeb 2024",
    dataFile: "redlist-amphibia.json",
    color: "#14b8a6", // teal-500
  },
  {
    id: "actinopterygii",
    name: "Ray-finned Fishes",
    apiEndpoint: "class/Actinopterygii",
    estimatedDescribed: 35000,
    estimatedSource: "FishBase 2024",
    dataFile: "redlist-actinopterygii.json",
    color: "#06b6d4", // cyan-500
  },
  {
    id: "chondrichthyes",
    name: "Sharks & Rays",
    apiEndpoint: "class/Chondrichthyes",
    estimatedDescribed: 1300,
    estimatedSource: "Shark References 2024",
    dataFile: "redlist-chondrichthyes.json",
    color: "#6366f1", // indigo-500
  },
  {
    id: "insecta",
    name: "Insects",
    apiEndpoint: "class/Insecta",
    estimatedDescribed: 1000000,
    estimatedSource: "Estimated",
    dataFile: "redlist-insecta.json",
    color: "#eab308", // yellow-500
  },
  {
    id: "arachnida",
    name: "Arachnids",
    apiEndpoint: "class/Arachnida",
    estimatedDescribed: 112000,
    estimatedSource: "World Spider Catalog 2024",
    dataFile: "redlist-arachnida.json",
    color: "#a855f7", // purple-500
  },
  {
    id: "malacostraca",
    name: "Crustaceans",
    apiEndpoint: "class/Malacostraca",
    estimatedDescribed: 40000,
    estimatedSource: "WoRMS 2024",
    dataFile: "redlist-malacostraca.json",
    color: "#ec4899", // pink-500
  },
  {
    id: "gastropoda",
    name: "Snails & Slugs",
    apiEndpoint: "class/Gastropoda",
    estimatedDescribed: 65000,
    estimatedSource: "MolluscaBase 2024",
    dataFile: "redlist-gastropoda.json",
    color: "#78716c", // stone-500
  },
  {
    id: "bivalvia",
    name: "Bivalves",
    apiEndpoint: "class/Bivalvia",
    estimatedDescribed: 9200,
    estimatedSource: "MolluscaBase 2024",
    dataFile: "redlist-bivalvia.json",
    color: "#0ea5e9", // sky-500
  },
  {
    id: "anthozoa",
    name: "Corals & Anemones",
    apiEndpoint: "class/Anthozoa",
    estimatedDescribed: 7500,
    estimatedSource: "WoRMS 2024",
    dataFile: "redlist-anthozoa.json",
    color: "#f43f5e", // rose-500
  },
];

// Map for quick lookup by ID
export const TAXA_BY_ID: Record<string, TaxonConfig> = Object.fromEntries(
  TAXA.map((t) => [t.id, t])
);

// Get taxon by ID, with fallback to plantae
export function getTaxonConfig(id: string): TaxonConfig {
  return TAXA_BY_ID[id] || TAXA_BY_ID["plantae"];
}

// IUCN category colors (shared across all taxa)
export const CATEGORY_COLORS: Record<string, string> = {
  EX: "#000000",
  EW: "#542344",
  CR: "#d81e05",
  EN: "#fc7f3f",
  VU: "#f9e814",
  NT: "#cce226",
  LC: "#60c659",
  DD: "#6b7280",
};

// Category order for sorting (most threatened first)
export const CATEGORY_ORDER: Record<string, number> = {
  EX: 0,
  EW: 1,
  CR: 2,
  EN: 3,
  VU: 4,
  NT: 5,
  LC: 6,
  DD: 7,
};

// Category full names
export const CATEGORY_NAMES: Record<string, string> = {
  EX: "Extinct",
  EW: "Extinct in the Wild",
  CR: "Critically Endangered",
  EN: "Endangered",
  VU: "Vulnerable",
  NT: "Near Threatened",
  LC: "Least Concern",
  DD: "Data Deficient",
};
