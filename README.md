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
- **Coverage**: 22 taxonomic groups across vertebrates, invertebrates, plants, fungi, and protists
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
- **GBIF Map** — occurrence points on a Leaflet map + iNaturalist photo gallery
- **Literature** — papers published since the last assessment (from OpenAlex and Nosible)
- **Red List** — full assessment details including criteria, population trend, threats, conservation actions, and rationale
- **CITES** — trade status, suspensions, quotas, and trade flow map

### Assessment Criteria Estimation
Interactive IUCN Criterion B calculator using GBIF occurrence data:
- Computes EOO (Extent of Occurrence), AOO (Area of Occupancy), and number of locations
- Temporal trend analysis
- Adjustable parameters (min year, max uncertainty, grid size, cluster distance)
- Visualizes convex hull and grid cells on the map

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
Maps:     React-Leaflet + react-simple-maps
Charts:   Recharts
Data:     SWR for client-side fetching
Hosting:  Vercel

Data Flow:
┌─────────────────┐     ┌─────────────────┐
│  IUCN Red List   │────▶│  Static CSVs    │────▶ API Routes ────▶ Dashboard UI
│  (pre-cached)   │     │  data/redlist/   │
└─────────────────┘     └─────────────────┘
┌─────────────────┐     ┌─────────────────┐
│  GBIF API       │────▶│  Static CSVs    │────▶ API Routes ────▶ Dashboard UI
│  (pre-cached)   │     │  data/gbif/     │
└─────────────────┘     └─────────────────┘

Live external APIs:
  GBIF REST API     → occurrence points, record breakdowns, iNaturalist photos
  Species+ API      → CITES listings, trade data
  OpenAlex / Nosible → scientific literature since last assessment
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
4. `fetch-gbif-new-counts` — GBIF API → updates GBIF CSVs with temporal splits
5. `build-taxa-summary` — aggregates per-taxon CSVs → `data/taxa-summary.json`

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
| `npm run fetch-data-from-r2` | Download the latest `app/data/` sync from R2 |
| `npm run upload-data-to-r2` | Upload current `app/data/` to R2 as a new timestamped sync |

## Environment Variables

Create `app/.env.local` with at least the R2 credentials (required to fetch `app/data/`):

```
# Cloudflare R2 — required for fetch-data-from-r2 / prebuild
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_DATA_BUCKET_NAME=dashboard-data

# Used by the data sync pipeline (not needed for local dev once app/data/ is populated)
RED_LIST_API_KEY=your_iucn_api_key
SPECIES_PLUS_API_KEY=your_cites_species_plus_api_key
```

See `app/.env.example` for the full list including database and analytics keys.

## Tech Stack

- **Next.js 16** — React framework
- **React 19** — UI library
- **TypeScript 5** — Type safety
- **Tailwind CSS 4** — Styling
- **Recharts** — Charts and graphs
- **React-Leaflet** / **react-simple-maps** — Maps
- **SWR** — Client-side data fetching
- **Vitest** — Testing
- **Vercel** — Hosting and deployment
