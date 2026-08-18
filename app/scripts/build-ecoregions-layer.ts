/**
 * build-ecoregions-layer: RESOLVE Ecoregions 2017 → one GeoJSON overlay
 *
 * The ecosystem context behind an occurrence map. A record sitting in Northern
 * Andean páramo and one in Magdalena Valley montane forest are different
 * evidence about a species' range, and nothing else on this map says which is
 * which.
 *
 * Source: Esri Living Atlas's hosted copy of Dinerstein et al. (2017),
 * "An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm",
 * BioScience 67(6). 847 terrestrial ecoregions in 14 biomes. Licensed
 * CC-BY 4.0, which the map attribution carries.
 *
 * This is the dataset behind One Earth's Navigator, whose own tiles are Cesium
 * ion assets keyed to One Earth's access token and so not ours to use. Taking
 * the data from its licensed source instead costs nothing and gives better
 * attributes than the Navigator exposes.
 *
 * Fetched once and stored rather than queried live, because the data is fixed:
 * Ecoregions 2017 has not been revised since publication, so a live query would
 * add a runtime dependency and a per-pan request for a file that never changes.
 * The whole world is 847 polygons and fits in a single request — the service's
 * maxRecordCount is 2000.
 *
 * Usage:
 *   npx tsx scripts/build-ecoregions-layer.ts              # default 0.1° simplification
 *   npx tsx scripts/build-ecoregions-layer.ts --offset 0.05
 *   npx tsx scripts/build-ecoregions-layer.ts --out /tmp/eco.json
 */

import { gzipSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";

const SERVICE =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Resolve_Ecoregions/FeatureServer/0/query";

/**
 * Vertex simplification, in degrees.
 *
 * 0.1° is about 11 km at the equator, which sounds coarse and isn't: an
 * ecoregion boundary is a broad ecological transition drawn at continental
 * scale, not a surveyed line, and this is a context layer read at the zoom
 * where a whole ecoregion is visible. It halves the payload against 0.05°
 * (1.97 MB gzipped against 2.77 MB) for no difference anyone can see.
 */
const DEFAULT_OFFSET = 0.1;

/** Coordinate precision. 4dp is ~11 m — far finer than the simplification. */
const COORD_DECIMALS = 4;

interface EcoregionProperties {
  /** Ecoregion name, e.g. "Northern Andean páramo". */
  name: string;
  /** One of the 14 biomes, e.g. "Montane Grasslands & Shrublands". */
  biome: string;
  /** Biogeographic realm, e.g. "Neotropic". */
  realm: string;
  /** Nature Needs Half status, e.g. "Nature Could Reach Half Protected". */
  nnh: string;
  /** The dataset's own colour for this ecoregion. */
  color: string;
  /** The dataset's own colour for its biome — what the overlay draws with. */
  biomeColor: string;
}

const ARG = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

function round(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(round);
  if (typeof value === "number") return Number(value.toFixed(COORD_DECIMALS));
  return value;
}

async function main() {
  const offset = Number(ARG("--offset") ?? DEFAULT_OFFSET);
  const out =
    ARG("--out") ?? path.join(__dirname, "..", "data", "overlays", "ecoregions-2017.json");

  const params = new URLSearchParams({
    where: "1=1",
    outFields: "ECO_NAME,BIOME_NAME,REALM,NNH_NAME,COLOR,COLOR_BIO",
    returnGeometry: "true",
    maxAllowableOffset: String(offset),
    outSR: "4326",
    f: "geojson",
  });

  console.log(`Fetching Ecoregions 2017 at ${offset}° simplification…`);
  const started = Date.now();
  const response = await fetch(`${SERVICE}?${params}`);
  if (!response.ok) throw new Error(`Living Atlas returned HTTP ${response.status}`);
  const collection = (await response.json()) as {
    features?: { properties: Record<string, string>; geometry: unknown }[];
    error?: { message: string };
  };
  if (collection.error) throw new Error(`Living Atlas: ${collection.error.message}`);

  const features = collection.features ?? [];
  if (features.length === 0) throw new Error("No features returned");
  // The dataset is 847 ecoregions and the service caps a response at 2000. A
  // short count means the cap moved and the layer is now silently partial.
  if (features.length < 800) {
    throw new Error(`Only ${features.length} ecoregions returned; expected ~847`);
  }

  const trimmed = {
    type: "FeatureCollection" as const,
    features: features.map((f) => {
      const p = f.properties;
      const properties: EcoregionProperties = {
        name: p.ECO_NAME ?? "",
        biome: p.BIOME_NAME ?? "",
        realm: p.REALM ?? "",
        nnh: p.NNH_NAME ?? "",
        color: p.COLOR ?? "#cccccc",
        biomeColor: p.COLOR_BIO ?? p.COLOR ?? "#cccccc",
      };
      return { type: "Feature" as const, properties, geometry: round(f.geometry) };
    }),
  };

  const json = JSON.stringify(trimmed);
  const gzipped = gzipSync(Buffer.from(json), { level: 9 });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, json);
  writeFileSync(`${out}.gz`, gzipped);

  const biomes = new Set(trimmed.features.map((f) => f.properties.biome));
  const realms = new Set(trimmed.features.map((f) => f.properties.realm));
  console.log(
    `  ${trimmed.features.length} ecoregions, ${biomes.size} biomes, ${realms.size} realms ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  console.log(`  ${(json.length / 1024 / 1024).toFixed(2)} MB raw, ${(gzipped.length / 1024 / 1024).toFixed(2)} MB gzipped`);
  console.log(`  → ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
