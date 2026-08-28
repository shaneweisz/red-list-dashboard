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
import { getAssessorCandidates, getAssessorCandidatesByCountry, getReviewerCandidatesByCountry, getColRevisions, _resetCaches } from "./species-store";

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

  it("strips parenthetical affiliations and merges them under one candidate", () => {
    const group = uniqueGroup();
    const row1 = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    const row2 = makeRow({ countries: ["ZA"], scientific_name: "Testus two" });
    setup([row1, row2], {
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Amori, G. (Small Nonvolant Mammal Red List Authority)", reviewers: null },
      ],
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2021", category: "LC", date: "2021-01-01", assessors: "Amori, G.", reviewers: null },
      ],
    });

    const result = getAssessorCandidatesByCountry([group], ["ZA"]);
    // Both rows credit the same person despite the affiliation label on one
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Amori, G.");
    expect(result[0].totalInRegion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getReviewerCandidatesByCountry
// ---------------------------------------------------------------------------

describe("getReviewerCandidatesByCountry", () => {
  it("returns empty array when no countries provided", () => {
    const group = uniqueGroup();
    setup([]);
    expect(getReviewerCandidatesByCountry([group], [])).toEqual([]);
  });

  it("returns empty array when no taxon groups provided", () => {
    expect(getReviewerCandidatesByCountry([], ["ZA"])).toEqual([]);
  });

  it("returns empty array when species have only assessors, no reviewers", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: "Dr. Africa", reviewers: null },
      ],
    });
    expect(getReviewerCandidatesByCountry([group], ["ZA"])).toEqual([]);
  });

  it("finds reviewers for species with overlapping countries", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA", "MZ"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-06-15", assessors: "Dr. Assessor", reviewers: "Dr. Reviewer" },
      ],
    });

    const result = getReviewerCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Reviewer");
    expect(result[0].totalInRegion).toBe(1);
    expect(result[0].latestDate).toBe("2020-06-15");
  });

  it("aggregates region and country counts from overlapping countries", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA", "KE"], scientific_name: "Testus wide" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2021", category: "VU", date: "2021-01-01", assessors: null, reviewers: "Dr. Wide" },
      ],
    });

    const result = getReviewerCandidatesByCountry([group], ["ZA", "KE"]);
    expect(result).toHaveLength(1);
    expect(result[0].regionCounts["Southern Africa"]).toBe(1);
    expect(result[0].regionCounts["Eastern Africa"]).toBe(1);
    expect(result[0].countryCounts["ZA"]).toBe(1);
    expect(result[0].countryCounts["KE"]).toBe(1);
  });

  it("counts unique species, not multiple assessments of the same species", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2010", category: "LC", date: "2010-01-01", assessors: null, reviewers: "Dr. Repeat" },
        { id: 2, year: "2015", category: "VU", date: "2015-06-01", assessors: null, reviewers: "Dr. Repeat" },
      ],
    });

    const result = getReviewerCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
    expect(result[0].totalInRegion).toBe(1);
    expect(result[0].latestDate).toBe("2015-06-01");
  });

  it("tracks totalAll separately from totalInRegion", () => {
    const group = uniqueGroup();
    const rowInRegion = makeRow({ countries: ["ZA"], scientific_name: "Testus local" });
    const rowOutside = makeRow({ countries: ["GB"], scientific_name: "Testus remote" });
    setup([rowInRegion, rowOutside], {
      [String(rowInRegion.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: null, reviewers: "Dr. Both" },
      ],
      [String(rowOutside.sis_taxon_id)]: [
        { id: 2, year: "2021", category: "VU", date: "2021-01-01", assessors: null, reviewers: "Dr. Both" },
      ],
    });

    const result = getReviewerCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
    expect(result[0].totalInRegion).toBe(1);
    expect(result[0].totalAll).toBe(2);
  });

  it("parses multiple reviewers from a single assessment", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-01-01", assessors: null, reviewers: "Smith, J.A. & Jones, B.C." },
      ],
    });

    const names = getReviewerCandidatesByCountry([group], ["ZA"]).map((c) => c.name);
    expect(names).toContain("Smith, J.A.");
    expect(names).toContain("Jones, B.C.");
  });

  // The bug behind the reported broken filter link: a reviewer carries a
  // "(... Red List Authority)" label in one assessment but not another, so the
  // affiliated variant produced a separate candidate whose URL didn't match the
  // species' latest_reviewers. Stripping the affiliation merges them.
  it("strips parenthetical affiliations and merges them under one candidate", () => {
    const group = uniqueGroup();
    const row1 = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    const row2 = makeRow({ countries: ["ZA"], scientific_name: "Testus two" });
    setup([row1, row2], {
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2008", category: "LC", date: "2008-01-01", assessors: null, reviewers: "Amori, G. (Small Nonvolant Mammal Red List Authority)" },
      ],
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2016", category: "LC", date: "2016-01-01", assessors: null, reviewers: "Amori, G." },
      ],
    });

    const result = getReviewerCandidatesByCountry([group], ["ZA"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Amori, G.");
    expect(result[0].totalInRegion).toBe(2);
  });

  it("strips affiliations from each name in a multi-reviewer string", () => {
    const group = uniqueGroup();
    const row = makeRow({ countries: ["ZA"], scientific_name: "Testus one" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: "2020-01-01", assessors: null, reviewers: "Amori, G. (Small Nonvolant Mammal Red List Authority) & Schipper, J. (Global Mammal Assessment Team)" },
      ],
    });

    const names = getReviewerCandidatesByCountry([group], ["ZA"]).map((c) => c.name);
    expect(names).toContain("Amori, G.");
    expect(names).toContain("Schipper, J.");
    expect(names).not.toContain("Amori, G. (Small Nonvolant Mammal Red List Authority)");
  });

  it("applies taxonomy filter to narrow scope", () => {
    const group = uniqueGroup();
    const beetleRow = makeRow({ countries: ["ZA"], scientific_name: "Beetlus one", order_name: "Coleoptera", class_name: "Insecta" });
    const mothRow = makeRow({ countries: ["ZA"], scientific_name: "Mothus one", order_name: "Lepidoptera", class_name: "Insecta" });
    setup([beetleRow, mothRow], {
      [String(beetleRow.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: "2020-01-01", assessors: null, reviewers: "Beetle Reviewer" },
      ],
      [String(mothRow.sis_taxon_id)]: [
        { id: 2, year: "2021", category: "LC", date: "2021-01-01", assessors: null, reviewers: "Moth Reviewer" },
      ],
    });

    expect(getReviewerCandidatesByCountry([group], ["ZA"])).toHaveLength(2);
    const beetleResult = getReviewerCandidatesByCountry([group], ["ZA"], { orderNames: ["coleoptera"] });
    expect(beetleResult).toHaveLength(1);
    expect(beetleResult[0].name).toBe("Beetle Reviewer");
  });
});

