/**
 * Pre-compute script to fetch all IUCN Red List plant species
 * and save to a JSON file for fast serving.
 *
 * Usage:
 *   npx tsx scripts/fetch-redlist-species.ts [--pages N] [--start-page N] [--resume]
 *
 * Options:
 *   --pages N       Number of pages to fetch (default: all ~807 pages)
 *   --start-page N  Page to start from (default: 1)
 *   --resume        Resume from existing data file (auto-detect last page)
 *
 * Example (test with 3 pages):
 *   npx tsx scripts/fetch-redlist-species.ts --pages 3
 *
 * Resume after interruption:
 *   npx tsx scripts/fetch-redlist-species.ts --resume
 */

import * as fs from "fs";
import * as path from "path";

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
const OUTPUT_FILE = path.join(__dirname, "../data/redlist-species.json");
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
}

interface TaxonResponse {
  assessments?: TaxonAssessment[];
}

interface Species {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  category: string;
  year_published: string;
  url: string;
  assessment_count: number;
  previous_assessments: string[];
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

async function fetchAssessmentHistory(
  taxonId: number
): Promise<{ count: number; previous: string[] }> {
  try {
    const res = await fetchWithAuth(
      `https://api.iucnredlist.org/api/v4/taxa/sis/${taxonId}`
    );
    if (res.ok) {
      const data: TaxonResponse = await res.json();
      const allAssessments = data.assessments || [];
      const previous = allAssessments
        .filter((a) => !a.latest)
        .map((a) => a.year_published)
        .sort((a, b) => parseInt(b) - parseInt(a));
      return { count: allAssessments.length, previous };
    }
  } catch {
    // Silently fail, return defaults
  }
  return { count: 1, previous: [] };
}

async function fetchPage(page: number): Promise<Assessment[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetchWithAuth(
      `https://api.iucnredlist.org/api/v4/taxa/kingdom/Plantae?latest=true&page=${page}`
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

function loadExistingData(): OutputData | null {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const content = fs.readFileSync(OUTPUT_FILE, "utf-8");
      return JSON.parse(content) as OutputData;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

function saveData(
  species: Species[],
  categoryCounts: Record<string, number>,
  pagesProcessed: number,
  lastPage: number,
  complete: boolean
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
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let maxPages = Infinity;
  let startPage = 1;
  let resume = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pages" && args[i + 1]) {
      maxPages = parseInt(args[i + 1], 10);
    }
    if (args[i] === "--start-page" && args[i + 1]) {
      startPage = parseInt(args[i + 1], 10);
    }
    if (args[i] === "--resume") {
      resume = true;
    }
  }

  // Load existing data if resuming
  let allSpecies: Species[] = [];
  let categoryCounts: Record<string, number> = {};
  let pagesProcessed = 0;

  if (resume) {
    const existing = loadExistingData();
    if (existing && !existing.metadata.complete) {
      allSpecies = existing.species;
      categoryCounts = existing.metadata.byCategory;
      pagesProcessed = existing.metadata.pagesProcessed;
      startPage = existing.metadata.lastPage + 1;
      console.log(`📂 Resuming from existing data...`);
      console.log(`   Found ${allSpecies.length} species from ${pagesProcessed} pages`);
      console.log(`   Continuing from page ${startPage}`);
      console.log("");
    } else if (existing?.metadata.complete) {
      console.log("✓ Data collection already complete!");
      console.log(`   ${existing.species.length} species in ${OUTPUT_FILE}`);
      return;
    }
  }

  console.log("🌿 IUCN Red List Species Fetcher");
  console.log("================================");
  console.log(`Start page: ${startPage}`);
  console.log(`Max pages: ${maxPages === Infinity ? "all" : maxPages}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Auto-save: every ${SAVE_INTERVAL} pages`);
  console.log("");

  if (!API_KEY) {
    console.error("❌ RED_LIST_API_KEY not set in .env.local");
    process.exit(1);
  }

  let page = startPage;
  let emptyPages = 0;
  let pagesThisRun = 0;

  // Main fetch loop
  while (pagesThisRun < maxPages) {
    process.stdout.write(`\rFetching page ${page}...`);

    try {
      const assessments = await fetchPage(page);

      if (assessments.length === 0) {
        emptyPages++;
        if (emptyPages >= 3) {
          console.log(`\n✓ Reached end of data at page ${page}`);
          break;
        }
        page++;
        continue;
      }

      emptyPages = 0;

      // Fetch assessment history in batches
      for (let i = 0; i < assessments.length; i += BATCH_SIZE) {
        const batch = assessments.slice(i, i + BATCH_SIZE);
        const historyPromises = batch.map((a) =>
          fetchAssessmentHistory(a.sis_taxon_id)
        );
        const histories = await Promise.all(historyPromises);

        for (let j = 0; j < batch.length; j++) {
          const a = batch[j];
          const history = histories[j];

          const species: Species = {
            sis_taxon_id: a.sis_taxon_id,
            assessment_id: a.assessment_id,
            scientific_name: a.taxon_scientific_name,
            category: a.red_list_category_code,
            year_published: a.year_published,
            url: a.url,
            assessment_count: history.count,
            previous_assessments: history.previous,
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
          `\n  → ${allSpecies.length} species collected (${pagesProcessed} pages) - saving...`
        );
        saveData(allSpecies, categoryCounts, pagesProcessed, page - 1, false);
      }

      // Delay between pages
      await delay(PAGE_DELAY);
    } catch (err) {
      console.error(`\n❌ Error on page ${page}:`, err);
      // Save progress before continuing
      saveData(allSpecies, categoryCounts, pagesProcessed, page - 1, false);
      console.log(`   Progress saved. Resume with: npx tsx scripts/fetch-redlist-species.ts --resume`);
      // Continue to next page on error
      page++;
    }
  }

  console.log(`\n\n📊 Collection complete!`);
  console.log(`   Total species: ${allSpecies.length}`);
  console.log(`   Pages processed: ${pagesProcessed}`);
  console.log(`   Categories:`, categoryCounts);

  // Final save
  saveData(allSpecies, categoryCounts, pagesProcessed, page - 1, true);
  console.log(`\n✓ Saved to ${OUTPUT_FILE}`);

  // File size
  const stats = fs.statSync(OUTPUT_FILE);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`   File size: ${sizeMB} MB`);
}

main().catch(console.error);
