/**
 * Pre-compute script to fetch IUCN Red List species for any taxon
 * and save to a JSON file for fast serving.
 *
 * Usage:
 *   npx tsx scripts/fetch-redlist-species.ts <taxon> [--pages N] [--start-page N] [--resume]
 *
 * Taxa (from src/config/taxa.ts):
 *   plantae, mammalia, aves, reptilia, amphibia, actinopterygii,
 *   chondrichthyes, insecta, arachnida, malacostraca, gastropoda,
 *   bivalvia, anthozoa
 *
 * Options:
 *   --pages N       Number of pages to fetch (default: all)
 *   --start-page N  Page to start from (default: 1)
 *   --resume        Resume from existing data file (auto-detect last page)
 *
 * Examples:
 *   npx tsx scripts/fetch-redlist-species.ts plantae          # Fetch all plants
 *   npx tsx scripts/fetch-redlist-species.ts mammalia --pages 3  # Test with 3 pages
 *   npx tsx scripts/fetch-redlist-species.ts aves --resume    # Resume birds fetch
 */

import * as fs from "fs";
import * as path from "path";

// Taxa configuration (inline to avoid import issues with tsx)
interface TaxonConfig {
  id: string;
  name: string;
  apiEndpoint: string;
  dataFile: string;
}

const TAXA_CONFIG: Record<string, TaxonConfig> = {
  plantae: { id: "plantae", name: "Plants", apiEndpoint: "kingdom/Plantae", dataFile: "redlist-plantae.json" },
  ascomycota: { id: "ascomycota", name: "Ascomycota (Sac Fungi)", apiEndpoint: "phylum/Ascomycota", dataFile: "redlist-ascomycota.json" },
  basidiomycota: { id: "basidiomycota", name: "Basidiomycota (Mushrooms)", apiEndpoint: "phylum/Basidiomycota", dataFile: "redlist-basidiomycota.json" },
  mammalia: { id: "mammalia", name: "Mammals", apiEndpoint: "class/Mammalia", dataFile: "redlist-mammalia.json" },
  aves: { id: "aves", name: "Birds", apiEndpoint: "class/Aves", dataFile: "redlist-aves.json" },
  reptilia: { id: "reptilia", name: "Reptiles", apiEndpoint: "class/Reptilia", dataFile: "redlist-reptilia.json" },
  amphibia: { id: "amphibia", name: "Amphibians", apiEndpoint: "class/Amphibia", dataFile: "redlist-amphibia.json" },
  actinopterygii: { id: "actinopterygii", name: "Ray-finned Fishes", apiEndpoint: "class/Actinopterygii", dataFile: "redlist-actinopterygii.json" },
  chondrichthyes: { id: "chondrichthyes", name: "Sharks & Rays", apiEndpoint: "class/Chondrichthyes", dataFile: "redlist-chondrichthyes.json" },
  insecta: { id: "insecta", name: "Insects", apiEndpoint: "class/Insecta", dataFile: "redlist-insecta.json" },
  arachnida: { id: "arachnida", name: "Arachnids", apiEndpoint: "class/Arachnida", dataFile: "redlist-arachnida.json" },
  malacostraca: { id: "malacostraca", name: "Crustaceans", apiEndpoint: "class/Malacostraca", dataFile: "redlist-malacostraca.json" },
  gastropoda: { id: "gastropoda", name: "Snails & Slugs", apiEndpoint: "class/Gastropoda", dataFile: "redlist-gastropoda.json" },
  bivalvia: { id: "bivalvia", name: "Bivalves", apiEndpoint: "class/Bivalvia", dataFile: "redlist-bivalvia.json" },
  anthozoa: { id: "anthozoa", name: "Corals & Anemones", apiEndpoint: "class/Anthozoa", dataFile: "redlist-anthozoa.json" },
};

// Load environment variables from .env.local manually
function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
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

loadEnvFile(path.join(__dirname, "../.env.local"));

