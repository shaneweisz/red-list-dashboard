import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// Runtime deps every DuckDB-backed route needs traced in: the dlopen'd
// libduckdb.so (file-tracing misses dlopen deps), the sync pointer used to build
// the R2 path, and the vendored httpfs extension (LOAD'd by path).
const DUCKDB_TRACE = [
  "./node_modules/@duckdb/node-bindings-linux-x64/**",
  "./latest-sync.txt",
  "./duckdb-ext/**",
];

// The CoL backbone artifacts (#271) are read ONLY from R2 via httpfs at runtime —
// no serverless function bundles them. But fetch-data-from-r2 pulls the whole
// sync into app/data/ at build time, so any function that traces data/ would bundle
// backbone.parquet (~170MB) and blow Vercel's 250MB function cap. Exclude them from
// the species-store routes (the DuckDB routes already exclude all of data/).
const COL_ARTIFACTS = [
  "**/data/backbone.parquet",
  "**/data/species/**",
  "**/data/species_link.parquet",
  "**/data/universe-names.parquet",
];

const nextConfig: NextConfig = {
  // #261: DuckDB-backed read routes query Parquet in R2. Keep the native addon
  // out of the bundler, and force-include the 68MB libduckdb.so it dlopens at
  // runtime (file-tracing misses dlopen deps). Scoped to the v2 routes so the
  // .so isn't bundled into every function. Vercel runs linux-x64.
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingIncludes: {
    // libduckdb.so (dlopen'd) + the version pointer used to build the R2 path +
    // the vendored httpfs extension (LOAD'd by path, avoiding a cold-start INSTALL).
    // Applies to every DuckDB-backed route: species list + history + search.
    "/api/redlist/species": DUCKDB_TRACE,
    "/api/redlist/species/history": DUCKDB_TRACE,
    "/api/search": DUCKDB_TRACE,
    "/api/search/warm": DUCKDB_TRACE,
    "/api/taxa/species": DUCKDB_TRACE,
  },

  // The API routes import a shared species-store module that references every
  // file under data/ (search-index.json ~95MB, redlist/ ~82MB, gbif/ ~62MB),
  // so Next traces the whole dataset into every serverless function — ~248MB,
  // over Vercel's 250MB uncompressed limit. Prune per route to what each
  // actually reads at runtime. Globs use **/ so they match whether the tracing
  // root is app/ (local) or the repo root (Vercel, where paths are app/data/…).
  outputFileTracingExcludes: {
    // Search now queries the parquets in R2 (httpfs) — no local data bundled.
    "/api/search": ["**/data/**"],
    "/api/search/warm": ["**/data/**"],
    // Species list queries the parquets in R2 (httpfs); it also reads the small
    // taxa-summary.json for the instant tooLarge check, so exclude the heavy data but
    // keep that one file. CRITICAL: keep ALL parquets out — USE_R2 is gated on
    // assessed.parquet NOT existing locally, so bundling any parquet flips the route to
    // local mode and the R2-only files (species_link) then 404.
    "/api/redlist/species": ["**/data/search-index.json", "**/data/redlist/**", "**/data/gbif/**", "**/data/mapping.csv", "**/data/node-children-summaries.json", "**/data/*.parquet", ...COL_ARTIFACTS],
    "/api/redlist/species/history": ["**/data/**"],
    // Reads the Red List / GBIF CSVs (+ mapping) but never the search index or
    // the R2-only CoL artifacts.
    "/api/redlist/assessor-candidates-by-country": ["**/data/search-index.json", ...COL_ARTIFACTS],
    // These read only the small precomputed summary JSONs.
    "/api/redlist/taxa-summary": ["**/data/search-index.json", "**/data/redlist/**", "**/data/gbif/**", "**/data/mapping.csv", ...COL_ARTIFACTS],
    "/api/redlist/taxa-subgroups": ["**/data/search-index.json", "**/data/redlist/**", "**/data/gbif/**", "**/data/mapping.csv", ...COL_ARTIFACTS],
    // Backbone tree navigation queries backbone.parquet in R2 (httpfs) — no local data.
    "/api/taxa/species": ["**/data/**"],
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "shane-weisz",

  project: "redlist-dashboard",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  }
});
