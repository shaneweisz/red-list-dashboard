# Red List Dashboard

A web application for visualizing **IUCN Red List assessment coverage and prioritization**, integrated with GBIF occurrence records. Designed to identify species that may need reassessment based on new evidence.

## Core Purpose

The dashboard answers questions like:
- Which species haven't been reassessed in 10+ years?
- Have new observations accumulated since the last assessment?
- Where are the knowledge gaps across taxonomic groups?

## How the Data Works

### Red List Data
- **Source**: Pre-downloaded IUCN Red List data stored as per-taxon CSV files
- **Coverage**: 21 taxonomic groups across vertebrates, invertebrates, plants, fungi, and protists
- **Fields**: Species name, IUCN category (CR/EN/VU/etc.), assessment date, historical assessments, population trend, range countries

### GBIF Integration
The key innovation — linking assessment data to real-world observations:

1. **Species Matching**: Each IUCN species is matched to GBIF using their species matching API (handles exact, fuzzy, and variant matches). Results stored in `data/mapping.csv`.

2. **Observation Counts**: For each species, the dashboard shows:
   - **Total GBIF** — all geo-referenced occurrence records
   - **New GBIF** — count of records added after the assessment year
   - **% New GBIF** — percentage of records added after the assessment year

3. **Record Type Breakdown**: Shows the source of records:
   - Human observations (including iNaturalist subset)
   - Preserved specimens (museum collections)
   - Machine observations (camera traps, acoustic sensors)

4. **Quality Filters**: Only geo-referenced records without coordinate issues

## Features

### Taxa Summary Table
Shows all taxonomic groups with species counts, assessment coverage, outdated assessment percentages, and GBIF occurrence totals. Click a row to drill down. Includes a Red List vs GBIF focus mode toggle and column visibility controls.

### Interactive Filter Charts
Four clickable charts for filtering species:
- **Risk Category** — EX/EW/CR/EN/VU/NT/LC/DD
- **Years Since Assessed** — highlights species not reassessed in 10+ years
- **Country** — world map with species/GBIF toggle
- **GBIF Observations** — distribution by observation count range

Charts support multi-select filtering (Cmd/Ctrl+click to select multiple) and cross-filter with the search bar.

### Species Table
- Search by scientific name
- Sortable by assessment date (default, oldest first), category, total GBIF records, or % new GBIF
- Secondary sort by total GBIF (descending) when primary values tie
- Links to IUCN assessment pages and GBIF occurrence search
- Pin species to the top of the table with drag-to-reorder

### Expandable Species Rows
Click any species row to see a tabbed (or stacked) detail view:
- **GBIF Map** — occurrence points on a MapLibre GL map + iNaturalist photo gallery
- **Literature** — papers published since the last assessment (from OpenAlex)
- **Red List** — full assessment details including criteria, population trend, threats, conservation actions, and rationale
- **CITES** — trade status, suspensions, quotas, and trade flow map

### GBIF Match Status Indicators
Shows data quality warnings when GBIF species matching is imperfect:
- **EXACT** — reliable match
- **FUZZY/VARIANT** — name variations matched
- **HIGHERRANK** — matched to genus/family only (counts may include other species)
- **NONE** — species not found in GBIF

### Dark Mode
Light, dark, and system theme modes.

---

## Architecture

```
Frontend: Next.js 16 + React 19 + Tailwind CSS 4
Maps:     MapLibre GL (react-map-gl) + react-simple-maps
Charts:   Recharts
Data:     SWR for client-side fetching
Hosting:  Vercel

Data Flow:
┌─────────────────┐  scripts/sync.ts   ┌──────────────────┐  httpfs / prebuild ┌───────────────┐
│  IUCN Red List   │───────────────────▶│  CSVs + parquets │───────────────────▶│  app/data/     │──▶ API Routes ──▶ UI
│  GBIF API        │  (offline pipeline)│  in private R2   │  (DuckDB at runtime│  (local copy)  │
│  Catalogue of Life│                    │                  │   / build-time)    │                │
└─────────────────┘                    └──────────────────┘                   └───────────────┘
                          version pinned by app/latest-sync.txt (git-tracked)

Live external APIs:
  GBIF REST API     → occurrence points, record breakdowns, iNaturalist photos
  Species+ API      → CITES listings, trade data
  OpenAlex          → scientific literature since last assessment
```

## Data Sync Pipeline

