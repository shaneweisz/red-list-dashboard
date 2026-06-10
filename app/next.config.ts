import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // #261: DuckDB-backed read routes query Parquet in R2. Keep the native addon
  // out of the bundler, and force-include the 68MB libduckdb.so it dlopens at
  // runtime (file-tracing misses dlopen deps). Scoped to the v2 routes so the
  // .so isn't bundled into every function. Vercel runs linux-x64.
  serverExternalPackages: ["@duckdb/node-api"],
  outputFileTracingIncludes: {
    "/api/v2/**": ["./node_modules/@duckdb/node-bindings-linux-x64/**"],
  },

  // The API routes import a shared species-store module that references every
  // file under data/ (search-index.json ~95MB, redlist/ ~82MB, gbif/ ~62MB),
  // so Next traces the whole dataset into every serverless function — ~248MB,
  // over Vercel's 250MB uncompressed limit. Prune per route to what each
  // actually reads at runtime. Globs use **/ so they match whether the tracing
  // root is app/ (local) or the repo root (Vercel, where paths are app/data/…).
  outputFileTracingExcludes: {
    // Search only reads the prebuilt index — never the CSVs/mapping.
    "/api/search": ["**/data/redlist/**", "**/data/gbif/**", "**/data/mapping.csv"],
    "/api/search/warm": ["**/data/redlist/**", "**/data/gbif/**", "**/data/mapping.csv"],
    // These read the Red List / GBIF CSVs (+ mapping) but never the search index.
    "/api/redlist/species": ["**/data/search-index.json"],
    "/api/redlist/assessor-candidates-by-country": ["**/data/search-index.json"],
    // These read only the small precomputed summary JSONs.
    "/api/redlist/taxa-summary": ["**/data/search-index.json", "**/data/redlist/**", "**/data/gbif/**", "**/data/mapping.csv"],
    "/api/redlist/taxa-subgroups": ["**/data/search-index.json", "**/data/redlist/**", "**/data/gbif/**", "**/data/mapping.csv"],
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
