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
// EXCLUDED DOMESTICATED SPECIES
// =============================================================================

/** GBIF species keys for domesticated species excluded from new assessments. */
const EXCLUDED_DOMESTICATED_GBIF_KEYS = new Set([
  2441022, // Bos taurus (Cow)
  2435035, // Felis catus (Cat)
  2441110, // Ovis aries (Domestic Sheep)
  2441056, // Capra hircus (Domestic Goat)
  2440886, // Equus caballus (Horse)
  7422937, // Bubalus bubalis (Water Buffalo)
  2440891, // Equus asinus (Donkey)
  9055455, // Camelus dromedarius (Arabian Camel)
  2441238, // Camelus bactrianus (Bactrian Camel)
  5220190, // Lama glama (Llama)
  7515593, // Vicugna pacos (Alpaca)
  2441019, // Bos grunniens (Yak)
  5219702, // Cavia porcellus (Guinea Pig)
  10694102, // Columba domestica (Domestic Pigeon)
  2436436, // Homo sapiens (Human)
]);

// =============================================================================
// PATHS
// =============================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const REDLIST_DIR = path.join(DATA_DIR, "redlist");
const GBIF_DIR = path.join(DATA_DIR, "gbif");
const TAXA_SUMMARY_PATH = path.join(DATA_DIR, "taxa-summary.json");
const NODE_CHILDREN_SUMMARIES_PATH = path.join(DATA_DIR, "node-children-summaries.json");

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
// DB_GROUP → DISPLAY TAXON ID (for the default 8-taxa view)
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
  brown_algae: "fungi",
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
let nodeChildrenSummariesCache: Record<string, NodeSummary[]> | null = null;

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
        if (EXCLUDED_DOMESTICATED_GBIF_KEYS.has(key)) continue;
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

/**
 * Get precomputed children summaries for a parent node.
 * Reads from data/node-children-summaries.json (cached in memory).
 */
export function getPrecomputedChildrenSummaries(parentNodeId: string): NodeSummary[] {
  if (!nodeChildrenSummariesCache) {
    const content = fs.readFileSync(NODE_CHILDREN_SUMMARIES_PATH, "utf-8");
    nodeChildrenSummariesCache = JSON.parse(content) as Record<string, NodeSummary[]>;
  }
  return nodeChildrenSummariesCache[parentNodeId] ?? [];
}

// =============================================================================
// NODE SUMMARIES (replaces old getSubgroupSummaries)
// =============================================================================

export interface NodeSummary {
  id: string;
  name: string;
  estimatedDescribed: number;
  totalAssessed: number;
  outdated: number;
  gbifNeSpeciesCount: number;
  byCategory: Record<string, number>;
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
