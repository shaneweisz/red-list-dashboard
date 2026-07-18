# Scoping: GBIF coordinate cleaning (CoordinateCleaner-style)

Investigation into integrating R's [CoordinateCleaner](https://github.com/ropensci/CoordinateCleaner) (Zizka et al. 2019) — or equivalent logic — to flag/clean bad GBIF occurrence records in the dashboard.

## TL;DR recommendation

- **Don't shell out to R.** Reimplement the relevant checks as pure, well-tested TypeScript, validated against CoordinateCleaner's own `testthat` fixtures. No R/Python runtime exists in this pipeline today, and the only place coordinate cleaning would matter (`/api/occurrences`) is a Vercel serverless function — not a good place to add an R dependency.
- **Only one code path has real coordinates**: `app/src/app/api/occurrences/route.ts` → `OccurrenceMapRow.tsx`. The batch sync pipeline (`sync.ts` and friends) never touches lat/lon — it only ever sums GBIF's server-side facet *counts*, so CoordinateCleaner-style geometric tests don't apply there at all.
- **Ship it in phases**, ordered by reference-data cost — cheap/no-reference tests first (zero coords, equal coords, duplicates, GBIF-HQ point), then small point-gazetteers (capitals, centroids, institutions), then polygon-based tests (sea, urban, country) which need bundled Natural Earth GeoJSON + a point-in-polygon lib. Skip `cc_iucn` (needs licensed IUCN range polygons) and the fossil-level `cf_*` tests (not relevant — `basisOfRecord` is already a user-facing filter toggle, not something we auto-clean).

## 1. Where this would plug in

This repo has two independent GBIF integrations, and it matters which one we're cleaning:

| Path | What it fetches | Has coordinates? |
|---|---|---|
| Batch pipeline (`app/scripts/fetch-gbif-species.ts`, `fetch-gbif-country-data.ts`, `fetch-gbif-new-counts.ts`) | GBIF `/occurrence/search` with `facet=speciesKey`/`country`, `limit=0` — server-side aggregation | **No** — only species/country + count ever lands in `data/*.csv` → `assessed.parquet` |
| Live per-occurrence route (`app/src/app/api/occurrences/route.ts`) | GBIF `/occurrence/search` fetched fresh per page request, converted to GeoJSON, rendered by `OccurrenceMapRow.tsx` | **Yes** — `decimalLatitude/decimalLongitude`, `basisOfRecord`, `coordinateUncertaintyInMeters`, `institutionCode`, `country`, etc. |

There's no on-disk/queryable table of individual occurrence points anywhere — the live route is stateless (`cache: "no-store"` upstream, short HTTP cache on the response). So a cleaning step here is necessarily a **per-request, per-page computation**, not a batch precompute — unless we deliberately add a new storage layer (out of scope for a first pass; flag as an open question below).

`OccurrenceMapRow.tsx` already has the right shape of UI for this: it classifies every record into togglable categories (`iNaturalist`, `humanOther`, `fossilSpecimen`, `preservedSpecimen`, …) and has a numeric coordinate-uncertainty threshold filter. A "flagged" category (or a few, one per failed test) slots into that existing pattern rather than requiring new UI scaffolding.

## 2. What GBIF already gives us for free

GBIF's own occurrence records carry an `issues` array (60+ possible values, see [GBIF issues/flags docs](https://techdocs.gbif.org/en/data-use/occurrence-issues-and-flags)), and the fetch code already requests `hasCoordinate=true&hasGeospatialIssue=false`. These are **parsing/interpretation** diagnostics, not plausibility checks — e.g. `ZERO_COORDINATE`, `COORDINATE_OUT_OF_RANGE`, `COUNTRY_COORDINATE_MISMATCH`. Rough mapping to CoordinateCleaner:

