/**
 * Enrich existing Red List JSON files with common names from the database.
 *
 * Prerequisites:
 *   1. SSH tunnel to the database (port 5433)
 *   2. Environment variables in .env:
 *      DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
 *
 * Usage:
 *   npx tsx scripts/enrich-common-names.ts [taxon]
 *
 * Examples:
 *   npx tsx scripts/enrich-common-names.ts           # Enrich all taxa
 *   npx tsx scripts/enrich-common-names.ts mammalia  # Enrich only mammals
 */

import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";

// Load environment variables from .env
function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const withoutExport = trimmed.replace(/^export\s+/, "");
        const [key, ...valueParts] = withoutExport.split("=");
        const value = valueParts.join("=").replace(/^["']|["']$/g, "");
        if (key && value) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // File doesn't exist, skip
  }
}

loadEnvFile(path.join(__dirname, "../../.env"));
loadEnvFile(path.join(__dirname, "../../.env.local"));
loadEnvFile(path.join(__dirname, "../.env"));
loadEnvFile(path.join(__dirname, "../.env.local"));

// All data files to enrich
const DATA_FILES = [
  "redlist-plantae.json",
  "redlist-ascomycota.json",
  "redlist-basidiomycota.json",
  "redlist-mammalia.json",
  "redlist-aves.json",
  "redlist-reptilia.json",
  "redlist-amphibia.json",
  "redlist-actinopterygii.json",
  "redlist-chondrichthyes.json",
  "redlist-insecta.json",
  "redlist-arachnida.json",
  "redlist-malacostraca.json",
  "redlist-gastropoda.json",
  "redlist-bivalvia.json",
  "redlist-anthozoa.json",
];

interface Species {
  sis_taxon_id: number;
  common_name?: string | null;
  [key: string]: unknown;
}

interface PrecomputedData {
  species: Species[];
  metadata: {
    [key: string]: unknown;
  };
}

async function fetchCommonNames(client: Client): Promise<Map<number, string>> {
  console.log("Fetching common names from database...");

  // Fetch English main common names for all taxa
  const result = await client.query<{ sis_id: string; name: string }>(`
    SELECT t.sis_id, tcn.name
    FROM taxons t
    INNER JOIN taxon_common_names tcn
      ON tcn.taxon_id = t.id
      AND tcn.language_id = 609
      AND tcn.main = true
    WHERE t.latest = true
  `);

  const commonNames = new Map<number, string>();
  for (const row of result.rows) {
    commonNames.set(Number(row.sis_id), row.name);
  }

  console.log(`  Found ${commonNames.size} common names\n`);
  return commonNames;
}

function enrichDataFile(
  filePath: string,
  commonNames: Map<number, string>
): { total: number; enriched: number } {
  const fileName = path.basename(filePath);

  if (!fs.existsSync(filePath)) {
    console.log(`  Skipping ${fileName} (file not found)`);
    return { total: 0, enriched: 0 };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const data: PrecomputedData = JSON.parse(content);

  let enrichedCount = 0;

  for (const species of data.species) {
    const commonName = commonNames.get(species.sis_taxon_id);
    if (commonName) {
      species.common_name = commonName;
      enrichedCount++;
    } else {
      species.common_name = null;
    }
  }

  // Write back to file
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  const pct = ((enrichedCount / data.species.length) * 100).toFixed(1);
  console.log(`  ${fileName}: ${enrichedCount}/${data.species.length} (${pct}%)`);

  return { total: data.species.length, enriched: enrichedCount };
}

async function main() {
  const args = process.argv.slice(2);
  const taxonArg = args[0]?.toLowerCase();

  // Filter data files if taxon specified
  let filesToProcess = DATA_FILES;
  if (taxonArg) {
    const matchingFile = DATA_FILES.find((f) =>
      f.toLowerCase().includes(taxonArg)
    );
    if (!matchingFile) {
      console.error(`No data file found matching: ${taxonArg}`);
      console.error("Available files:", DATA_FILES.join(", "));
      process.exit(1);
    }
    filesToProcess = [matchingFile];
  }

  console.log("Red List Common Names Enrichment");
  console.log("=".repeat(50));

  // Connect to database
  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: 5433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    console.log("Connected to database\n");

    // Fetch all common names once
    const commonNames = await fetchCommonNames(client);

    // Process each data file
    let totalSpecies = 0;
    let totalEnriched = 0;

    console.log("Enriching data files:");
    for (const fileName of filesToProcess) {
      const filePath = path.join(__dirname, "../data", fileName);
      const result = enrichDataFile(filePath, commonNames);
      totalSpecies += result.total;
      totalEnriched += result.enriched;
    }

    console.log("\n" + "=".repeat(50));
    console.log(`Total: ${totalEnriched}/${totalSpecies} species have common names`);
    console.log(`Coverage: ${((totalEnriched / totalSpecies) * 100).toFixed(1)}%`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
