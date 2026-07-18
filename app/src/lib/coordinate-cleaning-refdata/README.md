# Coordinate-cleaning reference data

Point gazetteers and polygon layers used by `../coordinate-cleaning.ts`'s `cc_cap`/`cc_cen`/`cc_inst`/`cc_sea`/`cc_urb` ports. Sourced independently of CoordinateCleaner's own bundled `countryref`/`institutions`/`landmass`/`urban_areas` R data objects (GPL-3) — see `docs/gbif-coordinate-cleaning-scoping.md` §4 for why.

All of this data is imported only by `coordinate-cleaning.ts`, which is used both server-side (`/api/occurrences`) and by a couple of client components for just their label/description exports (`QUALITY_FLAG_LABELS`/`QUALITY_FLAG_DESCRIPTIONS`). Verified via a production build that the bundler tree-shakes the actual point/polygon data out of the client bundle — only the flag label strings ship to the browser.

## `capitals.json` (200 points)

Country political capitals. Extracted from Natural Earth's 1:50m populated places layer (public domain, no attribution required), via the [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson) GeoJSON mirror (`50m/cultural/ne_50m_populated_places.json`), filtered to `ADM0CAP === 1`. Extracted by hand once (2026-07); capitals essentially never change, so no refresh script.

## `centroids.json` (250 points)

Country geographic centroids. Extracted from [mledoze/countries](https://github.com/mledoze/countries) (MIT licensed) `dist/countries.json`, each country's `latlng` field. Extracted by hand once (2026-07); same rationale as capitals.

## `institutions.json` (6,062 points)

Biodiversity institutions (museums, herbaria, zoos, universities, etc.) with known coordinates. Sourced live from GBIF's own [GRSciColl](https://www.gbif.org/grscicoll) registry (`api.gbif.org/v1/grscicoll/institution`), not CoordinateCleaner's bundled table — keeps this pipeline entirely GBIF-sourced and sidesteps the licensing question. Unlike capitals/centroids, GRSciColl actively grows, so regenerate periodically with:

```
npx tsx scripts/fetch-coordinate-cleaning-refdata.ts
```

## `land-polygons.json` (127 polygons)

Land/ocean mask. Extracted from Natural Earth's 1:110m land layer (public domain), via the martynafford mirror (`110m/physical/ne_110m_land.json`), stripped to bare `{type, coordinates}` geometries and coordinates rounded to 3 decimal places (~110m precision) to cut file size (237KB → 90KB). 110m is Natural Earth's coarsest scale — a deliberate trade-off for bundle size; fine for "clearly in the ocean" but won't resolve small islands or narrow coastal strips. Extracted by hand once (2026-07); coastlines don't change on any timescale this matters for, so no refresh script.

## `urban-areas.json` (2,143 polygons)

Urban area footprints. Extracted from Natural Earth's 1:50m urban areas layer (public domain), via the martynafford mirror (`50m/cultural/ne_50m_urban_areas.json`), same stripping/rounding treatment (4 decimal places, ~11m precision; 1.97MB → 730KB). Extracted by hand once (2026-07); no refresh script, same rationale as land polygons.
