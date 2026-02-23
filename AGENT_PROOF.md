# Agent Proof Contract

This document defines a single proof workflow that any coding agent can use.

## Command Contract

Run proof for a feature:

```bash
cd app
npm run proof:feature -- --name <feature-id> --route <path> --phase <before|after> --theme <light|dark|both>
```

Required arguments:

- `--name`: stable feature identifier (`feature-title-rename`)
- `--route`: app route to validate (`/`)
- `--phase`: `before` or `after`
- `--theme`: `light`, `dark`, or `both`

## Output Contract

Each run must write:

- `app/test-results/proof/<feature-id>/<phase>/proof-report.json`
- `app/test-results/proof/<feature-id>/<phase>/screenshots/*`
- `app/test-results/proof/<feature-id>/<phase>/artifacts/*`

`proof-report.json` includes:

- `schemaVersion`
- `featureId`
- `phase`
- `route`
- `commitSha`
- `timestamp`
- `checks[]` with `id`, `project`, `status`, `details`
- `artifacts[]`

## PR Evidence Contract

CI workflow `.github/workflows/proof-harness.yml` must:

1. Run `before` proof on PR base SHA.
2. Run `after` proof on PR head SHA.
3. Compare reports.
4. Upsert one PR comment marked by `<!-- proof-of-implementation -->`.
5. Upload artifacts for before/after/compare.
6. Fail if after-phase checks fail.

## Triggering CI Proof

Use either trigger:

- PR label: `needs-proof`
- PR comment: `/proof name=<feature-id> route=<path>`

## Snapshot and Flake Guidance

- Keep viewport fixed in Playwright config.
- Disable animations in test setup before capture.
- Use deterministic selectors and explicit readiness waits.
- Keep proof checks small and feature-specific.

