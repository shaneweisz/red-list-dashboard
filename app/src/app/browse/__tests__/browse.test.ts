import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the data store so the route logic can be tested without CSV data.
// isOutdated keeps its real >10-year rule (it's a pure function).
vi.mock("@/lib/data/species-store", () => ({
  getSpecies: vi.fn(() => []),
  searchSpecies: vi.fn(() => []),
  isOutdated: (date: string | null) => {
    if (!date) return true;
    const year = parseInt(date.slice(0, 4), 10);
    return Number.isNaN(year) ? true : new Date().getFullYear() - year > 10;
  },
}));

import { getSpecies, searchSpecies } from "@/lib/data/species-store";
import { GET } from "@/app/browse/route";

const mGetSpecies = vi.mocked(getSpecies);
const mSearch = vi.mocked(searchSpecies);

// Minimal SpeciesRow-shaped fixture (only fields the route touches).
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, sis_taxon_id: 1, taxon_group: "corals",
    class_name: null, order_name: null, family: null,
    scientific_name: "Acropora cervicornis", common_name: "Staghorn coral",
    category: "CR", threat_codes: ["11.1", "11.4", "5.4"],
    countries: ["US"], systems: ["Marine"], population_trend: "Decreasing",
    movement_pattern: null, growth_forms: [], has_map: true,
    gbif_occurrence_count: 50, assessment_date: "2018-06-01",
    ...overrides,
  };
}

const RECENT_YEAR = `${new Date().getFullYear()}-01-01`; // never outdated (>10yr rule)

function get(qs: string) {
  return GET(new NextRequest(`https://red.cst.cam.ac.uk/browse${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mGetSpecies.mockReturnValue([] as any);
  mSearch.mockReturnValue([]);
});

describe("/browse", () => {
  it("filters corals to the climate-change subset", async () => {
    mGetSpecies.mockReturnValue([
      row(),
      row({ scientific_name: "Montastraea cavernosa", threat_codes: ["5.4"], category: "EN" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const res = await get("?taxa=corals&threats=climate-change&format=json");
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.species[0].scientific_name).toBe("Acropora cervicornis");
    expect(data.breakdown).toEqual({ CR: 1 });
    expect(data.interpreted.join(" ")).toMatch(/Climate change/);
  });

  it("returns the whole taxon when only taxa is given", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mGetSpecies.mockReturnValue([row(), row({ scientific_name: "X", category: "EN" })] as any);
    const data = await (await get("?taxa=corals&format=json")).json();
    expect(data.total).toBe(2);
  });

  it("caps results at 200 but reports the true total", async () => {
    const many = Array.from({ length: 201 }, (_, i) => row({ scientific_name: `Coral ${i}`, sis_taxon_id: i }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mGetSpecies.mockReturnValue(many as any);
    const data = await (await get("?taxa=corals&threats=11&format=json")).json();
    expect(data.total).toBe(201);
    expect(data.shown).toBe(200);
    expect(data.capped).toBe(true);
  });

  it("reports no matches clearly", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mGetSpecies.mockReturnValue([row()] as any);
    const data = await (await get("?taxa=corals&categories=extinct&format=json")).json();
    expect(data.total).toBe(0);
  });

  it("shows a self-describing index (no data scan) when nothing is selected", async () => {
    const data = await (await get("?format=json")).json();
    expect(data.params.threats.some((t: { code: string }) => t.code === "11")).toBe(true);
    expect(mGetSpecies).not.toHaveBeenCalled();
  });

  it("echoes unresolved taxa instead of scanning", async () => {
    const data = await (await get("?taxa=dinosaurs&format=json")).json();
    expect(data.unresolved).toContain("taxa=dinosaurs");
    expect(mGetSpecies).not.toHaveBeenCalled();
  });

  it("supports name search across taxa via the search index", async () => {
    mSearch.mockReturnValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { taxon_group: "mammalia" } as any,
    ]);
    mGetSpecies.mockReturnValue([
      row({ taxon_group: "mammalia", scientific_name: "Panthera tigris", common_name: "Tiger", threat_codes: ["5.1"], category: "EN" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const data = await (await get("?search=tiger&format=json")).json();
    expect(data.total).toBe(1);
    expect(data.species[0].scientific_name).toBe("Panthera tigris");
    expect(mSearch).toHaveBeenCalled();
  });

  it("reports outdated stats for percentage questions", async () => {
    mGetSpecies.mockReturnValue([
      row({ taxon_group: "mammalia", assessment_date: "1990-01-01" }),
      row({ taxon_group: "mammalia", assessment_date: "1995-01-01" }),
      row({ taxon_group: "mammalia", assessment_date: RECENT_YEAR }),
      row({ taxon_group: "mammalia", assessment_date: RECENT_YEAR }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const data = await (await get("?taxa=mammalia&format=json")).json();
    expect(data.stats.assessed).toBe(4);
    expect(data.stats.outdated).toBe(2);
    expect(data.stats.outdated_pct).toBe(50);
  });

  it("filters by outdated, minObs and country together", async () => {
    mGetSpecies.mockReturnValue([
      row({ scientific_name: "Match sp", taxon_group: "insecta", category: "DD", countries: ["IN"], gbif_occurrence_count: 150, assessment_date: "2005-01-01" }),
      row({ scientific_name: "TooFewObs sp", taxon_group: "insecta", category: "DD", countries: ["IN"], gbif_occurrence_count: 5, assessment_date: "2005-01-01" }),
      row({ scientific_name: "Recent sp", taxon_group: "insecta", category: "DD", countries: ["IN"], gbif_occurrence_count: 150, assessment_date: RECENT_YEAR }),
      row({ scientific_name: "WrongCountry sp", taxon_group: "insecta", category: "DD", countries: ["US"], gbif_occurrence_count: 150, assessment_date: "2005-01-01" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    const data = await (await get("?taxa=insecta&categories=DD&minObs=100&outdated=yes&countries=India&format=json")).json();
    expect(data.total).toBe(1);
    expect(data.species[0].scientific_name).toBe("Match sp");
    expect(data.interpreted.join(" | ")).toMatch(/India \(IN\)/);
    expect(data.interpreted.join(" | ")).toMatch(/Outdated/);
  });

  it("serves an HTML index for a bare request", async () => {
    const res = await get("");
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toMatch(/Browse/);
    expect(body).toMatch(/llms\.txt/);
  });
});
