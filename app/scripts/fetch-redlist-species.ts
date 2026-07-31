/**
 * fetch-redlist-species: IUCN Red List DB → CSV
 *
 * Connects to the IUCN Red List PostgreSQL database and writes per-taxon
 * species data to data/redlist/{taxonId}.csv.
 *
 * Prerequisites:
 *   1. DB connectivity — primary is a local Postgres restored from
 *      ~/Data/RedList/*.bkp (`brew services start postgresql@16`), pointed
 *      at on the default port. Fallback: SSH-tunnel the remote SIS DB to
 *      localhost:5433 if you need data newer than your last local restore.
 *   2. Environment variables: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
 *
 * Usage:
 *   npx tsx scripts/fetch-redlist-species.ts [taxon]   # Sync one taxon (e.g. mammalia)
 *   npx tsx scripts/fetch-redlist-species.ts            # Sync all taxa
 */

import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import {
  loadEnvFiles,
  SyncLogger,
  writeCsv,
  readCsv,
  REDLIST_DIR,
} from "./utils";
import { getTaxa, allTaxaUnchecked, type RedlistQuery, type Taxon } from "./taxa";

const POPULATION_TRENDS: Record<string, string> = {
  "0": "Increasing",
  "1": "Decreasing",
  "2": "Stable",
  "3": "Unknown",
};

// =============================================================================
// TYPES
// =============================================================================

export interface RedlistSynonym {
  /** Canonical-form binomial, e.g. "Lithobates catesbeianus" */
  name: string;
  /** Synonym status from IUCN: ACCEPTED, NEW, ADD, MERGE, SPLIT, etc. */
  status: string;
}

/**
 * The IUCN `authority` column stores HTML entities literally — `&amp;` rather
 * than `&`. Left alone, "(Temminck &amp; Schlegel, 1838)" never compares equal
 * to Catalogue of Life's "(Temminck & Schlegel, 1838)", and 16.6% of authorship
 * comparisons fail for that reason alone.
 */
