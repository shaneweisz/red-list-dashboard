/**
 * Fetch IUCN Red List species data directly from the PostgreSQL database.
 *
 * Prerequisites:
 *   1. SSH tunnel to the database (port 5433)
 *   2. Environment variables in .env:
 *      DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
 *
 * Usage:
 *   npx tsx scripts/fetch-redlist-from-db.ts <taxon>
 *   npx tsx scripts/fetch-redlist-from-db.ts all
 *
 * Examples:
 *   npx tsx scripts/fetch-redlist-from-db.ts mammalia  # Fetch mammals
 *   npx tsx scripts/fetch-redlist-from-db.ts plantae   # Fetch plants
 *   npx tsx scripts/fetch-redlist-from-db.ts all       # Fetch all taxa
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

// Taxa configuration with database filters
interface TaxonConfig {
  id: string;
  name: string;
  dataFile: string;
  // Database filter: which column and value to filter taxons by
  filterColumn: "kingdom_name" | "phylum_name" | "class_name";
  filterValue: string;
}

const TAXA_CONFIG: Record<string, TaxonConfig> = {
  plantae: {
    id: "plantae",
    name: "Plants",
    dataFile: "redlist-plantae.json",
    filterColumn: "kingdom_name",
    filterValue: "PLANTAE",
  },
  ascomycota: {
    id: "ascomycota",
    name: "Ascomycota (Sac Fungi)",
    dataFile: "redlist-ascomycota.json",
    filterColumn: "phylum_name",
    filterValue: "ASCOMYCOTA",
  },
  basidiomycota: {
    id: "basidiomycota",
    name: "Basidiomycota (Mushrooms)",
    dataFile: "redlist-basidiomycota.json",
    filterColumn: "phylum_name",
    filterValue: "BASIDIOMYCOTA",
  },
  mammalia: {
    id: "mammalia",
    name: "Mammals",
    dataFile: "redlist-mammalia.json",
    filterColumn: "class_name",
    filterValue: "MAMMALIA",
  },
  aves: {
    id: "aves",
    name: "Birds",
    dataFile: "redlist-aves.json",
    filterColumn: "class_name",
    filterValue: "AVES",
  },
  reptilia: {
    id: "reptilia",
    name: "Reptiles",
    dataFile: "redlist-reptilia.json",
    filterColumn: "class_name",
    filterValue: "REPTILIA",
  },
  amphibia: {
    id: "amphibia",
    name: "Amphibians",
    dataFile: "redlist-amphibia.json",
    filterColumn: "class_name",
    filterValue: "AMPHIBIA",
  },
  actinopterygii: {
    id: "actinopterygii",
    name: "Ray-finned Fishes",
    dataFile: "redlist-actinopterygii.json",
    filterColumn: "class_name",
    filterValue: "ACTINOPTERYGII",
  },
  chondrichthyes: {
    id: "chondrichthyes",
    name: "Sharks & Rays",
    dataFile: "redlist-chondrichthyes.json",
    filterColumn: "class_name",
    filterValue: "CHONDRICHTHYES",
  },
  insecta: {
    id: "insecta",
    name: "Insects",
    dataFile: "redlist-insecta.json",
    filterColumn: "class_name",
    filterValue: "INSECTA",
  },
  arachnida: {
    id: "arachnida",
    name: "Arachnids",
    dataFile: "redlist-arachnida.json",
    filterColumn: "class_name",
    filterValue: "ARACHNIDA",
  },
  malacostraca: {
    id: "malacostraca",
    name: "Crustaceans",
    dataFile: "redlist-malacostraca.json",
    filterColumn: "class_name",
    filterValue: "MALACOSTRACA",
  },
  gastropoda: {
    id: "gastropoda",
    name: "Snails & Slugs",
    dataFile: "redlist-gastropoda.json",
    filterColumn: "class_name",
    filterValue: "GASTROPODA",
  },
  bivalvia: {
    id: "bivalvia",
    name: "Bivalves",
    dataFile: "redlist-bivalvia.json",
    filterColumn: "class_name",
    filterValue: "BIVALVIA",
  },
  anthozoa: {
    id: "anthozoa",
    name: "Corals & Anemones",
    dataFile: "redlist-anthozoa.json",
    filterColumn: "class_name",
    filterValue: "ANTHOZOA",
  },
};

interface PreviousAssessment {
  year: string;
  assessment_id: number;
  category: string;
}

interface Species {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  common_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string;
  url: string;
  population_trend: string | null;
  countries: string[];
  assessment_count: number;
  previous_assessments: PreviousAssessment[];
}

interface OutputData {
  species: Species[];
  metadata: {
    totalSpecies: number;
    fetchedAt: string;
    pagesProcessed: number;
    lastPage: number;
    byCategory: Record<string, number>;
    complete: boolean;
    taxonId: string;
    source: string;
  };
}

// Population trend code to text mapping
const POPULATION_TRENDS: Record<string, string> = {
  "0": "Increasing",
  "1": "Decreasing",
  "2": "Stable",
  "3": "Unknown",
};

async function fetchTaxonData(
  client: Client,
  taxonConfig: TaxonConfig
): Promise<Species[]> {
  console.log(`\nFetching ${taxonConfig.name}...`);

  // Main query to get species with latest global assessments
  const mainQuery = `
    SELECT DISTINCT ON (t.sis_id)
      t.sis_id as sis_taxon_id,
      a.redlist_id as assessment_id,
      t.scientific_name,
      tcn.name as common_name,
      t.family_name as family,
      rlc.code as category,
      a.assessment_date,
      a.year_published,
      pt.code as population_trend_code
    FROM taxons t
    JOIN assessments a ON a.taxon_id = t.id
    JOIN assessment_scopes ascope ON ascope.assessment_id = a.id
    JOIN red_list_category_lookup rlc ON rlc.id = a.red_list_category_id
    LEFT JOIN taxon_common_names tcn ON tcn.taxon_id = t.id
      AND tcn.language_id = 609 AND tcn.main = true
    LEFT JOIN population_trend_lookup pt ON pt.id = a.population_trend_id
    WHERE t.${taxonConfig.filterColumn} = $1
      AND t.latest = true
      AND a.latest = true
      AND a.suppress = false
      AND ascope.scope_lookup_id = 15  -- Global assessments only
    ORDER BY t.sis_id, a.assessment_date DESC
  `;

  const mainResult = await client.query(mainQuery, [taxonConfig.filterValue]);
  console.log(`  Found ${mainResult.rows.length} species with global assessments`);

  // Build a map of assessment_id -> species data
  const speciesMap = new Map<number, Species>();
  const assessmentIds: number[] = [];
  const sisTaxonIds: number[] = [];

  for (const row of mainResult.rows) {
    const assessmentDate = row.assessment_date
      ? new Date(row.assessment_date).toISOString().split("T")[0]
      : null;

    const sisTaxonId = Number(row.sis_taxon_id);
    const assessmentId = Number(row.assessment_id);

    speciesMap.set(assessmentId, {
      sis_taxon_id: sisTaxonId,
      assessment_id: assessmentId,
      scientific_name: row.scientific_name,
      common_name: row.common_name || null,
      family: row.family || null,
      category: row.category,
      assessment_date: assessmentDate,
      year_published: row.year_published,
      url: `https://www.iucnredlist.org/species/${sisTaxonId}/${assessmentId}`,
      population_trend: POPULATION_TRENDS[row.population_trend_code] || null,
      countries: [],
      assessment_count: 1,
      previous_assessments: [],
    });

    assessmentIds.push(assessmentId);
    sisTaxonIds.push(sisTaxonId);
  }

  // Batch fetch countries for all assessments
  console.log("  Fetching countries...");
  if (assessmentIds.length > 0) {
    const countriesQuery = `
      SELECT
        a.redlist_id as assessment_id,
        ll.code as country_code
      FROM assessments a
      JOIN assessment_locations al ON al.assessment_id = a.id
      JOIN location_lookup ll ON ll.id = al.location_id
      JOIN legend_lookup leg ON leg.id = al.legend_id
      WHERE a.redlist_id = ANY($1)
        AND leg.origin = 'Native'
        AND leg.presence = 'Extant'
        AND LENGTH(ll.code) = 2  -- Only country codes, not regions
    `;

    const countriesResult = await client.query(countriesQuery, [assessmentIds]);

    // Group countries by assessment
    const countriesByAssessment = new Map<number, Set<string>>();
    for (const row of countriesResult.rows) {
      const assessmentId = Number(row.assessment_id);
      if (!countriesByAssessment.has(assessmentId)) {
        countriesByAssessment.set(assessmentId, new Set());
      }
      countriesByAssessment.get(assessmentId)!.add(row.country_code);
    }

    // Assign countries to species
    for (const [assessmentId, countries] of countriesByAssessment) {
      const species = speciesMap.get(assessmentId);
      if (species) {
        species.countries = Array.from(countries).sort();
      }
    }
  }

  // Batch fetch previous assessments
  console.log("  Fetching previous assessments...");
  if (sisTaxonIds.length > 0) {
    const previousQuery = `
      SELECT
        t.sis_id as sis_taxon_id,
        a.redlist_id as assessment_id,
        a.year_published,
        rlc.code as category,
        a.latest
      FROM taxons t
      JOIN assessments a ON a.taxon_id = t.id
      JOIN red_list_category_lookup rlc ON rlc.id = a.red_list_category_id
      WHERE t.sis_id = ANY($1)
        AND a.suppress = false
      ORDER BY t.sis_id, a.year_published DESC
    `;

    const previousResult = await client.query(previousQuery, [sisTaxonIds]);

    // Group assessments by sis_taxon_id
    const assessmentsByTaxon = new Map<number, Array<{ year: string; assessment_id: number; category: string; latest: boolean }>>();
    for (const row of previousResult.rows) {
      const sisTaxonId = Number(row.sis_taxon_id);
      if (!assessmentsByTaxon.has(sisTaxonId)) {
        assessmentsByTaxon.set(sisTaxonId, []);
      }
      assessmentsByTaxon.get(sisTaxonId)!.push({
        year: row.year_published,
        assessment_id: Number(row.assessment_id),
        category: row.category,
        latest: row.latest,
      });
    }

    // Assign to species
    for (const species of speciesMap.values()) {
      const allAssessments = assessmentsByTaxon.get(species.sis_taxon_id) || [];
      species.assessment_count = allAssessments.length;
      species.previous_assessments = allAssessments
        .filter((a) => !a.latest)
        .map((a) => ({
          year: a.year,
          assessment_id: a.assessment_id,
          category: a.category,
        }));
    }
  }

  return Array.from(speciesMap.values());
}

function saveData(
  outputFile: string,
  species: Species[],
  taxonId: string
): void {
  // Calculate category counts
  const byCategory: Record<string, number> = {};
  for (const s of species) {
    byCategory[s.category] = (byCategory[s.category] || 0) + 1;
  }

  const output: OutputData = {
    species,
    metadata: {
      totalSpecies: species.length,
      fetchedAt: new Date().toISOString(),
      pagesProcessed: 1,
      lastPage: 1,
      byCategory,
      complete: true,
      taxonId,
      source: "database",
    },
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const taxonArg = args[0]?.toLowerCase();

  if (!taxonArg) {
    console.error("Usage: npx tsx scripts/fetch-redlist-from-db.ts <taxon>");
    console.error("\nAvailable taxa:");
    Object.entries(TAXA_CONFIG).forEach(([id, config]) => {
      console.error(`  ${id.padEnd(18)} - ${config.name}`);
    });
    console.error(`  ${"all".padEnd(18)} - Fetch all taxa`);
    process.exit(1);
  }

  // Determine which taxa to fetch
  let taxaToFetch: TaxonConfig[];
  if (taxonArg === "all") {
    taxaToFetch = Object.values(TAXA_CONFIG);
  } else {
    const taxonConfig = TAXA_CONFIG[taxonArg];
    if (!taxonConfig) {
      console.error(`Unknown taxon: ${taxonArg}`);
      console.error("\nAvailable taxa:");
      Object.keys(TAXA_CONFIG).forEach((id) => console.error(`  ${id}`));
      process.exit(1);
    }
    taxaToFetch = [taxonConfig];
  }

  console.log("IUCN Red List Database Fetcher");
  console.log("=".repeat(50));

  // Connect to database
  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: 5433, // SSH tunnel port
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    console.log("Connected to database");

    let totalSpecies = 0;
    let totalWithCommonNames = 0;

    for (const taxonConfig of taxaToFetch) {
      const species = await fetchTaxonData(client, taxonConfig);

      const outputFile = path.join(__dirname, "../data", taxonConfig.dataFile);
      saveData(outputFile, species, taxonConfig.id);

      const withCommonNames = species.filter((s) => s.common_name).length;
      totalSpecies += species.length;
      totalWithCommonNames += withCommonNames;

      console.log(`  Saved ${species.length} species to ${taxonConfig.dataFile}`);
      console.log(`  Common names: ${withCommonNames}/${species.length} (${((withCommonNames / species.length) * 100).toFixed(1)}%)`);

      // File size
      const stats = fs.statSync(outputFile);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`  File size: ${sizeMB} MB`);
    }

    console.log("\n" + "=".repeat(50));
    console.log(`Total: ${totalSpecies} species`);
    console.log(`Common names: ${totalWithCommonNames}/${totalSpecies} (${((totalWithCommonNames / totalSpecies) * 100).toFixed(1)}%)`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
