import { describe, it, expect } from "vitest";
import {
  parseGbifCsvLine,
  parseGbifCsv,
  filterSpecies,
  paginate,
  computeDistribution,
  fmtQty,
  type SpeciesRecord,
} from "../data-utils";

// ---------------------------------------------------------------------------
// parseGbifCsvLine
// ---------------------------------------------------------------------------
describe("parseGbifCsvLine", () => {
  it("parses a basic line with scientific name and since-assessment count", () => {
    const line = "2435099,52341,Panthera leo,Lion,1234";
    const result = parseGbifCsvLine(line, {
      hasScientificName: true,
      hasSinceAssessment: true,
    });
    expect(result.species_key).toBe(2435099);
    expect(result.occurrence_count).toBe(52341);
    expect(result.scientific_name).toBe("Panthera leo");
    expect(result.observations_after_assessment_year).toBe(1234);
  });

  it("handles line without scientific name column", () => {
    const line = "2435099,52341,some,extra";
    const result = parseGbifCsvLine(line, {
      hasScientificName: false,
      hasSinceAssessment: false,
    });
    expect(result.species_key).toBe(2435099);
    expect(result.occurrence_count).toBe(52341);
    expect(result.scientific_name).toBeUndefined();
    expect(result.observations_after_assessment_year).toBeNull();
  });

  it("handles common names with commas (uses lastComma for since-assessment)", () => {
    const line = "2435099,100,Rana capensis,Some, Complex Name,42";
    const result = parseGbifCsvLine(line, {
      hasScientificName: true,
      hasSinceAssessment: true,
    });
    expect(result.species_key).toBe(2435099);
    expect(result.occurrence_count).toBe(100);
    expect(result.scientific_name).toBe("Rana capensis");
    expect(result.observations_after_assessment_year).toBe(42);
  });

  it("returns null for since-assessment when the field is empty", () => {
    const line = "2435099,100,Rana capensis,Common Name,";
    const result = parseGbifCsvLine(line, {
      hasScientificName: true,
      hasSinceAssessment: true,
    });
    expect(result.observations_after_assessment_year).toBeNull();
  });

  it("returns null for since-assessment when field is non-numeric", () => {
    const line = "2435099,100,Rana capensis,Common Name,N/A";
    const result = parseGbifCsvLine(line, {
      hasScientificName: true,
      hasSinceAssessment: true,
    });
    expect(result.observations_after_assessment_year).toBeNull();
  });

  it("handles zero since-assessment count", () => {
    const line = "2435099,100,Rana capensis,Common Name,0";
    const result = parseGbifCsvLine(line, {
      hasScientificName: true,
      hasSinceAssessment: true,
    });
    expect(result.observations_after_assessment_year).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseGbifCsv (bulk CSV parsing)
// ---------------------------------------------------------------------------
describe("parseGbifCsv", () => {
  it("parses a full CSV string with header detection", () => {
    const csv = [
      "species_key,observations_total,scientific_name,common_name,observations_after_assessment_year",
      "2435099,100,Panthera leo,Lion,42",
      "5219404,200,Rana capensis,Cape Rain Frog,10",
    ].join("\n");

    const records = parseGbifCsv(csv);
    expect(records).toHaveLength(2);
    expect(records[0].species_key).toBe(2435099);
    expect(records[0].occurrence_count).toBe(100);
    expect(records[0].scientific_name).toBe("Panthera leo");
    expect(records[0].observations_after_assessment_year).toBe(42);
    expect(records[1].species_key).toBe(5219404);
    expect(records[1].occurrence_count).toBe(200);
  });

  it("detects scientific_name column from header", () => {
    const csv = [
      "species_key,observations_total",
      "2435099,100",
    ].join("\n");

    const records = parseGbifCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].scientific_name).toBeUndefined();
  });

  it("detects observations_after_assessment_year from header", () => {
    const csv = [
      "species_key,observations_total,scientific_name,common_name,observations_after_assessment_year",
      "2435099,100,Panthera leo,Lion,42",
    ].join("\n");
    expect(parseGbifCsv(csv)[0].observations_after_assessment_year).toBe(42);
  });

  it("detects occurrences_since_assessment as alternative header", () => {
    const csv = [
      "species_key,observations_total,scientific_name,common_name,occurrences_since_assessment",
      "2435099,100,Panthera leo,Lion,99",
    ].join("\n");
    expect(parseGbifCsv(csv)[0].observations_after_assessment_year).toBe(99);
  });

  it("returns empty array for empty CSV", () => {
    expect(parseGbifCsv("")).toEqual([]);
    expect(parseGbifCsv("species_key,observations_total")).toEqual([]);
  });

  it("skips lines that parse to NaN species_key", () => {
    const csv = [
      "species_key,observations_total,scientific_name,common_name,observations_after_assessment_year",
      "bad,100,Panthera leo,Lion,42",
      "2435099,100,Rana capensis,Frog,10",
    ].join("\n");
    const records = parseGbifCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].species_key).toBe(2435099);
  });
});

