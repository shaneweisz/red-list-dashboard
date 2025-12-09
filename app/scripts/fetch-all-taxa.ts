/**
 * Fetch complete IUCN Red List data for all taxa, one by one.
 * Skips taxa that already have complete data unless --force is specified.
 * Automatically resumes incomplete fetches.
 *
 * Usage:
 *   npx tsx scripts/fetch-all-taxa.ts [options]
 *
 * Options:
 *   --force          Re-fetch all taxa even if data exists (starts from scratch)
 *   --force <taxon>  Re-fetch only the specified taxon
 *   --skip <taxon>   Skip the specified taxon (can be used multiple times)
 *   --only <taxon>   Only fetch the specified taxon (can be used multiple times)
 *   --dry-run        Show what would be fetched without actually fetching
 *
 * Examples:
 *   npx tsx scripts/fetch-all-taxa.ts                    # Fetch all missing/incomplete taxa
 *   npx tsx scripts/fetch-all-taxa.ts --force            # Re-fetch everything from scratch
 *   npx tsx scripts/fetch-all-taxa.ts --force mammalia   # Re-fetch only mammals
 *   npx tsx scripts/fetch-all-taxa.ts --skip plantae     # Skip plants
 *   npx tsx scripts/fetch-all-taxa.ts --only mammalia --only aves  # Only mammals and birds
 *   npx tsx scripts/fetch-all-taxa.ts --dry-run          # Preview what would be fetched
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Taxa configuration
const TAXA = [
  { id: "plantae", name: "Plants" },
  { id: "ascomycota", name: "Ascomycota (Sac Fungi)" },
  { id: "basidiomycota", name: "Basidiomycota (Mushrooms)" },
  { id: "mammalia", name: "Mammals" },
  { id: "aves", name: "Birds" },
  { id: "reptilia", name: "Reptiles" },
  { id: "amphibia", name: "Amphibians" },
  { id: "actinopterygii", name: "Ray-finned Fishes" },
  { id: "chondrichthyes", name: "Sharks & Rays" },
  { id: "insecta", name: "Insects" },
  { id: "arachnida", name: "Arachnids" },
  { id: "malacostraca", name: "Crustaceans" },
  { id: "gastropoda", name: "Snails & Slugs" },
  { id: "bivalvia", name: "Bivalves" },
  { id: "anthozoa", name: "Corals & Anemones" },
];

interface DataFile {
  metadata?: {
    complete?: boolean;
    totalSpecies?: number;
    fetchedAt?: string;
    pagesProcessed?: number;
    lastPage?: number;
  };
}

function getDataFilePath(taxonId: string): string {
  return path.join(__dirname, `../data/redlist-${taxonId}.json`);
}

interface DataStatus {
  exists: boolean;
  complete: boolean;
  species: number;
  pages: number;
  date: string | null;
}

function checkDataStatus(taxonId: string): DataStatus {
  const filePath = getDataFilePath(taxonId);

  if (!fs.existsSync(filePath)) {
    return { exists: false, complete: false, species: 0, pages: 0, date: null };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data: DataFile = JSON.parse(content);
    return {
      exists: true,
      complete: data.metadata?.complete ?? false,
      species: data.metadata?.totalSpecies ?? 0,
      pages: data.metadata?.pagesProcessed ?? 0,
      date: data.metadata?.fetchedAt ?? null,
    };
  } catch {
    return { exists: true, complete: false, species: 0, pages: 0, date: null };
  }
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "N/A";
  return new Date(isoDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let forceAll = false;
  const forceTaxa: Set<string> = new Set();
  const skipTaxa: Set<string> = new Set();
  const onlyTaxa: Set<string> = new Set();
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") {
      // Check if next arg is a taxon or another flag
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        forceTaxa.add(next.toLowerCase());
        i++;
      } else {
        forceAll = true;
      }
    } else if (arg === "--skip" && args[i + 1]) {
      skipTaxa.add(args[i + 1].toLowerCase());
      i++;
    } else if (arg === "--only" && args[i + 1]) {
      onlyTaxa.add(args[i + 1].toLowerCase());
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: npx tsx scripts/fetch-all-taxa.ts [options]

Options:
  --force          Re-fetch all taxa even if data exists
  --force <taxon>  Re-fetch only the specified taxon
  --skip <taxon>   Skip the specified taxon (can be used multiple times)
  --only <taxon>   Only fetch the specified taxon (can be used multiple times)
  --dry-run        Show what would be fetched without actually fetching
  --help, -h       Show this help message

Available taxa:
${TAXA.map(t => `  ${t.id.padEnd(18)} - ${t.name}`).join("\n")}
`);
      process.exit(0);
    }
  }

  console.log("=".repeat(60));
  console.log("IUCN Red List - Fetch All Taxa");
  console.log("=".repeat(60));
  console.log("");

  // Determine which taxa to process
  let taxaToProcess = TAXA;

  if (onlyTaxa.size > 0) {
    taxaToProcess = TAXA.filter(t => onlyTaxa.has(t.id));
    if (taxaToProcess.length === 0) {
      console.error("Error: None of the specified taxa are valid.");
      console.error("Valid taxa:", TAXA.map(t => t.id).join(", "));
      process.exit(1);
    }
  }

  if (skipTaxa.size > 0) {
    taxaToProcess = taxaToProcess.filter(t => !skipTaxa.has(t.id));
  }

  // Check status of all taxa
  console.log("Checking data status...\n");
  console.log("Taxon".padEnd(20), "Status".padEnd(14), "Species".padStart(8), "Pages".padStart(7), "  Date");
  console.log("-".repeat(70));

  interface FetchTask {
    taxon: typeof TAXA[0];
    status: DataStatus;
    action: "fetch" | "resume" | "force";
  }

  const toFetch: FetchTask[] = [];

  for (const taxon of taxaToProcess) {
    const status = checkDataStatus(taxon.id);
    const shouldForce = forceAll || forceTaxa.has(taxon.id);

    let statusText: string;
    let action: "fetch" | "resume" | "force" | null = null;

    if (!status.exists) {
      statusText = "Missing";
      action = "fetch";
    } else if (!status.complete) {
      statusText = `Incomplete`;
      action = "resume";
    } else if (shouldForce) {
      statusText = "Force";
      action = "force";
    } else {
      statusText = "Complete";
      action = null;
    }

    const marker = action ? " *" : "";
    console.log(
      taxon.name.padEnd(20),
      statusText.padEnd(14),
      status.species.toString().padStart(8),
      status.pages.toString().padStart(7),
      " ",
      formatDate(status.date),
      marker
    );

    if (action) {
      toFetch.push({ taxon, status, action });
    }
  }

  console.log("-".repeat(70));
  console.log(`\n* = will be fetched/resumed\n`);

  if (toFetch.length === 0) {
    console.log("All taxa are complete. Nothing to fetch.");
    console.log("Use --force to re-fetch existing data.");
    return;
  }

  console.log(`Taxa to fetch: ${toFetch.length}`);
  for (const task of toFetch) {
    const actionLabel = task.action === "resume"
      ? `(resume from page ${task.status.pages + 1})`
      : task.action === "force"
        ? "(force re-fetch)"
        : "(new)";
    console.log(`  - ${task.taxon.name} (${task.taxon.id}) ${actionLabel}`);
  }
  console.log("");

  if (dryRun) {
    console.log("[Dry run] No data will be fetched.");
    return;
  }

  // Fetch each taxon
  const results: { taxon: string; success: boolean; species: number; action: string; error?: string }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < toFetch.length; i++) {
    const task = toFetch[i];
    const actionDesc = task.action === "resume" ? "Resuming" : "Fetching";
    console.log("=".repeat(60));
    console.log(`[${i + 1}/${toFetch.length}] ${actionDesc} ${task.taxon.name}...`);
    console.log("=".repeat(60));

    try {
      // Build command with --resume flag if resuming
      let cmd = `npx tsx scripts/fetch-redlist-species.ts ${task.taxon.id}`;
      if (task.action === "resume") {
        cmd += " --resume";
      }

      // Run the fetch script
      execSync(cmd, {
        stdio: "inherit",
        cwd: path.join(__dirname, ".."),
      });

      // Check the result
      const status = checkDataStatus(task.taxon.id);
      results.push({
        taxon: task.taxon.name,
        success: status.complete,
        species: status.species,
        action: task.action,
      });

      console.log(`\nCompleted ${task.taxon.name}: ${status.species} species\n`);
    } catch (error) {
      // Check if partial progress was made
      const status = checkDataStatus(task.taxon.id);
      results.push({
        taxon: task.taxon.name,
        success: false,
        species: status.species,
        action: task.action,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      console.error(`\nFailed to fetch ${task.taxon.name} (${status.species} species saved)\n`);
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Time elapsed: ${elapsed} minutes\n`);

  console.log("Taxon".padEnd(20), "Status".padEnd(10), "Species".padStart(10));
  console.log("-".repeat(45));

  let totalSpecies = 0;
  let successCount = 0;

  for (const result of results) {
    const status = result.success ? "OK" : "FAILED";
    console.log(
      result.taxon.padEnd(20),
      status.padEnd(10),
      result.species.toString().padStart(10)
    );
    if (result.success) {
      totalSpecies += result.species;
      successCount++;
    }
  }

  console.log("-".repeat(45));
  console.log(`Total: ${successCount}/${results.length} successful, ${totalSpecies.toLocaleString()} species`);
}

main();
