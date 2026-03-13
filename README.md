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

2. **Temporal Split**: GBIF records are split into two counts:
   - **Records at Assessment** — all occurrence data available when the assessment was made
   - **New Records Since** — observations added after the assessment date

3. **Record Type Breakdown**: Shows the source of records:
   - Human observations (including iNaturalist subset)
   - Preserved specimens (museum collections)
   - Machine observations (camera traps, acoustic sensors)

4. **Quality Filters**: Only geo-referenced records without coordinate issues

## Features

### Taxa Summary Table
Shows all taxonomic groups with species counts and GBIF occurrence totals. Click a row to drill down.

### Interactive Filter Charts
Three clickable charts for filtering species:
- **Category Distribution** — EX/EW/CR/EN/VU/NT/LC/DD
- **Years Since Assessment** — highlights species not reassessed in 10+ years
- **Assessment Count** — how many times a species has been reassessed

Charts support multi-select filtering (Cmd/Ctrl+click to select multiple) and cross-filter with the search bar.

### Species Table
- Search by scientific name
- Links to IUCN assessment pages
- Shows assessment history with category changes over time
- GBIF columns show records at assessment vs new records (with tooltips showing record type breakdown)

### Expandable Species Rows
Click any species row to see:
- **iNaturalist photos** — recent observations with images
- **Interactive map** — GBIF occurrence points plotted on a Leaflet map

### GBIF Dashboard (`/gbif`)
Alternative view focused on occurrence data with a world map for country-level filtering.

### GBIF Match Status Indicators
Shows data quality warnings when GBIF species matching is imperfect:
- **EXACT** — reliable match
- **FUZZY/VARIANT** — name variations matched
- **HIGHERRANK** — matched to genus/family only (counts may include other species)
- **NONE** — species not found in GBIF

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
                        ┌─────────────────┐
                        │  GBIF REST API  │────▶ Live queries (occurrences, photos)
                        └─────────────────┘
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
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

## Environment Variables

Create `app/.env.local` with:

```
RED_LIST_API_KEY=your_iucn_api_key
```

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
