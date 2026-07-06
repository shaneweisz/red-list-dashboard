/**
 * Validates the "By SSC specialist group" view config against the precomputed
 * node summaries it renders from (data/node-children-summaries.json).
 *
 * The view reuses existing taxonomy nodes, so the guarantees we care about are:
 *   1. Every referenced nodeId resolves to a precomputed summary.
 *   2. The finer vertebrate rows partition their class (mammal orders sum to the
 *      coarse mammals total), i.e. section subtotals stay meaningful.
 *   3. The whole view covers exactly the Table 1a universe — no gaps, no
 *      double-counting — so its grand total matches Table 1a (172,620).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { TAXONOMY_VIEWS } from "../taxonomy-views";

interface NodeSummary {
  id: string;
  totalAssessed: number;
}

const DATA_DIR = path.join(__dirname, "../../../data");

function flatSummaries(): Record<string, NodeSummary> {
  const raw = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "node-children-summaries.json"), "utf-8")
  ) as Record<string, NodeSummary[]>;
  const flat: Record<string, NodeSummary> = {};
  for (const arr of Object.values(raw)) {
    for (const s of arr) if (!(s.id in flat)) flat[s.id] = s;
  }
  return flat;
}

describe("SSC specialist group view", () => {
  const view = TAXONOMY_VIEWS.sscSpecialistGroups;
  const flat = flatSummaries();
  const rowIds = (view.sections ?? []).flatMap((s) => s.nodeIds);

  it("references at least one section of rows", () => {
    expect(rowIds.length).toBeGreaterThan(0);
    // roots should mirror the section rows exactly (same set)
    expect(new Set(view.roots)).toEqual(new Set(rowIds));
  });

  it("every referenced node resolves to a precomputed summary", () => {
    const missing = rowIds.filter((id) => !flat[id]);
    expect(missing, `unresolved nodeIds: ${missing.join(", ")}`).toEqual([]);
  });

  it("mammal order rows partition the coarse mammals total", () => {
    const mammals = view.sections?.find((s) => s.title === "MAMMALS");
    expect(mammals).toBeDefined();
    const sum = mammals!.nodeIds.reduce((s, id) => s + flat[id].totalAssessed, 0);
    expect(sum).toBe(flat["mammals"].totalAssessed);
  });

  it("covers exactly the Table 1a universe (grand total matches)", () => {
    const grandTotal = rowIds.reduce((s, id) => s + flat[id].totalAssessed, 0);
    expect(grandTotal).toBe(172620);
  });
});