- Already covered by GBIF, low value to reimplement: `cc_val` (validity), most of `cc_zero` (GBIF's `ZERO_COORDINATE` is exact 0,0; CoordinateCleaner adds a 0.5° buffer + lone-axis-zero case, which is a genuine small addition).
- **Not covered by GBIF at all — this is where CoordinateCleaner earns its keep**: coordinates that are valid, self-consistent, and in the right country, but sitting on a capital city, a country/province centroid, a museum/herbarium, GBIF's own Copenhagen HQ, or in the ocean/an urban area for a terrestrial species. These require an external gazetteer or land/sea mask GBIF doesn't maintain.

Zizka et al.'s own numbers: ~3.6% of GBIF plant records flagged at the record level; in the package's GBIF vignette, ~7% of a lion dataset failed the coordinate tests. Worth setting rough expectations that this is a modest-percentage cleanup, not a major rewrite of what's shown.

## 3. Every CoordinateCleaner test, and whether it's worth porting

| Function | Detects | Reference data needed | Verdict |
|---|---|---|---|
| `cc_zero` | Exact (0,0), or lone-axis zero, within a small buffer | none | **Ported** (phase 1) |
| `cc_equ` | lat == lon (data-entry artifact) | none | **Ported** (phase 1) |
| `cc_gbif` | Point at GBIF's Copenhagen HQ (~55.67, 12.58) | 1 hardcoded point | **Ported** (phase 1) |
| `cc_dupl` | Exact/near-duplicate records | none (self-referential) | **Ported** (phase 1) |
| `cc_cap` | Near a country's political capital | small capitals table | **Ported** (phase 2) — 200 capitals, Natural Earth, see §4 |
| `cc_cen` | Near a country centroid | small centroids table | **Ported** (phase 2) — 250 country centroids, mledoze/countries; province-level centroids out of scope (see §4) |
| `cc_inst` | Near a biodiversity institution (museum/herbarium/zoo) | ~11.6k-row gazetteer | **Ported** (phase 2) — 6,062-point gazetteer from GBIF's own GRSciColl API instead of CoordinateCleaner's bundled table (see §4) |
| `cc_sea` | Terrestrial point falls in the ocean | Natural Earth land polygons | **Ported** (phase 3) — 1,420 polygons, Natural Earth 50m land layer (upgraded from 110m after a real coastal species showed 110m was too coarse), see §4 |
| `cc_urb` | Point falls in an urban area | Natural Earth urban-areas polygons | **Ported** (phase 3) — 2,143 polygons, Natural Earth 50m urban areas, see §4 |
| `cc_coun` | Point outside the record's reported country | Natural Earth country polygons | **Lower priority** — GBIF's `COUNTRY_COORDINATE_MISMATCH` already covers most of this |
| `cc_outl` | Per-species geographic outlier vs. that species' other records | none, but needs the *whole* species' point set, not one page | **Deferred** — current route is paginated per-request (capped at 5,000 records/species); needs either a full-species prefetch or architecture change. Upstream also requires `min_occs=7` unique locations to run at all. |
| `cd_round` | Rasterization/rounding bias — flags whole datasets where too high a fraction of records share suspiciously round coordinates (e.g. everything landing on whole-degree or whole-minute grid lines) | none (statistical, whole-dataset) | **Deferred** — a `dataset`-level test over an entire GBIF dataset's records, not a per-record or per-species one; same architectural mismatch as `cc_outl` (our route only ever sees one species' paginated page, never a whole source dataset) |
| `cd_ddmm` | Degree-minutes-as-decimal-degrees transcription errors — flags whole datasets where too many records cluster at fractional values that look like unconverted MM.MM (e.g. `.51`, `.52`) rather than a real geographic spread | none (statistical, whole-dataset) | **Deferred** — same whole-dataset requirement as `cd_round`/`cc_outl` |
| `cc_aohi` | Point matches a curated list of recurring erroneous coordinates across birds/insects/mammals/plants (Park et al. 2023 "Artificial Hotspot Occurrence Inventory") | `aohi` gazetteer — bundled with CoordinateCleaner under GPL-3, but also independently deposited by the paper's authors on [Dryad](https://datadryad.org/dataset/doi:10.5061/dryad.v41ns1s0p) / [Zenodo](https://zenodo.org/records/7268229) under **CC0** (public domain) — 4 CSVs (birds/insects/mammals/plants), Oct 2022 snapshot | **Ported** (phase 4) — 231 points sourced from the CC0 Dryad/Zenodo deposit (kept only `determination === "FALSE"` rows, i.e. confirmed artificial, across all four taxa), not from CoordinateCleaner's bundled copy; same shape as `cc_cap` (buffer = 10,000m geodesic, per upstream's default), see §4 |
| `cc_iucn` | Point outside species' known range | **Licensed** IUCN range polygons, not bundled with the package | **Skip** — access/licensing blocker independent of this project; this dashboard has no IUCN spatial/range data anywhere today (only assessment metadata — category, criteria, etc.), so there's no shortcut available; revisit only if the app already has an IUCN spatial-data agreement |
| `cf_*` (fossil age checks) | Fossil-specific temporal errors | — | **Skip** — `basisOfRecord` is already a user-facing filter, and fossils are excluded entirely from the batch pipeline's queries |

Note on `cc_cen`'s province-level centroids specifically (upstream's default `test="both"` tests country *and* province/state centroids): out of scope for the same reason as the row above — see §4's centroids bullet for why no independently-sourced province-centroid dataset was worth adding in phase 2.

For context, CoordinateCleaner's own `clean_coordinates()` wrapper doesn't actually enable every test above by default — its out-of-the-box `tests` list is `capitals, centroids, equal, gbif, institutions, outliers, seas, zeros` (`cc_dupl` and `cc_urb` both require explicit opt-in upstream). We ship both anyway, so our default flag set is slightly more aggressive than CoordinateCleaner's own defaults.

## 4. Reference data — sourcing without copying CoordinateCleaner's bundled tables

CoordinateCleaner's `countryref`/`institutions`/`aohi` data objects are bundled with the package under its GPL-3 license. Rather than extracting and redistributing those R data objects verbatim (murky for a repo with no stated license of its own), source equivalents independently:

