# Working conventions for this repo

These apply to anyone (or any agent) opening a PR against redlist-dashboard, not just a specific assistant's preferences.

## Keep the PR description current

Treat the PR body as a living summary, not a one-time snapshot. Every time a commit changes what the PR does, what it fixes, or what's been verified, update the body's Summary/Test-plan sections to match (`gh pr edit --body ...`) — don't just leave the original description stale with fixes trailing below in comments. A reviewer should be able to read the PR body alone and get the current, complete picture.

## Always verify UI changes in a real browser

For any UI-facing change, complete an actual browser drive-through (navigate, interact, screenshot) before calling it done — don't downgrade to "typecheck/lint/tests pass, API returns the right data, that's probably enough" as a way to route around flaky tooling. If the verification tooling itself is broken, fix the tooling (see `.claude/skills/verify-ui/` for the current Node/Playwright workaround) rather than substituting a weaker check. Only skip with explicit sign-off, and say plainly that it wasn't verified visually — don't imply it was.

## Use a git worktree for each new piece of work

Start a new git worktree (a dedicated branch checked out to its own directory) for each new, substantial feature or fix, rather than branching in place in the main checkout — this keeps unrelated in-progress work isolated and lets multiple pieces of work proceed in parallel without one clobbering another's uncommitted state. Not worth it for a one-line fix or a quick doc change — use judgment on "substantial."

## Data resyncs: uploading to R2 is safe, merging `latest-sync.txt` is what goes live

`npm run upload-data-to-r2` (`scripts/upload-data-to-r2.ts`) pushes `app/data/` to a timestamped `syncs/<timestamp>/` prefix in the `dashboard-data` R2 bucket and updates the repo-tracked `app/latest-sync.txt` pointer file locally — but production only starts reading the new sync once that `latest-sync.txt` change is committed, pushed, and merged to main (prod's build/deploy pipeline is what actually fetches from R2 via `fetch-data-from-r2.ts`, keyed off whatever `latest-sync.txt` says on main). So it's safe to run the upload from a feature branch/worktree at any point once local data looks right — the upload itself is inert for prod until the `latest-sync.txt` bump lands on main via a normal PR merge. No need to hold off on uploading just because a PR is still in review.

## PR screenshots: R2, not the repo

Don't commit screenshots to the repo (`docs/pr-screenshots/` or anywhere else) — images committed to git stay in the object history forever, even after being deleted in a later commit, so screenshot-heavy PRs become a permanent, un-reclaimable addition to repo/clone size.

Instead:
1. Resize to ~1000px wide (`sips --resampleWidth 1000 <file> --out <file>`) — legible in a PR body, meaningfully smaller than a raw viewport capture.
2. Upload to the public Cloudflare R2 bucket **`pr-assets`** via the S3-compatible API (`@aws-sdk/client-s3`, already a dependency), using the `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` env vars (same credentials `scripts/upload-data-to-r2.ts` uses — `region: "auto"`, `endpoint: https://${accountId}.r2.cloudflarestorage.com`). Set `ContentType: "image/png"`.
3. Key convention: `pr-<number>-<short-feature-slug>/<NN>-<description>.png` — lead with the actual PR number (durable, collision-proof, and makes cleanup trivial: "is PR 369 merged? safe to delete its folder").
4. Embed as `https://pub-705b7e62dbf7494db65d38a97f0621b1.r2.dev/<key>` in the PR body (the bucket's public "Public Development URL"). GitHub proxies any public HTTPS image through Camo, so this renders identically to a GitHub-hosted image.
5. If a screenshot needs replacing after a follow-up commit changes the UI, **always upload it under a new key** (e.g. append `-v2`, `-v3`, ...) — do NOT overwrite the same key with a fresh `PutObjectCommand`. Two independent caches sit in front of the object and key off the URL, not the content: Cloudflare's CDN edge cache in front of the public R2 bucket, and GitHub's own Camo image proxy (`camo.githubusercontent.com`), which every embedded image gets routed through. Neither reliably revalidates just because the underlying object changed — a PR can keep rendering the old screenshot indefinitely even though `curl -I` against the raw R2 URL already shows the new `Last-Modified`/`ETag` (observed directly: overwriting `01-map-only.png` in place left the PR showing the stale image well after the object itself had updated). A new key is a URL neither cache has ever seen, so it's guaranteed to render fresh — no purge step, no waiting.
6. Once the PR body is updated to point at the new key, it's safe to delete the old one (`DeleteObjectCommand`) — the current PR no longer references it. One caveat: GitHub keeps an edit history for PR/issue bodies (the "· edited" link), and that history re-renders the exact old markdown, old image URL included — so deleting the old object leaves a broken image in that historical view. That's a cosmetic tradeoff only (nothing else breaks, no data loss); if preserving a specific PR's edit history matters, leave the old keys in place until the PR is merged/closed instead of deleting them.
7. Before calling a UI-touching PR done, re-check *every* screenshot already in the body against the current app, not just ones you're actively adding — an older screenshot from an earlier phase of the same PR is exactly as stale as one from a different PR if the UI it shows has since changed.
