# Changelog

All notable changes to the IUCN Red List Assessments Dashboard.

## [Unreleased]

## [v2.16.0] — 2026-06-30 – 2026-07-07 — Shared Filters, Attribution & Taxon Browsing

- Added a shared filter registry so the dashboard URL, MCP tools, and /browse stay in sync
- Added a "Dash For Life" brand for dashforlife.org, then renamed it to "Dash for Life"
- Added a commercial-use disclaimer to the Red List attribution footer
- Renamed the red.cst.cam.ac.uk brand title to "Red List Dashboard", added the globe icon, and reordered footer data sources to lead with IUCN Red List (version 2025-2)
- Surfaced arbitrary-taxon browsing via search with a thin taxon header
- Clarified GBIF column headers and added IUCN criteria on category hover
- Refreshed GBIF/CoL data sync (first full resync in ~3 weeks)

## [v2.15.0] — 2026-06-22 – 2026-06-24 — Dash of Life Default Brand & Header Redesign

- Made Dash of Life the default brand with a globe favicon
- Redesigned the dashboard header with a title + subtitle layout; renamed "Risk Category" to "Conservation Status"
- Added a "Suggested Reviewers" tab for NE species, analogous to Suggested Assessors, and stripped affiliation labels so assessor/reviewer candidates aggregate correctly
- Added a "Threatened" shortcut to the risk category chart
- Added an endemics filter to the country map and a configurable page-size selector to species/CITES tables
- Fixed table overflow, mobile landing alignment, and expanded-detail viewport fit
- Reverse-proxied PostHog events through /ingest to beat ad blockers
- Added test coverage reporting to CI

## [v2.14.0] — 2026-06-18 – 2026-06-19 — CITES Map Polish, EOL Tab & Dash of Life Rebrand

- Added flow-count slider, volume-scaled flows, and a records table to the CITES trade map
- Added an Encyclopedia of Life (EOL) tab to the species detail panel
- Gave agent-facing MCP/browse results a verifiable dashboard_url and simplified taxa URL params to a single flat param
- Introduced "Dash of Life" as an alternate brand for dashoflife.org, with per-domain titles
- Reworked the Threats and Assessors/Reviewers charts (repositioned, side-by-side layout)

## [v2.13.0] — 2026-06-15 – 2026-06-17 — Search Speed & CITES Trade Overhaul

- Sped up cold-start search and stopped syncing the unused JSON search index
- Fixed a described-year mis-parse from DOI citations and added a pre-Linnaean floor
- Overhauled CITES trade data: full history since 1975, unit-aware commodities, clearer re-exports, and cross-filterable bar charts
- Fixed the CITES trade map to color countries by dominant trade role rather than mere importer/exporter presence

## [v2.12.0] — 2026-06-12 – 2026-06-15 — Catalogue of Life Integration & Agent Access

- Ingested the Catalogue of Life backbone: surfaced the full described-species universe in New Assessments with an IUCN↔CoL toggle
- Extended search and synonym resolution to cover the full CoL universe, including CoL-only and retired-name species
- Added a Protected Areas (WDPA) overlay toggle to the occurrence map
- Added a CoL described-year field, filter chart, and table column for Not Evaluated species
- Restored iNaturalist observations for species with no GBIF backbone match
- Demoted spurious Catalogue of Life Extended Release taxonomic over-splits via a curated-checklist overlay
- Split "Other Invertebrates" into phylum-based browse sub-groups
- Rebuilt the /browse endpoint and llms.txt, and added a remote MCP server (/api/mcp, now public) for agent data access

## [v2.11.0] — 2026-06-10 – 2026-06-11 — DuckDB/Parquet Read Layer Migration

- Removed the orphaned criteria-estimation feature and corrected README/env drift
- Restructured taxa groups to common-name IDs and split Insecta into 8 order-based groups, in prep for Catalogue of Life ingestion
- Migrated the species read layer onto DuckDB/Parquet on R2, enabling arbitrary-rank taxonomic filtering (e.g. by family)
- Cut v2 cold-start and history-join latency; lazy-loaded assessment history (−40% species-list payload)
- Moved cross-taxa search onto DuckDB, retiring the 95MB in-memory JSON search index
- Collapsed /api/v2 into /api/redlist and removed the dead CSV species path

