/**
 * File-backed data layer for species and taxa summary.
 *
 * Reads per-taxon CSV files and taxa-summary.json produced by the sync scripts.
 * Caches in memory for the process lifetime (on Vercel = per cold start).
 */

import * as fs from "fs";
import * as path from "path";
import { readCsv } from "./csv";
import { countryToRegion } from "../regions";

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
// ASSESSOR CANDIDATES
// =============================================================================

export type TaxonomyLevel = "genus" | "family" | "order" | "class";

export interface AssessorCandidate {
  name: string;
  genus: number;
  family: number;
  order: number;
  class: number;
  latestDate: string;
}

/**
 * Find assessor candidates for an NE species by looking at assessed species
 * in the same taxon group. Counts how many species each assessor has assessed
 * at each taxonomy level (genus/family/order/class). A genus match also counts
 * as family, order, and class. Returns all assessors sorted by genus count,
 * then family, order, class.
 */
export function getAssessorCandidates(
  scientificName: string,
  taxonGroup: string,
  family?: string | null,
  orderName?: string | null,
  className?: string | null,
): AssessorCandidate[] {
  const genus = scientificName.split(" ")[0]?.toLowerCase() ?? "";
  const familyLc = family?.toLowerCase() ?? "";
  const orderLc = orderName?.toLowerCase() ?? "";
  const classLc = className?.toLowerCase() ?? "";

  const redlistRows = loadRedlistForGroup(taxonGroup);
  const historyMap = loadHistoryForGroup(taxonGroup);

  interface AssessorStats {
    genus: number;
    family: number;
    order: number;
    class: number;
    latestDate: string;
  }
  const assessorMap = new Map<string, AssessorStats>();

  for (const row of redlistRows) {
    const rowGenus = row.scientific_name.split(" ")[0]?.toLowerCase() ?? "";
    const isGenus = genus !== "" && rowGenus === genus;
    const isFamily = familyLc !== "" && row.family?.toLowerCase() === familyLc;
    const isOrder = orderLc !== "" && row.order_name?.toLowerCase() === orderLc;
    const isClass = classLc !== "" && row.class_name?.toLowerCase() === classLc;

    // Skip rows with no taxonomy overlap at all
    if (!isGenus && !isFamily && !isOrder && !isClass) continue;

    const assessments = historyMap[String(row.sis_taxon_id)] ?? [];
    const allAssessments = assessments.length > 0 ? assessments : [{
      id: row.assessment_id,
      year: row.year_published,
      category: row.category,
      date: row.assessment_date,
      assessors: null as string | null,
      reviewers: null as string | null,
    }];

    for (const assessment of allAssessments) {
      if (!assessment.assessors) continue;

      const date = assessment.date ?? "";
      const names = parseAssessorNames(assessment.assessors);
      for (const name of names) {
        const normalizedName = name.trim();
        if (!normalizedName || normalizedName.length < 3) continue;

        let stats = assessorMap.get(normalizedName);
        if (!stats) {
          stats = { genus: 0, family: 0, order: 0, class: 0, latestDate: "" };
          assessorMap.set(normalizedName, stats);
        }

        // Count inclusively: a genus match also counts as family/order/class
        if (isGenus) stats.genus++;
        if (isFamily || isGenus) stats.family++;
        if (isOrder || isFamily || isGenus) stats.order++;
        if (isClass || isOrder || isFamily || isGenus) stats.class++;
        if (date > stats.latestDate) stats.latestDate = date;
      }
    }
  }

  return [...assessorMap.entries()]
    .map(([name, stats]) => ({
      name,
      genus: stats.genus,
      family: stats.family,
      order: stats.order,
      class: stats.class,
      latestDate: stats.latestDate,
    }))
    .sort((a, b) => {
      if (a.genus !== b.genus) return b.genus - a.genus;
      if (a.family !== b.family) return b.family - a.family;
      if (a.order !== b.order) return b.order - a.order;
      if (a.class !== b.class) return b.class - a.class;
      return b.latestDate.localeCompare(a.latestDate);
    });
}

export interface AssessorCountryCandidate {
  name: string;
  /** Per-region species counts (aggregated from the target species' countries) */
  regionCounts: Record<string, number>;
  total: number;
  latestDate: string;
}

/**
 * Find assessor candidates for an NE species by looking at assessed species
 * in the same taxon group that share at least one country with the target species.
 * Aggregates counts by UN M49 sub-region for cleaner visualisation.
 */
export function getAssessorCandidatesByCountry(
  taxonGroup: string,
  countries: string[],
): AssessorCountryCandidate[] {
  if (countries.length === 0) return [];

  const countrySet = new Set(countries.map((c) => c.toUpperCase()));

  const redlistRows = loadRedlistForGroup(taxonGroup);
  const historyMap = loadHistoryForGroup(taxonGroup);

  const assessorMap = new Map<string, { regionCounts: Record<string, number>; latestDate: string }>();

  for (const row of redlistRows) {
    // Find which of the target countries this species occurs in
    const overlapping = row.countries.filter((c) => countrySet.has(c.toUpperCase()));
    if (overlapping.length === 0) continue;

    // Map overlapping countries to their regions (deduplicate per-species)
    const regions = new Set(overlapping.map((c) => countryToRegion(c)));

    const assessments = historyMap[String(row.sis_taxon_id)] ?? [];
    const allAssessments = assessments.length > 0 ? assessments : [{
      id: row.assessment_id,
      year: row.year_published,
      category: row.category,
      date: row.assessment_date,
      assessors: null as string | null,
      reviewers: null as string | null,
    }];

    for (const assessment of allAssessments) {
      if (!assessment.assessors) continue;

      const date = assessment.date ?? "";
      const names = parseAssessorNames(assessment.assessors);
      for (const name of names) {
        const normalizedName = name.trim();
        if (!normalizedName || normalizedName.length < 3) continue;

        let stats = assessorMap.get(normalizedName);
        if (!stats) {
          stats = { regionCounts: {}, latestDate: "" };
          assessorMap.set(normalizedName, stats);
        }

        for (const region of regions) {
          stats.regionCounts[region] = (stats.regionCounts[region] ?? 0) + 1;
        }
        if (date > stats.latestDate) stats.latestDate = date;
      }
    }
  }

  return [...assessorMap.entries()]
    .map(([name, stats]) => {
      const total = Object.values(stats.regionCounts).reduce((a, b) => a + b, 0);
      return {
        name,
        regionCounts: stats.regionCounts,
        total,
        latestDate: stats.latestDate,
      };
    })
    .sort((a, b) => {
      if (a.total !== b.total) return b.total - a.total;
      return b.latestDate.localeCompare(a.latestDate);
    });
}

/**
 * Parse assessor string into individual names.
 * Handles formats like "Smith, J.A." and "IUCN SSC Amphibian Specialist Group"
 */
function parseAssessorNames(raw: string): string[] {
  if (!raw || !raw.trim()) return [];

  // Split on " & "
  const ampersandParts = raw.split(" & ");
  const names: string[] = [];

  for (const part of ampersandParts) {
    const segments = part.split(", ");
    let current = segments[0];
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const isInitialsOrAffiliation =
        seg.startsWith("(") ||
        /^[A-Z]\./.test(seg) ||
        /^[A-Z]$/.test(seg);

      if (isInitialsOrAffiliation) {
        current += ", " + seg;
      } else {
        names.push(current.trim());
        current = seg;
      }
    }
    if (current.trim()) {
      names.push(current.trim());
    }
  }

  return names.filter(Boolean);
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
