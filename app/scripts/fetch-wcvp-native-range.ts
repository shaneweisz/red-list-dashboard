/**
 * fetch-wcvp-native-range: build a per-species native-country lookup from Kew's
 * World Checklist of Vascular Plants (WCVP), for the "POWO" native-range source
 * option in OccurrenceMapRow.tsx (issue #82) — alongside the existing Red List
 * assessment-location-based source (`s.countries`).
 *
 * Source data: https://sftp.kew.org/pub/data-repositories/WCVP/wcvp.zip (CC-BY,
 * Govaerts et al. 2021, Sci Data 8:215) — `wcvp_names.csv` (taxon name -> accepted
 * name resolution) and `wcvp_distribution.csv` (accepted name -> native/introduced/
 * extinct TDWG WGSRPD level-3 area codes). Both pipe-delimited, no real quoting
 * (some author-name fields contain literal apostrophes, so `quote=''` is required
 * or DuckDB misparses them as unterminated quotes).
 *
 * TDWG level-3 area codes (e.g. "FRA", "COS") are matched to ISO 3166-1 alpha-2
 * country codes via the original Brummitt Ed.2 WGSRPD table
 * (tdwg/wgsrpd, 109-488-1-ED/2nd Edition/tblLevel3.txt, `*`-delimited, Latin-1
 * encoded) — chosen over rWCVP's own `wgsrpd_mapping` crosswalk (Gallagher et al.
 * 2020) because that one only exists as an R `.rda` binary with no plain-text
 * source in the package repo. 41 of 369 L3 codes (11%) have no ISO code in the
 * official table — a mix of genuine multi-country composites (Baltic States,
 * Transcaucasus, ...) and a handful of single-country gaps that look like data-entry
 * omissions (Austria, Belgium, France, Italy, Spain, Ukraine, ...), confirmed by
 * cross-checking that OTHER L3 codes for the same country (e.g. Russia's four other
 * L3 subdivisions) do have an ISO code filled in. WGSRPD_OVERRIDES below patches
 * the confident cases (single country, or an unambiguous small multi-country set)
 * and leaves the rest unmapped — matching this codebase's existing "don't flag what
 * we can't determine" convention (see isOutsideReportedCountry/isOutsideNativeRange).
 *
 * Matching our Red List species to WCVP: exact case-insensitive match of
 * scientific_name against wcvp_names.taxon_name (covering both Accepted and
 * Synonym rows, resolved to accepted_plant_name_id) — no fuzzy/synonym-network
 * matching beyond what WCVP's own accepted_plant_name_id column gives us. Species
 * with no match (different spelling, taxonomic disagreement, or genuinely absent
 * from WCVP) simply get no POWO option — the UI falls back to the Red List source.
 *
 * Usage (re-run occasionally; WCVP ships periodic updates):
 *   npx tsx scripts/fetch-wcvp-native-range.ts [path-to-already-downloaded-wcvp.zip]
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { DuckDBInstance } from "@duckdb/node-api";
import { DATA_DIR } from "./utils";

const WCVP_ZIP_URL = "https://sftp.kew.org/pub/data-repositories/WCVP/wcvp.zip";
const TDWG_LEVEL3_URL =
  "https://raw.githubusercontent.com/tdwg/wgsrpd/master/109-488-1-ED/2nd%20Edition/tblLevel3.txt";
const OUT_DIR = path.join(__dirname, "..", "src", "lib", "native-range-refdata");
const OUT_PATH = path.join(OUT_DIR, "wcvp-native-countries.json");
const WORK_DIR = path.join(__dirname, "..", ".wcvp-tmp");

// Patches for TDWG WGSRPD level-3 codes with no ISO code in the official Ed.2
// table (see file header) — only the confident single- or unambiguous-multi-country
// cases; genuine multi-country composites with no clean split (Leeward Is., Gulf
// States, New Guinea, Borneo, ...) are deliberately left unmapped. Also overrides
// 4 codes that DO have an "ISO code" filled in but it's not a real current ISO
// 3166-1 alpha-2 (so it would never match GBIF's own countryCode field): GRB's
// "UK" (real code GB), and 3 pre-1990s composite/dissolved states the table never
// updated after they split — CZE "CS" (Czechoslovakia -> Czechia+Slovakia), YUG
// "YU" (Yugoslavia -> its 6 successor states), NLA "AN" (Netherlands Antilles ->
// its 3 successor territories).
const WGSRPD_OVERRIDES: Record<string, string[]> = {
  AUT: ["AT"], BGM: ["BE"], FRA: ["FR"], ITA: ["IT"], SPA: ["ES"], UKR: ["UA"],
  MOR: ["MA"], HAI: ["HT"], IRE: ["IE"], COM: ["KM"], SOL: ["SB"], SAM: ["WS"],
  MLY: ["MY"], LIN: ["KI"], CHS: ["CN"], AND: ["IN"], SIC: ["IT"], HAW: ["US"],
  NFL: ["CA"], RUS: ["RU"], PAL: ["PS"], KOR: ["KR", "KP"], LBS: ["LB", "SY"],
  BLT: ["EE", "LV", "LT"], TCS: ["GE", "AM", "AZ"],
  GRB: ["GB"], CZE: ["CZ", "SK"], YUG: ["BA", "HR", "ME", "MK", "RS", "SI"],
  NLA: ["CW", "SX", "BQ"],
};

function download(url: string, destPath: string) {
  execSync(`curl -sL --max-time 300 -o "${destPath}" "${url}"`, { stdio: "inherit" });
}

async function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const preDownloaded = process.argv[2];
  const zipPath = path.join(WORK_DIR, "wcvp.zip");
  if (preDownloaded) {
    fs.copyFileSync(preDownloaded, zipPath);
  } else {
    console.log(`Downloading ${WCVP_ZIP_URL} ...`);
    download(WCVP_ZIP_URL, zipPath);
  }
  console.log("Unzipping...");
  execSync(`unzip -o -q "${zipPath}" -d "${WORK_DIR}"`, { stdio: "inherit" });

  const level3Path = path.join(WORK_DIR, "tblLevel3.txt");
  console.log(`Downloading ${TDWG_LEVEL3_URL} ...`);
  download(TDWG_LEVEL3_URL, level3Path);

  // tblLevel3.txt is Latin-1 encoded (breaks on diacritics like "Føroyar" if read as UTF-8)
  const level3Raw = fs.readFileSync(level3Path).toString("latin1");
  const level3ToIso = new Map<string, string[]>();
  for (const line of level3Raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [l3code, , , isoCode] = line.split("*");
    if (!l3code) continue;
    if (WGSRPD_OVERRIDES[l3code]) {
      level3ToIso.set(l3code, WGSRPD_OVERRIDES[l3code]);
    } else if (isoCode?.trim()) {
      level3ToIso.set(l3code, [isoCode.trim().toUpperCase()]);
    }
  }
  console.log(`TDWG level-3 crosswalk: ${level3ToIso.size}/369 codes resolved to a country`);

  const namesPath = path.join(WORK_DIR, "wcvp_names.csv");
  const distPath = path.join(WORK_DIR, "wcvp_distribution.csv");
  const assessedPath = path.join(DATA_DIR, "assessed.parquet");

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  console.log("Matching Red List vascular-plant species against WCVP names...");
  const matchResult = await conn.runAndReadAll(`
    WITH our_species AS (
      SELECT DISTINCT scientific_name, lower(scientific_name) AS name_lower
      FROM read_parquet('${assessedPath}')
      WHERE taxon_group IN ('flowering_plants', 'gymnosperms', 'ferns_and_allies')
    ),
    names AS (
      SELECT lower(taxon_name) AS name_lower,
             COALESCE(accepted_plant_name_id, plant_name_id) AS resolved_id
      FROM read_csv('${namesPath}', delim=chr(124), header=true, quote='')
      WHERE taxon_name IS NOT NULL
    )
    SELECT o.scientific_name, n.resolved_id
    FROM our_species o JOIN names n ON o.name_lower = n.name_lower
  `);
  const matches = matchResult.getRowObjects() as unknown as { scientific_name: string; resolved_id: bigint }[];
  console.log(`Matched ${matches.length} species to a WCVP name`);

  const idToNames = new Map<bigint, string[]>();
  for (const { scientific_name, resolved_id } of matches) {
    const arr = idToNames.get(resolved_id);
    if (arr) arr.push(scientific_name);
    else idToNames.set(resolved_id, [scientific_name]);
  }

  console.log("Reading native distribution rows...");
  const distResult = await conn.runAndReadAll(`
    SELECT plant_name_id, area_code_l3
    FROM read_csv('${distPath}', delim=chr(124), header=true, quote='')
    WHERE introduced = 0 AND extinct = 0 AND (location_doubtful = 0 OR location_doubtful IS NULL)
  `);
  const distRows = distResult.getRowObjects() as unknown as { plant_name_id: bigint; area_code_l3: string }[];
  console.log(`${distRows.length} native distribution rows total`);

  const speciesCountries = new Map<string, Set<string>>();
  for (const { plant_name_id, area_code_l3 } of distRows) {
    const names = idToNames.get(plant_name_id);
    if (!names) continue;
    const isoCodes = level3ToIso.get(area_code_l3);
    if (!isoCodes) continue;
    for (const name of names) {
      let set = speciesCountries.get(name);
      if (!set) { set = new Set(); speciesCountries.set(name, set); }
      for (const iso of isoCodes) set.add(iso);
    }
  }

  const out: Record<string, string[]> = {};
  for (const [name, countries] of speciesCountries) {
    out[name] = Array.from(countries).sort();
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`Wrote ${Object.keys(out).length} species to ${OUT_PATH}`);

  fs.rmSync(WORK_DIR, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
