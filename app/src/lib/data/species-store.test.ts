import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs and csv modules before importing the module under test
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
}));

vi.mock("./csv", () => ({
  readCsv: vi.fn(() => []),
}));

import * as fs from "fs";
import { readCsv } from "./csv";
import { getAssessorCandidates, getAssessorCandidatesByCountry, searchSpecies, getSpecies, _resetSearchIndexCache, _resetCaches } from "./species-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestRedlistRow {
  sis_taxon_id: number;
  assessment_id: number;
  scientific_name: string;
  common_name: string | null;
  class_name: string | null;
  order_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string;
  population_trend: string | null;
  countries: string[];
  taxon_group_table1a: string;
}

interface TestAssessment {
  id: number;
  year: string;
  category: string;
  date: string | null;
  assessors: string | null;
  reviewers: string | null;
}

type HistoryMap = Record<string, TestAssessment[]>;

let nextId = 1;
function makeRow(overrides: Partial<TestRedlistRow> = {}): TestRedlistRow {
  const id = nextId++;
  return {
    sis_taxon_id: id,
    assessment_id: id * 100,
    scientific_name: "Testus species",
    common_name: null,
    class_name: "Mammalia",
    order_name: "Carnivora",
    family: "Felidae",
    category: "VU",
    assessment_date: "2020-01-01",
    year_published: "2020",
    population_trend: null,
    countries: [],
    taxon_group_table1a: "mammals",
    ...overrides,
  };
}

let groupCounter = 0;
function uniqueGroup(): string {
  return `test_group_${groupCounter++}`;
}

function setup(rows: TestRedlistRow[], history: HistoryMap = {}) {
  vi.mocked(readCsv).mockReturnValue(rows as ReturnType<typeof readCsv>);
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(history));
}