## [v2.10.0] — 2026-05-04 – 2026-05-26 — Data Refreshes & R2 Migration

- Refreshed GBIF occurrence data (May 4 and May 18 syncs)
- Reduced default occurrence map sample size from 1000 to 300 for faster loads
- Separated CITES country reservations from actual appendix listing changes
- Migrated the data sync pipeline from committed CSVs to Cloudflare R2 storage, enabling the repo to go public

## [v2.9.0] — 2026-04-21 – 2026-04-30 — Filter & View Fixes

- Defaulted preserved-specimen occurrences on for plants and fungi, where herbarium records are core assessment evidence
- Made filter chart bars clickable across their whole row, not just the bar itself
- Fixed filters that narrowed results to one species from incorrectly triggering the single-species detail view

## [v2.8.0] — 2026-04-08 — Chart & Taxonomy Refinements

- Added a Range/Year toggle to the Years Since Assessed chart, with year-based filtering and URL sync
- Hid the CSV download button as a precaution against commercial bulk-downloading of Red List data
- Matched IUCN scientific-name synonyms during sync to fix recently-reclassified species showing as unassessed
- Removed colloquial taxonomy groupings (e.g. "Insectivores", "Whales & Dolphins") in favor of monophyletic clades with real described-species estimates

## [v2.7.0] — 2026-04-03 – 2026-04-06 — Map Colors & Linting

- Refined occurrence map color scale to continuous hue gradient
- Default to before/after assessment date coloring with 50km GPS uncertainty filter
- Added ESLint rules for unused imports/variables and fixed all lint errors
- Fixed filter chart flashing and years-since-assessed calculation

## [v2.6.0] — 2026-04-02 — MapLibre & Single Species View

- Migrated occurrence map from react-leaflet to MapLibre GL JS
- Added single-species info card with profile pic, assessors, and key metrics
- Lazy-load API tabs and warm-start search API on page load
- Narrowed dashboard layout and added before/after date toggle on map legend

## [v2.5.0] — 2026-03-27 – 2026-04-01 — Search & Map Improvements

- Added cross-taxa species search bar with client-side search index
- Added color-by-date view for GBIF occurrence map
- Increased default GBIF sample size from 300 to 1000
- Added footer data source attributions
- Fixed split view animations, tooltip clipping, and mobile skeleton layout

## [v2.4.0] — 2026-03-24 – 2026-03-27 — Mobile UX, Filters & New Fields

- Improved mobile dashboard UX with responsive viewport and fixed table/tab overflow
- Added CSV export for filtered species list
- Added 7 new Red List fields: systems, growth forms, movement patterns, possibly extinct, criteria, threats
- Added More Filters section with realm, threats, population trend, movement patterns, growth form, and range map
- Added region filter dropdown on country map
- Renamed Red List tab to IUCN Red List and reordered detail tabs
- Fixed invertebrate double-counting and region dropdown selection bug
- Updated 'Fungi' label to 'Fungi & Protists'

## [v2.3.0] — 2026-03-18 – 2026-03-23 — Taxonomy Tree & Suggested Assessors

- Redesigned taxonomy system: unified tree with recursive drill-down, icons, and precomputed summaries
- Added Suggested Assessors tab with ranked table filtered by selected taxa
- Redesigned species detail panel layout and combined assessed/outdated/unassessed columns
- Persisted view mode, species selection, and detail tab in URL params
- Added legal attribution notices and switched PostHog to cookieless tracking
- Scaled down desktop layout on mobile with single-column charts
- Fixed CITES errors for synonym species and null quotas, detail row width issues
- Excluded domesticated species from new assessments
- Added column dividers, footer with attribution, and Vercel Speed Insights

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