const API_KEY = process.env.RED_LIST_API_KEY;
const PAGE_DELAY = 1000; // ms between page fetches
const BATCH_DELAY = 500; // ms between assessment detail batches
const BATCH_SIZE = 5; // concurrent requests for assessment details (reduced)
const MAX_RETRIES = 3; // retries on rate limit
const SAVE_INTERVAL = 1; // save every page

interface Assessment {
  sis_taxon_id: number;
  assessment_id: number;
  taxon_scientific_name: string;
  red_list_category_code: string;
  year_published: string;
  url: string;
}

interface ApiResponse {
  assessments: Assessment[];
}

interface TaxonAssessment {
  assessment_id: number;
  year_published: string;
  latest: boolean;
  red_list_category_code: string;
}

interface TaxonData {
  family_name?: string;
}

interface TaxonResponse {
  assessments?: TaxonAssessment[];
  taxon?: TaxonData;
}

interface AssessmentLocation {
  code: string;
  origin: string;
  presence: string;
}

interface AssessmentPopulationTrend {
  description?: {
    en?: string;
  };
}

interface AssessmentResponse {
  assessment_date?: string;
  population_trend?: AssessmentPopulationTrend;
  locations?: AssessmentLocation[];
}

interface PreviousAssessment {
  year: string;
  assessment_id: number;
  category: string;
}

interface Species {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
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
    taxonId?: string;
  };
}

async function fetchWithAuth(url: string): Promise<Response> {
  if (!API_KEY) {
    throw new Error("RED_LIST_API_KEY environment variable not set");
  }

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SpeciesDetails {
  count: number;
  previous: PreviousAssessment[];
  family: string | null;
  assessment_date: string | null;
  population_trend: string | null;
  countries: string[];
}

async function fetchSpeciesDetails(
  taxonId: number,
  assessmentId: number
): Promise<SpeciesDetails> {
  const defaults: SpeciesDetails = {
    count: 1,
    previous: [],
    family: null,
    assessment_date: null,
    population_trend: null,
    countries: [],
  };

  try {
    // Fetch both taxon details and assessment details in parallel
    const [taxonRes, assessmentRes] = await Promise.all([
      fetchWithAuth(`https://api.iucnredlist.org/api/v4/taxa/sis/${taxonId}`),
      fetchWithAuth(`https://api.iucnredlist.org/api/v4/assessment/${assessmentId}`),
    ]);

    let count = 1;
    let previous: PreviousAssessment[] = [];
    let family: string | null = null;
    let assessment_date: string | null = null;
    let population_trend: string | null = null;
    let countries: string[] = [];

    // Parse taxon response (for assessment history and family)
    if (taxonRes.ok) {
      const taxonData: TaxonResponse = await taxonRes.json();
      const allAssessments = taxonData.assessments || [];
      count = allAssessments.length;
      previous = allAssessments
        .filter((a) => !a.latest)
        .map((a) => ({
          year: a.year_published,
          assessment_id: a.assessment_id,
          category: a.red_list_category_code,
        }))
        .sort((a, b) => parseInt(b.year) - parseInt(a.year));
      family = taxonData.taxon?.family_name || null;
    }

    // Parse assessment response (for assessment date, population trend and countries)
    if (assessmentRes.ok) {
      const assessmentData: AssessmentResponse = await assessmentRes.json();
      // Store just the date portion (YYYY-MM-DD)
      assessment_date = assessmentData.assessment_date?.split("T")[0] || null;
      population_trend = assessmentData.population_trend?.description?.en || null;

      // Extract unique country codes (only native/extant species)
      if (assessmentData.locations) {
        countries = [...new Set(
          assessmentData.locations
            .filter((loc) => loc.origin === "Native" && loc.presence === "Extant")
            .map((loc) => loc.code)
            .filter((code) => code.length === 2) // Only country codes, not regions
        )].sort();
      }
    }

    return { count, previous, family, assessment_date, population_trend, countries };
  } catch {
    // Silently fail, return defaults
  }
  return defaults;
}

async function fetchPage(page: number, apiEndpoint: string): Promise<Assessment[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // scope_code=1 = Global assessments only (excludes regional/national)
    const res = await fetchWithAuth(
      `https://api.iucnredlist.org/api/v4/taxa/${apiEndpoint}?latest=true&scope_code=1&page=${page}`
    );

    if (res.ok) {
      const data: ApiResponse = await res.json();
      return data.assessments || [];
    }

    if (res.status === 429) {
      // Rate limited - wait and retry
      const waitTime = attempt * 5000; // 5s, 10s, 15s
      console.log(`\n  ⚠ Rate limited on page ${page}, waiting ${waitTime / 1000}s (attempt ${attempt}/${MAX_RETRIES})...`);
      await delay(waitTime);
      continue;
    }

    throw new Error(`API error on page ${page}: ${res.statusText}`);
  }

  throw new Error(`Failed to fetch page ${page} after ${MAX_RETRIES} retries`);
}

