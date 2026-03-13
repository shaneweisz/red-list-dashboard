import { describe, it, expect } from "vitest";
import {
  filterSpecies,
  paginate,
  computeDistribution,
  fmtQty,
  type SpeciesRecord,
} from "../data-utils";

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
