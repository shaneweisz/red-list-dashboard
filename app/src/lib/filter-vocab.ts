/**
 * Filter vocabulary + human-friendly value resolution.
 *
 * Single source of truth for the /browse endpoint and llms.txt. Lets an LLM
 * (or human) use plain-English values — "climate-change", "endangered",
 * "birds", "Brazil" — instead of internal codes, and lets us render codes
 * back as labels in output so the codebook is never required either way.
 */

import { CATEGORY_NAMES } from "@/config/taxa";
import { findNode } from "@/lib/taxonomy-utils";
import { canonicalizeTaxonId } from "@/lib/data/taxonomy-constants";
import { resolveCountryToAlpha2, ALPHA2_TO_NAME } from "@/lib/countries";

// ─── Threats (IUCN threat classification) ────────────────────────────────

/** IUCN threat classification hierarchy (moved from RedListView). */
export const THREAT_CATEGORIES: { code: string; label: string; children: { code: string; label: string }[] }[] = [
  { code: "1", label: "Development", children: [
    { code: "1.1", label: "Housing & urban areas" }, { code: "1.2", label: "Commercial & industrial areas" }, { code: "1.3", label: "Tourism & recreation areas" },
  ]},
  { code: "2", label: "Agriculture", children: [
    { code: "2.1", label: "Crops" }, { code: "2.2", label: "Wood & pulp plantations" }, { code: "2.3", label: "Livestock farming & ranching" }, { code: "2.4", label: "Aquaculture" },
  ]},
  { code: "3", label: "Energy & Mining", children: [
    { code: "3.1", label: "Oil & gas drilling" }, { code: "3.2", label: "Mining & quarrying" }, { code: "3.3", label: "Renewable energy" },
  ]},
  { code: "4", label: "Transport", children: [
    { code: "4.1", label: "Roads & railroads" }, { code: "4.2", label: "Utility & service lines" }, { code: "4.3", label: "Shipping lanes" }, { code: "4.4", label: "Flight paths" },
  ]},
  { code: "5", label: "Harvesting", children: [
    { code: "5.1", label: "Hunting & trapping" }, { code: "5.2", label: "Gathering plants" }, { code: "5.3", label: "Logging & wood harvesting" }, { code: "5.4", label: "Fishing & harvesting" },
  ]},
  { code: "6", label: "Disturbance", children: [
    { code: "6.1", label: "Recreational activities" }, { code: "6.2", label: "War & military" }, { code: "6.3", label: "Work & other activities" },
  ]},
  { code: "7", label: "System modifications", children: [
    { code: "7.1", label: "Fire & fire suppression" }, { code: "7.2", label: "Dams & water management" }, { code: "7.3", label: "Other modifications" },
  ]},
  { code: "8", label: "Invasive species", children: [
    { code: "8.1", label: "Invasive non-native species" }, { code: "8.2", label: "Problematic native species" }, { code: "8.3", label: "Introduced genetic material" }, { code: "8.4", label: "Unknown origin species" }, { code: "8.5", label: "Viral/prion diseases" }, { code: "8.6", label: "Diseases of unknown cause" },
  ]},
  { code: "9", label: "Pollution", children: [
    { code: "9.1", label: "Domestic & urban waste water" }, { code: "9.2", label: "Industrial & military effluents" }, { code: "9.3", label: "Agricultural & forestry effluents" },
    { code: "9.4", label: "Garbage & solid waste" }, { code: "9.5", label: "Air-borne pollutants" }, { code: "9.6", label: "Excess energy (light, thermal, noise)" },
  ]},
  { code: "10", label: "Geological events", children: [
    { code: "10.1", label: "Volcanoes" }, { code: "10.2", label: "Earthquakes/tsunamis" }, { code: "10.3", label: "Avalanches/landslides" },
  ]},
  { code: "11", label: "Climate change", children: [
    { code: "11.1", label: "Habitat shifting & alteration" }, { code: "11.2", label: "Droughts" }, { code: "11.3", label: "Temperature extremes" }, { code: "11.4", label: "Storms & flooding" }, { code: "11.5", label: "Other impacts" },
  ]},
  { code: "12", label: "Other", children: [
    { code: "12.1", label: "Other threat" },
  ]},
];

/** code → label, including sub-codes. */
export const THREAT_LABEL: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of THREAT_CATEGORIES) {
    m[c.code] = c.label;
    for (const sub of c.children) m[sub.code] = sub.label;
  }
  return m;
})();

