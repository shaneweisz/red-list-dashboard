# Working conventions for this repo

These apply to anyone (or any agent) opening a PR against redlist-dashboard, not just a specific assistant's preferences.

## Keep the PR description current

Treat the PR body as a living summary, not a one-time snapshot. Every time a commit changes what the PR does, what it fixes, or what's been verified, update the body's Summary/Test-plan sections to match (`gh pr edit --body ...`) — don't just leave the original description stale with fixes trailing below in comments. A reviewer should be able to read the PR body alone and get the current, complete picture.

## Always verify UI changes in a real browser

For any UI-facing change, complete an actual browser drive-through (navigate, interact, screenshot) before calling it done — don't downgrade to "typecheck/lint/tests pass, API returns the right data, that's probably enough" as a way to route around flaky tooling. If the verification tooling itself is broken, fix the tooling (see `.claude/skills/verify-ui/` for the current Node/Playwright workaround) rather than substituting a weaker check. Only skip with explicit sign-off, and say plainly that it wasn't verified visually — don't imply it was.

## Use a git worktree for each new piece of work

Start a new git worktree (a dedicated branch checked out to its own directory) for each new, substantial feature or fix, rather than branching in place in the main checkout — this keeps unrelated in-progress work isolated and lets multiple pieces of work proceed in parallel without one clobbering another's uncommitted state. Not worth it for a one-line fix or a quick doc change — use judgment on "substantial."

## PR screenshots: R2, not the repo

Don't commit screenshots to the repo (`docs/pr-screenshots/` or anywhere else) — images committed to git stay in the object history forever, even after being deleted in a later commit, so screenshot-heavy PRs become a permanent, un-reclaimable addition to repo/clone size.

Instead:
1. Resize to ~1000px wide (`sips --resampleWidth 1000 <file> --out <file>`) — legible in a PR body, meaningfully smaller than a raw viewport capture.
2. Upload to the public Cloudflare R2 bucket **`pr-assets`** via the S3-compatible API (`@aws-sdk/client-s3`, already a dependency), using the `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` env vars (same credentials `scripts/upload-data-to-r2.ts` uses — `region: "auto"`, `endpoint: https://${accountId}.r2.cloudflarestorage.com`). Set `ContentType: "image/png"`.
3. Key convention: `pr-<number>-<short-feature-slug>/<NN>-<description>.png` — lead with the actual PR number (durable, collision-proof, and makes cleanup trivial: "is PR 369 merged? safe to delete its folder").
4. Embed as `https://pub-705b7e62dbf7494db65d38a97f0621b1.r2.dev/<key>` in the PR body (the bucket's public "Public Development URL"). GitHub proxies any public HTTPS image through Camo, so this renders identically to a GitHub-hosted image.
5. If a screenshot needs replacing after a follow-up commit changes the UI, either overwrite the same key (`PutObjectCommand`) or `CopyObjectCommand`+`DeleteObjectCommand` to rename — nothing here is git-tracked, so there's no history to worry about.
6. Before calling a UI-touching PR done, re-check *every* screenshot already in the body against the current app, not just ones you're actively adding — an older screenshot from an earlier phase of the same PR is exactly as stale as one from a different PR if the UI it shows has since changed.
