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
  systems: string[];
  growth_forms: string[];
  movement_pattern: string | null;
  possibly_extinct: boolean;
  possibly_extinct_in_the_wild: boolean;
  criteria: string | null;
  threat_codes: string[];
  has_map: boolean;
}

export interface PreviousAssessment {
  id: number;
  year: string;
  category: string;
  date: string | null;
  assessors: string | null;
  reviewers: string | null;
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
    systems: r.systems ? r.systems.split(";").filter(Boolean) : [],
    growth_forms: r.growth_forms ? r.growth_forms.split(";").filter(Boolean) : [],
    movement_pattern: r.movement_pattern || null,
    possibly_extinct: r.possibly_extinct === "true",
    possibly_extinct_in_the_wild: r.possibly_extinct_in_the_wild === "true",
    criteria: r.criteria || null,
    threat_codes: r.threat_codes ? r.threat_codes.split(";").filter(Boolean) : [],
    has_map: r.has_map === "true",
  };
}

// =============================================================================
// CACHE
// =============================================================================

type HistoryMap = Record<string, PreviousAssessment[]>;

const redlistCache = new Map<string, RedlistRow[]>();
const historyCache = new Map<string, HistoryMap>();
let taxaSummaryCache: TaxaSummaryRow[] | null = null;
let nodeChildrenSummariesCache: Record<string, NodeSummary[]> | null = null;

/** @internal Reset all module-level caches (for tests only). */
export function _resetCaches(): void {
  redlistCache.clear();
  historyCache.clear();
  taxaSummaryCache = null;
  nodeChildrenSummariesCache = null;
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

// =============================================================================
// PUBLIC API
// =============================================================================

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
  /** Per-country species counts (country codes from the target species) */
  countryCounts: Record<string, number>;
  /** Species assessed in this taxonomy scope with country overlap */
  totalInRegion: number;
  /** Total species assessed in this taxonomy scope (regardless of country) */
  totalAll: number;
  latestDate: string;
}

/** Optional taxonomy filter (orderNames, classNames, etc.) applied on top of csvGroups */
interface TaxonomyFilter {
  classNames?: string[];
  orderNames?: string[];
  families?: string[];
  excludeClasses?: string[];
  excludeOrders?: string[];
  excludeFamilies?: string[];
}

/** Check if a redlist row passes the taxonomy filter */
function matchesTaxonomyFilter(
  row: { class_name: string | null; order_name: string | null; family: string | null },
  filter: TaxonomyFilter,
): boolean {
  if (filter.classNames && filter.classNames.length > 0) {
    const cls = (row.class_name ?? "").toLowerCase();
    if (!filter.classNames.includes(cls)) return false;
  }
  if (filter.excludeClasses && filter.excludeClasses.length > 0) {
    const cls = (row.class_name ?? "").toLowerCase();
    if (cls && filter.excludeClasses.includes(cls)) return false;
  }
  if (filter.orderNames && filter.orderNames.length > 0) {
    const ord = (row.order_name ?? "").toLowerCase();
    const cls = (row.class_name ?? "").toLowerCase();
    if (!filter.orderNames.includes(ord) && !(ord === "" && filter.orderNames.includes(cls))) return false;
  }
  if (filter.excludeOrders && filter.excludeOrders.length > 0) {
    const ord = (row.order_name ?? "").toLowerCase();
    const cls = (row.class_name ?? "").toLowerCase();
    if (filter.excludeOrders.includes(ord) || (ord === "" && filter.excludeOrders.includes(cls))) return false;
  }
  if (filter.families && filter.families.length > 0) {
    const fam = (row.family ?? "").toLowerCase();
    if (!filter.families.includes(fam)) return false;
  }
  if (filter.excludeFamilies && filter.excludeFamilies.length > 0) {
    const fam = (row.family ?? "").toLowerCase();
    if (fam && filter.excludeFamilies.includes(fam)) return false;
  }
  return true;
}

/**
 * Find assessor candidates for an NE species by looking at assessed species
 * in the given taxon groups that share at least one country with the target species.
 * Accepts multiple groups so a taxa like "plantae" can search across all plant groups.
 * Applies an optional taxonomy filter (e.g. orderNames for beetles) to narrow scope.
 * Aggregates counts by UN M49 sub-region for cleaner visualisation.
 */