// ---------------------------------------------------------------------------
// getColRevisions — the on-disk encoding is deliberately terse (short keys,
// omitted fields), so the decoder is exactly the kind of thing that breaks
// silently: a wrong key name yields a flag with everything undefined, and the
// UI just stops flagging rather than throwing. These pin the wire format.
// ---------------------------------------------------------------------------
describe("getColRevisions", () => {
  beforeEach(() => {
    _resetCaches();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  const load = (file: unknown) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(file));
    return getColRevisions();
  };

  it("expands every short key onto its long name", () => {
    const map = load({ species: { "41775": { r: "lumped", d: "Sus scrofa", i: 123, dc: "SUSSC", c: "7PST9", n: "Sus x", s: [["Sus y", "SUSY1"]] } } });
    expect(map.get(41775)).toEqual({
      reason: "lumped", detail: "Sus scrofa", detailId: 123, detailColId: "SUSSC",
      colId: "7PST9", colName: "Sus x", splitInto: [{ name: "Sus y", colId: "SUSY1" }],
    });
  });

  it("expands the accepted-name signal, including its boolean", () => {
    // gm ships as 1 rather than true to keep the file small; a decoder that
    // passed it through would put `genusMoved: 1` on the flag and silently send
    // every genus transfer to the wrong bar.
    const map = load({ species: { "7": { an: "Sibirenauta elongata", ac: "ABC12", gm: 1 } } });
    expect(map.get(7)).toEqual({
      acceptedName: "Sibirenauta elongata", acceptedColId: "ABC12", genusMoved: true,
    });
  });

  it("leaves genusMoved off a plain rename rather than setting it false", () => {
    const map = load({ species: { "8": { an: "Dalbergia emirnensis", ac: "XYZ99" } } });
    expect(map.get(8)).toEqual({ acceptedName: "Dalbergia emirnensis", acceptedColId: "XYZ99" });
    expect("genusMoved" in map.get(8)!).toBe(false);
  });

  it("keeps a split name with no CoL record as plain text rather than a dead link", () => {
    const map = load({ species: { "1": { s: [["Sus y", ""], ["Sus z", "SUSZ1"]] } } });
    expect(map.get(1)!.splitInto).toEqual([{ name: "Sus y" }, { name: "Sus z", colId: "SUSZ1" }]);
  });

  it("keys by number, not by the string the JSON object uses", () => {
    const map = load({ species: { "811": { s: [["Alcelaphus cokii", "L7YRS"]] } } });
    expect(map.get(811)).toBeTruthy();
    expect(map.has(811)).toBe(true);
  });

  it("omits absent fields rather than setting them undefined", () => {
    const map = load({ species: { "811": { s: [["Alcelaphus cokii", "L7YRS"]], c: "BHBY" } } });
    // A split-only flag has no no-match reason at all.
    expect(map.get(811)).toEqual({ colId: "BHBY", splitInto: [{ name: "Alcelaphus cokii", colId: "L7YRS" }] });
    expect("reason" in map.get(811)!).toBe(false);
  });

  it("drops an empty split list instead of carrying a flag that means nothing", () => {
    const map = load({ species: { "1": { r: "no_link" }, "2": { s: [] } } });
    expect(map.get(1)).toEqual({ reason: "no_link" });
    expect(map.get(2)).toEqual({});
  });

  it("returns an empty map when the file is missing, so a stale sync still serves species", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(getColRevisions().size).toBe(0);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("tolerates a file with no species key", () => {
    expect(load({ counts: {}, total: 0 }).size).toBe(0);
  });

  it("reads the file once and caches it for the process", () => {
    load({ species: { "1": { r: "no_link" } } });
    getColRevisions();
    getColRevisions();
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });
});
