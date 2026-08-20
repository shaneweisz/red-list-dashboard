import { describe, it, expect } from "vitest";
import {
  NO_MATCH_REASONS,
  NO_MATCH_REASON_SHORT,
  NO_MATCH_REASON_SUMMARY,
  NO_MATCH_REASON_LABEL,
  noMatchExplanation,
} from "@/lib/col-no-match";

// The reason codes themselves come from classifyNoMatch (lib/data/col-breakdown);
// this file is the UI's side of that contract. A new reason added there with no
// label here would render as a bare snake_case code in a chart axis, which is the
// failure these tests exist to catch.
describe("col-no-match vocabulary", () => {
  it("labels every reason code, three ways", () => {
    for (const reason of NO_MATCH_REASONS) {
      expect(NO_MATCH_REASON_SHORT[reason], `short label for ${reason}`).toBeTruthy();
      expect(NO_MATCH_REASON_SUMMARY[reason], `summary for ${reason}`).toBeTruthy();
      expect(NO_MATCH_REASON_LABEL[reason], `long label for ${reason}`).toBeTruthy();
    }
  });

  it("has no label without a reason code behind it", () => {
    const codes = new Set<string>(NO_MATCH_REASONS);
    for (const key of Object.keys(NO_MATCH_REASON_LABEL)) expect(codes.has(key)).toBe(true);
    for (const key of Object.keys(NO_MATCH_REASON_SHORT)) expect(codes.has(key)).toBe(true);
  });

  it("keeps short labels short enough for a chart axis", () => {
    for (const reason of NO_MATCH_REASONS) {
      expect(NO_MATCH_REASON_SHORT[reason].length).toBeLessThanOrEqual(16);
    }
  });

  describe("noMatchExplanation", () => {
    it("appends the species a lumped/demoted name points at", () => {
      expect(noMatchExplanation({ reason: "lumped", detail: "Sus scrofa", detailId: 41775 }))
        .toBe(`${NO_MATCH_REASON_LABEL.lumped} Sus scrofa`);
      expect(noMatchExplanation({ reason: "infraspecific", detail: "Arctocephalus philippii" }))
        .toBe(`${NO_MATCH_REASON_LABEL.infraspecific} Arctocephalus philippii`);
    });

    it("reads as a complete sentence for reasons with no second species", () => {
      expect(noMatchExplanation({ reason: "no_link" })).toBe(NO_MATCH_REASON_LABEL.no_link);
    });

    it("falls back to the raw code rather than rendering undefined", () => {
      expect(noMatchExplanation({ reason: "some_future_reason" })).toBe("some_future_reason");
    });
  });
});
