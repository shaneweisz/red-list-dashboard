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
import { getAssessorCandidates } from "./species-store";

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
  vi.mocked(readCsv).mockReturnValue(rows as any);
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

    const result = getAssessorCandidates("Panthera leo", group, "felidae", "carnivora", "mammalia");
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
