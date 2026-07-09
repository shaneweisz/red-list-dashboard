/**
 * Overrides layered on top of a node's own SpeciesFilter when computing its
 * Catalogue-of-Life-derived "described species" count (colDescribed) — used by
 * scripts/build-taxa-summary.ts (which needs the raw name lists to build SQL) and by
 * the frontend (which needs human-readable notes to explain a number that would
 * otherwise look unexplained, e.g. "why does Bison SG show a number at all when its
 * filter is genus: bison and Catalogue of Life has no genus Bison?").
 *
 * Kept in one place so the two stay in sync — a name added here for the SQL exclusion
 * automatically shows up in the tooltip note too, instead of two lists silently drifting.
 */

// Domestic/feral forms that would otherwise inflate a CoL-derived "described species"
// count for the SSC group whose genus/family they fall under — e.g. Canid SG (family
// Canidae) would count the domestic dog as one of its described species. Each name here
// has a wild-form sibling species confirmed present separately in the CoL backbone
// (verified directly against data/species/), so excluding the domestic form doesn't
// lose real wild-species coverage:
//   Bos taurus (domestic cattle) — sibling: Bos primigenius (aurochs)
//   Bos frontalis (gayal/mithun, domesticated from gaur) — sibling: Bos gaurus
//   Canis familiaris (domestic dog) — sibling: Canis lupus
//   Equus caballus (domestic horse) — sibling: Equus ferus
//   Equus asinus (domestic donkey) — sibling: Equus africanus
//   Felis catus (domestic cat) — sibling: Felis lybica
//   Vicugna pacos (domestic alpaca) — sibling: Vicugna vicugna
// NOT excluded, deliberately: Lama glama (domestic llama). Its wild sibling, the
// guanaco (Lama guanicoe), is missing from this CoL release entirely — excluding
// glama would drop Wild Camelid SG's CoL count further rather than fixing it. Also
// not excluded: Sus scrofa, Bubalus bubalis — CoL treats these as a single species
// spanning both wild and domestic populations (no separate wild-only accepted name),
// so excluding them would remove genuine wild-population coverage, not just the
// domestic form.
export const COL_DOMESTIC_EXCLUDE_NAMES = [
  "bos taurus", "bos frontalis", "canis familiaris", "equus caballus",
  "equus asinus", "felis catus", "vicugna pacos",
];

// CoL lumps genus Bison entirely into Bos (no "Bison" genus exists in this release —
// verified directly), so the Bison SG filter (genera: ["bison"]) matches zero CoL rows.
// Override its CoL computation to match by species name instead of genus. The same two
// names are added to the domestic-exclude list's effect for every OTHER node (via
// COL_EXCLUDE_ALL_NODES) so Afro-Asian Wild Cattle SG — whose own genus filter
// (bos/bubalus/pseudoryx) would otherwise also match them — doesn't double-count.
export const COL_SPECIES_NAME_OVERRIDES: Record<string, string[]> = {
  "ssc-bison": ["bos bison", "bos bonasus"],
};

export const COL_EXCLUDE_ALL_NODES = [
  ...COL_DOMESTIC_EXCLUDE_NAMES,
  ...COL_SPECIES_NAME_OVERRIDES["ssc-bison"],
];

// Short, human-readable explanations for the "# Described Species" hover tooltip —
// only needed for nodes where the CoL-derived count involves one of the overrides
// above (a plain filter description, generated separately, covers everything else).
export const COL_NODE_TOOLTIP_NOTES: Record<string, string> = {
  "ssc-bison": "Catalogue of Life classifies Bison within genus Bos, so this count matches by species name (Bos bison, Bos bonasus) instead of genus.",
  "ssc-afro-asian-wild-cattle": "Excludes the domestic cow (Bos taurus) and gayal (Bos frontalis), and Bison (Bos bison, Bos bonasus — counted separately under Bison SG).",
  "ssc-canid": "Excludes the domestic dog (Canis familiaris).",
  "ssc-cat": "Excludes the domestic cat (Felis catus).",
  "ssc-equid": "Excludes the domestic horse (Equus caballus) and donkey (Equus asinus).",
  "ssc-wild-camelid": "Excludes the domestic alpaca (Vicugna pacos). The wild guanaco (Lama guanicoe) is missing from this Catalogue of Life release entirely, so this figure likely undercounts by one species.",
  "ssc-hippo": "The pygmy hippopotamus (Choeropsis liberiensis) is missing from this Catalogue of Life release entirely — this figure undercounts by one species. No filter fix is possible; flagging this for Catalogue of Life is the only real fix.",
};

// A handful of nodes have a filter too broad/exclusion-heavy to summarize
// automatically in a readable sentence — a custom base description instead of the
// auto-generated one from their SpeciesFilter fields.
export const NODE_DESCRIPTION_OVERRIDES: Record<string, string> = {
  "ssc-other-mammals": "Mammal orders, families, and genera not claimed by any of the 35 named SSC pilot groups above.",
};