/** Human label for a threat code, walking up to the nearest known parent for
 *  deep sub-codes (e.g. "5.4.1" → "Fishing & harvesting"). Never returns a bare
 *  number when a labelled ancestor exists. */
export function threatDisplay(code: string): string {
  if (THREAT_LABEL[code]) return THREAT_LABEL[code];
  const parts = code.split(".");
  while (parts.length > 1) {
    parts.pop();
    const parent = parts.join(".");
    if (THREAT_LABEL[parent]) return THREAT_LABEL[parent];
  }
  return code;
}

const slugify = (v: string) => v.trim().toLowerCase().replace(/[\s_]+/g, "-");

// Informal names → top-level threat code.
const THREAT_ALIASES: Record<string, string> = {
  "climate-change": "11", "climate": "11", "global-warming": "11", "warming": "11",
  "pollution": "9",
  "invasive-species": "8", "invasives": "8", "invasive": "8", "disease": "8", "diseases": "8", "pathogens": "8",
  "harvesting": "5", "overharvesting": "5",
  "overfishing": "5.4", "fishing": "5.4",
  "hunting": "5.1", "poaching": "5.1", "trapping": "5.1",
  "logging": "5.3", "deforestation": "5.3",
  "agriculture": "2", "farming": "2", "crops": "2.1",
  "development": "1", "urbanisation": "1", "urbanization": "1", "housing": "1.1",
  "mining": "3.2", "energy": "3", "oil-and-gas": "3.1",
  "transport": "4", "roads": "4.1", "shipping": "4.3",
  "dams": "7.2", "fire": "7.1",
  "geological-events": "10", "volcanoes": "10.1", "earthquakes": "10.2",
  "droughts": "11.2", "storms": "11.4", "flooding": "11.4", "temperature-extremes": "11.3",
};

// label (lowercased) → code, for matching full labels.
const THREAT_LABEL_TO_CODE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [code, label] of Object.entries(THREAT_LABEL)) m[label.toLowerCase()] = code;
  return m;
})();

export function resolveThreats(values: string[]): { codes: string[]; unresolved: string[] } {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    if (/^\d+(\.\d+)*$/.test(v) && THREAT_LABEL[v]) { codes.add(v); continue; }
    const slug = slugify(v);
    if (THREAT_ALIASES[slug]) { codes.add(THREAT_ALIASES[slug]); continue; }
    if (THREAT_LABEL_TO_CODE[v.toLowerCase()]) { codes.add(THREAT_LABEL_TO_CODE[v.toLowerCase()]); continue; }
    unresolved.push(raw);
  }
  return { codes: [...codes], unresolved };
}

// ─── IUCN categories ─────────────────────────────────────────────────────

const CATEGORY_ALIASES: Record<string, string[]> = {
  "extinct": ["EX", "EW"], "extinct-in-the-wild": ["EW"],
  "critically-endangered": ["CR"], "critical": ["CR"],
  "endangered": ["EN"],
  "vulnerable": ["VU"],
  "threatened": ["CR", "EN", "VU"],
  "near-threatened": ["NT"],
  "least-concern": ["LC"],
  "data-deficient": ["DD"],
  "not-evaluated": ["NE"],
};

const CATEGORY_NAME_TO_CODE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [code, name] of Object.entries(CATEGORY_NAMES)) m[name.toLowerCase()] = code;
  return m;
})();

export function resolveCategories(values: string[]): { codes: string[]; unresolved: string[] } {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const upper = v.toUpperCase();
    if (CATEGORY_NAMES[upper]) { codes.add(upper); continue; }
    const slug = slugify(v);
    if (CATEGORY_ALIASES[slug]) { CATEGORY_ALIASES[slug].forEach((c) => codes.add(c)); continue; }
    if (CATEGORY_NAME_TO_CODE[v.toLowerCase()]) { codes.add(CATEGORY_NAME_TO_CODE[v.toLowerCase()]); continue; }
    unresolved.push(raw);
  }
  return { codes: [...codes], unresolved };
}

export function categoryLabel(code: string): string {
  return CATEGORY_NAMES[code] ? `${CATEGORY_NAMES[code]} (${code})` : code;
}

// ─── Taxa ────────────────────────────────────────────────────────────────

/** Featured top-level groups, shown in the index/llms.txt. Each id is a real
 *  taxonomy-tree node; display names come from the tree at runtime. */
