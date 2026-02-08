/**
 * GBIF Common Name Enricher
 * =========================
 *
 * Enriches existing GBIF CSV files with common (vernacular) names from the GBIF Species API.
 * This adds a common_name column to CSVs that already have species_key,occurrence_count,scientific_name.
 *
 * Input format:  species_key,occurrence_count,scientific_name
 * Output format: species_key,occurrence_count,scientific_name,common_name
 *
 * The GBIF Species API (/v1/species/{key}) returns a `vernacularName` field when available.
 * This is typically the most common English name for the species.
 *
 * Usage:
 *   npx tsx scripts/enrich-gbif-common-names.ts <taxon>
 *   npx tsx scripts/enrich-gbif-common-names.ts all
 *
 * Examples:
 *   npx tsx scripts/enrich-gbif-common-names.ts mammalia
 *   npx tsx scripts/enrich-gbif-common-names.ts all
 */

import * as fs from "fs";
import * as path from "path";

// Configuration
const BATCH_SIZE = 500; // Concurrent API requests per batch
const BATCH_DELAY = 50; // ms delay between batches

// Taxa configuration (matches fetch-gbif-species.ts)
const TAXA_FILES: Record<string, string> = {
  plantae: "gbif-plantae.csv",
  fungi: "gbif-fungi.csv",
  mammalia: "gbif-mammalia.csv",
  aves: "gbif-aves.csv",
  reptilia: "gbif-reptilia.csv",
  amphibia: "gbif-amphibia.csv",
  fishes: "gbif-fishes.csv",
  mollusca: "gbif-mollusca.csv",
  insecta: "gbif-insecta.csv",
  arachnida: "gbif-arachnida.csv",
  malacostraca: "gbif-malacostraca.csv",
  anthozoa: "gbif-anthozoa.csv",
  invertebrates: "gbif-invertebrates.csv",
};

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVernacularName(speciesKey: number): Promise<string> {
  try {
    const response = await fetch(`https://api.gbif.org/v1/species/${speciesKey}`);
    if (!response.ok) return "";
    const data = await response.json();
    return data.vernacularName || "";
  } catch {
    return "";
  }
}

async function enrichFile(taxonId: string, fileName: string): Promise<void> {
  const filePath = path.join(process.cwd(), "data", fileName);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.log(`  Skipping ${taxonId}: file not found (${fileName})`);
    return;
  }

  // Read existing CSV
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const header = lines[0];

  // Check if already enriched with common names
  if (header.includes("common_name")) {
    console.log(`  Skipping ${taxonId}: already has common_name column`);
    return;
  }

  // Must have scientific_name column
  if (!header.includes("scientific_name")) {
    console.log(`  Skipping ${taxonId}: missing scientific_name column (run enrich-gbif-names.ts first)`);
    return;
  }

  // Parse species keys from existing data
  const speciesKeys: number[] = [];
  const dataLines = lines.slice(1);
  for (const line of dataLines) {
    const parts = line.split(",");
    speciesKeys.push(parseInt(parts[0], 10));
  }

  console.log(`  Enriching ${taxonId}: ${speciesKeys.length} species...`);

  // Fetch common names in batches
  const commonNames: string[] = new Array(speciesKeys.length).fill("");

  for (let i = 0; i < speciesKeys.length; i += BATCH_SIZE) {
    const batch = speciesKeys.slice(i, i + BATCH_SIZE);

    const names = await Promise.all(
      batch.map((key) => fetchVernacularName(key))
    );

    for (let j = 0; j < names.length; j++) {
      commonNames[i + j] = names[j];
    }

    const progress = Math.min(i + BATCH_SIZE, speciesKeys.length);
    const withNames = commonNames.filter(Boolean).length;
    process.stdout.write(`\r    Progress: ${progress}/${speciesKeys.length} (${withNames} have common names)`);

    if (i + BATCH_SIZE < speciesKeys.length) {
      await delay(BATCH_DELAY);
    }
  }

  console.log(""); // New line after progress

  // Write enriched CSV
  const newHeader = header + ",common_name";
  const newRows = dataLines.map((line, idx) => {
    const name = commonNames[idx];
    // Escape common name if it contains commas
    const safeName = name.includes(",") ? `"${name}"` : name;
    return `${line},${safeName}`;
  });

  const newContent = [newHeader, ...newRows].join("\n");
  fs.writeFileSync(filePath, newContent);

  const withNames = commonNames.filter(Boolean).length;
  const pct = ((withNames / speciesKeys.length) * 100).toFixed(1);
  console.log(`    ${withNames}/${speciesKeys.length} species have common names (${pct}%)`);

  const stats = fs.statSync(filePath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`    Saved: ${sizeMB} MB`);
}

async function main() {
  const args = process.argv.slice(2);
  const taxonId = args[0]?.toLowerCase();

  if (!taxonId) {
    console.error("Usage: npx tsx scripts/enrich-gbif-common-names.ts <taxon>");
    console.error("       npx tsx scripts/enrich-gbif-common-names.ts all");
    console.error("\nAvailable taxa:");
    Object.keys(TAXA_FILES).forEach((id) => console.error(`  ${id}`));
    process.exit(1);
  }

  console.log("GBIF Common Name Enricher");
  console.log("=".repeat(50));

  if (taxonId === "all") {
    // Process all taxa
    for (const [id, fileName] of Object.entries(TAXA_FILES)) {
      await enrichFile(id, fileName);
    }
  } else {
    // Process single taxon
    const fileName = TAXA_FILES[taxonId];
    if (!fileName) {
      console.error(`Unknown taxon: ${taxonId}`);
      console.error("\nAvailable taxa:");
      Object.keys(TAXA_FILES).forEach((id) => console.error(`  ${id}`));
      process.exit(1);
    }
    await enrichFile(taxonId, fileName);
  }

  console.log("\nDone!");
}

main().catch(console.error);
