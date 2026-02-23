import fs from "node:fs/promises";
import path from "node:path";

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

function makeCheckMap(checks) {
  const map = new Map();
  for (const check of checks || []) {
    const key = `${check.project}:${check.id}`;
    map.set(key, check);
  }
  return map;
}

function statusIcon(status) {
  if (status === "pass") {
    return "✅";
  }
  if (status === "fail") {
    return "❌";
  }
  return "➖";
}

const args = parseArgs(process.argv);
const beforePath = args.before;
const afterPath = args.after;
const outJson = args["out-json"] || path.join(process.cwd(), "test-results", "proof", "compare", "comparison.json");
const outMd = args["out-md"] || path.join(process.cwd(), "test-results", "proof", "compare", "comment.md");

if (!beforePath || !afterPath) {
  console.error("Usage: compare-proof-reports --before <path> --after <path> [--out-json <path>] [--out-md <path>]");
  process.exit(2);
}

const beforeReport = JSON.parse(await fs.readFile(beforePath, "utf8"));
const afterReport = JSON.parse(await fs.readFile(afterPath, "utf8"));

const beforeChecks = makeCheckMap(beforeReport.checks);
const afterChecks = makeCheckMap(afterReport.checks);
const allKeys = [...new Set([...beforeChecks.keys(), ...afterChecks.keys()])].sort();

const checkDiff = allKeys.map((key) => {
  const before = beforeChecks.get(key);
  const after = afterChecks.get(key);
  return {
    key,
    project: after?.project || before?.project || "unknown",
    id: after?.id || before?.id || key,
    beforeStatus: before?.status || "missing",
    afterStatus: after?.status || "missing",
    beforeDetails: before?.details,
    afterDetails: after?.details,
  };
});

const improvements = checkDiff.filter((diff) => diff.beforeStatus === "fail" && diff.afterStatus === "pass");
const regressions = checkDiff.filter((diff) => diff.beforeStatus === "pass" && diff.afterStatus === "fail");
const afterFailures = checkDiff.filter((diff) => diff.afterStatus === "fail");

const summary = {
  featureId: afterReport.featureId,
  route: afterReport.route,
  before: {
    commitSha: beforeReport.commitSha,
    overallStatus: beforeReport.overallStatus,
    reportPath: beforePath,
    artifacts: beforeReport.artifacts || [],
  },
  after: {
    commitSha: afterReport.commitSha,
    overallStatus: afterReport.overallStatus,
    reportPath: afterPath,
    artifacts: afterReport.artifacts || [],
  },
  totals: {
    checks: checkDiff.length,
    improvements: improvements.length,
    regressions: regressions.length,
    afterFailures: afterFailures.length,
  },
  checkDiff,
  shouldFail: afterFailures.length > 0,
};

await fs.mkdir(path.dirname(outJson), { recursive: true });
await fs.mkdir(path.dirname(outMd), { recursive: true });
await fs.writeFile(outJson, `${JSON.stringify(summary, null, 2)}\n`);

const lines = [];
lines.push("<!-- proof-of-implementation -->");
lines.push("## Proof of Implementation");
lines.push("");
lines.push(`- Feature: \`${summary.featureId}\``);
lines.push(`- Route: \`${summary.route}\``);
lines.push(`- Before commit: \`${summary.before.commitSha}\``);
lines.push(`- After commit: \`${summary.after.commitSha}\``);
lines.push(`- Improvements: ${summary.totals.improvements}`);
lines.push(`- Regressions: ${summary.totals.regressions}`);
lines.push(`- After failures: ${summary.totals.afterFailures}`);
lines.push("");
lines.push("| Check | Before | After | Notes |");
lines.push("| --- | --- | --- | --- |");

for (const diff of checkDiff) {
  const note = diff.afterDetails || diff.beforeDetails || "";
  lines.push(
    `| \`${diff.project}:${diff.id}\` | ${statusIcon(diff.beforeStatus)} ${diff.beforeStatus} | ${statusIcon(diff.afterStatus)} ${diff.afterStatus} | ${String(
      note
    ).replace(/\|/g, "\\|")} |`
  );
}

lines.push("");
lines.push(`Generated at ${new Date().toISOString()}`);

await fs.writeFile(outMd, `${lines.join("\n")}\n`);

console.log(`Comparison JSON written to ${outJson}`);
console.log(`Comparison markdown written to ${outMd}`);
