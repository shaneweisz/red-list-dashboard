# Changelog

All notable changes to the IUCN Red List Assessments Dashboard.

## [v2.2.0] — 2026-03-15 – 2026-03-18 — CI, Monitoring & Data Updates

- Added CI workflows: TypeScript type checking and test runner
- Added Sentry error monitoring, tracing, and logging
- Added top iNaturalist observers/identifiers chart below occurrence map
- Optimized GBIF country fetching with kingdom-level query strategy
- Unified Red List and New Assessments into single component
- Added unassessed species columns (# and %) to taxa summary
- Updated taxa filters for 2025-2 Red List database

## [v2.1.0] — 2026-03-13 – 2026-03-14 — Taxa Drilldown & New Assessments

- Added progressive drill-down subgroups in taxa summary table
- Added assessor/reviewer filter chart with search and toggle
- Added Wikipedia tab to species detail view
- Added world map zoom/pan controls and country search (50m TopoJSON)
- Added New Assessments view for browsing unassessed GBIF species
- Added PostHog analytics in cookieless mode
- Added Claude PR Assistant GitHub Action

## [v2.0.0] — 2026-03-06 – 2026-03-12 — Data Pipeline & Static Files

- Built end-to-end data sync pipeline (fetch Red List → GBIF match → new counts → load)
- Explored Supabase migration, then reverted to static per-taxon CSV files
- Added per-taxon assessment history with assessors and reviewers
- Added diff-based sync with dry-run JSONL logging
- Prefetch all species data on page load for instant taxa switching
- Removed all Supabase dependencies

## [v1.9.0] — 2026-03-01 – 2026-03-05 — Assessment Assistant & Rich Maps

- Added Assessment Assistant section with criteria subtabs
- Added AOO method selector (GBIF Records / EOO×Prevalence)
- Added dynamic cross-filtering between all four charts
- Redesigned occurrence map: full-width with horizontal filter bar
- Added basemap toggle, animated time slider, marker shapes, and hover tooltips
- Added split map view comparing occurrences before/after assessment date
- Added Vercel Web Analytics
- Added Cache-Control headers on all API routes

## [v1.8.0] — 2026-02-27 – 2026-02-28 — Assessment Tools & Testing

- Added test suite with 64 unit tests (Vitest)
- Added threat prioritization scoring across 3 dimensions
- Added advanced GBIF occurrence filters: uncertainty, year range, dedup, sample size
- Added observation signal analysis with effort normalization
- Added IUCN Criterion B parameter estimation (EOO/AOO from GBIF data)
- Added interactive map for Criterion B sense-checking
- Enhanced CITES tab with interactive filters and line chart

## [v1.7.0] — 2026-02-26 — Dashboard Overhaul

- Added GBIF summary columns to taxa summary table
- Added 2x2 chart grid layout with filter hints
- Added focus toggle for column visibility
- Removed countries dropdown and starred import/export
- Fixed slow filter chart loading (10s → instant)
- Added default sort by newGbif column

## [v1.6.0] — 2026-02-17 – 2026-02-19 — CITES Integration

- Added CITES trade data tab in species detail view
- Added trade flows map with curved arcs and click-to-filter
- Added trade summary with country names, quantities, and importers
- Added CITES suspension overlay and dark mode support
- Added IUCN Red List citation footer
- Switched to local Geist fonts for offline builds

## [v1.5.0] — 2026-02-15 — Sorting & NE Fixes

- Added sortable "New GBIF" column (observations since last assessment)
- Improved OpenAlex search with name variants
- Unified table layout for NE and assessed species
- Fixed NE species endpoint for "all" taxon view

## [v1.4.0] — 2026-02-12 – 2026-02-13 — Redesigned Main Page

- Redesigned to single-page layout with multi-select taxa filtering
- Added iNaturalist audio observation support
- Added category breakdown bar column in taxa summary
- Added URL param sync for shareable/bookmarkable links
- Added hover interaction between iNat thumbnails and occurrence map
- Supported Cmd/Ctrl+Click for multi-select taxa filtering

## [v1.3.0] — 2026-02-09 – 2026-02-11 — Tabbed Species Detail

- Added tabbed view for species details (GBIF + iNaturalist / Literature)
- Added Red List Assessments tab with key metrics (EOO, AOO, population)
- Integrated IUCN Red List API for full assessment history
- Added stacked/tabbed layout toggle
- Renamed dashboard to "IUCN Red List Dashboard"

## [v1.2.0] — 2026-02-08 — Unified Dashboard

- Merged GBIF features into Red List tab and removed separate GBIF tab
- Added common name search functionality
- Added Not Evaluated (NE) species toggle with on-demand loading
- Added observation type checkboxes with paginated iNat photos
- Removed experiments, flora explorer, and downloader code

## [v1.1.0] — 2026-02-04 – 2026-02-07 — Performance & Mobile

- Added SWR caching and parallel fetches for performance
- Made Red List dashboard mobile-responsive
- Added sticky columns with horizontal scroll
- Added auto-zoom for GBIF occurrence maps to fit data bounding box

## [v1.0.0] — 2026-01-22 – 2026-01-27 — Major Redesign

- Redesigned TaxaSummary with clickable All Species row
- Added literature section with collapsible abstracts (OpenAlex)
- Added favourite/starred species with drag-and-drop reordering
- Added country filter dropdown with map visualization
- Added export/import for starred species
- Excluded preserved specimens from GBIF counts

## [v0.6.0] — 2025-12-15 — Polish & Match Status

- Added GBIF match status indicator with instant hover tooltip
- Renamed project to "Red List Dashboard"
- Various UX improvements to tooltips and column headers

## [v0.5.0] — 2025-12-10 – 2025-12-12 — Rich Species Detail

- Added iNaturalist observation image preview on hover
- Added multi-select filters for category, year, and country
- Added GBIF occurrence breakdown with clickable links
- Added species image column and occurrence map expansion
- Added inline GBIF breakdown and iNat photos in expanded rows

## [v0.4.0] — 2025-12-08 – 2025-12-09 — Red List Dashboard

- Added IUCN Red List statistics tab with species browser
- Added multi-taxa support (Birds, Mammals, Reptiles, Fishes, etc.)
- Added dark/light mode toggle
- Added taxa summary table with % assessed/outdated metrics
- Added combined taxa support (Fishes, Invertebrates, Fungi)

## [v0.3.0] — 2025-12-04 — World Map & Redesign

- Added interactive world map for country-based species exploration
- Added occurrence heatmap with cream-to-red color scale
- Redesigned homepage with side-by-side map and distribution
- Added navigation header

## [v0.2.0] — 2025-12-02 — Species Classifier & Experiments

- Added species classifier module with Tessera cache
- Added experiment page comparing similarity vs classifier methods
- Added location-based predictions with pre-trained models
- Added local prediction heatmaps with uncertainty estimation

## [v0.1.0] — 2025-11-28 — Initial Release

- GBIF plant species data explorer
- Distribution visualizations and charts
- Species search, images, and common names
- Global/Cambridge region toggle with occurrence maps
