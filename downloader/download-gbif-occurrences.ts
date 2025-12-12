/**
 * GBIF Occurrence Downloader
 * ==========================
 *
 * Downloads occurrence records from GBIF for a specified taxon and country.
 * Uses GBIF's async download API which processes large requests server-side.
 *
 * ## Prerequisites
 *
 * 1. GBIF account (free): https://www.gbif.org/user/profile
 * 2. Set environment variables:
 *    - GBIF_USERNAME: Your GBIF username
 *    - GBIF_PASSWORD: Your GBIF password
 *    - DATADIR: Directory to save downloads (defaults to ./data)
 *
 * ## Usage
 *
 *   npx tsx download-gbif-occurrences.ts [options]
 *
 * Options:
 *   --taxon <name>     Taxon to download (plantae, fungi, mammalia, etc.) [default: plantae]
 *   --country <code>   ISO country code (GB, US, FR, etc.) [default: GB]
 *   --format <type>    Download format: DWCA, SIMPLE_CSV, SPECIES_LIST [default: DWCA]
 *   --dry-run          Show the query without submitting
 *
 * ## Output
 *
 * Downloads are saved to: $DATADIR/gbif-occurrences-<taxon>-<country>-<timestamp>.zip
 *
 * DWCA format includes:
 * - occurrence.txt: Main occurrence records with all Darwin Core fields
 * - multimedia.txt: Associated media (images, sounds)
 * - verbatim.txt: Original verbatim records
 * - meta.xml: Archive structure metadata
 *
 * ## Estimated Times (UK Plants example: 39M records)
 *
 * - GBIF processing: 1-4 hours
 * - Download: 30-90 minutes (15-25 GB compressed)
 */

// GBIF taxonomy keys for different taxa
const TAXON_KEYS: Record<string, { type: "kingdom" | "class" | "order"; keys: number[] }> = {
  plantae: { type: "kingdom", keys: [6] },
  fungi: { type: "kingdom", keys: [5] },
  mammalia: { type: "class", keys: [359] },
  aves: { type: "class", keys: [212] },
  reptilia: { type: "class", keys: [11592253, 11493978, 11418114] },
  amphibia: { type: "class", keys: [131] },
  actinopterygii: { type: "class", keys: [204] },
  invertebrata: { type: "class", keys: [216, 367, 225, 137, 229, 206] },
};

interface DownloadRequest {
  creator: string;
  notificationAddresses: string[];
  sendNotification: boolean;
  format: "DWCA" | "SIMPLE_CSV" | "SPECIES_LIST";
  predicate: {
    type: string;
    predicates?: object[];
    key?: string;
    value?: string | number | boolean;
    values?: (string | number)[];
  };
}

interface DownloadStatus {
  key: string;
  status: "PREPARING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "KILLED";
  downloadLink?: string;
  size?: number;
  totalRecords?: number;
  created: string;
  modified: string;
  eraseAfter?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): {
  taxon: string;
  country: string;
  format: "DWCA" | "SIMPLE_CSV" | "SPECIES_LIST";
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const result = {
    taxon: "plantae",
    country: "GB",
    format: "DWCA" as const,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--taxon":
        result.taxon = args[++i]?.toLowerCase() || result.taxon;
        break;
      case "--country":
        result.country = args[++i]?.toUpperCase() || result.country;
        break;
      case "--format":
        const fmt = args[++i]?.toUpperCase();
        if (fmt === "DWCA" || fmt === "SIMPLE_CSV" || fmt === "SPECIES_LIST") {
          result.format = fmt;
        }
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
    }
  }

  return result;
}

function buildPredicate(taxon: string, country: string): DownloadRequest["predicate"] {
  const taxonConfig = TAXON_KEYS[taxon];
  if (!taxonConfig) {
    throw new Error(
      `Unknown taxon: ${taxon}. Available: ${Object.keys(TAXON_KEYS).join(", ")}`
    );
  }

  const predicates: object[] = [
    // Country filter
    { type: "equals", key: "COUNTRY", value: country },
    // Has coordinates
    { type: "equals", key: "HAS_COORDINATE", value: true },
    // No geospatial issues
    { type: "equals", key: "HAS_GEOSPATIAL_ISSUE", value: false },
    // Exclude fossils and citations
    {
      type: "in",
      key: "BASIS_OF_RECORD",
      values: [
        "HUMAN_OBSERVATION",
        "MACHINE_OBSERVATION",
        "PRESERVED_SPECIMEN",
        "OCCURRENCE",
        "MATERIAL_SAMPLE",
        "OBSERVATION",
        "LIVING_SPECIMEN",
      ],
    },
  ];

  // Add taxon filter based on type
  const keyField =
    taxonConfig.type === "kingdom"
      ? "KINGDOM_KEY"
      : taxonConfig.type === "class"
        ? "CLASS_KEY"
        : "ORDER_KEY";

  if (taxonConfig.keys.length === 1) {
    predicates.push({ type: "equals", key: keyField, value: taxonConfig.keys[0] });
  } else {
    predicates.push({ type: "in", key: keyField, values: taxonConfig.keys });
  }

  return {
    type: "and",
    predicates,
  };
}

