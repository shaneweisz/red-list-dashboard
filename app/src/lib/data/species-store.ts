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
import type { ColRevision } from "../col-revision";
import type { NoMatchReason, NoMatchDetail } from "./col-breakdown";

// =============================================================================
// PATHS
// =============================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const REDLIST_DIR = path.join(DATA_DIR, "redlist");
const TAXA_SUMMARY_PATH = path.join(DATA_DIR, "taxa-summary.json");
const TABLE1A_CHILDREN_SUMMARIES_PATH = path.join(DATA_DIR, "table1a-children-summaries.json");
const SSC_GROUP_CHILDREN_SUMMARIES_PATH = path.join(DATA_DIR, "ssc-group-children-summaries.json");
const COUNTRY_STATS_PATH = path.join(DATA_DIR, "country-stats.json");
const COL_REVISIONS_PATH = path.join(DATA_DIR, "col-revisions.json");

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
  habitat_codes: string[];
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
  col_described?: number; // CoL extant universe in this group (#271)
  col_ne?: number;        // CoL universe not yet IUCN-assessed
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
    habitat_codes: r.habitat_codes ? r.habitat_codes.split(";").filter(Boolean) : [],
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
let countryStatsCache: Record<string, { species: number; outdated: number }> | null = null;
let colRevisionsCache: Map<number, ColRevision> | null = null;