// ---------------------------------------------------------------------------
// filterSpecies
// ---------------------------------------------------------------------------
describe("filterSpecies", () => {
  const data: SpeciesRecord[] = [
    { species_key: 1, occurrence_count: 5, redlist_category: "CR" },
    { species_key: 2, occurrence_count: 50, redlist_category: "EN" },
    { species_key: 3, occurrence_count: 500, redlist_category: "VU" },
    { species_key: 4, occurrence_count: 5000, redlist_category: null },
    { species_key: 5, occurrence_count: 1, redlist_category: "CR" },
  ];

  it("filters by count range", () => {
    const result = filterSpecies(data, {
      minCount: 10,
      maxCount: 1000,
      redlistFilter: null,
    });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.species_key)).toEqual([2, 3]);
  });

  it("filters by redlist category", () => {
    const result = filterSpecies(data, {
      minCount: 0,
      maxCount: 999999,
      redlistFilter: "CR",
    });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.redlist_category === "CR")).toBe(true);
  });

  it("filters NE (not evaluated = null category)", () => {
    const result = filterSpecies(data, {
      minCount: 0,
      maxCount: 999999,
      redlistFilter: "NE",
    });
    expect(result).toHaveLength(1);
    expect(result[0].species_key).toBe(4);
  });

  it('treats "all" as no category filter', () => {
    const result = filterSpecies(data, {
      minCount: 0,
      maxCount: 999999,
      redlistFilter: "all",
    });
    expect(result).toHaveLength(5);
  });

  it("combines count range and category filter", () => {
    const result = filterSpecies(data, {
      minCount: 2,
      maxCount: 100,
      redlistFilter: "CR",
    });
    expect(result).toHaveLength(1);
    expect(result[0].species_key).toBe(1);
  });

  it("returns empty when nothing matches", () => {
    const result = filterSpecies(data, {
      minCount: 100000,
      maxCount: 999999,
      redlistFilter: null,
    });
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// paginate
// ---------------------------------------------------------------------------
describe("paginate", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns first page", () => {
    expect(paginate(items, 1, 3)).toEqual([1, 2, 3]);
  });

  it("returns second page", () => {
    expect(paginate(items, 2, 3)).toEqual([4, 5, 6]);
  });

  it("returns partial last page", () => {
    expect(paginate(items, 4, 3)).toEqual([10]);
  });

  it("returns empty for out-of-range page", () => {
    expect(paginate(items, 5, 3)).toEqual([]);
  });

  it("returns all items when limit exceeds length", () => {
    expect(paginate(items, 1, 100)).toEqual(items);
  });
});

// ---------------------------------------------------------------------------
// computeDistribution — accepts number[]
// ---------------------------------------------------------------------------
describe("computeDistribution", () => {
  it("buckets counts correctly", () => {
    const counts = [1, 1, 5, 10, 50, 100, 500, 5000, 50000];
    const dist = computeDistribution(counts);
    expect(dist.eq1).toBe(2);
    expect(dist.gt1_lte10).toBe(2); // 5, 10
    expect(dist.gt10_lte100).toBe(2); // 50, 100
    expect(dist.gt100_lte1000).toBe(1); // 500
    expect(dist.gt1000_lte10000).toBe(1); // 5000
    expect(dist.gt10000).toBe(1); // 50000
  });

  it("handles empty data", () => {
    const dist = computeDistribution([]);
    expect(dist.eq1).toBe(0);
    expect(dist.gt10000).toBe(0);
  });

  it("places boundary values in the correct bucket", () => {
    const counts = [1, 10, 100, 1000, 10000];
    const dist = computeDistribution(counts);
    expect(dist.eq1).toBe(1); // exactly 1
    expect(dist.gt1_lte10).toBe(1); // 10 (>1 && <=10)
    expect(dist.gt10_lte100).toBe(1); // 100
    expect(dist.gt100_lte1000).toBe(1); // 1000
    expect(dist.gt1000_lte10000).toBe(1); // 10000
    expect(dist.gt10000).toBe(0); // nothing >10000
  });
});

// ---------------------------------------------------------------------------
// fmtQty
// ---------------------------------------------------------------------------
describe("fmtQty", () => {
  it("formats millions", () => {
    expect(fmtQty(2_300_000)).toBe("2.3M");
    expect(fmtQty(1_000_000)).toBe("1.0M");
  });

  it("formats tens of thousands (no decimal)", () => {
    expect(fmtQty(50_000)).toBe("50k");
    expect(fmtQty(10_000)).toBe("10k");
  });

  it("formats thousands (one decimal)", () => {
    expect(fmtQty(1_500)).toBe("1.5k");
    expect(fmtQty(1_000)).toBe("1.0k");
    expect(fmtQty(9_999)).toBe("10.0k");
  });

  it("formats small numbers with locale string", () => {
    expect(fmtQty(999)).toBe("999");
    expect(fmtQty(0)).toBe("0");
    expect(fmtQty(1)).toBe("1");
  });
});
