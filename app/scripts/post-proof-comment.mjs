import fs from "node:fs/promises";

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

async function githubRequest(url, token, init = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(init.headers || {}),
  };

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

const args = parseArgs(process.argv);
const marker = "<!-- proof-of-implementation -->";

const markdownPath = args.markdown;
const repo = args.repo || process.env.GITHUB_REPOSITORY;
const prNumber = Number(args.pr || process.env.PR_NUMBER);
const runUrl = args["run-url"] || process.env.RUN_URL;
const beforeArtifact = args["before-artifact"] || process.env.BEFORE_ARTIFACT_NAME;
const afterArtifact = args["after-artifact"] || process.env.AFTER_ARTIFACT_NAME;
const token = process.env.GITHUB_TOKEN;

if (!markdownPath) {
  console.error("Missing required --markdown path");
  process.exit(2);
}

if (!repo || !prNumber || Number.isNaN(prNumber)) {
  console.error("Missing repo/pr context. Provide --repo and --pr or set GITHUB_REPOSITORY/PR_NUMBER.");
  process.exit(2);
}

if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(2);
}

const baseBody = await fs.readFile(markdownPath, "utf8");
const extra = [];

if (runUrl) {
  extra.push(`- Workflow run: ${runUrl}`);
}
if (beforeArtifact) {
  extra.push(`- Before artifact: \`${beforeArtifact}\``);
}
if (afterArtifact) {
  extra.push(`- After artifact: \`${afterArtifact}\``);
}

const body = extra.length > 0 ? `${baseBody.trim()}\n\n${extra.join("\n")}\n` : baseBody;
const issueCommentsUrl = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;

const comments = await githubRequest(issueCommentsUrl, token);
const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(marker));

if (existing) {
  const updateUrl = `https://api.github.com/repos/${repo}/issues/comments/${existing.id}`;
  await githubRequest(updateUrl, token, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
  console.log(`Updated proof comment ${existing.id}`);
} else {
  await githubRequest(issueCommentsUrl, token, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  console.log("Created proof comment");
}