The `scripts/` directory contains a pipeline for refreshing all static data files:

```bash
npx tsx scripts/sync.ts                  # Full sync, all taxa
npx tsx scripts/sync.ts mammalia aves    # Specific taxa only
```

**Pipeline phases:**
1. `fetch-redlist-species` — Red List database → per-taxon CSVs in `data/redlist/`
2. `fetch-gbif-species` — GBIF API → per-taxon CSVs in `data/gbif/`
3. `match-redlist-species-to-gbif` — GBIF Match API → `data/mapping.csv`
4. `fetch-gbif-country-data` — GBIF API → per-species country occurrence counts
5. `fetch-gbif-new-counts` — GBIF API → updates GBIF CSVs with temporal splits
6. `build-taxa-summary` — aggregates per-taxon CSVs → `data/taxa-summary.json` and `data/node-children-summaries.json`
7. `build-parquet` — CSVs → `assessed.parquet` / `unassessed.parquet` (the DuckDB read layer; also powers cross-taxa search)

Phases 8–10 build the **Catalogue of Life backbone** (run on a full sync only) — the described-species universe behind the new-assessments view, which surfaces species CoL knows about that IUCN hasn't yet evaluated:
8. `fetch-coldp` — CoL eXtended Release ColDP archive → `NameUsage.tsv` (downloaded to a temp dir, not `data/`)
9. `build-backbone` — `NameUsage.tsv` → `backbone.parquet` (tree + synonyms) + `species/` (accepted-species universe, partitioned; tagged `extinct`/`in_base`)
10. `build-matching` — reconciles IUCN/GBIF species to CoL → `species_link.parquet` (`{sis_taxon_id, gbif_species_key} → col_id`, via accepted-name + CoL/IUCN synonym matching)

**Publishing a refresh.** `app/data/` lives in a private R2 bucket; the active version is pinned via `app/latest-sync.txt`. To publish a fresh sync:

```bash
npx tsx scripts/sync.ts                # regenerate app/data/ locally
npm run diff-data-vs-r2                # spot-check what changed vs the live pinned sync
npm run upload-data-to-r2              # upload to R2, bump app/latest-sync.txt
git add app/latest-sync.txt && git commit -m "Bump data sync to <ts>"
git push                               # open PR; merging flips production
```

Production only switches to the new sync once the pointer-bump PR merges to main and Vercel redeploys.

## Getting Started

```bash
cd app
npm install
npm run fetch-data-from-r2   # populates app/data/ from private R2 (requires R2 creds in .env.local)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The Red List CSVs live in a private R2 bucket rather than in the repo, so the first step downloads them locally (~240MB). `npm run build` runs the same fetch automatically as `prebuild`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build (auto-runs `fetch-data-from-r2` first) |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with a coverage report (scoped to the `src` logic layer; HTML report in `coverage/`) |
| `npm run fetch-data-from-r2` | Download the sync pinned in `app/latest-sync.txt` from R2 into `app/data/` |
| `npm run upload-data-to-r2` | Upload current `app/data/` to R2 as a new timestamped sync and bump `app/latest-sync.txt` |
| `npm run diff-data-vs-r2` | Diff local `app/data/` against the currently-pinned R2 sync |

## Environment Variables

Create `app/.env.local` with at least the R2 credentials (required to fetch `app/data/`):

```
# Cloudflare R2 — required for fetch-data-from-r2 / prebuild
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_DATA_BUCKET_NAME=dashboard-data

# Live external APIs — needed at runtime for the Red List assessment-detail and CITES tabs
RED_LIST_API_KEY=your_iucn_api_key
SPECIES_PLUS_API_KEY=your_cites_species_plus_api_key

# IUCN Red List Postgres database — needed only to run the data sync pipeline
DB_HOST=your_db_host
DB_PORT=your_db_port
DB_NAME=your_db_name
DB_USER=your_db_user
DB_PASSWORD=your_db_password
```

See `app/.env.example` for the full list including database and analytics keys.

## Tech Stack

- **Next.js 16** — React framework
- **React 19** — UI library
- **TypeScript 5** — Type safety
- **Tailwind CSS 4** — Styling
- **Recharts** — Charts and graphs
- **MapLibre GL** (react-map-gl) / **react-simple-maps** — Maps
- **SWR** — Client-side data fetching
- **Vitest** — Testing
- **Vercel** — Hosting and deployment
