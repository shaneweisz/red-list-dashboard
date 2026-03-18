/**
 * File-backed data layer for species and taxa summary.
 *
 * Reads per-taxon CSV files and taxa-summary.json produced by the sync scripts.
 * Caches in memory for the process lifetime (on Vercel = per cold start).
 */

import * as fs from "fs";
import * as path from "path";
import { readCsv } from "./csv";

// =============================================================================
// PATHS
// =============================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const REDLIST_DIR = path.join(DATA_DIR, "redlist");
const GBIF_DIR = path.join(DATA_DIR, "gbif");
const TAXA_SUMMARY_PATH = path.join(DATA_DIR, "taxa-summary.json");

// =============================================================================
// TYPES
// =============================================================================

interface RedlistRow {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  common_name: string | null;
  class_name: string | null;
  order_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string;
  population_trend: string | null;
  countries: string[];
  taxon_group_table1a: string;
}

interface MappingRow {
  sis_taxon_id: number;
  gbif_species_key: number | null;
  match_type: string;
}

interface GbifRow {
  gbif_species_key: number;
  scientific_name: string;
  common_name: string;
  taxon_group_table1a: string;
  total_count: number;
  count_after_assessment_year: number | null;
  class_name: string;
  order_name: string;
  family: string;
  countries: string[];
}

export interface PreviousAssessment {
  id: number;
  year: string;
  category: string;
  date: string | null;
  assessors: string | null;
  reviewers: string | null;
}

export interface SpeciesRow {
  id: number;
  sis_taxon_id: number | null;
  assessment_id: number | null;
  scientific_name: string;
  common_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string | null;
  population_trend: string | null;
  countries: string[];
  class_name: string | null;
  order_name: string | null;
  taxon_group: string;
  taxon_id: string;
  gbif_species_key: number | null;
  gbif_occurrence_count: number | null;
  gbif_observations_after_assessment_year: number | null;
  previous_assessments: PreviousAssessment[];
}

export interface TaxaSummaryRow {
  table1a_taxon_group: string;
  total_assessed: number;
  outdated: number;
  by_category: Record<string, number>;
  gbif_species_count: number;
  gbif_ne_species_count: number;
  total_gbif_observations: number;
  mean_gbif_obs: number;
  median_gbif_obs: number | null;
}

// =============================================================================
// DB_GROUP → DISPLAY TAXON ID
// =============================================================================

const DB_GROUP_TO_TAXON_ID: Record<string, string> = {
  fishes: "fishes",
  insecta: "invertebrates",
  arachnida: "invertebrates",
  mollusca: "invertebrates",
  crustacea: "invertebrates",
  corals: "invertebrates",
  other_invertebrates: "invertebrates",
  velvet_worms: "invertebrates",
  horseshoe_crabs: "invertebrates",
  flowering_plants: "plantae",
  gymnosperms: "plantae",
  ferns_and_allies: "plantae",
  mosses: "plantae",
  green_algae: "plantae",
  red_algae: "plantae",
  brown_algae: "plantae",
  mushrooms: "fungi",
};

function mapTaxonId(group: string): string {
  return DB_GROUP_TO_TAXON_ID[group] ?? group;
}

// =============================================================================
// CSV PARSERS
// =============================================================================

