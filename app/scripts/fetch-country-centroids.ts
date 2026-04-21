/**
 * fetch-country-centroids: generate country centroid lookup from Natural Earth
 *
 * Downloads the Natural Earth 10m Admin 0 countries GeoJSON (public domain)
 * and extracts ISO 3166-1 alpha-2 → (lon, lat) using the cartographic
 * LABEL_X / LABEL_Y fields. Mirrors the country-centroid half of the R
 * `CoordinateCleaner` package's `cc_cen` test (Natural Earth centroids,
 * 1 km default buffer — see lib/countryCentroids.ts).
 *
 * Source: https://www.naturalearthdata.com/ (Terms: public domain)
 * Mirror: nvkelso/natural-earth-vector (also public domain)
 *
 * Usage:
 *   npx tsx scripts/fetch-country-centroids.ts
 */

import * as fs from "fs";
import * as path from "path";

const NATURAL_EARTH_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";

const OUTPUT_PATH = path.resolve(
  __dirname,
  "../data/country-centroids.json"
);

interface NaturalEarthFeature {
  properties: {
    ISO_A2?: string;
    ISO_A2_EH?: string;
    NAME?: string;
    LABEL_X?: number;
    LABEL_Y?: number;
  };
}

type CentroidMap = Record<string, [number, number]>; // ISO2 → [lon, lat]

async function main() {
  console.log(`Fetching ${NATURAL_EARTH_URL}`);
  const res = await fetch(NATURAL_EARTH_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching Natural Earth data`);
  const geojson = (await res.json()) as { features: NaturalEarthFeature[] };

  const centroids: CentroidMap = {};
  let skipped = 0;

  for (const feat of geojson.features) {
    // ISO_A2_EH (ephemeral) falls back for disputed/unrecognized territories
    // (e.g. Kosovo, Western Sahara) where ISO_A2 is "-99".
    const iso =
      feat.properties.ISO_A2 && feat.properties.ISO_A2 !== "-99"
        ? feat.properties.ISO_A2
        : feat.properties.ISO_A2_EH && feat.properties.ISO_A2_EH !== "-99"
          ? feat.properties.ISO_A2_EH
          : null;
    const lon = feat.properties.LABEL_X;
    const lat = feat.properties.LABEL_Y;

    if (!iso || lon == null || lat == null) {
      skipped++;
      continue;
    }

    // First occurrence wins — some Natural Earth features share codes
    // (e.g. France + French overseas). The first (mainland) is preferred.
    if (!(iso in centroids)) {
      centroids[iso] = [Number(lon.toFixed(4)), Number(lat.toFixed(4))];
    }
  }

  const sorted: CentroidMap = {};
  for (const iso of Object.keys(centroids).sort()) {
    sorted[iso] = centroids[iso];
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(sorted, null, 2) + "\n",
    "utf-8"
  );

  console.log(`Wrote ${Object.keys(sorted).length} centroids to ${OUTPUT_PATH}`);
  if (skipped > 0) console.log(`Skipped ${skipped} features without ISO_A2 / LABEL coords`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
