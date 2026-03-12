/**
 * Validates taxa-summary.json against IUCN Table 1a (2025-1).
 *
 * Requires actual pipeline data files.
 * Run manually after: sync.ts
 *
 * Usage: TEST_TABLE1A=1 npx vitest run scripts/__tests__/validate-table1a.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "../../data");

const TABLE_1A_2025_1: Record<string, number> = {
  mammalia: 6025,
  aves: 11195,
  reptilia: 10316,
  amphibia: 8009,
  fishes: 28866,
  insecta: 13442,
  mollusca: 9144,
  crustacea: 3310,
  corals: 916,
  arachnida: 994,
  velvet_worms: 11,
  horseshoe_crabs: 4,
  other_invertebrates: 1119,
  mosses: 327,
  ferns_and_allies: 828,
  gymnosperms: 1061,
  flowering_plants: 72439,
  green_algae: 18,
  red_algae: 78,
  mushrooms: 1300,
  brown_algae: 18,
};

const TOTAL_EXPECTED = 169420;

describe.skipIf(!process.env.TEST_TABLE1A)("taxa_summary vs Table 1a (2025-1)", () => {
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
    for (const [taxon, expected] of Object.entries(TABLE_1A_2025_1)) {
      const assessed = actual.get(taxon);
      expect(assessed, `${taxon}: expected ${expected}, got ${assessed}`).toBe(expected);
      totalActual += assessed ?? 0;
    }

    expect(totalActual).toBe(TOTAL_EXPECTED);
  });
});
