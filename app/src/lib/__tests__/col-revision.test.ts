import { describe, it, expect } from "vitest";
import {
  REVISION_REASONS,
  REVISION_REASON_SHORT,
  REVISION_REASON_SUMMARY,
  SPLIT_REASON,
  isFlagged,
  revisionReasons,
  matchesRevisionFilter,
  noMatchSentence,
  noMatchExplanation,
  splitSentence,
  revisionSentences,
  colTaxonUrl,
  newRevisionTally,
  tallyRevision,
} from "@/lib/col-revision";

// The no-match reason codes come from classifyNoMatch (lib/data/col-breakdown);
// this file is the UI's side of that contract. A new reason added there with no
// wording here would render as a bare snake_case code, which is what these catch.
describe("revision vocabulary", () => {
  it("gives every reason a short label, a summary, and both sentence framings", () => {
    for (const reason of REVISION_REASONS) {
      expect(REVISION_REASON_SHORT[reason], `short label for ${reason}`).toBeTruthy();
      expect(REVISION_REASON_SUMMARY[reason], `summary for ${reason}`).toBeTruthy();
      if (reason === SPLIT_REASON) continue; // not a noMatchSentence case — see splitSentence
      for (const subject of ["Panthera leo", null]) {
        const sentence = noMatchSentence({ reason, detail: "Panthera tigris" }, subject);
        expect(sentence.before, `${reason} / subject=${subject}`).toBeTruthy();
        expect(sentence.before).not.toBe(reason); // a bare code = no case in the switch
      }
    }
  });

  it("has no label without a reason code behind it", () => {
    const codes = new Set<string>(REVISION_REASONS);
    for (const key of Object.keys(REVISION_REASON_SHORT)) expect(codes.has(key)).toBe(true);
    for (const key of Object.keys(REVISION_REASON_SUMMARY)) expect(codes.has(key)).toBe(true);
  });

  it("keeps short labels short enough for a chart axis", () => {
    for (const reason of REVISION_REASONS) {
      expect(REVISION_REASON_SHORT[reason].length).toBeLessThanOrEqual(16);
    }
  });
});

describe("isFlagged / revisionReasons", () => {
  it("treats the two signals as independent, and a species with both as belonging to both bars", () => {
    expect(revisionReasons({ reason: "lumped" })).toEqual(["lumped"]);
    expect(revisionReasons({ splitInto: [{ name: "Aepyceros petersi" }] })).toEqual([SPLIT_REASON]);
    expect(revisionReasons({ reason: "lumped", splitInto: [{ name: "Leptoxis coosaensis" }] }))
      .toEqual([SPLIT_REASON, "lumped"]);
  });

  it("is unflagged for no flag, and for a flag carrying neither signal", () => {
    expect(isFlagged(null)).toBe(false);
    expect(isFlagged(undefined)).toBe(false);
    // An empty splitInto must not flag a species — build-col-revisions omits the
    // key entirely, but a hand-written or future-encoded entry might not.
    expect(isFlagged({ splitInto: [] })).toBe(false);
    expect(isFlagged({ colId: "ABC" })).toBe(false);
    expect(isFlagged({ reason: "no_link" })).toBe(true);
    expect(isFlagged({ splitInto: [{ name: "Aepyceros petersi" }] })).toBe(true);
  });
});

