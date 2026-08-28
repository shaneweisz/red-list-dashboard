/**
 * The two lists that decide which data/ files are tracked by git must agree.
 *
 * `data/` holds ~400 MB of per-species data that must never touch git, so
 * everything under it is ignored and a handful of small aggregate files are
 * un-ignored by name. The weekly workflow then stages those same files by an
 * explicit allowlist, never `git add -A`.
 *
 * Two lists, maintained by hand, in different files, in different languages.
 * They have already drifted once: node-children-summaries.json outlived its
 * writer in the workflow's list, and staging a path that matches nothing fails
 * the whole step with "pathspec did not match any files".
 *
 * The drift is silent in the other direction too. Moving a tracked file into a
 * subdirectory looks harmless, but git will not descend into an excluded
 * directory, so `!/data/published/taxa-summary.json` un-ignores nothing unless
 * the directory is un-ignored first — the file quietly stops being tracked and
 * the workflow's next run fails on a path that used to work. That is waiting
 * for the file-layout restructure, which is exactly when this test earns its
 * keep.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GITIGNORE = path.join(APP, ".gitignore");
const WORKFLOW = path.resolve(APP, "../.github/workflows/weekly-sync.yml");

/**
 * Files under data/ that .gitignore rescues from the blanket ignore.
 *
 * A trailing slash is a directory being re-opened so git will descend into it,
 * not a file to track — nesting a tracked file needs both, and only the file
 * belongs in the workflow's staging list.
 */
function unignoredDataPaths(): string[] {
  return fs
    .readFileSync(GITIGNORE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("!/data/") && !l.endsWith("/"))
    .map((l) => l.slice(2)); // "!/data/x" -> "data/x"
}

/** Paths under data/ that the weekly workflow stages. */
function stagedDataPaths(): string[] {
  const addLine = fs
    .readFileSync(WORKFLOW, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("git add "));
  if (!addLine) throw new Error("weekly-sync.yml has no `git add` line");
  return addLine
    .replace(/^git add\s+/, "")
    .split(/\s+/)
    .filter((t) => t.startsWith("data/"));
}

/** "data/a/b" -> ["data/a", "data/a/b"] — every directory git must descend into. */
function ancestors(dir: string): string[] {
  const parts = dir.split("/");
  return parts.slice(1).map((_, i) => parts.slice(0, i + 2).join("/"));
}

describe("data/ allowlists", () => {
  it("un-ignores at least one file, so a bad parse cannot pass vacuously", () => {
    expect(unignoredDataPaths().length).toBeGreaterThan(0);
    expect(stagedDataPaths().length).toBeGreaterThan(0);
  });

  it(".gitignore and the weekly workflow name exactly the same data/ files", () => {
    expect([...stagedDataPaths()].sort()).toEqual([...unignoredDataPaths()].sort());
  });

  it("un-ignores every parent directory, or git never descends to the file", () => {
    // `/data/*` then `!/data/published/taxa-summary.json` does nothing: git skips
    // excluded directories without looking inside. Each intermediate directory
    // has to be un-ignored, and re-excluded, before the file can be named.
    //
    // Matched whole-line, not as a substring: "!/data/published/x.json" contains
    // the text "!/data/published/" while doing none of the un-ignoring, so a
    // substring check passes exactly when the rule is broken.
    const lines = fs
      .readFileSync(GITIGNORE, "utf8")
      .split("\n")
      .map((l) => l.trim());
    for (const p of unignoredDataPaths()) {
      const dir = path.dirname(p); // "data" for a top-level file
      if (dir === "data") continue;
      for (const d of ancestors(dir)) {
        expect(lines, `${p} is nested but /${d}/ is never un-ignored`).toContain(`!/${d}/`);
      }
    }
  });

  it("keeps the repo the sole owner of col-revisions.json", () => {
    // The card's reason codes live in this file and the vocabulary that reads
    // them lives in src/lib/col-revision.ts. If it were R2-published as well as
    // tracked, fetch-data-from-r2 would overwrite the committed copy at build
    // time and the two could ship apart — renaming a reason in code would empty
    // its bar until the next sync. So: tracked, staged weekly, never uploaded.
    const upload = fs.readFileSync(path.join(APP, "scripts/upload-data-to-r2.ts"), "utf8");
    const excluded = upload.match(/EXCLUDE_FROM_SYNC = new Set\(\[([^\]]*)\]\)/);
    expect(excluded, "EXCLUDE_FROM_SYNC not found — did it move or get renamed?").toBeTruthy();
    expect(excluded![1]).toContain('"col-revisions.json"');
    expect(unignoredDataPaths()).toContain("data/col-revisions.json");
    expect(stagedDataPaths()).toContain("data/col-revisions.json");
  });

  it("stages an explicit list rather than everything", () => {
    const workflow = fs.readFileSync(WORKFLOW, "utf8");
    for (const line of workflow.split("\n").map((l) => l.trim())) {
      if (!line.startsWith("git add ")) continue;
      const args = line.replace(/^git add\s+/, "").split(/\s+/);
      expect(args, "git add -A/. would commit ~400MB of per-species data").not.toContain("-A");
      expect(args).not.toContain(".");
      expect(args).not.toContain("data/");
    }
  });
});
