/**
 * fetch-lumped-own-counts: occurrence counts for species Catalogue of Life lumps
 *
 * Some assessed species are, in CoL's view, synonyms of a different species. The
 * dashboard deliberately does not show them the other species' counts — that is
 * how a Critically Endangered Algerian willowherb came to display 295,698 records
 * of a common European one.
 *
 * But refusing the other species' records is not the same as having none. GBIF
 * holds the records identified under the species' own name against its own usage,
 * and those are legitimately its own:
 *
 *   Malus sieversii (VU)      146,340 shown -> 8,135 its own
 *   Epilobium numidicum (CR)  295,698 shown ->     0 its own
 *   Thymallus aeliani (EN)     73,641 shown ->    11 its own
 *
 * So blanking them outright trades a wrong number for no number when the right
 * number exists. This phase fetches it.
 *
 * These keys cannot come from the facet enumeration in fetch-gbif-species, which
 * only ever emits accepted usages — a synonym's own key is absent from it by
 * construction. So each is counted directly, and the results are appended to the
 * per-taxon GBIF CSVs where build-parquet already looks for them.
 *
 * Usage:
 *   npx tsx scripts/fetch-lumped-own-counts.ts
 */

import * as path from "path";
import {
  loadEnvFiles,
  SyncLogger,
  DATA_DIR,
  writeCsv,
  delay,
} from "./utils";
import { readMappingCsv } from "./match-redlist-species-to-gbif";
import { readRedlistCsv } from "./fetch-redlist-species";
import { readGbifCsv } from "./fetch-gbif-species";
import { getTaxa } from "./taxa";
import { GBIF_CHECKLIST_KEY, INCLUDED_BASIS_OF_RECORD } from "../src/lib/gbif";

// Counts are read from a faceted query over many keys at once rather than one
// request per species. Individually there are 6,000+ species and two counts each,
// which GBIF rate-limits long before it finishes — the first attempt at this got
// 2,750 species in and then 429'd for the rest of the run.
const BATCH_SIZE = 100;
// A taxonKey facet returns every ancestor of every match as well as the keys
// asked for, so the limit has to leave room for those or requested keys fall off
// the end. Verified per batch below rather than assumed.
const FACET_LIMIT = 2000;
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 2000;
const CURRENT_YEAR = new Date().getFullYear();

const LUMPED_CSV_PATH = path.join(DATA_DIR, "lumped-own-counts.csv");
const LUMPED_CSV_COLUMNS = [
  // sis_taxon_id is what lets build-parquet attribute these counts back to the
  // species. Without it the rows land in the file, get folded into gbif_rows, and
  // then join to nothing — the species still shows 0 (Pararge xiphioides sat on
  // 4,371 of its own records reading "no data"), and its key surfaces separately
  // in unassessed.parquet as a browsable species that does not exist.
  "sis_taxon_id",
  "gbif_species_key", "scientific_name", "taxon_group_table1a",
  "class_name", "order_name", "family", "total_count", "count_after_assessment_year",
];