describe("matchesRevisionFilter", () => {
  const lumped = { reason: "lumped", detail: "Sus scrofa" };
  const split = { splitInto: [{ name: "Aepyceros petersi" }] };
  const both = { reason: "lumped", splitInto: [{ name: "Leptoxis coosaensis" }] };
  const none = null;
  const no = new Set<string>();

  it("passes everything when nothing is selected", () => {
    for (const f of [lumped, split, both, none]) expect(matchesRevisionFilter(f, null, no)).toBe(true);
  });

  it("splits the world in two on the coarse toggle", () => {
    for (const f of [lumped, split, both]) {
      expect(matchesRevisionFilter(f, "flagged", no)).toBe(true);
      expect(matchesRevisionFilter(f, "clean", no)).toBe(false);
    }
    expect(matchesRevisionFilter(none, "flagged", no)).toBe(false);
    expect(matchesRevisionFilter(none, "clean", no)).toBe(true);
  });

  it("matches a species under every reason it carries", () => {
    expect(matchesRevisionFilter(both, null, new Set(["lumped"]))).toBe(true);
    expect(matchesRevisionFilter(both, null, new Set([SPLIT_REASON]))).toBe(true);
    expect(matchesRevisionFilter(split, null, new Set(["lumped"]))).toBe(false);
    expect(matchesRevisionFilter(lumped, null, new Set([SPLIT_REASON]))).toBe(false);
  });

  it("ORs multiple selected reasons", () => {
    const sel = new Set(["lumped", "no_link"]);
    expect(matchesRevisionFilter(lumped, null, sel)).toBe(true);
    expect(matchesRevisionFilter({ reason: "no_link" }, null, sel)).toBe(true);
    expect(matchesRevisionFilter({ reason: "provisional" }, null, sel)).toBe(false);
  });

  it("lets a reason selection win over the coarse toggle rather than contradicting it", () => {
    // A reason implies flagged, so "clean" + a reason must not cancel out to
    // "nothing matches" — the UI clears reasons when leaving flagged, and this
    // is the belt-and-braces half of that.
    expect(matchesRevisionFilter(lumped, "clean", new Set(["lumped"]))).toBe(true);
    expect(matchesRevisionFilter(none, "clean", new Set(["lumped"]))).toBe(false);
  });
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

describe("splitSentence", () => {
  const flat = (flag: Parameters<typeof splitSentence>[0], subject: string) => {
    const s = splitSentence(flag, subject);
    return s && `${s.before}${s.names.map((n) => n.name).join(", ")}${s.after}`;
  };

  it("is null when there are no splits", () => {
    expect(splitSentence({ reason: "lumped" }, "Sus scrofa")).toBeNull();
    expect(splitSentence({ splitInto: [] }, "Sus scrofa")).toBeNull();
  });

  it("leads with what the split means for the assessment", () => {
    const sentence = flat({ splitInto: [{ name: "Aepyceros petersi" }] }, "Aepyceros melampus")!;
    expect(sentence).toBe(
      "Catalogue of Life suggests Aepyceros melampus has been split into 2 separate species" +
      " — so this assessment may cover populations now assigned to Aepyceros petersi."
    );
  });

  it("counts the species the old concept split INTO, parent included", () => {
    // The names listed are the OTHERS, so "split into 4" while listing 3 is
    // correct — saying "split into 3" would quietly drop the species itself.
    expect(flat({ splitInto: [{ name: "A" }, { name: "B" }, { name: "C" }] }, "X"))
      .toContain("split into 4 separate species");
    expect(flat({ splitInto: [{ name: "A" }] }, "X")).toContain("split into 2 separate species");
  });

  it("summarises the tail rather than listing 73 brambles", () => {
    const names = Array.from({ length: 73 }, (_, i) => ({ name: `Rubus sp${i}` }));
    const sentence = flat({ splitInto: names }, "Rubus fruticosus")!;
    expect(sentence).toContain("split into 74 separate species");
    expect(sentence).toContain("Rubus sp0, Rubus sp1, Rubus sp2, and 70 more.");
    expect(sentence).not.toContain("Rubus sp3,");
  });

  it("keeps each split-off species as its own value, so it can be linked", () => {
    const s = splitSentence({ splitInto: [{ name: "Alcelaphus cokii", colId: "L7YRS" }] }, "Alcelaphus buselaphus")!;
    expect(s.names).toEqual([{ name: "Alcelaphus cokii", colId: "L7YRS" }]);
    expect(s.before).not.toContain("Alcelaphus cokii");
  });

  it("hedges both the heuristic and its consequence", () => {
    const sentence = flat({ splitInto: [{ name: "Aepyceros petersi" }] }, "Aepyceros melampus")!;
    expect(sentence).toContain("suggests");
    expect(sentence).toContain("may cover");
  });

  it("names the subject in the sentence, so the UI can link it to its own CoL record", () => {
    const s = splitSentence({ splitInto: [{ name: "Aepyceros petersi" }] }, "Aepyceros melampus")!;
    expect(s.before).toContain("Aepyceros melampus");
  });
});

describe("revisionSentences", () => {
  it("returns one sentence per signal, no-match first", () => {
    expect(revisionSentences({ reason: "no_link" }, "Bufo bufo")).toHaveLength(1);
    expect(revisionSentences({ splitInto: [{ name: "Bufo spinosus" }] }, "Bufo bufo")).toHaveLength(1);
    const both = revisionSentences(
      { reason: "lumped", detail: "Leptoxis picta", splitInto: [{ name: "Leptoxis coosaensis" }] },
      "Leptoxis foremani",
    );
    expect(both).toHaveLength(2);
    expect(both[0]).toContain("is the same species as Leptoxis picta");
    expect(both[1]).toContain("Leptoxis coosaensis");
    expect(both[1]).toContain("has been split into");
  });

  it("returns nothing for a flag carrying neither signal", () => {
    expect(revisionSentences({ colId: "ABC" }, "Bufo bufo")).toEqual([]);
  });
});

describe("colTaxonUrl", () => {
  it("deep-links to the CoL record the flag is about", () => {
    expect(colTaxonUrl({ reason: "lumped", colId: "7PST9" }, "Achatinella lila"))
      .toBe("https://www.catalogueoflife.org/data/taxon/7PST9");
    expect(colTaxonUrl({ splitInto: [{ name: "Aepyceros petersi" }], colId: "64ZMM" }, "Aepyceros melampus"))
      .toBe("https://www.catalogueoflife.org/data/taxon/64ZMM");
  });

  it("falls back to a name search for the one reason with no CoL record", () => {
    expect(colTaxonUrl({ reason: "no_link" }, "Achatinella lila"))
      .toBe("https://www.catalogueoflife.org/data/search?q=Achatinella%20lila");
  });
});

// The bars deliberately do not partition the flagged set (see RevisionTally).
// That's only defensible if the arithmetic the card prints is exactly right, so
// the identity is pinned here rather than trusted.
describe("RevisionTally", () => {
  const tally = (flags: Parameters<typeof tallyRevision>[1][]) => {
    const t = newRevisionTally();
    for (const f of flags) tallyRevision(t, f);
    return t;
  };

  it("keeps noMatch + split - both === flagged, the identity the card prints", () => {
    const t = tally([
      { reason: "lumped" },
      { reason: "infraspecific" },
      { splitInto: [{ name: "A" }] },
      { splitInto: [{ name: "B" }] },
      { splitInto: [{ name: "C" }] },
      { reason: "lumped", splitInto: [{ name: "D" }] },   // both
      { reason: "no_link", splitInto: [{ name: "E" }] },  // both
      null,
      undefined,
      { splitInto: [] },                        // carries nothing
    ]);
    expect(t.noMatch).toBe(4);
    expect(t.split).toBe(5);
    expect(t.both).toBe(2);
    expect(t.flagged).toBe(7);
    expect(t.noMatch + t.split - t.both).toBe(t.flagged);
  });

  it("partitions species into flagged and clean, with nothing lost", () => {
    const flags = [{ reason: "lumped" }, { splitInto: [{ name: "A" }] }, null, { splitInto: [] }, { reason: "no_link", splitInto: [{ name: "B" }] }];
    const t = tally(flags);
    expect(t.flagged + t.clean).toBe(flags.length);
  });

  it("counts a species in every bar it belongs to, so the bars over-total by exactly `both`", () => {
    const t = tally([{ reason: "lumped" }, { reason: "lumped", splitInto: [{ name: "D" }] }, { splitInto: [{ name: "E" }] }]);
    expect(t.counts).toEqual({ lumped: 2, split: 2 });
    const barSum = Object.values(t.counts).reduce((a, b) => a + b, 0);
    expect(barSum).toBe(t.flagged + t.both);
  });

  it("makes each bar's count equal what selecting that reason returns — the invariant a strict partition would have broken", () => {
    const flags = [
      { reason: "lumped" },
      { reason: "lumped", splitInto: [{ name: "D" }] },
      { splitInto: [{ name: "E" }] },
      { reason: "no_link" },
      null,
    ];
    const t = tally(flags);
    for (const reason of Object.keys(t.counts)) {
      const selected = flags.filter((f) => matchesRevisionFilter(f, null, new Set([reason])));
      expect(selected.length, `bar "${reason}" must select exactly what it counts`).toBe(t.counts[reason]);
    }
  });

  it("counts nothing for an all-clean set", () => {
    const t = tally([null, undefined, { colId: "X" }]);
    expect(t).toEqual({ counts: {}, flagged: 0, clean: 3, noMatch: 0, split: 0, both: 0 });
  });
});