export const FEATURED_TAXA: string[] = [
  "mammalia", "aves", "reptilia", "amphibia", "fishes",
  "insecta", "arachnida", "mollusca", "crustacea", "corals",
  "other_invertebrates", "velvet_worms", "horseshoe_crabs",
  "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
  "green_algae", "red_algae", "brown_algae", "mushrooms",
];

// Common English names → taxonomy node id.
const TAXA_ALIASES: Record<string, string> = {
  "mammals": "mammalia", "mammal": "mammalia",
  "birds": "aves", "bird": "aves",
  "reptiles": "reptilia", "reptile": "reptilia",
  "amphibians": "amphibia", "amphibian": "amphibia", "frogs": "amphibia", "frog": "amphibia", "toads": "amphibia",
  "fish": "fishes",
  "sharks": "sharks-rays", "rays": "sharks-rays", "sharks-and-rays": "sharks-rays",
  "insects": "insecta", "insect": "insecta",
  "beetles": "beetles", "butterflies": "butterflies-moths", "moths": "butterflies-moths", "bees": "bees-wasps-ants", "wasps": "bees-wasps-ants", "ants": "bees-wasps-ants",
  "spiders": "arachnida", "arachnids": "arachnida",
  "molluscs": "mollusca", "mollusks": "mollusca", "snails": "mollusca", "slugs": "mollusca",
  "crustaceans": "crustacea", "crabs": "crustacea", "crayfish": "crustacea",
  "coral": "corals",
  "plants": "flowering_plants", "plant": "flowering_plants", "flowers": "flowering_plants", "trees": "flowering_plants",
  "conifers": "gymnosperms",
  "ferns": "ferns_and_allies", "fern": "ferns_and_allies",
  "moss": "mosses",
  "fungi": "mushrooms", "mushroom": "mushrooms",
  "velvet-worms": "velvet_worms",
  "horseshoe-crabs": "horseshoe_crabs",
};

export function resolveTaxa(values: string[]): { ids: string[]; unresolved: string[] } {
  const ids = new Set<string>();
  const unresolved: string[] = [];
  // Resolve a candidate to a current node id, normalizing legacy/latin ids
  // (aves→birds, mammalia→mammals, …) via canonicalizeTaxonId so common-name
  // aliases that still point at the old ids (TAXA_ALIASES) land on the live node.
  const toNode = (c: string): string | null => {
    const canon = canonicalizeTaxonId(c.toLowerCase());
    return findNode(canon) ? canon : null;
  };
  for (const raw of values) {
    const v = raw.trim();
    if (!v || v.toLowerCase() === "all") { if (v) unresolved.push(raw); continue; }
    const underscored = v.toLowerCase().replace(/-/g, "_");
    const hyphenated = v.toLowerCase().replace(/_/g, "-");
    const slug = slugify(v);
    const hit =
      toNode(v) ?? toNode(underscored) ?? toNode(hyphenated) ??
      (TAXA_ALIASES[slug] ? toNode(TAXA_ALIASES[slug]) : null) ??
      (TAXA_ALIASES[underscored] ? toNode(TAXA_ALIASES[underscored]) : null);
    if (hit) { ids.add(hit); continue; }
    // Arbitrary-rank: a single scientific-name word (a class/order/family like
    // "felidae" or "odonata") isn't a curated node, but the read layer matches it
    // by rank (resolveWhere). Pass it through lowercased; a non-taxon just yields
    // zero results. Multi-word values are species names → use `search`, not `taxa`.
    if (/^[a-z]+$/i.test(v)) { ids.add(v.toLowerCase()); continue; }
    unresolved.push(raw);
  }
  return { ids: [...ids], unresolved };
}

export function taxonLabel(id: string): string {
  return findNode(id)?.name ?? id;
}

// ─── Countries ───────────────────────────────────────────────────────────

export function resolveCountries(values: string[]): { codes: string[]; unresolved: string[] } {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    const code = resolveCountryToAlpha2(v);
    if (code) codes.add(code);
    else unresolved.push(raw);
  }
  return { codes: [...codes], unresolved };
}

export function countryLabel(code: string): string {
  return ALPHA2_TO_NAME[code] ? `${ALPHA2_TO_NAME[code]} (${code})` : code;
}

// ─── Misc base-filter vocab (free-text, passed through as-is) ──────────────

export const SYSTEMS = ["Terrestrial", "Freshwater", "Marine"];
export const POPULATION_TRENDS = ["Increasing", "Stable", "Decreasing", "Unknown"];
export const ALL_CATEGORIES = Object.keys(CATEGORY_NAMES);