export function decodeEntities(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export interface RedlistSpecies {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  /**
   * The author and year IUCN publishes for this name.
   *
   * Carried so the matching phase can hand it to GBIF, which needs authorship as
   * its own parameter to resolve a name whose spelling differs from Catalogue of
   * Life's. Without it GBIF backs off to the genus and the species shows nothing.
   */
  authority: string | null;
  common_name: string | null;
  class_name: string | null;
  order_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null; // YYYY-MM-DD
  year_published: string;
  population_trend: string | null;
  countries: string[];
  taxon_group_table1a: string;
  systems: string[]; // Terrestrial, Freshwater, Marine
  growth_forms: string[]; // Tree, Shrub, Forb or Herb, etc.
  movement_pattern: string | null; // Full Migrant, Not a Migrant, etc.
  possibly_extinct: boolean;
  possibly_extinct_in_the_wild: boolean;
  criteria: string | null; // e.g. "B1ab(ii,iii)+2ab(ii,iii)"
  threat_codes: string[]; // Full threat codes e.g. ["1.1","2.1.2","5.3.3"]
  /**
   * Habitat entries as `code:season:suitability:major` compact tuples, e.g.
   * ["1.1:R:S:1", "12.1:B:M:0"] (Forest-Boreal, Resident, Suitable, major
   * importance; Marine Intertidal-Rocky Shoreline, Breeding season, Marginal,
   * not major). One tuple per assessment_habitats row — a species can have
   * the same code twice under different season/suitability combos. See
   * SEASON_CODES/SUITABILITY_CODES below for the single-letter encoding.
   */
  habitat_codes: string[];
  /**
   * Scientific-name synonyms from the IUCN taxon_synonyms table, after
   * dropping (a) the species's own canonical name and (b) any synonym whose
   * binomial is claimed by more than one current latest taxon (ambiguous
   * splits/lumps). Used to find additional GBIF backbone keys for species
   * that have been recently reclassified.
   */
  synonyms: RedlistSynonym[];
}

// Single-letter encoding for habitat_codes' compact tuples (see RedlistSpecies.habitat_codes).
// "-" covers the rare null/unrecognized value so a tuple always has exactly 4 fields.
export const SEASON_CODES: Record<string, string> = {
  "Resident": "R",
  "Breeding Season": "B",
  "Non-Breeding Season": "N",
  "Passage": "P",
  "Seasonal Occurrence Unknown": "U",
};
export const SUITABILITY_CODES: Record<string, string> = {
  "Suitable": "S",
  "Marginal": "M",
  "Unknown": "U",
};
// majorImportance is a raw Yes/No/blank field in the source data (not an
// enumerated lookup like season/suitability) — blank is the single largest
// bucket (~35% of rows), so it gets its own code ("-") rather than being
// folded into "No", which would make "exclude minor" wrongly exclude species
// whose importance was simply never recorded.
export const MAJOR_IMPORTANCE_CODES: Record<string, string> = {
  "Yes": "1",
  "No": "0",
};

// =============================================================================
// DATA FETCHING (from IUCN PostgreSQL)
// =============================================================================

export async function fetchFromIucnDb(
  pgClient: Client,
  taxonId: string,
  query: RedlistQuery,
): Promise<RedlistSpecies[]> {
  const mainQuery = `
    SELECT DISTINCT ON (t.sis_id)
      t.sis_id as sis_taxon_id,
      a.id as assessment_id,
      t.scientific_name,
      t.authority,
      tcn.name as common_name,
      t.class_name,
      t.order_name,
      t.family_name as family,
      rlc.code as category,
      a.assessment_date,
      a.year_published,
      pt.code as population_trend_code,
      a.possibly_extinct,
      a.possibly_extinct_in_the_wild,
      a.criteria
    FROM taxons t
    JOIN assessments a ON a.taxon_id = t.id
    JOIN assessment_scopes ascope ON ascope.assessment_id = a.id
    JOIN red_list_category_lookup rlc ON rlc.id = a.red_list_category_id
    LEFT JOIN taxon_common_names tcn ON tcn.taxon_id = t.id
      AND tcn.language_id = 609 AND tcn.main = true
    LEFT JOIN population_trend_lookup pt ON pt.id = a.population_trend_id
    WHERE t.${query.filterColumn} = ANY($1)
      AND t.latest = true
      AND (a.latest = true
        -- Edge case: Mayaheros ericymba (sis_id 4840, assessment 288151174).
        -- This species' only global assessment is an amendment (is_amendment=true)
        -- to a 1996 assessment. Amendments have a.latest=false in the IUCN DB, so
        -- our a.latest=true filter excludes it. However, the IUCN website and their
        -- Table 1a count of 29,114 fishes includes this species. Without this
        -- override, our total is 29,113.
        -- Ref: https://www.iucnredlist.org/species/4840/288151174#amendment
        OR a.id = 288151174)
      AND a.suppress = false
      AND ascope.scope_lookup_id = 15
      AND t.infra_name IS NULL
      AND t.subpopulation_name IS NULL
    ORDER BY t.sis_id, a.assessment_date DESC
  `;

  const mainResult = await pgClient.query(mainQuery, [query.filterValues]);

  const species: RedlistSpecies[] = [];
  const assessmentIds: number[] = [];

  for (const row of mainResult.rows) {
    const assessmentDate = row.assessment_date
      ? new Date(row.assessment_date).toISOString().split("T")[0]
      : null;

    const assessmentId = Number(row.assessment_id);
    species.push({
      sis_taxon_id: Number(row.sis_taxon_id),
      assessment_id: assessmentId,
      scientific_name: row.scientific_name,
      authority: decodeEntities(row.authority),
      common_name: row.common_name || null,
      class_name: row.class_name?.toLowerCase() || null,
      order_name: row.order_name?.toLowerCase() || null,
      family: row.family?.toLowerCase() || null,
      category: row.category,
      assessment_date: assessmentDate,
      year_published: row.year_published,
      population_trend: POPULATION_TRENDS[row.population_trend_code] || null,
      countries: [],
      taxon_group_table1a: taxonId,
      systems: [],
      growth_forms: [],
      movement_pattern: null,
      possibly_extinct: row.possibly_extinct === true,
      possibly_extinct_in_the_wild: row.possibly_extinct_in_the_wild === true,
      criteria: row.criteria || null,
      threat_codes: [],
      habitat_codes: [],
      synonyms: [],
    });
    assessmentIds.push(assessmentId);
  }

  if (assessmentIds.length > 0) {
    const sisIds = species.map((s) => s.sis_taxon_id);

    // Batch-fetch countries, systems, growth forms, movement patterns, threats, and synonyms
    const [countriesResult, systemsResult, growthFormsResult, movementResult, threatsResult, habitatsResult, synonymsResult] = await Promise.all([
      pgClient.query(`
        SELECT a.id as assessment_id, ll.code as country_code
        FROM assessments a
        JOIN assessment_locations al ON al.assessment_id = a.id
        JOIN location_lookup ll ON ll.id = al.location_id
        JOIN legend_lookup leg ON leg.id = al.legend_id
        WHERE a.id = ANY($1)
          AND leg.origin = 'Native'
          AND leg.presence = 'Extant'
          AND LENGTH(ll.code) = 2
      `, [assessmentIds]),
      pgClient.query(`
        SELECT asys.assessment_id, sl.description->>'en' as system_name
        FROM assessment_systems asys
        JOIN system_lookup sl ON sl.id = asys.system_lookup_id
        WHERE asys.assessment_id = ANY($1)
      `, [assessmentIds]),
      pgClient.query(`
        SELECT agf.assessment_id, gfl.description->>'en' as growth_form
        FROM assessment_growth_forms agf
        JOIN growth_form_lookup gfl ON gfl.id = agf.growth_form_id
        WHERE agf.assessment_id = ANY($1)
      `, [assessmentIds]),
      pgClient.query(`
        SELECT assessment_id, supplementary_fields->>'MovementPatterns.pattern' as pattern
        FROM assessment_supplementary_infos
        WHERE assessment_id = ANY($1)
          AND supplementary_fields->>'MovementPatterns.pattern' IS NOT NULL
      `, [assessmentIds]),
      pgClient.query(`
        SELECT at2.assessment_id, tl.code
        FROM assessment_threats at2
        JOIN threat_lookup tl ON tl.id = at2.threat_id
        WHERE at2.assessment_id = ANY($1)
      `, [assessmentIds]),
      pgClient.query(`
        SELECT ah.assessment_id, hl.code,
               ah.supplementary_fields->>'season' as season,
               ah.supplementary_fields->>'suitability' as suitability,
               ah.supplementary_fields->>'majorImportance' as major_importance
        FROM assessment_habitats ah
        JOIN habitat_lookup hl ON hl.id = ah.habitat_id
        WHERE ah.assessment_id = ANY($1)
      `, [assessmentIds]),
      // Synonyms with global ambiguity filtering. The CTEs scan all latest
      // taxa (not just this batch) because ambiguity is a global property:
      // a synonym is dropped if its (genus, species) is claimed by more
      // than one current latest taxon (whether as a synonym of one and
      // canonical of another, or as a synonym of two daughters of a split).
      pgClient.query(`
        WITH all_latest_synonyms AS (
          SELECT t.sis_id, ts.genus_name, ts.species_name, ts.status
          FROM taxon_synonyms ts
          JOIN taxons t ON t.id = ts.taxon_id
          WHERE t.latest = true
            AND t.infra_name IS NULL
            AND t.subpopulation_name IS NULL
            AND ts.genus_name IS NOT NULL
            AND ts.species_name IS NOT NULL
            AND ts.infra_name IS NULL
            AND ts.status NOT IN ('DELETE','D')
        ),
        all_latest_canonicals AS (
          -- Excludes hybrids ("Salix x fragilis") and bracketed subgenera
          -- ("Bombus (Bombus) terrestris") so split_part(' ', 1/2) yields a
          -- valid (genus, species) pair. These are rare and would otherwise
          -- emit garbage tokens like "(Bombus)" that can't collide with real
          -- synonym names anyway, so excluding them is safe.
          SELECT sis_id, scientific_name
          FROM taxons
          WHERE latest = true
            AND infra_name IS NULL
            AND subpopulation_name IS NULL
            AND scientific_name !~ ' [x×] '
            AND position('(' in scientific_name) = 0
        ),
        synonym_claim_counts AS (
          SELECT genus_name, species_name, COUNT(DISTINCT sis_id) AS claim_count
          FROM (
            SELECT genus_name, species_name, sis_id FROM all_latest_synonyms
            UNION ALL
            SELECT split_part(scientific_name, ' ', 1),
                   split_part(scientific_name, ' ', 2),
                   sis_id
            FROM all_latest_canonicals
          ) u
          GROUP BY genus_name, species_name
        )
        SELECT als.sis_id, als.genus_name, als.species_name, als.status
        FROM all_latest_synonyms als
        JOIN synonym_claim_counts scc
          ON scc.genus_name = als.genus_name
         AND scc.species_name = als.species_name
        WHERE als.sis_id = ANY($1)
          AND scc.claim_count = 1
      `, [sisIds]),
    ]);

    // Countries
    const countriesByAssessment = new Map<number, Set<string>>();
    for (const row of countriesResult.rows) {
      const aid = Number(row.assessment_id);
      if (!countriesByAssessment.has(aid)) countriesByAssessment.set(aid, new Set());
      countriesByAssessment.get(aid)!.add(row.country_code);
    }

    // Systems (realm)
    const systemsByAssessment = new Map<number, Set<string>>();
    for (const row of systemsResult.rows) {
      const aid = Number(row.assessment_id);
      if (!systemsByAssessment.has(aid)) systemsByAssessment.set(aid, new Set());
      // Shorten "Freshwater (=Inland waters)" to "Freshwater"
      const name = (row.system_name as string).replace(/ \(=.*\)/, "");
      systemsByAssessment.get(aid)!.add(name);
    }

    // Growth forms
    const growthFormsByAssessment = new Map<number, Set<string>>();
    for (const row of growthFormsResult.rows) {
      const aid = Number(row.assessment_id);
      if (!growthFormsByAssessment.has(aid)) growthFormsByAssessment.set(aid, new Set());
      growthFormsByAssessment.get(aid)!.add(row.growth_form);
    }

    // Movement patterns
    const movementByAssessment = new Map<number, string>();
    for (const row of movementResult.rows) {
      movementByAssessment.set(Number(row.assessment_id), row.pattern);
    }

    // Threats (full sub-codes, deduplicated)
    const threatsByAssessment = new Map<number, Set<string>>();
    for (const row of threatsResult.rows) {
      const aid = Number(row.assessment_id);
      if (!threatsByAssessment.has(aid)) threatsByAssessment.set(aid, new Set());
      threatsByAssessment.get(aid)!.add(row.code);
    }

    // Habitats — one compact `code:season:suitability:major` tuple per
    // assessment_habitats row (deduped on the full tuple, not just the code,
    // since the same habitat code can legitimately appear twice under
    // different season/suitability combos).
    const habitatsByAssessment = new Map<number, Set<string>>();
    for (const row of habitatsResult.rows) {
      const aid = Number(row.assessment_id);
      const seasonCode = SEASON_CODES[row.season] ?? "-";
      const suitabilityCode = SUITABILITY_CODES[row.suitability] ?? "-";
      const majorFlag = MAJOR_IMPORTANCE_CODES[row.major_importance] ?? "-";
      if (!habitatsByAssessment.has(aid)) habitatsByAssessment.set(aid, new Set());
      habitatsByAssessment.get(aid)!.add(`${row.code}:${seasonCode}:${suitabilityCode}:${majorFlag}`);
    }

    // Assign to species
    for (const s of species) {
      const countries = countriesByAssessment.get(s.assessment_id);
      if (countries) s.countries = Array.from(countries).sort();

      const systems = systemsByAssessment.get(s.assessment_id);
      if (systems) s.systems = Array.from(systems).sort();

      const growthForms = growthFormsByAssessment.get(s.assessment_id);
      if (growthForms) s.growth_forms = Array.from(growthForms).sort();

      s.movement_pattern = movementByAssessment.get(s.assessment_id) ?? null;

      const threats = threatsByAssessment.get(s.assessment_id);
      if (threats) s.threat_codes = Array.from(threats).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const habitats = habitatsByAssessment.get(s.assessment_id);
      if (habitats) s.habitat_codes = Array.from(habitats).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    // Synonyms (deduplicated per sis_id, excluding the species's own canonical name).
    // The SQL has already dropped ambiguous (multi-claimed) names.
    const synonymsBySisId = new Map<number, RedlistSynonym[]>();
    const seenBySisId = new Map<number, Set<string>>();
    for (const row of synonymsResult.rows) {
      const sisId = Number(row.sis_id);
      const name = `${row.genus_name} ${row.species_name}`;
      let seen = seenBySisId.get(sisId);
      if (!seen) {
        seen = new Set();
        seenBySisId.set(sisId, seen);
      }
      if (seen.has(name)) continue;
      seen.add(name);
      let list = synonymsBySisId.get(sisId);
      if (!list) {
        list = [];
        synonymsBySisId.set(sisId, list);
      }
      list.push({ name, status: row.status || "" });
    }
    for (const s of species) {
      const list = synonymsBySisId.get(s.sis_taxon_id);
      if (!list) continue;
      // Drop self-equal synonyms (defensive — the SQL ambiguity filter doesn't catch these)
      s.synonyms = list.filter((syn) => syn.name !== s.scientific_name);
    }
  }

  return species;
}

// =============================================================================
// TAXON COVERAGE CHECK
// =============================================================================

const FILTER_COLUMN_TO_TAXON_FIELD: Record<RedlistQuery["filterColumn"], "kingdom_name" | "phylum_name" | "class_name" | "order_name"> = {
  kingdom_name: "kingdom_name",
  phylum_name: "phylum_name",
  class_name: "class_name",
  order_name: "order_name",
};

/**
 * Sanity-checks that every (kingdom, phylum, class, order) combination with
 * currently-assessed species is matched by exactly one Taxon's redlist
 * filter — zero matches means those species are silently missing from every
 * CSV; more than one means they're double-counted across CSVs. Runs against
 * the SAME base "currently assessed" predicate as fetchFromIucnDb (minus the
 * class/order/phylum filter), so it's just one extra query per sync, not a
 * new DB round trip pattern.
 *
 * This is how the crustaceans gap was found: IUCN's SIS DB had already split
 * 2 barnacle species out of the legacy "MAXILLOPODA" class into its own
 * (misspelled) "THEOCOSTRACA" class, which no taxon's filterValues listed —
 * see taxa.ts's crustaceans comment. The IUCN DB only refreshes ~every 6
 * months, so this is cheap insurance against the same class of drift
 * recurring silently at the next sync.
 */
async function checkTaxonCoverage(pgClient: Client): Promise<void> {
  const result = await pgClient.query(`
    SELECT t.kingdom_name, t.phylum_name, t.class_name, t.order_name, count(*) AS n
    FROM taxons t
    JOIN assessments a ON a.taxon_id = t.id
    JOIN assessment_scopes ascope ON ascope.assessment_id = a.id
    WHERE t.latest = true
      AND (a.latest = true OR a.id = 288151174)
      AND a.suppress = false
      AND ascope.scope_lookup_id = 15
      AND t.infra_name IS NULL
      AND t.subpopulation_name IS NULL
    GROUP BY 1, 2, 3, 4
  `);

  const unmatched: string[] = [];
  const doubleMatched: string[] = [];
  for (const row of result.rows) {
    const hits = allTaxaUnchecked().filter((taxon) =>
      taxon.redlist.some((q) => {
        const value: string | null = row[FILTER_COLUMN_TO_TAXON_FIELD[q.filterColumn]];
        return value != null && q.filterValues.includes(value.toUpperCase());
      }),
    ).map((t) => t.id);

    const label = `kingdom=${row.kingdom_name} phylum=${row.phylum_name} class=${row.class_name} order=${row.order_name} (${row.n} species)`;
    if (hits.length === 0) unmatched.push(label);
    else if (hits.length > 1) doubleMatched.push(`${label} -> ${hits.join(", ")}`);
  }

  if (unmatched.length > 0) {
    console.warn(`\n⚠️  taxon coverage: ${unmatched.length} group(s) matched by ZERO taxa — entirely missing from every CSV:`);
    unmatched.forEach((l) => console.warn(`   ${l}`));
  }
  if (doubleMatched.length > 0) {
    console.warn(`\n⚠️  taxon coverage: ${doubleMatched.length} group(s) matched by MULTIPLE taxa — species double-counted across CSVs:`);
    doubleMatched.forEach((l) => console.warn(`   ${l}`));
  }
  if (unmatched.length === 0 && doubleMatched.length === 0) {
    console.log("\n✓ taxon coverage: every currently-assessed species is matched by exactly one taxon.");
  }
}

// =============================================================================
// ASSESSMENT HISTORY
// =============================================================================

export interface AssessmentHistoryEntry {
  id: number;
  year: string;
  category: string;
  date: string | null;
  criteria: string | null;
  assessors: string | null;
  reviewers: string | null;
}

export type AssessmentHistoryMap = Record<string, AssessmentHistoryEntry[]>;

export async function fetchAssessmentHistory(
  pgClient: Client,
  taxon: Taxon,
): Promise<AssessmentHistoryMap> {
  const result: AssessmentHistoryMap = {};

  for (const query of taxon.redlist) {
    const sql = `
      SELECT
        t.sis_id as sis_taxon_id,
        a.id as assessment_id,
        a.year_published,
        rlc.code as category,
        a.assessment_date,
        a.criteria,
        ac_assessors.supplementary_fields->>'full' as assessors,
        ac_reviewers.supplementary_fields->>'full' as reviewers
      FROM taxons t
      JOIN assessments a ON a.taxon_id = t.id
      JOIN assessment_scopes ascope ON ascope.assessment_id = a.id
      JOIN red_list_category_lookup rlc ON rlc.id = a.red_list_category_id
      LEFT JOIN assessment_credits ac_assessors ON ac_assessors.assessment_id = a.id AND ac_assessors.credit_type_id = 1
      LEFT JOIN assessment_credits ac_reviewers ON ac_reviewers.assessment_id = a.id AND ac_reviewers.credit_type_id = 2
      WHERE t.${query.filterColumn} = ANY($1)
        AND t.latest = true
        AND a.suppress = false
        AND ascope.scope_lookup_id = 15
        AND t.infra_name IS NULL
        AND t.subpopulation_name IS NULL
      ORDER BY t.sis_id, a.year_published DESC, a.id DESC
    `;

    const rows = (await pgClient.query(sql, [query.filterValues])).rows;

    for (const row of rows) {
      const sisTaxonId = String(row.sis_taxon_id);
      const yearPublished = String(row.year_published);

      if (!result[sisTaxonId]) result[sisTaxonId] = [];

      // Deduplicate: keep only the first (highest assessment_id) per year
      const existing = result[sisTaxonId];
      if (existing.length > 0 && existing[existing.length - 1].year === yearPublished) {
        continue;
      }

      const assessmentDate = row.assessment_date
        ? new Date(row.assessment_date).toISOString().split("T")[0]
        : null;

      existing.push({
        id: Number(row.assessment_id),
        year: yearPublished,
        category: row.category,
        date: assessmentDate,
        criteria: row.criteria || null,
        assessors: row.assessors || null,
        reviewers: row.reviewers || null,
      });
    }
  }

  return result;
}

// =============================================================================
// CSV OUTPUT
// =============================================================================

const REDLIST_CSV_COLUMNS = [
  "sis_taxon_id", "scientific_name", "authority", "common_name", "class_name", "order_name",
  "family", "taxon_group_table1a", "assessment_id", "iucn_category", "assessment_date",
  "year_published", "population_trend", "countries", "systems", "growth_forms",
  "movement_pattern", "possibly_extinct", "possibly_extinct_in_the_wild",
  "criteria", "threat_codes", "habitat_codes", "synonyms",
];

/**
 * Encode synonyms as semicolon-separated `name:status` pairs.
 * Colon is safe as the within-pair delimiter (binomials are space-separated,
 * statuses are an enum, neither contains colons).
 */
export function encodeSynonyms(synonyms: RedlistSynonym[]): string {
  return synonyms.map((s) => `${s.name}:${s.status}`).join(";");
}

export function decodeSynonyms(raw: string | undefined): RedlistSynonym[] {
  if (!raw) return [];
  const result: RedlistSynonym[] = [];
  for (const part of raw.split(";")) {
    if (!part) continue;
    const idx = part.indexOf(":");
    if (idx === -1) {
      // Tolerate legacy/malformed entries with no status
      result.push({ name: part, status: "" });
    } else {
      result.push({ name: part.slice(0, idx), status: part.slice(idx + 1) });
    }
  }
  return result;
}

export function writeRedlistCsv(species: RedlistSpecies[], outputPath: string): void {
  const rows = species
    .map((s) => ({
      sis_taxon_id: s.sis_taxon_id,
      scientific_name: s.scientific_name,
      common_name: s.common_name,
      class_name: s.class_name,
      order_name: s.order_name,
      family: s.family,
      taxon_group_table1a: s.taxon_group_table1a,
      assessment_id: s.assessment_id,
      iucn_category: s.category,
      assessment_date: s.assessment_date,
      year_published: s.year_published,
      population_trend: s.population_trend,
      countries: s.countries.join(";"),
      systems: s.systems.join(";"),
      growth_forms: s.growth_forms.join(";"),
      movement_pattern: s.movement_pattern,
      possibly_extinct: s.possibly_extinct ? "true" : "",
      possibly_extinct_in_the_wild: s.possibly_extinct_in_the_wild ? "true" : "",
      criteria: s.criteria,
      threat_codes: s.threat_codes.join(";"),
      habitat_codes: s.habitat_codes.join(";"),
      synonyms: encodeSynonyms(s.synonyms),
    }));

  writeCsv(rows, REDLIST_CSV_COLUMNS, outputPath);
}

export function readRedlistCsv(taxonId: string): RedlistSpecies[] {
  const csvPath = path.join(REDLIST_DIR, `${taxonId}.csv`);
  return readCsv<RedlistSpecies>(csvPath, (r) => ({
    sis_taxon_id: parseInt(r.sis_taxon_id, 10),
    assessment_id: parseInt(r.assessment_id, 10),
    scientific_name: r.scientific_name,
    authority: r.authority || null,
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
    synonyms: decodeSynonyms(r.synonyms),
  }));
}

// =============================================================================
// MAIN
// =============================================================================

export async function run(opts: {
  taxa?: string[];
  historyOnly?: boolean;
  logger?: SyncLogger;
} = {}): Promise<void> {
  const taxaToSync = getTaxa(opts.taxa);
  const historyOnly = opts.historyOnly ?? false;
  const logger = opts.logger ?? SyncLogger.noop();

  const startTime = Date.now();

  const pgClient = new Client({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await pgClient.connect();
    console.log("Connected to IUCN database\n");

    // Only on a full sync (no taxon filter) — a single-taxon debug run
    // shouldn't spam warnings about all the OTHER taxa it didn't touch.
    if (!opts.taxa && !historyOnly) {
      await checkTaxonCoverage(pgClient);
    }

    logger.log("fetch_redlist_species_start", {
      taxa: taxaToSync.map((t) => t.id),
      historyOnly,
    });

    let totalSpecies = 0;

    for (const taxon of taxaToSync) {
      const taxonStart = Date.now();
      console.log(`\n${taxon.name} (${taxon.id}):`);

      if (!historyOnly) {
        const taxonSpecies: RedlistSpecies[] = [];
        for (const query of taxon.redlist) {
          const species = await fetchFromIucnDb(pgClient, taxon.id, query);
          console.log(`  Fetched ${species.length} species`);
          taxonSpecies.push(...species);
        }

        const outputPath = path.join(REDLIST_DIR, `${taxon.id}.csv`);
        writeRedlistCsv(taxonSpecies, outputPath);
        console.log(`  Wrote ${taxonSpecies.length} species → ${outputPath}`);
        totalSpecies += taxonSpecies.length;
      }

      const history = await fetchAssessmentHistory(pgClient, taxon);
      const historyDir = path.join(REDLIST_DIR, "history");
      fs.mkdirSync(historyDir, { recursive: true });
      const historyPath = path.join(historyDir, `${taxon.id}.json`);
      fs.writeFileSync(historyPath, JSON.stringify(history) + "\n");
      console.log(`  Wrote history for ${Object.keys(history).length} species → ${historyPath}`);

      const taxonDuration = ((Date.now() - taxonStart) / 1000).toFixed(1);
      logger.log("fetch_redlist_species_taxon", { taxon: taxon.id, fetched: totalSpecies, duration_seconds: Number(taxonDuration) });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;

    logger.log("fetch_redlist_species_complete", {
      total_species: totalSpecies,
      duration_seconds: Number(elapsed),
    });

    console.log("\n" + "=".repeat(50));
    console.log("fetch-redlist-species complete:");
    if (!historyOnly) console.log(`  Species: ${totalSpecies.toLocaleString()}`);
    console.log(`  Output:  ${REDLIST_DIR}/`);
    console.log(`  Duration: ${minutes}m ${seconds}s`);
  } finally {
    await pgClient.end();
  }
}

async function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const historyOnly = args.includes("--history-only");
  const taxonArg = args.find((a) => !a.startsWith("--"))?.toLowerCase();

  console.log(`fetch-redlist-species: IUCN Red List DB → ${historyOnly ? "history JSON" : "CSV + history JSON"}`);
  console.log("=".repeat(50));

  const logger = new SyncLogger("fetch-redlist-species");
  try {
    await run({ taxa: taxonArg ? [taxonArg] : undefined, historyOnly, logger });
  } finally {
    logger.close();
  }
}

const isDirectRun = process.argv[1]?.endsWith("fetch-redlist-species.ts") || process.argv[1]?.endsWith("fetch-redlist-species.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
