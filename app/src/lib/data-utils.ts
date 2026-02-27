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
 * Parse a single CSV line from a GBIF data file.
 *
 * CSV format: species_key,observations_total,scientific_name,common_name,observations_after_assessment_year
 *
 * The parser uses indexOf rather than split(",") because common_name may contain commas.
 */
export function parseGbifCsvLine(
  line: string,
  opts: { hasScientificName: boolean; hasSinceAssessment: boolean }
): SpeciesRecord {
  const firstComma = line.indexOf(",");
  const secondComma = line.indexOf(",", firstComma + 1);
  const thirdComma = line.indexOf(",", secondComma + 1);

  const species_key = parseInt(line.slice(0, firstComma), 10);
  const occurrence_count = parseInt(line.slice(firstComma + 1, secondComma), 10);
  const scientific_name = opts.hasScientificName
    ? line.slice(secondComma + 1, thirdComma) || undefined
    : undefined;

  let observations_after_assessment_year: number | null = null;
  if (opts.hasSinceAssessment) {
    const lastComma = line.lastIndexOf(",");
    const sinceStr = line.slice(lastComma + 1).trim();
    if (sinceStr) {
      const parsed = parseInt(sinceStr, 10);
      if (!isNaN(parsed)) observations_after_assessment_year = parsed;
    }
  }

  return {
    species_key,
    occurrence_count,
    observations_after_assessment_year,
    scientific_name,
  };
}

/**
 * Parse a full GBIF CSV string (header + data rows) into SpeciesRecord[].
 *
 * Automatically detects which columns are present from the header row.
 * Skips rows that produce NaN for species_key or occurrence_count.
 */
export function parseGbifCsv(csvContent: string): SpeciesRecord[] {
  if (!csvContent.trim()) return [];

  const lines = csvContent.trim().split("\n");
  if (lines.length <= 1) return [];

  const header = lines[0];
  const hasScientificName = header.includes("scientific_name");
  const hasSinceAssessment =
    header.includes("observations_after_assessment_year") ||
    header.includes("occurrences_since_assessment");

  const records: SpeciesRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const record = parseGbifCsvLine(lines[i], {
      hasScientificName,
      hasSinceAssessment,
    });
    if (!isNaN(record.species_key) && !isNaN(record.occurrence_count)) {
      records.push(record);
    }
  }
  return records;
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
