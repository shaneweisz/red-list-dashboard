import fs from "node:fs/promises";
import path from "node:path";
import { execSync, spawn } from "node:child_process";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args[key] = value;
  }
  return args;
}

function getGitSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function listFilesRecursively(dir) {
  const result = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(next);
      } else {
        result.push(next);
      }
    }
  }
  await walk(dir);
  return result;
}

async function loadCheckResults(checksDir) {
  const checks = [];
  const files = await listFilesRecursively(checksDir);

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const content = JSON.parse(await fs.readFile(file, "utf8"));
      const project = content.project || path.basename(file, ".json");
      for (const check of content.checks || []) {
        checks.push({
          id: check.id,
          project,
          status: check.status,
          details: check.details,
        });
      }
    } catch {
      // Skip malformed files.
    }
  }

  return checks;
}

function themeToProjects(theme) {
  if (theme === "light") {
    return ["chromium-light"];
  }
  if (theme === "dark") {
    return ["chromium-dark"];
  }
  return ["chromium-light", "chromium-dark"];
}

const args = parseArgs(process.argv);
const featureId = args.name;
const route = args.route || "/";
const phase = args.phase || "after";
const theme = args.theme || "both";

if (!featureId) {
  console.error("Missing required --name argument");
  process.exit(2);
}

if (!["before", "after"].includes(phase)) {
  console.error("Invalid --phase. Use before|after.");
  process.exit(2);
}

if (!["light", "dark", "both"].includes(theme)) {
  console.error("Invalid --theme. Use light|dark|both.");
  process.exit(2);
}

const cwd = process.cwd();
const proofOutputDir = path.resolve(cwd, "test-results", "proof", featureId, phase);
const checksDir = path.join(proofOutputDir, "checks");
const projects = themeToProjects(theme);
const playwrightArgs = [
  "playwright",
  "test",
  "tests/proof/title-header.proof.spec.ts",
  "--config=playwright.config.ts",
  "--reporter=list",
];

for (const project of projects) {
  playwrightArgs.push("--project", project);
}

if (process.env.PLAYWRIGHT_UPDATE_SNAPSHOTS === "1") {
  playwrightArgs.push("--update-snapshots");
}

await fs.rm(proofOutputDir, { recursive: true, force: true });
await fs.mkdir(proofOutputDir, { recursive: true });

const env = {
  ...process.env,
  PROOF_FEATURE_NAME: featureId,
  PROOF_ROUTE: route,
  PROOF_PHASE: phase,
  PROOF_OUTPUT_DIR: proofOutputDir,
  PROOF_CAPTURE_VIDEO: "1",
};

const command = process.platform === "win32" ? "npx.cmd" : "npx";

const exitCode = await new Promise((resolve) => {
  const child = spawn(command, playwrightArgs, {
    cwd,
    env,
    stdio: "inherit",
  });

  child.on("exit", (code) => resolve(code ?? 1));
  child.on("error", () => resolve(1));
});

const checks = await loadCheckResults(checksDir);
const files = await listFilesRecursively(proofOutputDir);
const interestingExtensions = new Set([".png", ".webm", ".zip", ".json", ".html"]);
const artifacts = files
  .filter((file) => interestingExtensions.has(path.extname(file)))
  .map((file) => path.relative(proofOutputDir, file))
  .sort();

const overallStatus = checks.every((check) => check.status === "pass") && exitCode === 0 ? "pass" : "fail";

const manifest = {
  schemaVersion: "1.0.0",
  featureId,
  phase,
  route,
  theme,
  commitSha: process.env.PROOF_COMMIT_SHA || getGitSha(),
  timestamp: new Date().toISOString(),
  overallStatus,
  exitCode,
  checks,
  artifacts,
};

const manifestPath = path.join(proofOutputDir, "proof-report.json");
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Proof manifest written to ${manifestPath}`);

process.exit(exitCode);