async function submitDownloadRequest(
  request: DownloadRequest,
  username: string,
  password: string
): Promise<string> {
  const response = await fetch("https://api.gbif.org/v1/occurrence/download/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit download request: ${response.status} - ${error}`);
  }

  const downloadKey = await response.text();
  return downloadKey;
}

async function checkDownloadStatus(downloadKey: string): Promise<DownloadStatus> {
  const response = await fetch(
    `https://api.gbif.org/v1/occurrence/download/${downloadKey}`
  );

  if (!response.ok) {
    throw new Error(`Failed to check download status: ${response.status}`);
  }

  return response.json();
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  const fs = await import("fs");
  const { Readable } = await import("stream");
  const { finished } = await import("stream/promises");

  const fileStream = fs.createWriteStream(outputPath);
  await finished(Readable.fromWeb(response.body as any).pipe(fileStream));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

async function main() {
  const { taxon, country, format, dryRun } = parseArgs();

  const username = process.env.GBIF_USERNAME;
  const password = process.env.GBIF_PASSWORD;
  const dataDir = process.env.DATADIR || "./data";

  if (!dryRun && (!username || !password)) {
    console.error("Error: GBIF_USERNAME and GBIF_PASSWORD environment variables required");
    console.error("");
    console.error("Set them by adding to your .env file or exporting:");
    console.error("  export GBIF_USERNAME=your_username");
    console.error("  export GBIF_PASSWORD=your_password");
    console.error("");
    console.error("Create a free account at: https://www.gbif.org/user/profile");
    process.exit(1);
  }

  const predicate = buildPredicate(taxon, country);

  const request: DownloadRequest = {
    creator: username || "dry-run",
    notificationAddresses: [],
    sendNotification: false,
    format,
    predicate,
  };

  console.log("=".repeat(60));
  console.log("GBIF Occurrence Download Request");
  console.log("=".repeat(60));
  console.log(`Taxon:    ${taxon}`);
  console.log(`Country:  ${country}`);
  console.log(`Format:   ${format}`);
  console.log("");
  console.log("Query predicate:");
  console.log(JSON.stringify(predicate, null, 2));
  console.log("");

  if (dryRun) {
    console.log("[DRY RUN] Would submit this request to GBIF");
    console.log("");
    console.log("Full request body:");
    console.log(JSON.stringify(request, null, 2));
    return;
  }

  // Submit the download request
  console.log("Submitting download request to GBIF...");
  const downloadKey = await submitDownloadRequest(request, username!, password!);
  console.log(`Download key: ${downloadKey}`);
  console.log("");
  console.log(`Track progress: https://www.gbif.org/occurrence/download/${downloadKey}`);
  console.log("");

  // Poll for completion
  const startTime = Date.now();
  let lastStatus = "";

  while (true) {
    const status = await checkDownloadStatus(downloadKey);

    if (status.status !== lastStatus) {
      lastStatus = status.status;
      const elapsed = formatDuration(Date.now() - startTime);
      console.log(`[${elapsed}] Status: ${status.status}`);

      if (status.totalRecords) {
        console.log(`         Records: ${status.totalRecords.toLocaleString()}`);
      }
    }

    if (status.status === "SUCCEEDED") {
      console.log("");
      console.log("Download ready!");
      console.log(`  Records: ${status.totalRecords?.toLocaleString()}`);
      console.log(`  Size: ${formatBytes(status.size || 0)}`);
      console.log(`  Link: ${status.downloadLink}`);
      console.log("");

      // Download the file
      const timestamp = new Date().toISOString().slice(0, 10);
      const outputPath = `${dataDir}/gbif-occurrences-${taxon}-${country.toLowerCase()}-${timestamp}.zip`;

      console.log(`Downloading to: ${outputPath}`);
      const downloadStart = Date.now();

      await downloadFile(status.downloadLink!, outputPath);

      const downloadTime = formatDuration(Date.now() - downloadStart);
      console.log(`Download complete in ${downloadTime}`);
      console.log("");
      console.log("Total time: " + formatDuration(Date.now() - startTime));

      break;
    }

    if (status.status === "FAILED" || status.status === "CANCELLED" || status.status === "KILLED") {
      console.error("");
      console.error(`Download ${status.status.toLowerCase()}`);
      process.exit(1);
    }

    // Poll every 30 seconds
    await sleep(30000);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
