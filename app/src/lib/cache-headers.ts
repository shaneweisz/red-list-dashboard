/**
 * Cache-Control headers for API responses.
 *
 * s-maxage:              cache at Vercel's edge CDN (avoids origin transfer)
 * stale-while-revalidate: serve stale while refreshing in background
 *
 * Browser cache (max-age) is kept short so users still get fresh-ish data
 * on hard refresh, while the edge absorbs most repeat traffic.
 */

/** 1 hour edge cache — for data that changes infrequently (species lists, stats, assessments). */
export const CACHE_1H = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=60",
};

/** 5 minute edge cache — for data derived from live external APIs (search, occurrences). */
export const CACHE_5M = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
};