beforeEach(() => {
  nextId = 1;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getAssessorCandidates", () => {
  it("returns empty array when no assessed species exist", () => {
    const group = uniqueGroup();
    setup([]);
    expect(getAssessorCandidates("Panthera leo", group)).toEqual([]);
  });

  it("returns empty array when species have no assessors", () => {
    const group = uniqueGroup();
    setup([makeRow({ scientific_name: "Panthera tigris" })]);
    expect(getAssessorCandidates("Panthera leo", group)).toEqual([]);
  });

  it("skips species with no taxonomy overlap", () => {
    const group = uniqueGroup();
    const row = makeRow({
      scientific_name: "Equus caballus",
      family: "Equidae",
      order_name: "Perissodactyla",
      class_name: "Mammalia",
    });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Dr. Horse", reviewers: null },
      ],
    });

    // No genus/family/order/class overlap at all
    const result = getAssessorCandidates("Rana temporaria", group, "Ranidae", "Anura", "Amphibia");
    expect(result).toEqual([]);
  });

  it("counts genus matches inclusively (genus also counts as family/order/class)", () => {
    const group = uniqueGroup();
    const row = makeRow({
      scientific_name: "Panthera tigris",
      family: "Felidae",
      order_name: "Carnivora",
      class_name: "Mammalia",
    });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-06-15", assessors: "Dr. Smith", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    expect(result).toHaveLength(1);
    expect(result[0].genus).toBe(1);
    expect(result[0].family).toBe(1);
    expect(result[0].order).toBe(1);
    expect(result[0].class).toBe(1);
  });

  it("counts family match inclusively (family also counts as order/class)", () => {
    const group = uniqueGroup();
    const row = makeRow({
      scientific_name: "Felis catus",
      family: "Felidae",
      order_name: "Carnivora",
      class_name: "Mammalia",
    });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2021", category: "LC", date: "2021-03-01", assessors: "Dr. Jones", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    expect(result).toHaveLength(1);
    expect(result[0].genus).toBe(0);
    expect(result[0].family).toBe(1);
    expect(result[0].order).toBe(1);
    expect(result[0].class).toBe(1);
  });

  it("counts order match inclusively (order also counts as class)", () => {
    const group = uniqueGroup();
    const row = makeRow({
      scientific_name: "Canis lupus",
      family: "Canidae",
      order_name: "Carnivora",
      class_name: "Mammalia",
    });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2019", category: "LC", date: "2019-05-01", assessors: "Dr. Wolf", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    expect(result).toHaveLength(1);
    expect(result[0].genus).toBe(0);
    expect(result[0].family).toBe(0);
    expect(result[0].order).toBe(1);
    expect(result[0].class).toBe(1);
  });

  it("counts class-only match", () => {
    const group = uniqueGroup();
    const row = makeRow({
      scientific_name: "Equus caballus",
      family: "Equidae",
      order_name: "Perissodactyla",
      class_name: "Mammalia",
    });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2022", category: "LC", date: "2022-01-01", assessors: "Dr. Horse", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    expect(result).toHaveLength(1);
    expect(result[0].genus).toBe(0);
    expect(result[0].family).toBe(0);
    expect(result[0].order).toBe(0);
    expect(result[0].class).toBe(1);
  });

  it("sorts by genus count first, then family, order, class", () => {
    const group = uniqueGroup();
    const genusRow = makeRow({ scientific_name: "Panthera tigris", family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" });
    const familyRow = makeRow({ scientific_name: "Felis catus", family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" });
    const orderRow = makeRow({ scientific_name: "Canis lupus", family: "Canidae", order_name: "Carnivora", class_name: "Mammalia" });
    const classRow = makeRow({ scientific_name: "Equus caballus", family: "Equidae", order_name: "Perissodactyla", class_name: "Mammalia" });

    setup([genusRow, familyRow, orderRow, classRow], {
      [String(genusRow.sis_taxon_id)]: [
        { id: 1, year: "2018", category: "EN", date: "2018-01-01", assessors: "Genus Expert", reviewers: null },
      ],
      [String(familyRow.sis_taxon_id)]: [
        { id: 2, year: "2022", category: "LC", date: "2022-01-01", assessors: "Family Expert", reviewers: null },
      ],
      [String(orderRow.sis_taxon_id)]: [
        { id: 3, year: "2023", category: "LC", date: "2023-01-01", assessors: "Order Expert", reviewers: null },
      ],
      [String(classRow.sis_taxon_id)]: [
        { id: 4, year: "2024", category: "LC", date: "2024-01-01", assessors: "Class Expert", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    expect(result[0].name).toBe("Genus Expert");
    expect(result[1].name).toBe("Family Expert");
    expect(result[2].name).toBe("Order Expert");
    expect(result[3].name).toBe("Class Expert");
  });

  it("returns all candidates, not just top 3", () => {
    const group = uniqueGroup();
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ scientific_name: `Panthera sp${i}`, family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" })
    );
    const history: HistoryMap = {};
    for (const row of rows) {
      history[String(row.sis_taxon_id)] = [
        { id: row.sis_taxon_id, year: "2020", category: "VU", date: "2020-01-01", assessors: `Expert ${row.sis_taxon_id}`, reviewers: null },
      ];
    }
    setup(rows, history);

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    expect(result).toHaveLength(5);
  });

  it("breaks genus ties by family count", () => {
    const group = uniqueGroup();
    const genusRow = makeRow({ scientific_name: "Panthera tigris", family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" });
    const familyRow = makeRow({ scientific_name: "Felis catus", family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" });

    setup([genusRow, familyRow], {
      [String(genusRow.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-01-01", assessors: "Assessor A", reviewers: null },
      ],
      [String(familyRow.sis_taxon_id)]: [
        // Assessor B has no genus match but a family match — still 0 genus
        // Assessor A also gets this family match via genus overlap
        { id: 2, year: "2020", category: "LC", date: "2020-01-01", assessors: "Assessor A & Assessor B", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    // Assessor A: genus=1, family=2 (genus row + family row)
    // Assessor B: genus=0, family=1
    expect(result[0].name).toBe("Assessor A");
    expect(result[0].genus).toBe(1);
    expect(result[0].family).toBe(2);
  });

  it("handles case-insensitive matching for family, order, and class", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Felis catus", family: "FELIDAE", order_name: "CARNIVORA", class_name: "MAMMALIA" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Dr. Case", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "felidae", "carnivora", "mammals");
    expect(result).toHaveLength(1);
    expect(result[0].family).toBe(1);
  });

  it("skips assessor names shorter than 3 characters", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-01-01", assessors: "AB & Dr. Valid Name", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    const names = result.map((c) => c.name);
    expect(names).not.toContain("AB");
    expect(names).toContain("Dr. Valid Name");
  });

  it("genus match works without family/order/class params", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-06-15", assessors: "Dr. Genus", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    expect(result).toHaveLength(1);
    expect(result[0].genus).toBe(1);
  });

  it("returns empty when no family/order/class params and genus differs", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Felis catus", family: "Felidae", order_name: "Carnivora" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Dr. Fallback", reviewers: null },
      ],
    });

    // Different genus, no family/order/class provided — no overlap
    const result = getAssessorCandidates("Canis lupus", group);
    expect(result).toEqual([]);
  });

  it("uses assessment date (not year_published) for latestDate", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2022", category: "EN", date: "2015-05-28", assessors: "Dr. Timeline", reviewers: null },
        { id: 2, year: "2020", category: "VU", date: "2019-11-01", assessors: "Dr. Timeline", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    expect(result).toHaveLength(1);
    expect(result[0].latestDate).toBe("2019-11-01");
  });

  it("parses multiple assessors from a single assessment", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-01-01", assessors: "Smith, J.A. & Jones, B.C.", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    const names = result.map((c) => c.name);
    expect(names).toContain("Smith, J.A.");
    expect(names).toContain("Jones, B.C.");
  });

  it("genus match works even when row has null family/order/class", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris", family: null, order_name: null, class_name: null });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-01-01", assessors: "Genus Only", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, null, null, null);
    expect(result).toHaveLength(1);
    expect(result[0].genus).toBe(1);
    // family/order/class should still count via genus inclusivity
    expect(result[0].family).toBe(1);
    expect(result[0].order).toBe(1);
    expect(result[0].class).toBe(1);
  });

  it("accumulates counts across multiple species for the same assessor", () => {
    const group = uniqueGroup();
    const row1 = makeRow({ scientific_name: "Panthera tigris", family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" });
    const row2 = makeRow({ scientific_name: "Panthera pardus", family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" });
    const row3 = makeRow({ scientific_name: "Felis catus", family: "Felidae", order_name: "Carnivora", class_name: "Mammalia" });

    setup([row1, row2, row3], {
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-01-01", assessors: "Multi Assessor", reviewers: null },
      ],
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2021", category: "VU", date: "2021-01-01", assessors: "Multi Assessor", reviewers: null },
      ],
      [String(row3.sis_taxon_id)]: [
        { id: 3, year: "2022", category: "LC", date: "2022-01-01", assessors: "Multi Assessor", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora", "Mammalia");
    expect(result).toHaveLength(1);
    expect(result[0].genus).toBe(2);   // tigris + pardus
    expect(result[0].family).toBe(3);  // tigris + pardus + catus
    expect(result[0].order).toBe(3);
    expect(result[0].class).toBe(3);
    expect(result[0].latestDate).toBe("2022-01-01");
  });
});

// ---------------------------------------------------------------------------
// getAssessorCandidatesByCountry
// ---------------------------------------------------------------------------

describe("getAssessorCandidatesByCountry", () => {
  it("returns empty array when no countries provided", () => {
    const group = uniqueGroup();
    setup([]);
    expect(getAssessorCandidatesByCountry([group], [])).toEqual([]);
  });

  it("returns empty array when no taxon groups provided", () => {
    expect(getAssessorCandidatesByCountry([], ["ZA"])).toEqual([]);
  });

  it("returns empty array when no species share countries", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["GB"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Dr. UK", reviewers: null },
      ],
    });
    // Search for species in ZA — no overlap
    expect(getAssessorCandidatesByCountry([group], ["ZA"])).toEqual([]);
  });

  it("finds assessors for species with overlapping countries", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA", "MZ"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-06-15", assessors: "Dr. Africa", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Africa");
    expect(result[0].totalInRegion).toBe(1);
    expect(result[0].latestDate).toBe("2020-06-15");
  });

  it("aggregates region counts from overlapping countries", () => {
    const group = uniqueGroup();
    // Species occurs in both Southern Africa (ZA) and Eastern Africa (KE)
    const row = makeRow({ countries: ["ZA", "KE"], scientific_name: "Testus wide" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2021", category: "VU", date: "2021-01-01", assessors: "Dr. Wide", reviewers: null },
      ],
    });

    // Target species occurs in both ZA and KE
    const result = getAssessorCandidatesByCountry([group], ["ZA", "KE"]);
    expect(result).toHaveLength(1);
    expect(result[0].regionCounts["Southern Africa"]).toBe(1);
    expect(result[0].regionCounts["Eastern Africa"]).toBe(1);
    // Country-level counts should also be present
    expect(result[0].countryCounts["ZA"]).toBe(1);
    expect(result[0].countryCounts["KE"]).toBe(1);
  });

  it("sorts by total count descending", () => {
    const group = uniqueGroup();
    const row1 = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    const row2 = makeRow({ countries: ["ZA"], scientific_name: "Testus two" });
    const row3 = makeRow({ countries: ["ZA"], scientific_name: "Testus three" });

    setup([row1, row2, row3], {
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Few Assessor", reviewers: null },
      ],
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2020", category: "LC", date: "2020-01-01", assessors: "Many Assessor", reviewers: null },
      ],
      [String(row3.sis_taxon_id)]: [
        { id: 3, year: "2020", category: "LC", date: "2020-01-01", assessors: "Many Assessor", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    expect(result[0].name).toBe("Many Assessor");
    expect(result[0].totalInRegion).toBe(2);
    expect(result[1].name).toBe("Few Assessor");
    expect(result[1].totalInRegion).toBe(1);
  });

  it("breaks total ties by latest date", () => {
    const group = uniqueGroup();
    const row1 = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    const row2 = makeRow({ countries: ["ZA"], scientific_name: "Testus two" });

    setup([row1, row2], {
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2018", category: "LC", date: "2018-01-01", assessors: "Old Assessor", reviewers: null },
      ],
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2023", category: "LC", date: "2023-01-01", assessors: "New Assessor", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    expect(result[0].name).toBe("New Assessor");
    expect(result[1].name).toBe("Old Assessor");
  });

  it("searches across multiple taxon groups", () => {
    const group1 = uniqueGroup();
    const group2 = uniqueGroup();
    const row1 = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    const row2 = makeRow({ countries: ["ZA"], scientific_name: "Testus two" });

    // First setup loads for group1
    setup([row1], {
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Group1 Expert", reviewers: null },
      ],
    });
    // Call for group1 first to prime its cache
    const partial = getAssessorCandidatesByCountry([group1], ["ZA"]);
    expect(partial).toHaveLength(1);

    // Now setup for group2
    setup([row2], {
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2021", category: "VU", date: "2021-01-01", assessors: "Group2 Expert", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group1, group2], ["ZA"]);
    const names = result.map((c) => c.name);
    expect(names).toContain("Group1 Expert");
    expect(names).toContain("Group2 Expert");
  });

  it("handles case-insensitive country matching", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["za"], scientific_name: "Testus lower" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Dr. Case", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
  });

  it("skips assessor names shorter than 3 characters", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "AB & Dr. Valid", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    const names = result.map((c) => c.name);
    expect(names).not.toContain("AB");
    expect(names).toContain("Dr. Valid");
  });

  it("counts unique species, not multiple assessments of the same species", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2010", category: "LC", date: "2010-01-01", assessors: "Dr. Repeat", reviewers: null },
        { id: 2, year: "2015", category: "VU", date: "2015-06-01", assessors: "Dr. Repeat", reviewers: null },
        { id: 3, year: "2020", category: "EN", date: "2020-03-15", assessors: "Dr. Repeat", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Repeat");
    // Should count as 1 species, not 3 assessments
    expect(result[0].totalInRegion).toBe(1);
    expect(result[0].regionCounts["Southern Africa"]).toBe(1);
    // Latest date should still be tracked correctly
    expect(result[0].latestDate).toBe("2020-03-15");
  });

  it("tracks totalAll separately from totalInRegion", () => {
    const group = uniqueGroup();
    const rowInRegion = makeRow({ countries: ["ZA"], scientific_name: "Testus local" });
    const rowOutside = makeRow({ countries: ["GB"], scientific_name: "Testus remote" });

    setup([rowInRegion, rowOutside], {
      [String(rowInRegion.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Dr. Both", reviewers: null },
      ],
      [String(rowOutside.sis_taxon_id)]: [
        { id: 2, year: "2021", category: "VU", date: "2021-01-01", assessors: "Dr. Both", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Both");
    expect(result[0].totalInRegion).toBe(1);  // Only the ZA species
    expect(result[0].totalAll).toBe(2);        // Both species
  });

  it("applies taxonomy filter to narrow scope", () => {
    const group = uniqueGroup();
    const beetleRow = makeRow({ countries: ["ZA"], scientific_name: "Beetlus one", order_name: "Coleoptera", class_name: "Insecta" });
    const mothRow = makeRow({ countries: ["ZA"], scientific_name: "Mothus one", order_name: "Lepidoptera", class_name: "Insecta" });

    setup([beetleRow, mothRow], {
      [String(beetleRow.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Beetle Expert", reviewers: null },
      ],
      [String(mothRow.sis_taxon_id)]: [
        { id: 2, year: "2021", category: "LC", date: "2021-01-01", assessors: "Moth Expert", reviewers: null },
      ],
    });

    // Without filter: both assessors appear
    const allResult = getAssessorCandidatesByCountry([group], ["ZA"]);
    expect(allResult).toHaveLength(2);

    // With orderNames filter: only beetle assessor
    const beetleResult = getAssessorCandidatesByCountry([group], ["ZA"], { orderNames: ["coleoptera"] });
    expect(beetleResult).toHaveLength(1);
    expect(beetleResult[0].name).toBe("Beetle Expert");
  });
});

// ---------------------------------------------------------------------------
// searchSpecies (uses pre-built search-index.json)
// ---------------------------------------------------------------------------

describe("searchSpecies", () => {
  function setupSearchIndex(entries: { i: number; s: string; c?: string; ti: string; tg: string; cat: string; gk?: number; aid?: number; ad?: string; ctry?: string }[]) {
    _resetSearchIndexCache();
    vi.mocked(fs.readFileSync).mockImplementation(((filePath: string) => {
      if (String(filePath).includes("search-index")) return JSON.stringify(entries);
      return "{}";
    }) as typeof fs.readFileSync);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  }

  it("returns empty array for queries shorter than 2 characters", () => {
    expect(searchSpecies("a")).toEqual([]);
    expect(searchSpecies("")).toEqual([]);
  });

  it("matches scientific name case-insensitively", () => {
    setupSearchIndex([
      { i: 1, s: "Panthera leo", ti: "mammals", tg: "mammals", cat: "VU" },
      { i: 2, s: "Felis catus", ti: "mammals", tg: "mammals", cat: "LC" },
    ]);

    const results = searchSpecies("panthera");
    expect(results).toHaveLength(1);
    expect(results[0].scientific_name).toBe("Panthera leo");
  });

  it("matches common name case-insensitively", () => {
    setupSearchIndex([
      { i: 1, s: "Panthera leo", c: "Lion", ti: "mammals", tg: "mammals", cat: "VU" },
      { i: 2, s: "Felis catus", c: "Cat", ti: "mammals", tg: "mammals", cat: "LC" },
    ]);

    const results = searchSpecies("lion");
    expect(results).toHaveLength(1);
    expect(results[0].scientific_name).toBe("Panthera leo");
  });

  it("ranks prefix matches on scientific name before substring matches", () => {
    setupSearchIndex([
      { i: 1, s: "Leopardus pardalis", ti: "mammals", tg: "mammals", cat: "LC" },
      { i: 2, s: "Panthera leo", ti: "mammals", tg: "mammals", cat: "VU" },
      { i: 3, s: "Leo ninus", ti: "mammals", tg: "mammals", cat: "VU" },
    ]);

    const results = searchSpecies("leo");
    // "Leo ninus" and "Leopardus pardalis" are prefix matches, "Panthera leo" is substring
    expect(results[0].scientific_name).toBe("Leo ninus");
    expect(results[1].scientific_name).toBe("Leopardus pardalis");
    expect(results[2].scientific_name).toBe("Panthera leo");
  });

  it("ranks exact common name match above scientific name prefix match", () => {
    setupSearchIndex([
      { i: 1, s: "Leopardus pardalis", c: "Ocelot", ti: "mammals", tg: "mammals", cat: "LC" },
      { i: 2, s: "Panthera pardus", c: "Leopard", ti: "mammals", tg: "mammals", cat: "VU" },
      { i: 3, s: "Neofelis nebulosa", c: "Leopard Cat", ti: "mammals", tg: "mammals", cat: "VU" },
    ]);

    const results = searchSpecies("leopard");
    expect(results[0].scientific_name).toBe("Panthera pardus");
    expect(results[1].scientific_name).toBe("Neofelis nebulosa");
    expect(results[2].scientific_name).toBe("Leopardus pardalis");
  });

  it("respects the limit parameter", () => {
    setupSearchIndex([
      { i: 1, s: "Testus alpha", ti: "mammals", tg: "mammals", cat: "VU" },
      { i: 2, s: "Testus beta", ti: "mammals", tg: "mammals", cat: "VU" },
      { i: 3, s: "Testus gamma", ti: "mammals", tg: "mammals", cat: "VU" },
    ]);

    const results = searchSpecies("testus", 2);
    expect(results).toHaveLength(2);
  });

  it("returns correct taxon_id mapping", () => {
    setupSearchIndex([
      { i: -99, s: "Insectus novus", ti: "invertebrates", tg: "beetles", cat: "NE", gk: 99 },
    ]);

    const results = searchSpecies("insectus");
    expect(results).toHaveLength(1);
    expect(results[0].taxon_id).toBe("invertebrates");
    expect(results[0].taxon_group).toBe("beetles");
    expect(results[0].category).toBe("NE");
    expect(results[0].id).toBe(-99);
  });

  it("returns enriched fields (gbif_species_key, assessment_id, countries)", () => {
    setupSearchIndex([
      { i: 1, s: "Panthera leo", c: "Lion", ti: "mammals", tg: "mammals", cat: "VU", gk: 5219404, aid: 280792135, ad: "2025-05-05", ctry: "AO;BJ;KE" },
    ]);

    const results = searchSpecies("lion");
    expect(results).toHaveLength(1);
    expect(results[0].gbif_species_key).toBe(5219404);
    expect(results[0].assessment_id).toBe(280792135);
    expect(results[0].assessment_date).toBe("2025-05-05");
    expect(results[0].countries).toEqual(["AO", "BJ", "KE"]);
  });
});

// ---------------------------------------------------------------------------
// getSpecies — 1:N mapping (species → multiple GBIF keys via synonyms)
// ---------------------------------------------------------------------------

describe("getSpecies (1:N mapping)", () => {
  // The mapping CSV has columns: sis_taxon_id, gbif_species_key, match_type, name_source.
  // GBIF CSV is parsed by parseGbifRow with columns:
  //   gbif_species_key, scientific_name, common_name, taxon_group_table1a,
  //   total_count, count_after_assessment_year, class_name, order_name, family, countries
  // Redlist CSV uses parseRedlistRow.

  interface MappingFixture {
    sis_taxon_id: number;
    gbif_species_key: number | null;
    match_type: string;
    name_source?: string;
  }
  interface GbifFixture {
    gbif_species_key: number;
    scientific_name: string;
    total_count: number;
    count_after_assessment_year: number | null;
    common_name?: string;
    family?: string;
    class_name?: string;
    order_name?: string;
  }

  /**
   * Set up readCsv to dispatch by path: mapping.csv → mappingRows,
   * redlist/<group>.csv → redlistRows, gbif/<group>.csv → gbifRows.
   */
  function setupGetSpecies(opts: {
    group: string;
    redlistRows?: TestRedlistRow[];
    mappingRows?: MappingFixture[];
    gbifRows?: GbifFixture[];
  }) {
    _resetCaches();
    const redlist = opts.redlistRows ?? [];
    const mapping = (opts.mappingRows ?? []).map((m) => ({
      ...m,
      name_source: m.name_source ?? "",
    }));
    const gbif = (opts.gbifRows ?? []).map((g) => ({
      gbif_species_key: g.gbif_species_key,
      scientific_name: g.scientific_name,
      common_name: g.common_name ?? "",
      taxon_group_table1a: opts.group,
      total_count: g.total_count,
      count_after_assessment_year: g.count_after_assessment_year,
      class_name: g.class_name ?? "",
      order_name: g.order_name ?? "",
      family: g.family ?? "",
      countries: [] as string[],
    }));

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{}"); // empty history
    vi.mocked(readCsv).mockImplementation(((csvPath: string) => {
      const p = String(csvPath);
      if (p.endsWith("mapping.csv")) return mapping as ReturnType<typeof readCsv>;
      if (p.includes("/gbif/")) return gbif as ReturnType<typeof readCsv>;
      // Anything else (per-group redlist) → redlist rows.
      return redlist as ReturnType<typeof readCsv>;
    }) as typeof readCsv);
  }

  it("regression: single GBIF link aggregates correctly", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Aquarana catesbeianus", taxon_group_table1a: group });
    setupGetSpecies({
      group,
      redlistRows: [row],
      mappingRows: [
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
      ],
      gbifRows: [
        { gbif_species_key: 100, scientific_name: "Aquarana catesbeianus", total_count: 50, count_after_assessment_year: 10 },
      ],
    });

    const results = getSpecies([group], false);
    expect(results).toHaveLength(1);
    expect(results[0].gbif_species_key).toBe(100);
    expect(results[0].gbif_occurrence_count).toBe(50);
    expect(results[0].gbif_observations_after_assessment_year).toBe(10);
  });

  it("multiple GBIF links sum occurrence counts", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Aquarana catesbeianus", taxon_group_table1a: group });
    setupGetSpecies({
      group,
      redlistRows: [row],
      mappingRows: [
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 200, match_type: "EXACT", name_source: "synonym" },
      ],
      gbifRows: [
        { gbif_species_key: 100, scientific_name: "Aquarana catesbeianus", total_count: 50, count_after_assessment_year: 10 },
        { gbif_species_key: 200, scientific_name: "Lithobates catesbeianus", total_count: 30, count_after_assessment_year: 5 },
      ],
    });

    const results = getSpecies([group], false);
    expect(results).toHaveLength(1);
    expect(results[0].gbif_occurrence_count).toBe(80);
    expect(results[0].gbif_observations_after_assessment_year).toBe(15);
    // Primary (displayed) key is the first non-null link → canonical (100).
    expect(results[0].gbif_species_key).toBe(100);
  });

  it("multiple GBIF links populate linkedGbifKeys (both excluded from NE list)", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Aquarana catesbeianus", taxon_group_table1a: group });
    setupGetSpecies({
      group,
      redlistRows: [row],
      mappingRows: [
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 100, match_type: "EXACT" },
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 200, match_type: "EXACT" },
      ],
      gbifRows: [
        { gbif_species_key: 100, scientific_name: "Aquarana catesbeianus", total_count: 50, count_after_assessment_year: 10 },
        { gbif_species_key: 200, scientific_name: "Lithobates catesbeianus", total_count: 30, count_after_assessment_year: 5 },
        { gbif_species_key: 300, scientific_name: "Other species", total_count: 5, count_after_assessment_year: 1 },
      ],
    });

    const results = getSpecies([group], true);
    // 1 redlist row + 1 NE (key 300 only). Keys 100 and 200 are linked.
    const ne = results.filter((r) => r.category === "NE");
    expect(ne).toHaveLength(1);
    expect(ne[0].gbif_species_key).toBe(300);
  });

  it("missing GBIF data on one of multiple keys: only available counts are summed", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Aquarana catesbeianus", taxon_group_table1a: group });
    setupGetSpecies({
      group,
      redlistRows: [row],
      mappingRows: [
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 100, match_type: "EXACT" },
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 999, match_type: "EXACT" }, // not in gbifMap
      ],
      gbifRows: [
        { gbif_species_key: 100, scientific_name: "Aquarana catesbeianus", total_count: 50, count_after_assessment_year: 10 },
      ],
    });

    const results = getSpecies([group], false);
    expect(results).toHaveLength(1);
    expect(results[0].gbif_occurrence_count).toBe(50);
    expect(results[0].gbif_observations_after_assessment_year).toBe(10);
    expect(Number.isNaN(results[0].gbif_occurrence_count!)).toBe(false);
  });

  it("primary gbif_species_key prefers canonical regardless of mapping CSV row order", () => {
    // The matcher writes canonical rows before synonym rows today, but the
    // reader must not depend on that — selection should be by name_source.
    // This fixture deliberately lists the synonym row FIRST.
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Aquarana catesbeianus", taxon_group_table1a: group });
    setupGetSpecies({
      group,
      redlistRows: [row],
      mappingRows: [
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 200, match_type: "EXACT", name_source: "synonym" },
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 100, match_type: "EXACT", name_source: "canonical" },
      ],
      gbifRows: [
        { gbif_species_key: 100, scientific_name: "Aquarana catesbeianus", total_count: 50, count_after_assessment_year: 10 },
        { gbif_species_key: 200, scientific_name: "Lithobates catesbeianus", total_count: 30, count_after_assessment_year: 5 },
      ],
    });

    const results = getSpecies([group], false);
    expect(results).toHaveLength(1);
    // Despite the synonym row appearing first in the mapping, the canonical
    // key (100) is selected as the displayed/external-link gbif_species_key.
    expect(results[0].gbif_species_key).toBe(100);
    // Counts still aggregate across both keys.
    expect(results[0].gbif_occurrence_count).toBe(80);
  });

  it("falls back to first non-null link when no canonical-source link exists", () => {
    // Edge case: a species whose canonical name didn't match GBIF at all,
    // but a synonym did. The displayed gbif_species_key should be the
    // synonym key (only option), not null.
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Aquarana catesbeianus", taxon_group_table1a: group });
    setupGetSpecies({
      group,
      redlistRows: [row],
      mappingRows: [
        { sis_taxon_id: row.sis_taxon_id, gbif_species_key: 200, match_type: "EXACT", name_source: "synonym" },
      ],
      gbifRows: [
        { gbif_species_key: 200, scientific_name: "Lithobates catesbeianus", total_count: 30, count_after_assessment_year: 5 },
      ],
    });

    const results = getSpecies([group], false);
    expect(results[0].gbif_species_key).toBe(200);
    expect(results[0].gbif_occurrence_count).toBe(30);
  });

  it("Bullfrog regression: legacy Lithobates key is linked to Aquarana, not surfaced as NE", () => {
    // The user-reported bug: Lithobates catesbeianus appearing as a separate
    // NE row even though Aquarana catesbeianus has an assessment. With the
    // 1:N mapping, both GBIF keys link back to the bullfrog assessment.
    const group = uniqueGroup();
    const bullfrog = makeRow({
      sis_taxon_id: 58565,
      scientific_name: "Aquarana catesbeianus",
      common_name: "American Bullfrog",
      category: "LC",
      taxon_group_table1a: group,
    });
    setupGetSpecies({
      group,
      redlistRows: [bullfrog],
      mappingRows: [
        { sis_taxon_id: 58565, gbif_species_key: 5217419, match_type: "EXACT", name_source: "canonical" },
        { sis_taxon_id: 58565, gbif_species_key: 2427091, match_type: "EXACT", name_source: "synonym" },
      ],
      gbifRows: [
        { gbif_species_key: 5217419, scientific_name: "Aquarana catesbeianus", total_count: 100, count_after_assessment_year: 20 },
        { gbif_species_key: 2427091, scientific_name: "Lithobates catesbeianus", total_count: 5000, count_after_assessment_year: 800 },
      ],
    });

    const results = getSpecies([group], true);
    // Exactly one row, no NE row for the legacy Lithobates key.
    expect(results).toHaveLength(1);
    const bullfrogResult = results[0];
    expect(bullfrogResult.scientific_name).toBe("Aquarana catesbeianus");
    expect(bullfrogResult.category).toBe("LC");
    // All occurrences (5100) flow to the assessed species.
    expect(bullfrogResult.gbif_occurrence_count).toBe(5100);
    expect(bullfrogResult.gbif_observations_after_assessment_year).toBe(820);
    // No "Lithobates catesbeianus" NE row.
    expect(results.find((r) => r.scientific_name === "Lithobates catesbeianus")).toBeUndefined();
  });
});

