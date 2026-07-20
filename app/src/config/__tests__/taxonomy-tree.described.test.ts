// Guards against reintroducing a hand-typed estimatedDescribed citation on a
// non-official node — exactly the recurring bug class documented across the SSC
// group review (see redlist-2026-1-update-scoping in project memory): a hand-typed
// "estimated described species" number, whether a third-party citation or an
// approximation, drifting out of sync with reality and getting fixed piecemeal
// ~14+ times. The fix was structural, not another review pass: estimatedDescribed
// only exists on the 25 OFFICIAL_IUCN_DESCRIBED_NODE_IDS (the Table 1a PDF's own
// numbers); every other node always shows the live CoL-derived count instead (see
// resolveDescribed in TaxaSummary.tsx). This test makes that invariant permanent.
import { describe, it, expect } from "vitest";
import { NODE_INDEX, OFFICIAL_IUCN_DESCRIBED_NODE_IDS, stripNodePrefix } from "@/lib/taxonomy-utils";

describe("estimatedDescribed is official-Table-1a-only", () => {
  const officialWithoutEstimate: string[] = [];
  const nonOfficialWithEstimate: string[] = [];

  for (const [id, node] of NODE_INDEX) {
    const isOfficial = OFFICIAL_IUCN_DESCRIBED_NODE_IDS.has(stripNodePrefix(id));
    const hasEstimate = node.estimatedDescribed !== undefined;
    if (isOfficial && !hasEstimate) officialWithoutEstimate.push(id);
    if (!isOfficial && hasEstimate) nonOfficialWithEstimate.push(id);
  }

  it("every official node has a real Table 1a estimatedDescribed value", () => {
    expect(officialWithoutEstimate).toHaveLength(0);
  });

  it("no non-official node (sub-group or SSC group) has a hand-typed estimatedDescribed", () => {
    expect(
      nonOfficialWithEstimate,
      `${nonOfficialWithEstimate.length} non-official node(s) still carry estimatedDescribed: ${nonOfficialWithEstimate.join(", ")}`,
    ).toHaveLength(0);
  });
});
