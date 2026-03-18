/**
 * Validates taxa-summary.json against IUCN Table 1a (2025-2).
 *
 * Requires data files from sync.ts to be present.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "../../data");

const TABLE_1A_2025_2: Record<string, number> = {
  mammalia: 6036,
  aves: 11185,
  reptilia: 10368,
  amphibia: 8051,
  fishes: 29114,
  insecta: 13696,
  mollusca: 9502,
  crustacea: 3361,
  corals: 916,
  arachnida: 1053,
  velvet_worms: 11,
  horseshoe_crabs: 4,
  other_invertebrates: 1139,
  mosses: 327,
  ferns_and_allies: 834,
  gymnosperms: 1062,
  flowering_plants: 74545,
  green_algae: 18,
  red_algae: 78,
  mushrooms: 1302,
  brown_algae: 18,
};

const TOTAL_EXPECTED = 172620;

describe("taxa_summary vs Table 1a (2025-2)", () => {
  it("total_assessed per table1a_taxon_group matches Table 1a expected values", () => {
    const summaryPath = path.join(DATA_DIR, "taxa-summary.json");
    expect(fs.existsSync(summaryPath), "taxa-summary.json must exist").toBe(true);

    const data = JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as Array<{
      table1a_taxon_group: string;
      total_assessed: number;
    }>;

    expect(data.length).toBeGreaterThan(0);

    const actual = new Map<string, number>();
    for (const row of data) {
      actual.set(row.table1a_taxon_group, row.total_assessed);
    }

    let totalActual = 0;
    for (const [taxon, expected] of Object.entries(TABLE_1A_2025_2)) {
      const assessed = actual.get(taxon);
      expect(assessed, `${taxon}: expected ${expected}, got ${assessed}`).toBe(expected);
      totalActual += assessed ?? 0;
    }

    expect(totalActual).toBe(TOTAL_EXPECTED);
  });
});
