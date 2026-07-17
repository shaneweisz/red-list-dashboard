/**
 * fetch-coordinate-cleaning-refdata: regenerate the institutions gazetteer used by
 * cc_inst (src/lib/coordinate-cleaning.ts) from GBIF's own GRSciColl registry.
 *
 * Institutions get added/moved in GRSciColl over time, so this is worth re-running
 * occasionally (not on every sync — it's not part of the taxonomic data pipeline).
 * Capitals/centroids (src/lib/coordinate-cleaning-refdata/{capitals,centroids}.json)
 * are sourced from Natural Earth and mledoze/countries instead, both essentially
 * static (country capitals/centroids don't move), so there's no fetch script for
 * those — they were extracted once by hand; re-derive the same way if ever needed:
 *   - capitals.json: https://github.com/martynafford/natural-earth-geojson
 *     50m/cultural/ne_50m_populated_places.json, filtered to ADM0CAP === 1
 *   - centroids.json: https://github.com/mledoze/countries dist/countries.json,
 *     each country's `latlng` field
 *
 * Usage:
 *   npx tsx scripts/fetch-coordinate-cleaning-refdata.ts
 */

import * as fs from "fs";
import * as path from "path";

const OUT_PATH = path.join(__dirname, "..", "src", "lib", "coordinate-cleaning-refdata", "institutions.json");
const PAGE_LIMIT = 1000;

interface Institution {
  name: string;
  lat: number;
  lon: number;
}

async function fetchAllInstitutions(): Promise<Institution[]> {
  const out: Institution[] = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`https://api.gbif.org/v1/grscicoll/institution?limit=${PAGE_LIMIT}&offset=${offset}`);
    if (!res.ok) throw new Error(`GRSciColl API error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    for (const r of data.results as { name?: string; latitude?: number; longitude?: number }[]) {
      if (r.latitude == null || r.longitude == null) continue;
      out.push({ name: r.name ?? "", lat: Math.round(r.latitude * 1e5) / 1e5, lon: Math.round(r.longitude * 1e5) / 1e5 });
    }
    console.log(`offset=${offset} total_so_far=${out.length} endOfRecords=${data.endOfRecords}`);
    if (data.endOfRecords) break;
    offset += PAGE_LIMIT;
  }
  return out;
}

async function run() {
  const institutions = await fetchAllInstitutions();
  fs.writeFileSync(OUT_PATH, JSON.stringify(institutions));
  console.log(`Wrote ${institutions.length} institutions to ${OUT_PATH}`);
}

run();