/** @internal Reset all module-level caches (for tests only). */
export function _resetCaches(): void {
  redlistCache.clear();
  historyCache.clear();
  taxaSummaryCache = null;
  nodeChildrenSummariesCache = null;
  countryStatsCache = null;
  colRevisionsCache = null;
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
 * Reads from data/table1a-children-summaries.json + data/ssc-group-children-
 * summaries.json (cached in memory, merged — callers don't care which of the
 * two static-tree sources a given parent id belongs to).
 */
export function getPrecomputedChildrenSummaries(parentNodeId: string): NodeSummary[] {
  if (!nodeChildrenSummariesCache) {
    const table1a = JSON.parse(fs.readFileSync(TABLE1A_CHILDREN_SUMMARIES_PATH, "utf-8")) as Record<string, NodeSummary[]>;
    const ssc = JSON.parse(fs.readFileSync(SSC_GROUP_CHILDREN_SUMMARIES_PATH, "utf-8")) as Record<string, NodeSummary[]>;
    nodeChildrenSummariesCache = { ...table1a, ...ssc };
  }
  return nodeChildrenSummariesCache[parentNodeId] ?? [];
}

/**
 * Get per-country totals across ALL species (unfiltered by taxon) — feeds the
 * country-view landing page's world map. A single precomputed aggregate
 * (~200 countries, one static file), not a live query: this data never varies
 * by taxon/subgroup selection, unlike the per-country taxa-summary/node-summary
 * endpoints (see country-taxa-summary-duckdb.ts), so there's nothing for a
 * live query to compose with here.
 */
export function getCountryStats(): Record<string, { species: number; outdated: number }> {
  if (!countryStatsCache) {
    const content = fs.readFileSync(COUNTRY_STATS_PATH, "utf-8");
    countryStatsCache = JSON.parse(content) as Record<string, { species: number; outdated: number }>;
  }
  return countryStatsCache;
}

/**
 * sis_taxon_id → the "possible taxonomic revision" flag, for the ~6% of
 * assessed species carrying one (data/col-revisions.json, built by
 * scripts/build-col-revisions.ts). Two independent signals share the entry: no
 * clean 1:1 Catalogue of Life match, and species CoL has likely split out of
 * this one — see lib/col-revision.
 *
 * Stamped onto every assessed species row (species-duckdb.ts) so the dashboard
 * can flag inline and filter by reason without a second round trip.
 *
 * Returns an empty map when the file is absent — a sync predating the script
 * still serves species, just with every row unflagged, rather than 500ing.
 */
export function getColRevisions(): Map<number, ColRevision> {
  if (colRevisionsCache) return colRevisionsCache;
  const out = new Map<number, ColRevision>();
  if (fs.existsSync(COL_REVISIONS_PATH)) {
    // Short-keyed on disk (r/d/i/dc/c/n/s/lw/ln, absent fields omitted) — one entry per
    // flagged species, so the shipped file stays small. See build-col-revisions.
    const file = JSON.parse(fs.readFileSync(COL_REVISIONS_PATH, "utf-8")) as {
      species: Record<string, { r?: string; d?: string; i?: number; dc?: string; c?: string; n?: string;
        s?: [string, string, string, string][]; lw?: [string, string, string][]; ln?: string }>;
    };
    for (const [id, e] of Object.entries(file.species ?? {})) {
      out.set(Number(id), {
        ...(e.r != null ? { reason: e.r } : {}),
        ...(e.d != null ? { detail: e.d } : {}),
        ...(e.i != null ? { detailId: e.i } : {}),
        ...(e.dc != null ? { detailColId: e.dc } : {}),
        ...(e.c != null ? { colId: e.c } : {}),
        ...(e.n != null ? { colName: e.n } : {}),
        // [name, col_id, previous name, previous col_id] on disk; an empty
        // string means CoL has nothing we can link to, so the UI renders that
        // part as plain text (or omits it).
        ...(e.lw?.length ? {
          lumpedWith: e.lw.map(([name, colId, category]) => ({
            name,
            ...(colId ? { colId } : {}),
            ...(category ? { category } : {}),
          })),
        } : {}),
        ...(e.ln != null ? { lumpedUnder: e.ln } : {}),
        ...(e.s?.length ? {
          splitInto: e.s.map(([name, colId, prevName, prevColId]) => ({
            name,
            ...(colId ? { colId } : {}),
            ...(prevName ? { previousName: prevName } : {}),
            ...(prevColId ? { previousColId: prevColId } : {}),
          })),
        } : {}),
      });
    }
  }
  colRevisionsCache = out;
  return out;
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

/** Optional taxonomy filter (orderNames, classNames, etc.) applied on top of taxonGroups */
interface TaxonomyFilter {
  classNames?: string[];
  orderNames?: string[];
  families?: string[];
  excludeClasses?: string[];
  excludeOrders?: string[];
  excludeFamilies?: string[];
  genera?: string[];
  excludeGenera?: string[];
  speciesNames?: string[];
  excludeSpeciesNames?: string[];
  extraSpeciesNames?: string[];
}

/** Check if a redlist row passes the taxonomy filter */
function matchesTaxonomyFilter(
  row: { class_name: string | null; order_name: string | null; family: string | null; scientific_name?: string | null },
  filter: TaxonomyFilter,
): boolean {
  // extraSpeciesNames: mirrors matchesFilter's OR escape hatch (taxonomy-utils.ts) —
  // species included regardless of every other clause below.
  if (filter.extraSpeciesNames?.length) {
    const name = (row.scientific_name ?? "").trim().toLowerCase();
    if (filter.extraSpeciesNames.includes(name)) return true;
  }
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
  if (filter.genera?.length || filter.excludeGenera?.length) {
    const genus = (row.scientific_name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (filter.genera && filter.genera.length > 0 && !filter.genera.includes(genus)) return false;
    if (filter.excludeGenera && filter.excludeGenera.length > 0 && genus && filter.excludeGenera.includes(genus)) return false;
  }
  if (filter.speciesNames?.length || filter.excludeSpeciesNames?.length) {
    const name = (row.scientific_name ?? "").trim().toLowerCase();
    if (filter.speciesNames && filter.speciesNames.length > 0 && !filter.speciesNames.includes(name)) return false;
    if (filter.excludeSpeciesNames && filter.excludeSpeciesNames.length > 0 && name && filter.excludeSpeciesNames.includes(name)) return false;
  }
  return true;
}

/**
 * Strip trailing parenthetical affiliations from an assessor/reviewer name.
 * The same person appears with a "(... Red List Authority)" / "(... Assessment
 * Team)" role label in some assessments but not others, so we drop it to (a)
 * aggregate that person's species under one candidate and (b) keep the name a
 * stable identity that round-trips with the assessors/reviewers dashboard filter
 * (which matches against the latest assessment, where the label is often absent).
 * e.g. "Amori, G. (Small Nonvolant Mammal Red List Authority)" -> "Amori, G."
 */
function stripAffiliation(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, "").trim();
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
          const normalizedName = stripAffiliation(name);
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

export interface ReviewerCountryCandidate {
  name: string;
  /** Per-region species counts (aggregated from the target species' countries) */
  regionCounts: Record<string, number>;
  /** Per-country species counts (country codes from the target species) */
  countryCounts: Record<string, number>;
  /** Species reviewed in this taxonomy scope with country overlap */
  totalInRegion: number;
  /** Total species reviewed in this taxonomy scope (regardless of country) */
  totalAll: number;
  latestDate: string;
}

/**
 * Find reviewer candidates for an NE species by looking at assessed species
 * in the given taxon groups that share at least one country with the target species.
 * Accepts multiple groups so a taxa like "plantae" can search across all plant groups.
 * Applies an optional taxonomy filter (e.g. orderNames for beetles) to narrow scope.
 * Aggregates counts by UN M49 sub-region for cleaner visualisation.
 */
export function getReviewerCandidatesByCountry(
  taxonGroups: string[],
  countries: string[],
  taxonomyFilter?: TaxonomyFilter,
): ReviewerCountryCandidate[] {
  if (countries.length === 0 || taxonGroups.length === 0) return [];

  const countrySet = new Set(countries.map((c) => c.toUpperCase()));

  const reviewerMap = new Map<string, { regionCounts: Record<string, number>; countryCounts: Record<string, number>; totalInRegion: number; totalAll: number; latestDate: string; seenSpeciesRegion: Set<number>; seenSpeciesAll: Set<number> }>();

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

      // Collect unique reviewer names across all assessments for this species
      const speciesReviewers = new Set<string>();
      let latestDate = "";
      for (const assessment of allAssessments) {
        if (!assessment.reviewers) continue;
        const date = assessment.date ?? "";
        if (date > latestDate) latestDate = date;
        for (const name of parseAssessorNames(assessment.reviewers)) {
          const normalizedName = stripAffiliation(name);
          if (normalizedName && normalizedName.length >= 3) {
            speciesReviewers.add(normalizedName);
          }
        }
      }

      // Credit each reviewer once per species
      for (const normalizedName of speciesReviewers) {
        let stats = reviewerMap.get(normalizedName);
        if (!stats) {
          stats = { regionCounts: {}, countryCounts: {}, totalInRegion: 0, totalAll: 0, latestDate: "", seenSpeciesRegion: new Set(), seenSpeciesAll: new Set() };
          reviewerMap.set(normalizedName, stats);
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

  return [...reviewerMap.entries()]
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
  // Catalogue of Life backbone (#272): extant accepted universe under this node and
  // the not-evaluated slice (universe − assessed, by col_id). Undefined when the CoL
  // artifacts weren't present at build time.
  colDescribed?: number;
  colNe?: number;
  // Per-name breakdown of colDescribed/colNe, for every name in the node's primary
  // include dimension (e.g. Pinniped SG's families [otariidae, phocidae, odobenidae],
  // or a single-name dimension like Primate SG's [primates]) — each entry's count/
  // neCount use the same filter (including excludes) narrowed to that one name, so
  // they sum to colDescribed/colNe exactly. trueAssessed is IUCN's own assessed count
  // for that one name (matched via assessed.parquet's own class/order/family fields,
  // not CoL's) — comparing it to count-neCount surfaces likely splits/lumps/coverage
  // gaps a CoL-only view would hide (see BreakdownList in TaxaSummary.tsx). Undefined
  // when the CoL artifacts weren't present at build time.
  colBreakdown?: { name: string; count: number; neCount: number; trueAssessed: number; noMatchIds: number[]; noMatchDetails?: NoMatchDetail[]; splitDetails?: SplitDetail[] }[];
}

// See scripts/build-taxa-summary.ts's classifyNoMatch for what each reason means and
// how it's derived. Modular/additive on top of noMatchIds — safe to ignore or drop
// without touching the count-only CoL Match / No CoL Match mechanism.
// Re-exported from lib/data/col-breakdown, which is where classifyNoMatch
// actually produces these — this file used to declare its own structurally
// identical copy, and adding a reason there (synonym_of) silently failed to
// typecheck here until both were edited. One declaration, no drift.
export type { NoMatchReason, NoMatchDetail };

// Heuristic "split from" flag for Not Evaluated species — see
// scripts/build-taxa-summary.ts's SPLIT_CANDIDATES_SQL for the mechanism and its
// caveats. Keyed by col_id (NE species have no sis_taxon_id), additive on top of
// colBreakdown, and independently droppable.
export interface SplitDetail {
  colId: string;
  parentId: number;
  parentName: string;
  parentCategory: string;
}

export { isOutdated, outdatedCutoffDate } from "@/lib/outdated";
