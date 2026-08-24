import { describe, it, expect } from "vitest";
import {
  REVISION_REASONS,
  UNFLAGGED_REASONS,
  REVISION_REASON_SHORT,
  REVISION_REASON_SUMMARY,
  SPLIT_REASON,
  isFlagged,
  revisionReasons,
  matchesRevisionFilter,
  noMatchSentence,
  noMatchExplanation,
  splitSentence,
  splitSummary,
  lumpSummary,
  flattenSummary,
  revisionSentences,
  colTaxonUrl,
  type ColRevision,
  newRevisionTally,
  tallyRevision,
  barTotal,
} from "@/lib/col-revision";

// The no-match reason codes come from classifyNoMatch (lib/data/col-breakdown);
// this file is the UI's side of that contract. A new reason added there with no
// wording here would render as a bare snake_case code, which is what these catch.
describe("revision vocabulary", () => {
  // Wording must cover the reasons the dashboard flags AND the ones it only
  // diagnoses — the SSC group view still renders those.
  const ALL_REASONS = [...REVISION_REASONS, ...UNFLAGGED_REASONS];

  it("gives every reason a short label, a summary, and both sentence framings", () => {
    for (const reason of ALL_REASONS) {
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
    const codes = new Set<string>(ALL_REASONS);
    for (const key of Object.keys(REVISION_REASON_SHORT)) expect(codes.has(key)).toBe(true);
    for (const key of Object.keys(REVISION_REASON_SUMMARY)) expect(codes.has(key)).toBe(true);
  });

  it("keeps short labels short enough for a chart axis", () => {
    for (const reason of ALL_REASONS) {
      expect(REVISION_REASON_SHORT[reason].length).toBeLessThanOrEqual(16);
    }
  });
});

describe("UNFLAGGED_REASONS", () => {
  it("keeps extinct_unconfirmed out of the dashboard's bars", () => {
    // Not a taxonomic revision, and mostly a CoL data error — 25 of the 60 it
    // caught were Least Concern or Near Threatened. See UNFLAGGED_REASONS.
    expect(UNFLAGGED_REASONS).toContain("extinct_unconfirmed");
    expect(REVISION_REASONS as readonly string[]).not.toContain("extinct_unconfirmed");
  });

  it("still gives it wording, since the SSC group view reports it", () => {
    expect(noMatchExplanation({ reason: "extinct_unconfirmed" }, "Columba arquatrix"))
      .toContain("flagged extinct");
  });
});

describe("isFlagged / revisionReasons", () => {
  it("treats the two signals as independent, and a species with both as belonging to both bars", () => {
    expect(revisionReasons({ reason: "lumped" })).toEqual(["lumped"]);
    expect(revisionReasons({ splitInto: [{ name: "Aepyceros petersi" }] })).toEqual([SPLIT_REASON]);
    expect(revisionReasons({ reason: "lumped", splitInto: [{ name: "Leptoxis coosaensis" }] }))
      .toEqual([SPLIT_REASON, "lumped"]);
    // Derived from the group as well, which is how the dashboard ships it.
    expect(revisionReasons({ lumpedWith: [{ name: "Dasycercus hillieri" }] })).toEqual(["lumped"]);
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

  it("does not promise the checklist will add a name it has declined", () => {
    // "hasn't added it yet" implied a backlog; most of these are old names in
    // genera the checklist covers thoroughly. See noMatchSentence's not_in_base.
    const sentence = noMatchExplanation({ reason: "not_in_base" }, "Euphorbia ankarensis");
    expect(sentence).not.toContain("yet");
    expect(sentence).toContain("extended release");
  });

  it("falls back to the raw code rather than rendering undefined", () => {
    expect(noMatchExplanation({ reason: "some_future_reason" }, "Bufo bufo")).toBe("some_future_reason");
  });
});

describe("splitSummary", () => {
  const vallonia = {
    colId: "7FDLW",
    splitInto: [
      { name: "Vallonia gracilicosta", colId: "7FDMB", previousName: "Vallonia costata var. montana Sterki, 1893", previousColId: "7V9Y8" },
      { name: "Vallonia parvula", colId: "7TKP7", previousName: "Vallonia costata var. minor Sterki, 1893", previousColId: "7V9Y7" },
      { name: "Vallonia patens", colId: "7TKP8", previousName: "Vallonia costata var. amurensis Sterki in Pilsbry, 1893", previousColId: "7V9Y5" },
    ],
  };

  it("is null when there are no splits", () => {
    expect(splitSummary({ reason: "lumped" }, "Sus scrofa")).toBeNull();
    expect(splitSummary({ splitInto: [] }, "Sus scrofa")).toBeNull();
  });

  it("leads with what the split means for the assessment", () => {
    expect(splitSummary(vallonia, "Vallonia costata")!.lead).toBe(
      "Catalogue of Life suggests Vallonia costata has been split into 4 separate species," +
      " so this assessment may cover populations now assigned to the others:"
    );
  });

  it("says 'the other species' when there is only one", () => {
    const lead = splitSummary({ splitInto: [{ name: "Aepyceros petersi" }] }, "Aepyceros melampus")!.lead;
    expect(lead).toContain("split into 2 separate species");
    expect(lead.endsWith("now assigned to the other species:")).toBe(true);
  });

  it("counts the species the old concept split into, but lists only the others", () => {
    // "split into 4" while listing 3 is right — the assessed species is the
    // fourth, and "the others" at the end of the lead is what says so.
    const entries = splitSummary(vallonia, "Vallonia costata")!.entries;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name)).toEqual(["Vallonia gracilicosta", "Vallonia parvula", "Vallonia patens"]);
  });

  it("carries the old name behind each split in full, with its own CoL record", () => {
    // This is the evidence, and CoL only shows it from the NEW species' page —
    // so the tooltip has to carry it or the claim can't be checked by hand.
    const first = splitSummary(vallonia, "Vallonia costata")!.entries[0];
    expect(first.previousName).toBe("Vallonia costata var. montana Sterki, 1893");
    expect(first.previousColId).toBe("7V9Y8");
  });

  it("lists every split-off species, however long the tail", () => {
    // Rubus fruticosus has 73. The tooltip pages through them rather than the
    // list standing in for names it doesn't show.
    const names = Array.from({ length: 73 }, (_, i) => ({ name: `Rubus sp${i}` }));
    const summary = splitSummary({ splitInto: names }, "Rubus fruticosus")!;
    expect(summary.lead).toContain("split into 74 separate species");
    expect(summary.entries).toHaveLength(73);
  });

  it("hedges both the heuristic and its consequence", () => {
    const lead = splitSummary(vallonia, "Vallonia costata")!.lead;
    expect(lead).toContain("suggests");
    expect(lead).toContain("may cover");
  });

  it("flattens to a single string for contexts that can't hold links", () => {
    const flat = splitSentence(vallonia, "Vallonia costata")!;
    expect(flat).toContain("Vallonia gracilicosta (previously Vallonia costata var. montana Sterki, 1893)");
    expect(flat).not.toContain("unchanged");
  });
});

describe("lumpSummary", () => {
  const sus = {
    reason: "lumped", detail: "Sus scrofa", colId: "53HGR", lumpedUnder: "Sus scrofa",
    lumpedWith: [{ name: "Sus scrofa", category: "LC" }],
  };
  const limonium = {
    reason: "lumped", colId: "X", lumpedUnder: "Limonium roridum",
    lumpedWith: [
      { name: "Limonium dolihiense", colId: "72DMW", category: "EN" },
      { name: "Limonium helenae", colId: "72DP8", category: "EN" },
    ],
  };

  it("is null unless the flag is a lump with its group known", () => {
    expect(lumpSummary({ splitInto: [{ name: "A" }] }, "X")).toBeNull();
    // The SSC panel's data carries only the tie-break winner, so callers there
    // fall back to noMatchSentence rather than rendering an empty list.
    expect(lumpSummary({ reason: "lumped", detail: "Sus scrofa" }, "Sus bucculentus")).toBeNull();
  });

  it("says how many assessments describe one CoL species, and what it is called", () => {
    expect(lumpSummary(sus, "Sus bucculentus")!.lead).toBe(
      "Catalogue of Life treats Sus bucculentus and 1 other IUCN assessment as a single species," +
      " Sus scrofa — so more than one assessment covers what Catalogue of Life counts as one species:"
    );
    expect(lumpSummary(limonium, "Limonium chersonesum")!.lead)
      .toContain("and 2 other IUCN assessments as a single species, Limonium roridum");
  });

  it("lists the other assessments, not the species itself", () => {
    const entries = lumpSummary(limonium, "Limonium chersonesum")!.entries;
    expect(entries.map((e) => e.name)).toEqual(["Limonium dolihiense", "Limonium helenae"]);
    expect(entries.map((e) => e.name)).not.toContain("Limonium chersonesum");
  });

  it("carries each member's own CoL record and IUCN category", () => {
    // The category is where the awkwardness shows — one CoL species assessed
    // both Extinct and Least Concern.
    const [first] = lumpSummary(limonium, "Limonium chersonesum")!.entries;
    expect(first.colId).toBe("72DMW");
    expect(first.category).toBe("EN");
    expect(flattenSummary(lumpSummary(sus, "Sus bucculentus"))).toContain("Sus scrofa (LC)");
  });

  it("copes with an accepted name the group does not contain", () => {
    // Limonium roridum is CoL's name for the group; none of the 15 assessed
    // species is called that.
    expect(lumpSummary(limonium, "Limonium chersonesum")!.lead).toContain("Limonium roridum");
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
    // With the group known, the lump half becomes the richer list instead.
    const withGroup = revisionSentences(
      { reason: "lumped", detail: "Leptoxis picta", lumpedUnder: "Leptoxis picta",
        lumpedWith: [{ name: "Leptoxis picta", category: "EX" }] },
      "Leptoxis foremani",
    );
    expect(withGroup[0]).toContain("as a single species, Leptoxis picta");
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

  it("partitions species into flagged and clean, with nothing lost", () => {
    const flags = [
      { reason: "no_link" },
      { splitInto: [{ name: "A" }] },
      { lumpedWith: [{ name: "B" }] },
      null,
      { splitInto: [] },
    ];
    const t = tally(flags);
    expect(t.flagged + t.clean).toBe(flags.length);
    expect(t.flagged).toBe(3);
  });

  it("counts a species in every bar it belongs to, over-totalling by exactly multiSignal", () => {
    const t = tally([
      { reason: "no_link" },
      { lumpedWith: [{ name: "B" }] },
      { lumpedWith: [{ name: "B" }], splitInto: [{ name: "C" }] }, // two signals
      { reason: "not_in_base", splitInto: [{ name: "D" }] },       // two signals
    ]);
    expect(t.counts).toEqual({ no_link: 1, lumped: 2, split: 2, not_in_base: 1 });
    expect(t.multiSignal).toBe(2);
    expect(barTotal(t)).toBe(t.flagged + t.multiSignal);
  });

  it("makes each bar's count equal what selecting that reason returns", () => {
    // The invariant a strict partition would have broken.
    const flags = [
      { reason: "no_link" },
      { lumpedWith: [{ name: "B" }] },
      { lumpedWith: [{ name: "B" }], splitInto: [{ name: "C" }] },
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
    expect(t).toEqual({ counts: {}, flagged: 0, clean: 3, multiSignal: 0 });
  });
});

describe("lumping is symmetric", () => {
  // CoL's 347N2 is both Dasycercus cristicauda (EX) and Dasycercus hillieri
  // (LC). Only hillieri used to be flagged, because it matched by synonym while
  // cristicauda matched by accepted name — a tie-break, not a taxonomic fact.
  const cristicauda: ColRevision = { colId: "347N2", lumpedUnder: "Dasycercus cristicauda",
    lumpedWith: [{ name: "Dasycercus hillieri", category: "LC" }] };
  const hillieri: ColRevision = { colId: "347N2", lumpedUnder: "Dasycercus cristicauda",
    lumpedWith: [{ name: "Dasycercus cristicauda", category: "EX" }] };

  it("flags both members, not just the one that lost the tie-break", () => {
    expect(isFlagged(cristicauda)).toBe(true);
    expect(isFlagged(hillieri)).toBe(true);
  });

  it("puts both in the lumped bar without either carrying a no-match reason", () => {
    expect(revisionReasons(cristicauda)).toEqual(["lumped"]);
    expect(revisionReasons(hillieri)).toEqual(["lumped"]);
    expect(cristicauda.reason).toBeUndefined();
  });

  it("selects both when the lumped bar is clicked", () => {
    const sel = new Set(["lumped"]);
    expect(matchesRevisionFilter(cristicauda, null, sel)).toBe(true);
    expect(matchesRevisionFilter(hillieri, null, sel)).toBe(true);
  });

  it("names CoL's species only when it isn't the subject already", () => {
    // cristicauda IS the accepted name, so repeating it would say nothing.
    expect(lumpSummary(cristicauda, "Dasycercus cristicauda")!.lead)
      .toContain("as a single species — so more than one");
    expect(lumpSummary(hillieri, "Dasycercus hillieri")!.lead)
      .toContain("as a single species, Dasycercus cristicauda —");
  });

  it("describes each from its own side", () => {
    expect(lumpSummary(cristicauda, "Dasycercus cristicauda")!.entries[0].name).toBe("Dasycercus hillieri");
    expect(lumpSummary(hillieri, "Dasycercus hillieri")!.entries[0].name).toBe("Dasycercus cristicauda");
  });
});
