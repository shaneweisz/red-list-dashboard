/**
 * build-parquet (#261): build the DuckDB read substrate from the per-group
 * Red List + GBIF CSVs + history. Three lineage-sorted parquets (split by the
 * assessed-vs-unassessed scale/schema asymmetry — assessed is bounded ~172k,
 * unassessed balloons under CoL):
 *
 *  - assessed.parquet     = Red List assessed species, enriched with GBIF
 *      occurrence counts summed across ALL their mapping links (canonical-
 *      preferred representative key). Rich schema; columns match SpeciesRow.
 *      Includes denormalized latest_assessors/latest_reviewers (history seq 0)
 *      and assessment_count (count of history rows) so the species list needs
 *      no history join (full history is lazy).
 *  - unassessed.parquet   = GBIF species not linked to any assessment (minus
 *      domesticated), category 'NE'. Lean schema — taxonomy + occurrence count
 *      only (no assessment-only columns, no obs-after-assessment-year).
 *  - assessments.parquet  = flattened assessment history (one row per past
 *      assessment, seq-ordered) for the species detail panel.
 *
 * The canonical species read substrate: powers the species list, lazy history,
 * and cross-taxa search. Sorted by lineage so
 * DuckDB row-group min/max prunes any taxonomic filter.
 *
 *   npx tsx scripts/build-parquet.ts
 */
import * as fs from "fs";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnvFiles, DATA_DIR, REDLIST_DIR, GBIF_DIR } from "./utils";
import { EXCLUDED_DOMESTICATED_GBIF_KEYS } from "../src/lib/data/taxonomy-constants";

