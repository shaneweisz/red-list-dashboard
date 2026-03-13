/**
 * Pure data-processing helpers extracted from API routes for testability.
 */

export interface SpeciesRecord {
  species_key: number;
  occurrence_count: number;
  observations_after_assessment_year?: number | null;
  scientific_name?: string;
  redlist_category?: string | null;
}

/**
 * Filter species records by occurrence count range and optional Red List category.
 */
export function filterSpecies(
  data: SpeciesRecord[],
  opts: {
    minCount: number;
    maxCount: number;
    redlistFilter: string | null;
  }
): SpeciesRecord[] {
  let filtered = data.filter(
    (d) => d.occurrence_count >= opts.minCount && d.occurrence_count <= opts.maxCount
  );

  if (opts.redlistFilter && opts.redlistFilter !== "all") {
    if (opts.redlistFilter === "NE") {
      filtered = filtered.filter((d) => !d.redlist_category);
    } else {
      filtered = filtered.filter((d) => d.redlist_category === opts.redlistFilter);
    }
  }

  return filtered;
}

/**
 * Paginate an array. Pages are 1-indexed.
 */
export function paginate<T>(items: T[], page: number, limit: number): T[] {
  const start = (page - 1) * limit;
  return items.slice(start, start + limit);
}

/**
 * Compute the occurrence-count distribution buckets from an array of counts.
 */
export function computeDistribution(counts: number[]): {
  eq1: number;
  gt1_lte10: number;
  gt10_lte100: number;
  gt100_lte1000: number;
  gt1000_lte10000: number;
  gt10000: number;
} {
  return {
    eq1: counts.filter((c) => c === 1).length,
    gt1_lte10: counts.filter((c) => c > 1 && c <= 10).length,
    gt10_lte100: counts.filter((c) => c > 10 && c <= 100).length,
    gt100_lte1000: counts.filter((c) => c > 100 && c <= 1000).length,
    gt1000_lte10000: counts.filter((c) => c > 1000 && c <= 10000).length,
    gt10000: counts.filter((c) => c > 10000).length,
  };
}

/**
 * Format a large number for display (e.g. 1500 → "1.5k", 2300000 → "2.3M").
 */
export function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}