function parseRedlistRow(r: Record<string, string>): RedlistRow {
  return {
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    assessment_id: parseInt(r.assessment_id, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || null,
    class_name: r.class_name || null,
    order_name: r.order_name || null,
    family: r.family || null,
    category: r.iucn_category || "",
    assessment_date: r.assessment_date || null,
    year_published: r.year_published || "",
    population_trend: r.population_trend || null,
    countries: r.countries ? r.countries.split(";").filter(Boolean) : [],
    taxon_group_table1a: r.taxon_group_table1a,
  };
}

function parseMappingRow(r: Record<string, string>): MappingRow {
  return {
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    gbif_species_key: r.gbif_species_key ? parseInt(r.gbif_species_key, 10) : null,
    match_type: r.match_type || "",
  };
}

function parseGbifRow(r: Record<string, string>): GbifRow {
  return {
    gbif_species_key: parseInt(r.gbif_species_key, 10),
    scientific_name: r.scientific_name,
    common_name: r.common_name || "",
    taxon_group_table1a: r.taxon_group_table1a,
    total_count: parseInt(r.total_count, 10) || 0,
    count_after_assessment_year: r.count_after_assessment_year ? parseInt(r.count_after_assessment_year, 10) : null,
    class_name: r.class_name || "",
    order_name: r.order_name || "",
    family: r.family || "",
    countries: r.countries ? r.countries.split(";").filter(Boolean) : [],
  };
}

// =============================================================================
// CACHE
// =============================================================================

type HistoryMap = Record<string, PreviousAssessment[]>;

const redlistCache = new Map<string, RedlistRow[]>();
const gbifCache = new Map<string, Map<number, GbifRow>>();
const historyCache = new Map<string, HistoryMap>();
let mappingCache: Map<number, { gbif_species_key: number | null; match_type: string }> | null = null;
let taxaSummaryCache: TaxaSummaryRow[] | null = null;

function loadMapping(): Map<number, { gbif_species_key: number | null; match_type: string }> {
  if (mappingCache) return mappingCache;
  const csvPath = path.join(DATA_DIR, "mapping.csv");
  if (!fs.existsSync(csvPath)) {
    mappingCache = new Map();
    return mappingCache;
  }
  const rows = readCsv(csvPath, parseMappingRow);
  const map = new Map<number, { gbif_species_key: number | null; match_type: string }>();
  for (const row of rows) {
    map.set(row.sis_taxon_id, { gbif_species_key: row.gbif_species_key, match_type: row.match_type });
  }
  mappingCache = map;
  return mappingCache;
}

function loadRedlistForGroup(group: string): RedlistRow[] {
  if (redlistCache.has(group)) return redlistCache.get(group)!;
  const csvPath = path.join(REDLIST_DIR, `${group}.csv`);
  if (!fs.existsSync(csvPath)) {
    redlistCache.set(group, []);
    return [];
  }
  const rows = readCsv(csvPath, parseRedlistRow);
  redlistCache.set(group, rows);
  return rows;
}

function loadHistoryForGroup(group: string): HistoryMap {
  if (historyCache.has(group)) return historyCache.get(group)!;
  const jsonPath = path.join(REDLIST_DIR, "history", `${group}.json`);
  if (!fs.existsSync(jsonPath)) {
    historyCache.set(group, {});
    return {};
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as HistoryMap;
  historyCache.set(group, data);
  return data;
}

function loadGbifForGroup(group: string): Map<number, GbifRow> {
  if (gbifCache.has(group)) return gbifCache.get(group)!;
  const csvPath = path.join(GBIF_DIR, `${group}.csv`);
  if (!fs.existsSync(csvPath)) {
    const empty = new Map<number, GbifRow>();
    gbifCache.set(group, empty);
    return empty;
  }
  const rows = readCsv(csvPath, parseGbifRow);
  const map = new Map<number, GbifRow>();
  for (const row of rows) map.set(row.gbif_species_key, row);
  gbifCache.set(group, map);
  return map;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get merged species rows for the given taxon groups.
 * Each redlist species gets GBIF counts attached. GBIF-only species become NE rows.
 */
export function getSpecies(groups: string[], includeNE: boolean): SpeciesRow[] {
  const results: SpeciesRow[] = [];
  const linkedGbifKeys = new Set<number>();

  const mapping = loadMapping();

  for (const group of groups) {
    const redlistRows = loadRedlistForGroup(group);
    const gbifMap = loadGbifForGroup(group);
    const historyMap = loadHistoryForGroup(group);

    for (const r of redlistRows) {
      let gbifOccurrenceCount: number | null = null;
      let gbifObsAfterAssessment: number | null = null;
      const gbifSpeciesKey = mapping.get(r.sis_taxon_id)?.gbif_species_key ?? null;

      if (gbifSpeciesKey) {
        const gbif = gbifMap.get(gbifSpeciesKey);
        if (gbif) {
          gbifOccurrenceCount = gbif.total_count;
          gbifObsAfterAssessment = gbif.count_after_assessment_year;
          linkedGbifKeys.add(gbifSpeciesKey);
        }
      }

      const previousAssessments = historyMap[String(r.sis_taxon_id)] ?? [];

      results.push({
        id: r.sis_taxon_id,
        sis_taxon_id: r.sis_taxon_id,
        assessment_id: r.assessment_id,
        scientific_name: r.scientific_name,
        common_name: r.common_name,
        family: r.family,
        category: r.category,
        assessment_date: r.assessment_date,
        year_published: r.year_published,
        population_trend: r.population_trend,
        countries: r.countries,
        class_name: r.class_name,
        order_name: r.order_name,
        taxon_group: r.taxon_group_table1a,
        taxon_id: mapTaxonId(r.taxon_group_table1a),
        gbif_species_key: gbifSpeciesKey,
        gbif_occurrence_count: gbifOccurrenceCount,
        gbif_observations_after_assessment_year: gbifObsAfterAssessment,
        previous_assessments: previousAssessments,
      });
    }

    // Add NE species (GBIF-only, not linked to any redlist entry)
    if (includeNE) {
      for (const [key, gbif] of gbifMap) {
        if (linkedGbifKeys.has(key)) continue;
        results.push({
          id: -key, // Negated to avoid collision with sis_taxon_id
          sis_taxon_id: null,
          assessment_id: null,
          scientific_name: gbif.scientific_name,
          common_name: gbif.common_name || null,
          family: gbif.family || null,
          category: "NE",
          assessment_date: null,
          year_published: null,
          population_trend: null,
          countries: gbif.countries,
          class_name: gbif.class_name || null,
          order_name: gbif.order_name || null,
          taxon_group: gbif.taxon_group_table1a,
          taxon_id: mapTaxonId(gbif.taxon_group_table1a),
          gbif_species_key: gbif.gbif_species_key,
          gbif_occurrence_count: gbif.total_count,
          gbif_observations_after_assessment_year: gbif.count_after_assessment_year,
          previous_assessments: [],
        });
      }
    }
  }

  return results;
}

/**
 * Get taxa summary rows from the pre-computed JSON file.
 */
export function getTaxaSummary(): TaxaSummaryRow[] {
  if (taxaSummaryCache) return taxaSummaryCache;
  const content = fs.readFileSync(TAXA_SUMMARY_PATH, "utf-8");
  taxaSummaryCache = JSON.parse(content) as TaxaSummaryRow[];
  return taxaSummaryCache;
}

// =============================================================================
// DYNAMIC TAXONOMY DRILL-DOWN
// =============================================================================

/**
 * Taxonomic ranks available for drill-down, in hierarchical order.
 * Genus is derived from the first word of scientific_name.
 */
export const TAXONOMY_RANKS = ["class", "order", "family", "genus"] as const;
export type TaxonomyRank = (typeof TAXONOMY_RANKS)[number];

export interface DrillChild {
  /** The rank value (e.g. "Rodentia") — as found in the data */
  value: string;
  /** The rank this child represents */
  rank: TaxonomyRank;
  /** Number of assessed species */
  totalAssessed: number;
  /** Number of outdated assessments */
  outdated: number;
  /** NE species on GBIF */
  gbifNeSpeciesCount: number;
  /** Breakdown by IUCN category */
  byCategory: Record<string, number>;
  /** Whether this node can be drilled further */
  hasChildren: boolean;
  /** A representative common name for display, if available */
  representativeCommonName: string | null;
}

/**
 * A step in the drill path, e.g. { rank: "order", value: "rodentia" }.
 */
export interface DrillStep {
  rank: TaxonomyRank;
  value: string;
}

function extractGenus(scientificName: string): string {
  return scientificName.split(" ")[0] || "";
}

function getRankValue(
  row: { class_name: string | null; order_name: string | null; family: string | null; scientific_name: string },
  rank: TaxonomyRank,
): string {
  switch (rank) {
    case "class": return (row.class_name ?? "").toLowerCase();
    case "order": return (row.order_name ?? "").toLowerCase();
    case "family": return (row.family ?? "").toLowerCase();
    case "genus": return extractGenus(row.scientific_name).toLowerCase();
  }
}

function getDisplayRankValue(
  row: { class_name: string | null; order_name: string | null; family: string | null; scientific_name: string },
  rank: TaxonomyRank,
): string {
  switch (rank) {
    case "class": return row.class_name ?? "";
    case "order": return row.order_name ?? "";
    case "family": return row.family ?? "";
    case "genus": return extractGenus(row.scientific_name);
  }
}

/**
 * Given a taxon's CSV groups and a drill path, return children at the next rank.
 *
 * Examples:
 * - getDrillChildren(["mammalia"], []) → classes within Mammalia
 * - getDrillChildren(["mammalia"], [{rank:"class", value:"mammalia"}]) → orders
 * - getDrillChildren(["mammalia"], [{rank:"class", value:"mammalia"}, {rank:"order", value:"rodentia"}]) → families
 */
export function getDrillChildren(
  groups: string[],
  drillPath: DrillStep[],
): DrillChild[] {
  const lastRank = drillPath.length > 0 ? drillPath[drillPath.length - 1].rank : null;
  const lastRankIdx = lastRank ? TAXONOMY_RANKS.indexOf(lastRank) : -1;
  const nextRankIdx = lastRankIdx + 1;

  if (nextRankIdx >= TAXONOMY_RANKS.length) {
    return [];
  }

  const nextRank = TAXONOMY_RANKS[nextRankIdx];
  const canDrillFurther = nextRankIdx + 1 < TAXONOMY_RANKS.length;

  const allRows: RedlistRow[] = [];
  for (const group of groups) {
    allRows.push(...loadRedlistForGroup(group));
  }

  const mapping = loadMapping();
  const linkedGbifKeys = new Set<number>();
  for (const row of allRows) {
    const entry = mapping.get(row.sis_taxon_id);
    if (entry?.gbif_species_key != null) linkedGbifKeys.add(entry.gbif_species_key);
  }

  const filteredRows = allRows.filter(row => {
    for (const step of drillPath) {
      if (getRankValue(row, step.rank) !== step.value.toLowerCase()) return false;
    }
    return true;
  });

  const childMap = new Map<string, {
    displayValue: string;
    totalAssessed: number;
    outdated: number;
    byCategory: Record<string, number>;
    commonNames: Map<string, number>;
    subValues: Set<string>;
  }>();

  const belowRank = canDrillFurther ? TAXONOMY_RANKS[nextRankIdx + 1] : null;

  for (const row of filteredRows) {
    const val = getRankValue(row, nextRank);
    if (!val) continue;

    let entry = childMap.get(val);
    if (!entry) {
      entry = {
        displayValue: getDisplayRankValue(row, nextRank),
        totalAssessed: 0,
        outdated: 0,
        byCategory: {},
        commonNames: new Map(),
        subValues: new Set(),
      };
      childMap.set(val, entry);
    }

    entry.totalAssessed++;
    if (isOutdated(row.assessment_date)) entry.outdated++;
    const cat = row.category;
    if (cat) entry.byCategory[cat] = (entry.byCategory[cat] ?? 0) + 1;

    if (row.common_name) {
      entry.commonNames.set(row.common_name, (entry.commonNames.get(row.common_name) ?? 0) + 1);
    }

    if (belowRank) {
      const subVal = getRankValue(row, belowRank);
      if (subVal) entry.subValues.add(subVal);
    }
  }

  const gbifNeCounts = new Map<string, number>();
  for (const group of groups) {
    const gbifMap = loadGbifForGroup(group);
    for (const [key, gbifRow] of gbifMap) {
      if (linkedGbifKeys.has(key)) continue;

      let matches = true;
      for (const step of drillPath) {
        if (getRankValue(gbifRow, step.rank) !== step.value.toLowerCase()) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;

      const val = getRankValue(gbifRow, nextRank);
      if (!val) continue;
      gbifNeCounts.set(val, (gbifNeCounts.get(val) ?? 0) + 1);
    }
  }

  const results: DrillChild[] = [];
  for (const [val, entry] of childMap) {
    let representativeCommonName: string | null = null;
    if (entry.commonNames.size > 0) {
      let maxCount = 0;
      for (const [name, count] of entry.commonNames) {
        if (count > maxCount) {
          maxCount = count;
          representativeCommonName = name;
        }
      }
    }

    results.push({
      value: entry.displayValue || val,
      rank: nextRank,
      totalAssessed: entry.totalAssessed,
      outdated: entry.outdated,
      gbifNeSpeciesCount: gbifNeCounts.get(val) ?? 0,
      byCategory: entry.byCategory,
      hasChildren: canDrillFurther && entry.subValues.size > 1,
      representativeCommonName,
    });
  }

  results.sort((a, b) => b.totalAssessed - a.totalAssessed);

  return results;
}

// =============================================================================
// SUBGROUP SUMMARIES
// =============================================================================

export interface SubGroupSummary {
  id: string;
  name: string;
  estimatedDescribed: number;
  totalAssessed: number;
  outdated: number;
  gbifNeSpeciesCount: number;
  byCategory: Record<string, number>;
}

interface SubGroupFilter {
  groups: string[];
  classNames?: string[];
  orderNames?: string[];
  excludeOrders?: string[];
}

interface SubGroupDef {
  id: string;
  name: string;
  estimatedDescribed: number;
  source: string;
  sourceUrl: string;
  filter: SubGroupFilter;
}

const CURRENT_YEAR = new Date().getFullYear();
const OUTDATED_THRESHOLD_YEARS = 10;

/**
 * Is an assessment outdated? Uses the same logic as build-taxa-summary.ts:
 * outdated if assessment_date is >10 years ago, or if assessment_date is missing.
 */
export function isOutdated(assessmentDate: string | null, currentYear = CURRENT_YEAR): boolean {
  if (!assessmentDate) return true; // No date → treat as outdated
  const year = parseInt(assessmentDate.slice(0, 4), 10);
  if (isNaN(year)) return true;
  return currentYear - year > OUTDATED_THRESHOLD_YEARS;
}

function matchesFilter(row: { class_name: string | null; order_name: string | null }, filter: SubGroupFilter): boolean {
  // Check class filter
  if (filter.classNames && filter.classNames.length > 0) {
    const cls = (row.class_name ?? "").toLowerCase();
    if (!filter.classNames.includes(cls)) return false;
  }
  // Check order include filter
  // Fall back to class_name when order_name is empty (GBIF taxonomy quirk)
  if (filter.orderNames && filter.orderNames.length > 0) {
    const ord = (row.order_name ?? "").toLowerCase();
    const cls = (row.class_name ?? "").toLowerCase();
    if (!filter.orderNames.includes(ord) && !(ord === "" && filter.orderNames.includes(cls))) return false;
  }
  // Check order exclude filter (same class_name fallback)
  if (filter.excludeOrders && filter.excludeOrders.length > 0) {
    const ord = (row.order_name ?? "").toLowerCase();
    const cls = (row.class_name ?? "").toLowerCase();
    if (filter.excludeOrders.includes(ord) || (ord === "" && filter.excludeOrders.includes(cls))) return false;
  }
  return true;
}

/**
 * Compute summary stats for each subgroup by filtering the actual CSV data.
 */
export function getSubgroupSummaries(subgroups: SubGroupDef[]): SubGroupSummary[] {
  // Deduplicate: figure out which CSV groups we need to load
  const allGroups = new Set<string>();
  for (const sg of subgroups) {
    for (const g of sg.filter.groups) allGroups.add(g);
  }

  // Load all needed CSV rows, grouped by their table1a group
  const rowsByGroup = new Map<string, RedlistRow[]>();
  const gbifByGroup = new Map<string, Map<number, GbifRow>>();
  for (const group of allGroups) {
    rowsByGroup.set(group, loadRedlistForGroup(group));
    gbifByGroup.set(group, loadGbifForGroup(group));
  }

  // Build set of linked GBIF keys (assessed species with GBIF matches)
  const mapping = loadMapping();
  const linkedGbifKeys = new Set<number>();
  for (const entry of mapping.values()) {
    if (entry.gbif_species_key != null) linkedGbifKeys.add(entry.gbif_species_key);
  }

  // Track which rows from "other_invertebrates" are claimed by specific subgroups
  // so the catch-all "Other Invertebrates" subgroup can exclude them
  const claimedRowIds = new Set<number>();
  const claimedGbifKeys = new Set<number>();

  const results: SubGroupSummary[] = [];

  for (const sg of subgroups) {
    let totalAssessed = 0;
    let outdated = 0;
    let gbifNeSpeciesCount = 0;
    const byCategory: Record<string, number> = {};

    const isOtherInvertsCatchAll =
      sg.id === "other-invertebrates" &&
      sg.filter.groups.includes("other_invertebrates");

    for (const group of sg.filter.groups) {
      const rows = rowsByGroup.get(group) ?? [];
      for (const row of rows) {
        if (!matchesFilter(row, sg.filter)) continue;

        // For the "Other Invertebrates" catch-all, skip rows claimed by
        // echinoderms/worms subgroups
        if (isOtherInvertsCatchAll && group === "other_invertebrates") {
          if (claimedRowIds.has(row.sis_taxon_id)) continue;
        }

        totalAssessed++;
        if (isOutdated(row.assessment_date)) outdated++;
        const cat = row.category;
        if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      }

      // Count NE (unassessed) GBIF species
      const gbifMap = gbifByGroup.get(group) ?? new Map();
      for (const [key, gbifRow] of gbifMap) {
        if (linkedGbifKeys.has(key)) continue;
        if (!matchesFilter(gbifRow, sg.filter)) continue;
        if (isOtherInvertsCatchAll && group === "other_invertebrates") {
          if (claimedGbifKeys.has(key)) continue;
        }
        gbifNeSpeciesCount++;
      }
    }

    // If this is echinoderms or worms, record which other_invertebrates rows
    // were claimed so the catch-all can skip them
    if (
      sg.id !== "other-invertebrates" &&
      sg.filter.groups.includes("other_invertebrates") &&
      (sg.filter.classNames || sg.filter.orderNames)
    ) {
      const rows = rowsByGroup.get("other_invertebrates") ?? [];
      for (const row of rows) {
        if (matchesFilter(row, sg.filter)) {
          claimedRowIds.add(row.sis_taxon_id);
        }
      }
      const gbifMap = gbifByGroup.get("other_invertebrates") ?? new Map();
      for (const [key, gbifRow] of gbifMap) {
        if (!linkedGbifKeys.has(key) && matchesFilter(gbifRow, sg.filter)) {
          claimedGbifKeys.add(key);
        }
      }
    }

    results.push({
      id: sg.id,
      name: sg.name,
      estimatedDescribed: sg.estimatedDescribed,
      totalAssessed,
      outdated,
      gbifNeSpeciesCount,
      byCategory,
    });
  }

  return results;
}