- **Capitals** (phase 2, shipped): Natural Earth 1:50m populated places, via the [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson) GeoJSON mirror, filtered to `ADM0CAP === 1` — 200 capitals, public domain. See `app/src/lib/coordinate-cleaning-refdata/README.md`.
- **Centroids** (phase 2, shipped): [mledoze/countries](https://github.com/mledoze/countries) (MIT), each country's `latlng` field — 250 country centroids. Province-level centroids (part of upstream `cc_cen`'s default `test="both"`) are out of scope — no independently-sourced province-centroid dataset was worth the added complexity for phase 2.
- **Institutions** (phase 2, shipped): GBIF operates the **GRSciColl** registry itself (`api.gbif.org/v1/grscicoll/institution`) — pulled 6,062 institutions with valid coordinates from GBIF's own API instead of needing CoordinateCleaner's compiled table. Keeps the whole pipeline sourced from GBIF, sidesteps the licensing question entirely, and can be refreshed with `npx tsx scripts/fetch-coordinate-cleaning-refdata.ts` since GRSciColl grows over time (unlike capitals/centroids, which are static).
- **Land/sea mask** (phase 3, shipped): Natural Earth 1:50m land layer, via the martynafford mirror — 1,420 polygons, coordinates rounded to ~110m precision to cut bundle size (2.76MB → 1.07MB). Public domain, no CoordinateCleaner dependency. Started at Natural Earth's coarsest 110m scale (matching CoordinateCleaner's own `cc_sea` default) but upgraded to 50m after real GBIF data (*Breviceps macrops*, a coastal-dwelling frog) exposed genuinely-offshore records — confirmed several km out in open water via satellite imagery — that 110m's coastline simplification missed entirely.
- **Urban areas** (phase 3, shipped): Natural Earth 1:50m urban areas layer, same mirror — 2,143 polygons, rounded to ~11m precision (1.97MB → 730KB). Point-in-polygon via `@turf/boolean-point-in-polygon`, with a manual bounding-box pre-filter (see `coordinate-cleaning.ts`) — benchmarked at <30ms for 2,000 records against the full urban-areas set.
- **Country borders**: not pulled in — `cc_coun` stayed out of scope since GBIF's own `COUNTRY_COORDINATE_MISMATCH` issue flag already covers most of what it would catch.
- **Artificial hotspots** (phase 4, shipped): Park et al.'s own [Dryad](https://datadryad.org/dataset/doi:10.5061/dryad.v41ns1s0p)/[Zenodo](https://zenodo.org/records/7268229) deposit of the AHOI dataset (CC0) — independent of CoordinateCleaner's bundled `aohi` object (GPL-3), despite backing the same `cc_aohi` check. See `app/src/lib/coordinate-cleaning-refdata/README.md` for the exact filtering applied.

## 5. Testing strategy ("well tested to match that package")

CoordinateCleaner has a `testthat` suite on GitHub (`tests/testthat/test_coordinatelevel_functions.R` etc.) with small synthetic data.frames and expected boolean flag vectors per function — plain, human-readable R. Recommended approach:

1. For each ported `cc_*` function, read its upstream test file and **hand-transcribe the input points + expected pass/fail outcomes** into a TS/vitest table-driven test (don't commit the raw GPL-3 R source into this repo — reimplement the *cases*, not copy the file).
2. Cross-check a handful of cases against a live `Rscript` run of the real package during development (one-time, not part of CI) to catch any transcription drift.
3. Follow this repo's existing test pattern: pure exported functions with explicit inputs (mirrors `match-redlist-species-to-gbif.ts`'s `MatchFn`-injection pattern in `app/scripts/__tests__/match-redlist-species-to-gbif.test.ts`), so each check is testable without a live GBIF or network call.

## 6. Proposed shape (phase 1)

- New module, e.g. `app/src/lib/coordinate-cleaning.ts`: pure functions `isZeroCoordinate`, `isEqualLatLon`, `isNearGbifHq`, `isDuplicate`, etc., each returning a flag reason; a `cleanOccurrence(record): string[]` that runs the active set and returns failed-check names.
- Apply in `app/src/app/api/occurrences/route.ts` when building GeoJSON features — attach `properties.qualityFlags: string[]`.
- Extend `OccurrenceMapRow.tsx`'s existing checkbox-filter pattern with a "flagged records" toggle (default: hidden, matching how `hasGeospatialIssue=false` already hides GBIF's own flags today), and a count badge — similar precedent to the recently-added "# Outdated" tooltip treatment.

## 7. Open questions before implementation

- **Scope for v1**: just phase 1 (zero/equal/GBIF-HQ/duplicates — no reference data, ships fast) plus phase 2 (capitals/centroids/institutions), or push straight through phase 3 (sea/urban, needs `@turf/turf` + bundled Natural Earth GeoJSON as a new dependency)?
- **UI**: hide flagged records by default (extra cleaning, matches current `hasGeospatialIssue=false` behavior) or show them dimmed/distinct with an opt-in toggle to hide (more transparent, lets users judge borderline cases)?
- **`cc_outl` / dataset-level checks**: worth a follow-up architecture change (prefetch a full species' points instead of paginated pages) or out of scope entirely for now?
- Confirm no plan to actually shell out to R — everything above assumes a from-scratch TS reimplementation validated against upstream test fixtures.