export function getAssessorCandidatesByCountry(
  taxonGroups: string[],
  countries: string[],
  taxonomyFilter?: TaxonomyFilter,
): AssessorCountryCandidate[] {
  if (countries.length === 0 || taxonGroups.length === 0) return [];

  const countrySet = new Set(countries.map((c) => c.toUpperCase()));

  const assessorMap = new Map<string, { regionCounts: Record<string, number>; countryCounts: Record<string, number>; totalInRegion: number; totalAll: number; latestDate: string; seenSpeciesRegion: Set<number>; seenSpeciesAll: Set<number> }>();

  for (const taxonGroup of taxonGroups) {
    const redlistRows = loadRedlistForGroup(taxonGroup);
    const historyMap = loadHistoryForGroup(taxonGroup);

    for (const row of redlistRows) {
      // Apply taxonomy filter (e.g. only coleoptera for beetles)
      if (taxonomyFilter && !matchesTaxonomyFilter(row, taxonomyFilter)) continue;

      // Find which of the target countries this species occurs in
      const overlapping = row.countries.filter((c) => countrySet.has(c.toUpperCase()));
      const hasCountryOverlap = overlapping.length > 0;

      // Map overlapping countries to their regions (deduplicate per-species)
      const regions = hasCountryOverlap
        ? new Set(overlapping.map((c) => countryToRegion(c)))
        : new Set<string>();

      const assessments = historyMap[String(row.sis_taxon_id)] ?? [];
      const allAssessments = assessments.length > 0 ? assessments : [{
        id: row.assessment_id,
        year: row.year_published,
        category: row.category,
        date: row.assessment_date,
        assessors: null as string | null,
        reviewers: null as string | null,
      }];

      // Collect unique assessor names across all assessments for this species
      const speciesAssessors = new Set<string>();
      let latestDate = "";
      for (const assessment of allAssessments) {
        if (!assessment.assessors) continue;
        const date = assessment.date ?? "";
        if (date > latestDate) latestDate = date;
        for (const name of parseAssessorNames(assessment.assessors)) {
          const normalizedName = name.trim();
          if (normalizedName && normalizedName.length >= 3) {
            speciesAssessors.add(normalizedName);
          }
        }
      }

      // Credit each assessor once per species
      for (const normalizedName of speciesAssessors) {
        let stats = assessorMap.get(normalizedName);
        if (!stats) {
          stats = { regionCounts: {}, countryCounts: {}, totalInRegion: 0, totalAll: 0, latestDate: "", seenSpeciesRegion: new Set(), seenSpeciesAll: new Set() };
          assessorMap.set(normalizedName, stats);
        }

        // Always count for totalAll
        if (!stats.seenSpeciesAll.has(row.sis_taxon_id)) {
          stats.seenSpeciesAll.add(row.sis_taxon_id);
          stats.totalAll++;
        }

        // Count for region overlap
        if (hasCountryOverlap && !stats.seenSpeciesRegion.has(row.sis_taxon_id)) {
          stats.seenSpeciesRegion.add(row.sis_taxon_id);
          stats.totalInRegion++;
          for (const region of regions) {
            stats.regionCounts[region] = (stats.regionCounts[region] ?? 0) + 1;
          }
          for (const c of overlapping) {
            const code = c.toUpperCase();
            stats.countryCounts[code] = (stats.countryCounts[code] ?? 0) + 1;
          }
        }
        if (latestDate > stats.latestDate) stats.latestDate = latestDate;
      }
    }
  }

  return [...assessorMap.entries()]
    .filter(([, stats]) => stats.totalInRegion > 0)
    .map(([name, stats]) => ({
      name,
      regionCounts: stats.regionCounts,
      countryCounts: stats.countryCounts,
      totalInRegion: stats.totalInRegion,
      totalAll: stats.totalAll,
      latestDate: stats.latestDate,
    }))
    .sort((a, b) => {
      if (a.totalInRegion !== b.totalInRegion) return b.totalInRegion - a.totalInRegion;
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
