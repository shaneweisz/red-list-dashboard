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

// Each test uses a unique group name so the module's internal cache doesn't
// cause cross-test interference (the caches are keyed by group name).
let groupCounter = 0;
function uniqueGroup(): string {
  return `test_group_${groupCounter++}`;
}

/**
 * Configure the mocked fs/csv to return the given rows and history
 * for any group name (the mocks always return the same data regardless
 * of which group is requested).
 */
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
  it("returns empty array when no assessed species exist in the group", () => {
    const group = uniqueGroup();
    setup([]);
    expect(getAssessorCandidates("Panthera leo", group)).toEqual([]);
  });

  it("returns empty array when species exist but none have assessors", () => {
    const group = uniqueGroup();
    setup([makeRow({ scientific_name: "Panthera tigris" })]);
    expect(getAssessorCandidates("Panthera leo", group)).toEqual([]);
  });

  it("finds a genus-level match", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris", family: "Felidae" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: null, assessors: "Dr. Smith", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Smith");
    expect(result[0].bestMatchLevel).toBe("genus");
  });

  it("finds a family-level match when genus differs", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Felis catus", family: "Felidae", order_name: "Carnivora" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2021", category: "LC", date: null, assessors: "Dr. Jones", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Jones");
    expect(result[0].bestMatchLevel).toBe("family");
  });

  it("finds an order-level match when genus and family differ", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Canis lupus", family: "Canidae", order_name: "Carnivora" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2019", category: "LC", date: null, assessors: "Dr. Wolf", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Wolf");
    expect(result[0].bestMatchLevel).toBe("order");
  });

  it("falls back to group-level when no taxonomy matches", () => {
    const group = uniqueGroup();
    const row = makeRow({
      scientific_name: "Equus caballus",
      family: "Equidae",
      order_name: "Perissodactyla",
    });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2022", category: "LC", date: null, assessors: "Dr. Horse", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dr. Horse");
    expect(result[0].bestMatchLevel).toBe("group");
  });

  it("ranks genus > family > order > group", () => {
    const group = uniqueGroup();
    const genusRow = makeRow({ scientific_name: "Panthera tigris", family: "Felidae", order_name: "Carnivora" });
    const familyRow = makeRow({ scientific_name: "Felis catus", family: "Felidae", order_name: "Carnivora" });
    const orderRow = makeRow({ scientific_name: "Canis lupus", family: "Canidae", order_name: "Carnivora" });
    const groupRow = makeRow({ scientific_name: "Equus caballus", family: "Equidae", order_name: "Perissodactyla" });

    setup([genusRow, familyRow, orderRow, groupRow], {
      [String(genusRow.sis_taxon_id)]: [
        { id: 1, year: "2018", category: "EN", date: null, assessors: "Genus Expert", reviewers: null },
      ],
      [String(familyRow.sis_taxon_id)]: [
        { id: 2, year: "2022", category: "LC", date: null, assessors: "Family Expert", reviewers: null },
      ],
      [String(orderRow.sis_taxon_id)]: [
        { id: 3, year: "2023", category: "LC", date: null, assessors: "Order Expert", reviewers: null },
      ],
      [String(groupRow.sis_taxon_id)]: [
        { id: 4, year: "2024", category: "LC", date: null, assessors: "Group Expert", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Genus Expert");
    expect(result[0].bestMatchLevel).toBe("genus");
    expect(result[1].name).toBe("Family Expert");
    expect(result[1].bestMatchLevel).toBe("family");
    expect(result[2].name).toBe("Order Expert");
    expect(result[2].bestMatchLevel).toBe("order");
  });

  it("returns at most 3 candidates", () => {
    const group = uniqueGroup();
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ scientific_name: `Genus${i} species`, family: "Fam" + i, order_name: "Ord" + i })
    );
    const history: HistoryMap = {};
    for (const row of rows) {
      history[String(row.sis_taxon_id)] = [
        { id: row.sis_taxon_id, year: "2020", category: "VU", date: null, assessors: `Expert ${row.sis_taxon_id}`, reviewers: null },
      ];
    }
    setup(rows, history);

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(3);
  });

  it("breaks ties at same match level: more matches at that level wins", () => {
    const group = uniqueGroup();
    const row1 = makeRow({ scientific_name: "Panthera tigris" });
    const row2 = makeRow({ scientific_name: "Panthera pardus" });
    const row3 = makeRow({ scientific_name: "Panthera onca" });

    setup([row1, row2, row3], {
      // Recent Assessor: 1 genus match (2023)
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2023", category: "EN", date: null, assessors: "Recent Assessor", reviewers: null },
      ],
      // Prolific Assessor: 2 genus matches (2018, 2019)
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2018", category: "VU", date: null, assessors: "Prolific Assessor", reviewers: null },
      ],
      [String(row3.sis_taxon_id)]: [
        { id: 3, year: "2019", category: "NT", date: null, assessors: "Prolific Assessor", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result[0].name).toBe("Prolific Assessor");
    expect(result[1].name).toBe("Recent Assessor");
  });

  it("breaks ties at same match level and count: recency wins", () => {
    const group = uniqueGroup();
    const row1 = makeRow({ scientific_name: "Panthera tigris" });
    const row2 = makeRow({ scientific_name: "Panthera pardus" });

    setup([row1, row2], {
      [String(row1.sis_taxon_id)]: [
        { id: 1, year: "2023", category: "EN", date: null, assessors: "Recent", reviewers: null },
      ],
      [String(row2.sis_taxon_id)]: [
        { id: 2, year: "2018", category: "VU", date: null, assessors: "Old", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    expect(result[0].name).toBe("Recent");
    expect(result[1].name).toBe("Old");
  });

  it("handles case-insensitive matching for family and order", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Felis catus", family: "FELIDAE", order_name: "CARNIVORA" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: null, assessors: "Dr. Case", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "felidae", "carnivora");
    expect(result).toHaveLength(1);
    expect(result[0].bestMatchLevel).toBe("family");
  });

  it("skips assessor names shorter than 3 characters", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: null, assessors: "AB & Dr. Valid Name", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    const names = result.map((c) => c.name);
    expect(names).not.toContain("AB");
    expect(names).toContain("Dr. Valid Name");
  });

  it("genus match works without family/order params", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris", family: "Felidae", order_name: "Carnivora" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: null, assessors: "Dr. Genus", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    expect(result).toHaveLength(1);
    expect(result[0].bestMatchLevel).toBe("genus");
  });

  it("falls back to group when family/order are null and genus differs", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Felis catus", family: "Felidae", order_name: "Carnivora" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "LC", date: null, assessors: "Dr. Fallback", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Canis lupus", group);
    expect(result).toHaveLength(1);
    expect(result[0].bestMatchLevel).toBe("group");
  });

  it("promotes assessor to best match level across multiple species", () => {
    const group = uniqueGroup();
    const genusRow = makeRow({ scientific_name: "Panthera tigris", family: "Felidae" });
    const groupRow = makeRow({ scientific_name: "Equus caballus", family: "Equidae", order_name: "Perissodactyla" });

    setup([genusRow, groupRow], {
      [String(genusRow.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: null, assessors: "Multi Assessor", reviewers: null },
      ],
      [String(groupRow.sis_taxon_id)]: [
        { id: 2, year: "2022", category: "LC", date: null, assessors: "Multi Assessor", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Multi Assessor");
    expect(result[0].bestMatchLevel).toBe("genus");
    expect(result[0].assessmentCount).toBe(2);
  });

  it("returns matched species sorted by year descending, capped at 3", () => {
    const group = uniqueGroup();
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ sis_taxon_id: 100 + i, scientific_name: `Panthera sp${i}`, family: "Felidae" })
    );
    const history: HistoryMap = {};
    for (let i = 0; i < rows.length; i++) {
      history[String(rows[i].sis_taxon_id)] = [
        { id: i, year: String(2018 + i), category: "VU", date: null, assessors: "Same Person", reviewers: null },
      ];
    }
    setup(rows, history);

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(1);
    expect(result[0].matchedSpecies).toHaveLength(3);
    const years = result[0].matchedSpecies.map((s) => s.year);
    expect(years).toEqual(["2022", "2021", "2020"]);
  });

  it("parses multiple assessors from a single assessment", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: null, assessors: "Smith, J.A. & Jones, B.C.", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    const names = result.map((c) => c.name);
    expect(names).toContain("Smith, J.A.");
    expect(names).toContain("Jones, B.C.");
  });

  it("genus match works even when row has null family/order", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris", family: null, order_name: null });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: null, assessors: "Genus Only", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, null, null);
    expect(result).toHaveLength(1);
    expect(result[0].bestMatchLevel).toBe("genus");
  });

  it("does not double-count: a genus match is not also counted as family/order", () => {
    const group = uniqueGroup();
    // This row matches at genus level AND shares the same family and order
    const row = makeRow({ scientific_name: "Panthera tigris", family: "Felidae", order_name: "Carnivora" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2020", category: "EN", date: null, assessors: "Dr. Precise", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group, "Felidae", "Carnivora");
    expect(result).toHaveLength(1);
    // It should be genus, not family or order
    expect(result[0].bestMatchLevel).toBe("genus");
  });

  it("tracks recentYear as the latest assessment year for each assessor", () => {
    const group = uniqueGroup();
    const row = makeRow({ scientific_name: "Panthera tigris" });
    setup([row], {
      [String(row.sis_taxon_id)]: [
        { id: 1, year: "2015", category: "EN", date: null, assessors: "Dr. Timeline", reviewers: null },
        { id: 2, year: "2022", category: "VU", date: null, assessors: "Dr. Timeline", reviewers: null },
        { id: 3, year: "2018", category: "NT", date: null, assessors: "Dr. Timeline", reviewers: null },
      ],
    });

    const result = getAssessorCandidates("Panthera leo", group);
    expect(result).toHaveLength(1);
    expect(result[0].recentYear).toBe("2022");
  });
});
