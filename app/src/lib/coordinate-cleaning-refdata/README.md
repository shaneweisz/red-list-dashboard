# Coordinate-cleaning reference data

Small point gazetteers used by `../coordinate-cleaning.ts`'s `cc_cap`/`cc_cen`/`cc_inst` ports. Sourced independently of CoordinateCleaner's own bundled `countryref`/`institutions` R data objects (GPL-3) — see `docs/gbif-coordinate-cleaning-scoping.md` §4 for why.

## `capitals.json` (200 points)

Country political capitals. Extracted from Natural Earth's 1:50m populated places layer (public domain, no attribution required), via the [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson) GeoJSON mirror (`50m/cultural/ne_50m_populated_places.json`), filtered to `ADM0CAP === 1`. Extracted by hand once (2026-07); capitals essentially never change, so no refresh script.

## `centroids.json` (250 points)

Country geographic centroids. Extracted from [mledoze/countries](https://github.com/mledoze/countries) (MIT licensed) `dist/countries.json`, each country's `latlng` field. Extracted by hand once (2026-07); same rationale as capitals.

## `institutions.json` (6,062 points)

Biodiversity institutions (museums, herbaria, zoos, universities, etc.) with known coordinates. Sourced live from GBIF's own [GRSciColl](https://www.gbif.org/grscicoll) registry (`api.gbif.org/v1/grscicoll/institution`), not CoordinateCleaner's bundled table — keeps this pipeline entirely GBIF-sourced and sidesteps the licensing question. Unlike capitals/centroids, GRSciColl actively grows, so regenerate periodically with:

```
npx tsx scripts/fetch-coordinate-cleaning-refdata.ts
```