export async function run(): Promise<void> {
  const redlistGlob = path.join(REDLIST_DIR, "*.csv");
  const gbifGlob = path.join(GBIF_DIR, "*.csv");
  const mappingCsv = path.join(DATA_DIR, "mapping.csv");
  const historyDir = path.join(REDLIST_DIR, "history");
  const assessmentsOut = path.join(DATA_DIR, "assessments.parquet");
  const assessedOut = path.join(DATA_DIR, "assessed.parquet");
  const unassessedOut = path.join(DATA_DIR, "unassessed.parquet");
  const domesticated = [...EXCLUDED_DOMESTICATED_GBIF_KEYS].map((k) => `'${k}'`).join(",");

  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();

  // GBIF rows keyed by species key (globally unique across group files).
  await conn.run(`
    CREATE TEMP TABLE gbif_all AS
      SELECT
        CAST(gbif_species_key AS VARCHAR)        AS gbif_species_key,
        scientific_name, common_name,
        taxon_group_table1a                      AS taxon_group,
        lower(class_name) AS class_name, lower(order_name) AS order_name, lower(family) AS family,
        CAST(total_count AS BIGINT)              AS total_count,
        CAST(count_after_assessment_year AS BIGINT) AS count_after,
        countries
      FROM read_csv_auto('${gbifGlob}', union_by_name=true);
  `);

  await conn.run(`
    CREATE TEMP TABLE map AS
      SELECT CAST(sis_taxon_id AS BIGINT) AS sis_taxon_id,
             CAST(gbif_species_key AS VARCHAR) AS gbif_species_key,
             name_source
      FROM read_csv_auto('${mappingCsv}')
      WHERE gbif_species_key IS NOT NULL;
  `);

  // sis_taxon_id → its Red List group (one per species). Used to restrict GBIF
  // enrichment to the species' OWN group, matching species-store's per-group
  // gbifMap lookup (cross-group linked keys are not counted).
  await conn.run(`
    CREATE TEMP TABLE rl AS
      SELECT DISTINCT CAST(sis_taxon_id AS BIGINT) AS sis_taxon_id, taxon_group_table1a AS taxon_group
      FROM read_csv_auto('${redlistGlob}', union_by_name=true);
  `);

  // Per-assessment GBIF enrichment: one species, one key, one set of counts.
  //
  // This used to SUM counts across every linked GBIF row, which quietly turned a
  // species with more than one link into the union of several taxa. Combined with
  // a synonym link it is how assessed species came to display totals that were
  // not theirs — a species' own record count plus a congener's. Whatever the
  // representative key is, the numbers shown must be that key's numbers, so the
  // count a user sees and the search the link opens describe the same taxon.
  //
  // The representative key prefers a canonical-source match, then the lowest key,
  // which is deterministic across runs.
  await conn.run(`
    CREATE TEMP TABLE chosen_link AS
      SELECT
        m.sis_taxon_id,
        arg_min(m.gbif_species_key, (CASE WHEN m.name_source='canonical' THEN '0' ELSE '1' END) || m.gbif_species_key) AS gbif_species_key
      FROM map m
      JOIN rl ON rl.sis_taxon_id = m.sis_taxon_id
      JOIN gbif_all g ON g.gbif_species_key = m.gbif_species_key AND g.taxon_group = rl.taxon_group
      GROUP BY m.sis_taxon_id;
  `);
  await conn.run(`
    CREATE TEMP TABLE enrich AS
      SELECT
        c.sis_taxon_id,
        g.total_count  AS gbif_occurrence_count,
        g.count_after  AS gbif_observations_after_assessment_year,
        c.gbif_species_key
      FROM chosen_link c
      JOIN rl ON rl.sis_taxon_id = c.sis_taxon_id
      JOIN gbif_all g ON g.gbif_species_key = c.gbif_species_key AND g.taxon_group = rl.taxon_group;
  `);

  // History, loaded first so the latest assessors/reviewers can be denormalized
  // into assessed.parquet below. Flatten the map-shaped history/*.json into rows
  // (one per past assessment), preserving array order via `seq` (index 0 =
  // latest) so the lazy per-species history query can rebuild it in order.
  const ndjson = path.join(DATA_DIR, "_assessments.ndjson");
  const ws = fs.createWriteStream(ndjson);
  if (fs.existsSync(historyDir)) {
    for (const file of fs.readdirSync(historyDir).filter((f) => f.endsWith(".json"))) {
      const data = JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf-8")) as
        // criteria is optional on the parsed shape (not just the type) — history
        // files regenerated before it was added to fetchAssessmentHistory won't
        // have the key at all; `x.criteria ?? null` below handles that at runtime.
        Record<string, Array<{ id: number; year: string; category: string; date: string | null; criteria?: string | null; assessors: string | null; reviewers: string | null }>>;
      for (const [sis, arr] of Object.entries(data)) {
        arr.forEach((x, seq) => ws.write(JSON.stringify({ sis_taxon_id: Number(sis), seq, id: x.id, year: x.year, category: x.category, date: x.date, criteria: x.criteria ?? null, assessors: x.assessors, reviewers: x.reviewers }) + "\n"));
      }
    }
  }
  await new Promise<void>((res) => ws.end(res));
  // Explicit column types (not read_json_auto's sampled inference): criteria is
  // null on most pre-2001 assessments, and auto-inference over a column that's
  // sometimes null/sometimes string can land on JSON type instead of VARCHAR —
  // casting a JSON-typed value to VARCHAR then serializes it (embedding literal
  // quotes in the string) rather than unwrapping it.
  await conn.run(`
    CREATE TEMP TABLE hist AS
      SELECT sis_taxon_id, seq, id, "year", category, "date", criteria, assessors, reviewers
      FROM read_json('${ndjson}', format='newline_delimited', columns={
        sis_taxon_id: 'BIGINT', seq: 'INTEGER', id: 'BIGINT', "year": 'VARCHAR',
        category: 'VARCHAR', "date": 'VARCHAR', criteria: 'VARCHAR',
        assessors: 'VARCHAR', reviewers: 'VARCHAR'
      });
  `);
  fs.unlinkSync(ndjson);
  // Latest (seq 0 = most recent) assessors/reviewers per species. Denormalized
  // into assessed.parquet so the species list needs NO history join — the list
  // view's assessor/reviewer filter reads these scalars; the full history array
  // is fetched lazily (getAssessmentHistory) only when a detail panel opens.
  await conn.run(`
    CREATE TEMP TABLE latest_assess AS
      SELECT sis_taxon_id, assessors AS latest_assessors, reviewers AS latest_reviewers
      FROM hist WHERE seq = 0;
  `);

  // Number of assessments per species (#423 item 1) — one row in hist per past
  // assessment (already deduplicated to one per year by fetchAssessmentHistory),
  // so a plain count is exactly "how many times has this species been assessed."
  // Denormalized into assessed.parquet like latest_assess above, so the species
  // list needs no join at query time.
  await conn.run(`
    CREATE TEMP TABLE assess_count AS
      SELECT sis_taxon_id, count(*) AS assessment_count
      FROM hist GROUP BY sis_taxon_id;
  `);

  // Assessed (IUCN Red List) — the hot, bounded, rich dataset.
  await conn.run(`
    COPY (
      SELECT
        CAST(r.sis_taxon_id AS BIGINT)   AS id,
        r.scientific_name, r.common_name,
        r.taxon_group_table1a            AS taxon_group,
        lower(r.class_name) AS class_name, lower(r.order_name) AS order_name, lower(r.family) AS family,
        r.iucn_category,
        CAST(r.assessment_id AS BIGINT)  AS assessment_id,
        -- keep as raw strings (read_csv may infer DATE/INT) to match the CSV path
        CAST(r.assessment_date AS VARCHAR) AS assessment_date,
        CAST(r.year_published AS VARCHAR)  AS year_published,
        r.countries,
        e.gbif_species_key,
        e.gbif_occurrence_count,
        e.gbif_observations_after_assessment_year,
        -- arrays kept as raw ';'-joined strings (query layer splits, matching
        -- loadRedlistForGroup); booleans as 'true'.
        nullif(r.population_trend, '')    AS population_trend,
        r.systems, r.growth_forms,
        nullif(r.movement_pattern, '')    AS movement_pattern,
        coalesce(CAST(r.possibly_extinct AS VARCHAR), '') = 'true'             AS possibly_extinct,
        coalesce(CAST(r.possibly_extinct_in_the_wild AS VARCHAR), '') = 'true' AS possibly_extinct_in_the_wild,
        nullif(r.criteria, '')            AS criteria,
        r.threat_codes, r.habitat_codes,
        la.latest_assessors, la.latest_reviewers,
        coalesce(ac.assessment_count, 1)  AS assessment_count
      FROM read_csv_auto('${redlistGlob}', union_by_name=true) r
      LEFT JOIN enrich e ON e.sis_taxon_id = r.sis_taxon_id
      LEFT JOIN latest_assess la ON la.sis_taxon_id = r.sis_taxon_id
      LEFT JOIN assess_count ac ON ac.sis_taxon_id = r.sis_taxon_id
      ORDER BY class_name, order_name, family, scientific_name
    ) TO '${assessedOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  // Unassessed (GBIF species with no IUCN assessment) — cold, huge under CoL,
  // lean schema (no assessment-only columns).
  await conn.run(`
    COPY (
      SELECT
        -- Synthetic negative id; assessed rows use the positive sis_taxon_id.
        -- Was the negated GBIF key, which alphanumeric CoL keys cannot provide.
        -- Hashed rather than sequential because the dashboard persists pinned
        -- species by abs(id), so the id has to survive a resync that adds or
        -- removes species; masked to 2^53 so it stays exactly representable once
        -- the query layer turns it into a JS number. The assertion below rechecks
        -- uniqueness on every build rather than assuming it.
        -(hash(g.gbif_species_key) % 9007199254740992)::BIGINT AS id,
        g.scientific_name, g.common_name,
        g.taxon_group, g.class_name, g.order_name, g.family,
        'NE'                             AS iucn_category,
        g.countries,
        g.gbif_species_key,
        g.total_count                    AS gbif_occurrence_count
      FROM gbif_all g
      WHERE g.gbif_species_key NOT IN (SELECT DISTINCT gbif_species_key FROM map)
        AND g.gbif_species_key NOT IN (${domesticated})
      ORDER BY class_name, order_name, family, scientific_name
    ) TO '${unassessedOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  // Assessments (history) — persist the flattened rows (built above) sorted by
  // sis_taxon_id so a single-species lazy lookup prunes to one row group.
  await conn.run(`
    COPY (
      SELECT sis_taxon_id, seq, id, "year", category, "date", criteria, assessors, reviewers
      FROM hist
      ORDER BY sis_taxon_id, seq
    ) TO '${assessmentsOut}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  const q = async (sql: string) => (await (await conn.run(sql)).getRowObjects());
  const a = (await q(`
    SELECT count(*) n,
           count(*) FILTER (gbif_occurrence_count IS NOT NULL) with_obs,
           count(*) FILTER (gbif_observations_after_assessment_year IS NOT NULL) with_caa
    FROM '${assessedOut}'`))[0];
  const ne = (await q(`SELECT count(*) n FROM '${unassessedOut}'`))[0];
  console.log(`Wrote ${assessedOut}: ${a.n} assessed (with occurrence_count ${a.with_obs}, with count-after ${a.with_caa})`);
  console.log(`Wrote ${unassessedOut}: ${ne.n} unassessed (NE)`);
  const h = (await q(`SELECT count(*) nrows, count(DISTINCT sis_taxon_id) species FROM '${assessmentsOut}'`))[0];
  console.log(`Wrote ${assessmentsOut}: ${h.nrows} assessment events across ${h.species} species`);
  const dup = (await q(`SELECT count(*) c FROM (SELECT gbif_species_key FROM gbif_all GROUP BY 1 HAVING count(*)>1)`))[0].c;
  console.log(`  duplicate GBIF keys across group files: ${dup}`);

  // The unassessed id is a hash, so uniqueness is checked rather than assumed.
  const idDup = (await q(`SELECT count(*) c FROM (SELECT id FROM '${unassessedOut}' GROUP BY 1 HAVING count(*)>1)`))[0].c;
  if (Number(idDup) > 0) {
    throw new Error(`build-parquet: ${idDup} colliding synthetic ids in ${unassessedOut} — two unassessed species would share a row identity.`);
  }

  // Records since assessment are a subset of the total, so one exceeding the
  // other is arithmetically impossible and means counts from different taxa have
  // been mixed. 43 species were in this state after the previous attempt.
  const impossible = (await q(
    `SELECT count(*) c FROM '${assessedOut}' WHERE gbif_observations_after_assessment_year > gbif_occurrence_count`
  ))[0].c;
  if (Number(impossible) > 0) {
    throw new Error(
      `build-parquet: ${impossible} species have more records since assessment than in total. ` +
      `That cannot happen for a single taxon — counts from different taxa have been combined.`
    );
  }
}

const isDirectRun = process.argv[1]?.endsWith("build-parquet.ts") || process.argv[1]?.endsWith("build-parquet.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
}
