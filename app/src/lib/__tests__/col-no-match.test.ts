import { describe, it, expect } from "vitest";
import {
  NO_MATCH_REASONS,
  NO_MATCH_REASON_SHORT,
  NO_MATCH_REASON_SUMMARY,
  noMatchSentence,
  noMatchExplanation,
  colTaxonUrl,
} from "@/lib/col-no-match";

// The reason codes themselves come from classifyNoMatch (lib/data/col-breakdown);
// this file is the UI's side of that contract. A new reason added there with no
// wording here would render as a bare snake_case code, which is what these catch.
describe("col-no-match vocabulary", () => {
  it("gives every reason a short label, a summary, and both sentence framings", () => {
    for (const reason of NO_MATCH_REASONS) {
      expect(NO_MATCH_REASON_SHORT[reason], `short label for ${reason}`).toBeTruthy();
      expect(NO_MATCH_REASON_SUMMARY[reason], `summary for ${reason}`).toBeTruthy();
      for (const subject of ["Panthera leo", null]) {
        const sentence = noMatchSentence({ reason, detail: "Panthera tigris" }, subject);
        expect(sentence.before, `${reason} / subject=${subject}`).toBeTruthy();
        // A bare code leaking through means the switch has no case for it.
        expect(sentence.before).not.toBe(reason);
      }
    }
  });

  it("has no short label without a reason code behind it", () => {
    const codes = new Set<string>(NO_MATCH_REASONS);
    for (const key of Object.keys(NO_MATCH_REASON_SHORT)) expect(codes.has(key)).toBe(true);
    for (const key of Object.keys(NO_MATCH_REASON_SUMMARY)) expect(codes.has(key)).toBe(true);
  });

  it("keeps short labels short enough for a chart axis", () => {
    for (const reason of NO_MATCH_REASONS) {
      expect(NO_MATCH_REASON_SHORT[reason].length).toBeLessThanOrEqual(16);
    }
  });

  describe("noMatchSentence", () => {
    it("names the species when it stands alone, and drops it when the UI already does", () => {
      const flag = { reason: "lumped", detail: "Sus scrofa", detailId: 41775 };
      expect(noMatchExplanation(flag, "Sus bucculentus"))
        .toBe("According to Catalogue of Life, Sus bucculentus is the same species as Sus scrofa.");
      expect(noMatchExplanation(flag, null)).toBe("Same species as Sus scrofa");
    });

    it("names the third species two lumped names merged into, when there is one", () => {
      const flag = { reason: "lumped", detail: "Epimyrma ravouxi", colName: "Temnothorax ravouxi" };
      expect(noMatchExplanation(flag, "Epimyrma bernardi")).toBe(
        "According to Catalogue of Life, Epimyrma bernardi is the same species as Epimyrma ravouxi" +
        " — both are now called Temnothorax ravouxi."
      );
    });

    it("keeps the linkable species in its own part, never inlined into the text", () => {
      const s = noMatchSentence({ reason: "infraspecific", detail: "Muntiacus muntjak" }, "Muntiacus montanus");
      expect(s.detail).toBe("Muntiacus muntjak");
      expect(s.before).not.toContain("Muntiacus muntjak");
      expect(s.before).toContain("Muntiacus montanus");
    });

    it("reads as a complete sentence for reasons with no second species", () => {
      expect(noMatchExplanation({ reason: "no_link" }, "Bufo bufo"))
        .toBe("Bufo bufo hasn't been matched to a Catalogue of Life name yet.");
    });

    it("falls back to the raw code rather than rendering undefined", () => {
      expect(noMatchExplanation({ reason: "some_future_reason" }, "Bufo bufo")).toBe("some_future_reason");
    });
  });

  describe("colTaxonUrl", () => {
    it("deep-links to the CoL record the assessment disagrees with", () => {
      expect(colTaxonUrl({ reason: "lumped", colId: "7PST9" }, "Achatinella lila"))
        .toBe("https://www.catalogueoflife.org/data/taxon/7PST9");
    });

    it("falls back to a name search for the one reason with no CoL record", () => {
      expect(colTaxonUrl({ reason: "no_link" }, "Achatinella lila"))
        .toBe("https://www.catalogueoflife.org/data/search?q=Achatinella%20lila");
    });
  });
});