function loadExistingData(outputFile: string): OutputData | null {
  try {
    if (fs.existsSync(outputFile)) {
      const content = fs.readFileSync(outputFile, "utf-8");
      return JSON.parse(content) as OutputData;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

function saveData(
  outputFile: string,
  species: Species[],
  categoryCounts: Record<string, number>,
  pagesProcessed: number,
  lastPage: number,
  complete: boolean,
  taxonId: string
): void {
  const output: OutputData = {
    species,
    metadata: {
      totalSpecies: species.length,
      fetchedAt: new Date().toISOString(),
      pagesProcessed,
      lastPage,
      byCategory: categoryCounts,
      complete,
      taxonId,
    },
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let maxPages = Infinity;
  let startPage = 1;
  let resume = false;
  let taxonId: string | null = null;

  // First arg without -- is the taxon
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pages" && args[i + 1]) {
      maxPages = parseInt(args[i + 1], 10);
    } else if (args[i] === "--start-page" && args[i + 1]) {
      startPage = parseInt(args[i + 1], 10);
    } else if (args[i] === "--resume") {
      resume = true;
    } else if (!args[i].startsWith("--") && !taxonId) {
      taxonId = args[i].toLowerCase();
    }
  }

  // Validate taxon
  if (!taxonId) {
    console.error("Usage: npx tsx scripts/fetch-redlist-species.ts <taxon> [options]");
    console.error("\nAvailable taxa:");
    Object.entries(TAXA_CONFIG).forEach(([id, config]) => {
      console.error(`  ${id.padEnd(18)} - ${config.name}`);
    });
    console.error("\nOptions:");
    console.error("  --pages N        Number of pages to fetch");
    console.error("  --start-page N   Page to start from");
    console.error("  --resume         Resume from existing data");
    process.exit(1);
  }

  const taxonConfig = TAXA_CONFIG[taxonId];
  if (!taxonConfig) {
    console.error(`Unknown taxon: ${taxonId}`);
    console.error("\nAvailable taxa:");
    Object.keys(TAXA_CONFIG).forEach((id) => console.error(`  ${id}`));
    process.exit(1);
  }

  const OUTPUT_FILE = path.join(__dirname, "../data", taxonConfig.dataFile);

  // Load existing data if resuming
  let allSpecies: Species[] = [];
  let categoryCounts: Record<string, number> = {};
  let pagesProcessed = 0;

  if (resume) {
    const existing = loadExistingData(OUTPUT_FILE);
    if (existing && !existing.metadata.complete) {
      allSpecies = existing.species;
      categoryCounts = existing.metadata.byCategory;
      pagesProcessed = existing.metadata.pagesProcessed;
      startPage = existing.metadata.lastPage + 1;
      console.log(`Resuming from existing data...`);
      console.log(`   Found ${allSpecies.length} species from ${pagesProcessed} pages`);
      console.log(`   Continuing from page ${startPage}`);
      console.log("");
    } else if (existing?.metadata.complete) {
      console.log("Data collection already complete!");
      console.log(`   ${existing.species.length} species in ${OUTPUT_FILE}`);
      return;
    }
  }

  console.log(`IUCN Red List Species Fetcher - ${taxonConfig.name}`);
  console.log("=".repeat(50));
  console.log(`Taxon: ${taxonConfig.name} (${taxonId})`);
  console.log(`API endpoint: ${taxonConfig.apiEndpoint}`);
  console.log(`Start page: ${startPage}`);
  console.log(`Max pages: ${maxPages === Infinity ? "all" : maxPages}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Auto-save: every ${SAVE_INTERVAL} pages`);
  console.log("");

  if (!API_KEY) {
    console.error("RED_LIST_API_KEY not set in .env.local");
    process.exit(1);
  }

  let page = startPage;
  let emptyPages = 0;
  let pagesThisRun = 0;

  // Main fetch loop
  while (pagesThisRun < maxPages) {
    process.stdout.write(`\rFetching page ${page}...`);

    try {
      const assessments = await fetchPage(page, taxonConfig.apiEndpoint);

      if (assessments.length === 0) {
        emptyPages++;
        if (emptyPages >= 3) {
          console.log(`\nReached end of data at page ${page}`);
          break;
        }
        page++;
        continue;
      }

      emptyPages = 0;

      // Fetch species details in batches
      for (let i = 0; i < assessments.length; i += BATCH_SIZE) {
        const batch = assessments.slice(i, i + BATCH_SIZE);
        const detailsPromises = batch.map((a) =>
          fetchSpeciesDetails(a.sis_taxon_id, a.assessment_id)
        );
        const detailsList = await Promise.all(detailsPromises);

        for (let j = 0; j < batch.length; j++) {
          const a = batch[j];
          const details = detailsList[j];

          const species: Species = {
            sis_taxon_id: a.sis_taxon_id,
            assessment_id: a.assessment_id,
            scientific_name: a.taxon_scientific_name,
            family: details.family,
            category: a.red_list_category_code,
            assessment_date: details.assessment_date,
            year_published: a.year_published,
            url: a.url,
            population_trend: details.population_trend,
            countries: details.countries,
            assessment_count: details.count,
            previous_assessments: details.previous,
          };

          allSpecies.push(species);

          // Track category counts
          const cat = species.category;
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }

        // Rate limit between batches
        await delay(BATCH_DELAY);
      }

      pagesProcessed++;
      pagesThisRun++;
      page++;

      // Progress update and incremental save
      if (pagesProcessed % SAVE_INTERVAL === 0) {
        console.log(
          `\n  -> ${allSpecies.length} species collected (${pagesProcessed} pages) - saving...`
        );
        saveData(OUTPUT_FILE, allSpecies, categoryCounts, pagesProcessed, page - 1, false, taxonId);
      }

      // Delay between pages
      await delay(PAGE_DELAY);
    } catch (err) {
      console.error(`\nError on page ${page}:`, err);
      // Save progress before continuing
      saveData(OUTPUT_FILE, allSpecies, categoryCounts, pagesProcessed, page - 1, false, taxonId);
      console.log(`   Progress saved. Resume with: npx tsx scripts/fetch-redlist-species.ts ${taxonId} --resume`);
      // Continue to next page on error
      page++;
    }
  }

  console.log(`\n\nCollection complete for ${taxonConfig.name}!`);
  console.log(`   Total species: ${allSpecies.length}`);
  console.log(`   Pages processed: ${pagesProcessed}`);
  console.log(`   Categories:`, categoryCounts);

  // Final save
  saveData(OUTPUT_FILE, allSpecies, categoryCounts, pagesProcessed, page - 1, true, taxonId);
  console.log(`\nSaved to ${OUTPUT_FILE}`);

  // File size
  const stats = fs.statSync(OUTPUT_FILE);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`   File size: ${sizeMB} MB`);
}

main().catch(console.error);
