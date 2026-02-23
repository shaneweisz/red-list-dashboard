# Red List Dashboard

A web application for visualizing **IUCN Red List assessment coverage and prioritization**, integrated with GBIF occurrence records. Designed to identify species that may need reassessment based on new evidence.

## Core Purpose

The dashboard answers questions like:
- Which species haven't been reassessed in 10+ years?
- Have new observations accumulated since the last assessment?
- Where are the knowledge gaps across taxonomic groups?

## How the Data Works

### Red List Data
- **Source**: Pre-downloaded IUCN Red List data stored as JSON files (one per taxon)
- **Coverage**: 8 taxonomic groups (Mammals, Birds, Reptiles, Amphibians, Fishes, Invertebrates, Plants, Fungi)
- **Fields**: Species name, IUCN category (CR/EN/VU/etc.), assessment date, historical assessments, population trend, range countries

### GBIF Integration
The key innovation - linking assessment data to real-world observations:

1. **Species Matching**: Each IUCN species is matched to GBIF using their species matching API (handles exact, fuzzy, and variant matches)

2. **Temporal Split**: GBIF records are split into two counts:
   - **Records at Assessment** - all occurrence data available when the assessment was made
   - **New Records Since** - observations added after the assessment date

3. **Record Type Breakdown**: Shows the source of records:
   - Human observations (including iNaturalist subset)
   - Preserved specimens (museum collections)
   - Machine observations (camera traps, acoustic sensors)

4. **Quality Filters**: Only geo-referenced records without coordinate issues

## Features

### 1. Taxa Summary Table
Shows all 8 taxonomic groups with species counts and GBIF occurrence totals. Click a row to drill down.

### 2. Interactive Filter Charts
Three clickable charts for filtering species:
- **Category Distribution** - EX/EW/CR/EN/VU/NT/LC/DD
- **Years Since Assessment** - highlights species not reassessed in 10+ years
- **Assessment Count** - how many times a species has been reassessed

Charts support multi-select filtering (Cmd/Ctrl+click to select multiple).

### 3. Species Table
- Search by scientific name
- Links to IUCN assessment pages
- Shows assessment history with category changes over time
- **GBIF columns** show records at assessment vs new records (with tooltips showing record type breakdown)

### 4. Expandable Species Rows
Click any species row to see:
- **iNaturalist photos** - recent observations with images
- **Interactive map** - GBIF occurrence points plotted on a Leaflet map

### 5. GBIF Dashboard (`/gbif`)
Alternative view focused on occurrence data with a world map for country-level filtering.

### 6. GBIF Match Status Indicators
Shows data quality warnings when GBIF species matching is imperfect:
- **EXACT** - reliable match
- **FUZZY/VARIANT** - name variations matched
- **HIGHERRANK** - matched to genus/family only (counts may include other species)
- **NONE** - species not found in GBIF

---

## Demo Example

The **Karoo Rock Elephant-Shrew** illustrates the dashboard's value:
- Listed as Data Deficient for 12 years
- Dashboard reveals 8 new iNaturalist observations since the assessment
- Shows where reassessment could now be justified with new evidence

---

## Key Talking Points

1. **Assessment Gaps**: Easily identify species not reassessed in years
2. **Evidence Accumulation**: See where new GBIF/iNaturalist data has emerged since assessments
3. **Prioritization**: Filter by category, age, and data availability to prioritize reassessment efforts
4. **Data Quality**: Record type breakdown and match status help assess reliability of occurrence data

Supports the "living Red List" concept - automatically surfacing where updated evidence bases exist.

## Architecture

```
Frontend: Next.js 16 + React 19 + Tailwind CSS
Maps: React-Leaflet with OpenStreetMap
Charts: Recharts

Data Flow:
┌─────────────────┐     ┌─────────────────┐
│  IUCN Red List  │────▶│  Local JSON     │────▶ API Routes
│  (pre-cached)   │     │  /data/*.json   │
└─────────────────┘     └─────────────────┘
                                              ↓
┌─────────────────┐                      Dashboard UI
│  GBIF API       │──────────────────────────▶
│  (live queries) │
└─────────────────┘
```

## Getting Started

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

Create `app/.env.local` with:

```
RED_LIST_API_KEY=your_iucn_api_key
```

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Recharts
- React-Leaflet

## Proof Workflow

This repo includes an agent-agnostic proof harness that validates features with browser assertions, screenshots, and video.

### Run feature proof locally

```bash
cd app
npm run proof:feature -- --name feature-title-rename --route / --phase after --theme both
```

Generated proof artifacts:

- `app/test-results/proof/<feature-id>/<phase>/proof-report.json`
- `app/test-results/proof/<feature-id>/<phase>/screenshots/*`
- `app/test-results/proof/<feature-id>/<phase>/artifacts/*` (video/trace/test output)

### Compare before vs after reports

```bash
cd app
npm run proof:pr:compare -- --before ../artifacts/before/proof-report.json --after ../artifacts/after/proof-report.json
```

### Trigger proof in PRs

- Add label `needs-proof` to a PR, or
- Comment on a PR with `/proof name=<feature-id> route=<path>`

The workflow runs both base and head commits, uploads artifacts, and updates a single `Proof of Implementation` PR comment.

See [AGENT_PROOF.md](/Users/shaneweisz/Repos/red-list-dashboard/AGENT_PROOF.md) for the contract expected from agents.