interface LumpedSpecies {
  sisTaxonId: number;
  taxonId: string;
  gbifKey: string;
  scientificName: string;
  className: string;
  orderName: string;
  family: string;
  assessmentYear: number | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Occurrence counts for a batch of keys, from one faceted query.
 *
 * Returns a key → count map covering exactly the keys asked for. A key GBIF has
 * no records for is absent from the facet, which is indistinguishable from the
 * facet having been truncated — so the caller's keys are reconciled against the
 * response and a short facet is retried in smaller pieces rather than silently
 * read as a row of zeroes.
 */
async function countBatch(keys: string[], yearRange?: string): Promise<Map<string, number>> {
  const params = new URLSearchParams({
    checklistKey: GBIF_CHECKLIST_KEY,
    facet: "taxonKey",
    facetLimit: String(FACET_LIMIT),
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
    limit: "0",
  });
  for (const k of keys) params.append("taxonKey", k);
  if (yearRange) params.set("year", yearRange);
  INCLUDED_BASIS_OF_RECORD.forEach((b) => params.append("basisOfRecord", b));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://api.gbif.org/v1/occurrence/search?${params}`);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < MAX_RETRIES) {
          await delay(Math.pow(2, attempt) * BACKOFF_BASE_MS);
          continue;
        }
        throw new Error(`GBIF API error: HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`GBIF API error: HTTP ${res.status}`);

      const data = (await res.json()) as {
        facets?: Array<{ field: string; counts: Array<{ name: string; count: number }> }>;
      };
      const facet = data.facets?.find((f) => f.field === "TAXON_KEY");
      const counts = new Map<string, number>();
      for (const c of facet?.counts ?? []) counts.set(c.name, c.count);

      // If the facet filled up, a requested key could be missing because it was
      // cut off rather than because it has no records. Split and retry.
      if ((facet?.counts?.length ?? 0) >= FACET_LIMIT && keys.length > 1) {
        const halves = chunk(keys, Math.ceil(keys.length / 2));
        const merged = new Map<string, number>();
        for (const half of halves) {
          for (const [k, v] of await countBatch(half, yearRange)) merged.set(k, v);
        }
        return merged;
      }

      return new Map(keys.map((k) => [k, counts.get(k) ?? 0]));
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await delay(Math.pow(2, attempt) * BACKOFF_BASE_MS);
        continue;
      }
      throw err;
    }
  }
  throw new Error("GBIF count batch exhausted retries");
}

/**
 * Assessed species whose key the facet enumeration never emitted.
 *
 * Two kinds, both needing a count fetched directly:
 *
 * LUMPED — the resolution to another species was refused, so the key kept is the
 * species' own usage, which is a synonym and therefore absent from a facet over
 * accepted usages. Only taken when the match came from the species' OWN name: a
 * match reached through one of its Red List synonyms landed on a usage that CoL
 * assigns to a different species, and the records under that name are not safely
 * this species'. Catapodium borgesii (VU, Azores endemic) is the case — matched
 * via a synonym onto Catapodium marinum, a widespread European grass, and 19,901
 * records is not a number to hand an island endemic on that basis.
 *
 * NOT_IN_FACETS — the resolution was followed and the key is real, but it is not
 * species rank, so no speciesKey facet contains it. Fringilla polatzeki (EN) is
 * one: CoL ranks it a subspecies of Fringilla teydea, the demotion is correctly
 * followed, and then the key finds nothing to join to.
 */
export function loadLumpedSpecies(taxaIds?: string[]): LumpedSpecies[] {
  const mapping = readMappingCsv();
  const out: LumpedSpecies[] = [];

  for (const taxon of getTaxa(taxaIds)) {
    const fetched = readGbifCsv(taxon.id);
    for (const s of readRedlistCsv(taxon.id)) {
      const links = mapping.get(s.sis_taxon_id) ?? [];

      // Only species that came away with nothing. A species that already linked
      // to a key the facets emitted has its count; fetching its synonym usage as
      // well would add a second row under a second key, and since no assessed
      // species links to that key it would surface in unassessed.parquet as a
      // browsable species — a phantom duplicate of the accepted one. Skipping
      // these takes the phase from 56,395 species to the ~14,800 it is for.
      if (links.some((l) => l.gbif_species_key && fetched.has(l.gbif_species_key))) continue;

      const lumped = links.find(
        (l) =>
          l.unfetched_key &&
          !fetched.has(l.unfetched_key) &&
          // NO_GBIF_DATA keys are excluded, and the reason is worth recording
          // because it is not the obvious one. They are not keys GBIF has no
          // records for — they are keys the facet enumeration never emitted, and
          // sampling 300 of the 49,521 evenly found 0.7% do hold records. So
          // there is real data here, just not much: fetching all of them would
          // recover roughly 350 species at the cost of ~20 minutes on every
          // weekly sync. It is also not a regression — those species were absent
          // from the enumeration before this migration too, and showed no data
          // then either. Left for its own change rather than folded into this
          // one. (Beware sampling the head of this list: the first few are
          // well-recorded mammals and suggest a hit rate of 60%.)
          l.match_type !== "NO_GBIF_DATA" &&
          (l.match_type !== "LUMPED" || l.name_source === "canonical")
      );
      if (!lumped?.unfetched_key) continue;

      const year = s.assessment_date ? parseInt(s.assessment_date.slice(0, 4), 10) : NaN;
      out.push({
        sisTaxonId: s.sis_taxon_id,
        taxonId: taxon.id,
        gbifKey: lumped.unfetched_key,
        scientificName: s.scientific_name,
        className: s.class_name ?? "",
        orderName: s.order_name ?? "",
        family: s.family ?? "",
        assessmentYear: Number.isNaN(year) ? null : year,
      });
    }
  }
  return out;
}

export async function run(opts: { taxa?: string[]; logger?: SyncLogger } = {}): Promise<void> {
  const logger = opts.logger ?? SyncLogger.noop();
  const lumped = loadLumpedSpecies(opts.taxa);

  console.log(`  ${lumped.length} species CoL folds into another — counting their own records`);
  if (lumped.length === 0) return;

  // Totals: batched across all of them.
  const totals = new Map<string, number>();
  const allKeys = [...new Set(lumped.map((s) => s.gbifKey))];
  const totalBatches = chunk(allKeys, BATCH_SIZE);
  for (let i = 0; i < totalBatches.length; i++) {
    for (const [k, v] of await countBatch(totalBatches[i])) totals.set(k, v);
    process.stdout.write(`\r  Totals ${Math.min((i + 1) * BATCH_SIZE, allKeys.length)}/${allKeys.length}`);
  }
  console.log("");

  // Records since assessment: the window differs per species, so batch by the
  // assessment year they share.
  const byYear = new Map<number, string[]>();
  for (const sp of lumped) {
    if (sp.assessmentYear === null || sp.assessmentYear + 1 > CURRENT_YEAR) continue;
    const list = byYear.get(sp.assessmentYear) ?? [];
    list.push(sp.gbifKey);
    byYear.set(sp.assessmentYear, list);
  }
  const since = new Map<string, number>();
  let yearsDone = 0;
  for (const [year, keys] of byYear) {
    for (const batch of chunk([...new Set(keys)], BATCH_SIZE)) {
      for (const [k, v] of await countBatch(batch, `${year + 1},${CURRENT_YEAR}`)) since.set(k, v);
    }
    yearsDone++;
    process.stdout.write(`\r  Since-assessment windows ${yearsDone}/${byYear.size}`);
  }
  if (byYear.size > 0) console.log("");

  // Written as its own artifact rather than appended into the per-taxon CSVs.
  // Appending made the phase depend on run history: rows added by an earlier run
  // survived a later one, so tightening the rule that decides which species
  // qualify had no effect on species a looser rule had already added. A separate
  // file is rewritten whole every time, which makes the phase idempotent and the
  // pipeline reproducible from any starting point.
  // Only species that actually have records. A key can resolve perfectly and hold
  // nothing, and writing a zero for it is not the same as writing nothing: zero is
  // a value, so those rows would count as "has GBIF data" and the headline would
  // read 175,363 of 175,909 species — 99.7% coverage, produced entirely by
  // recording 60,601 absences as if they were measurements.
  const rows = lumped
    .filter((sp) => (totals.get(sp.gbifKey) ?? 0) > 0)
    .map((sp) => ({
    sis_taxon_id: sp.sisTaxonId,
    gbif_species_key: sp.gbifKey,
    scientific_name: sp.scientificName,
    taxon_group_table1a: sp.taxonId,
    class_name: sp.className,
    order_name: sp.orderName,
    family: sp.family,
    total_count: totals.get(sp.gbifKey) ?? 0,
    count_after_assessment_year: since.has(sp.gbifKey) ? since.get(sp.gbifKey)! : null,
  }));

  writeCsv(rows, LUMPED_CSV_COLUMNS, LUMPED_CSV_PATH);

  const withRecords = rows.filter((r) => r.total_count > 0).length;
  const totalRecords = rows.reduce((n, r) => n + r.total_count, 0);
  console.log(`  Wrote ${LUMPED_CSV_PATH}: ${rows.length} rows`);
  console.log(
    `  ${withRecords} of ${lumped.length} have records of their own (${totalRecords.toLocaleString()} in total)`
  );
  logger.log("fetch_lumped_own_counts", {
    species: lumped.length,
    with_records: withRecords,
    records: totalRecords,
  });
}

const isDirectRun =
  process.argv[1]?.endsWith("fetch-lumped-own-counts.ts") ||
  process.argv[1]?.endsWith("fetch-lumped-own-counts.js");
if (isDirectRun) {
  loadEnvFiles();
  run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
