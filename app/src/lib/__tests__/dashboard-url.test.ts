import { describe, it, expect } from "vitest";
import { browseInputToDashboardQuery, browseInputToDashboardUrl } from "../dashboard-url";
import { parseParams } from "@/hooks/useFilterParams";

const params = (input: Parameters<typeof browseInputToDashboardQuery>[0]) =>
  new URLSearchParams(browseInputToDashboardQuery(input));

describe("browseInputToDashboardQuery", () => {
  it("returns empty string when nothing resolves", () => {
    expect(browseInputToDashboardQuery({})).toBe("");
    expect(browseInputToDashboardQuery({ taxa: ["not-a-real-thing!!"] })).toBe("");
  });

  it("maps a featured taxon", () => {
    expect(params({ taxa: ["mammals"] }).get("taxa")).toBe("mammals");
  });

  it("maps a scientific-rank taxon to taxa (no subgroup)", () => {
    const p = params({ taxa: ["felidae"] });
    expect(p.get("taxa")).toBe("felidae");
    expect(p.has("subgroups")).toBe(false);
  });

  it("maps a curated sub-group to subgroups + its display root in taxa", () => {
    const p = params({ taxa: ["sharks-rays"] });
    expect(p.get("subgroups")).toBe("sharks-rays");
    expect(p.get("taxa")).toBe("fishes");
  });

  it("maps a Table-1a group under a virtual root to root + prefixed sub-group", () => {
    // corals species carry taxon_id=invertebrates, so taxa=corals alone matches
    // nothing — the dashboard's working form is invertebrates + inv-corals.
    const p = params({ taxa: ["corals"] });
    expect(p.get("taxa")).toBe("invertebrates");
    expect(p.get("subgroups")).toBe("inv-corals");
  });

  it("resolves category aliases (threatened → CR,EN,VU)", () => {
    expect(params({ taxa: ["mammals"], categories: ["threatened"] }).get("categories")).toBe("CR,EN,VU");
  });

  it("resolves threat aliases (climate-change → 11)", () => {
    expect(params({ taxa: ["corals"], threats: ["climate-change"] }).get("threats")).toBe("11");
  });

  it("expands a region into countries (lossless) and emits no region param", () => {
    const p = params({ taxa: ["amphibians"], region: ["Sub-Saharan Africa"] });
    expect(p.has("region")).toBe(false);
    expect((p.get("countries") ?? "").length).toBeGreaterThan(0);
  });

  it("emits the exact continuous params verbatim", () => {
    const p = params({
      taxa: ["mammals"],
      outdated: "yes",
      minObs: 100, maxObs: 5000,
      minAssessmentYear: 2010, maxAssessmentYear: 2020,
      minDescribedYear: 1990, maxDescribedYear: 2000,
    });
    expect(p.get("outdated")).toBe("yes");
    expect(p.get("minObs")).toBe("100");
    expect(p.get("maxObs")).toBe("5000");
    expect(p.get("minAssessmentYear")).toBe("2010");
    expect(p.get("maxAssessmentYear")).toBe("2020");
    expect(p.get("minDescribedYear")).toBe("1990");
    expect(p.get("maxDescribedYear")).toBe("2000");
  });

  it("joins assessors/reviewers with the dashboard's pipe delimiter", () => {
    const p = params({ taxa: ["mammals"], assessors: ["Smith"], reviewers: ["Jones"] });
    expect(p.get("assessors")).toBe("Smith");
    expect(p.get("reviewers")).toBe("Jones");
  });

  it("emits hasMap / systems / trends", () => {
    const p = params({ taxa: ["mammals"], hasMap: "yes", systems: ["Marine"], trends: ["Decreasing"] });
    expect(p.get("hasMap")).toBe("yes");
    expect(p.get("systems")).toBe("Marine");
    expect(p.get("trends")).toBe("Decreasing");
  });

  it("maps a species lookup to a name search", () => {
    expect(params({ search: "tiger" }).get("search")).toBe("tiger");
  });

  it("prefixes an origin for the absolute URL", () => {
    expect(browseInputToDashboardUrl("https://example.com", { taxa: ["mammals"] }))
      .toBe("https://example.com/?taxa=mammals");
  });
});

// The whole point of the shared translator: what it emits, the dashboard reads
// back into the same filter state — so the agent and the human see one view.
describe("browseInputToDashboardQuery → parseParams round-trip", () => {
  it("round-trips taxa + categories + exact filters", () => {
    const qs = browseInputToDashboardQuery({
      taxa: ["mammals"],
      categories: ["threatened"],
      outdated: "yes",
      minObs: 100,
      minAssessmentYear: 2010,
    });
    const parsed = parseParams(qs);
    expect(parsed.taxa).toEqual(new Set(["mammals"]));
    expect(parsed.categories).toEqual(new Set(["CR", "EN", "VU"]));
    expect(parsed.outdated).toBe("yes");
    expect(parsed.minObs).toBe(100);
    expect(parsed.minAssessmentYear).toBe(2010);
  });

  it("round-trips a region as the same country set the dashboard would hold", () => {
    const qs = browseInputToDashboardQuery({ taxa: ["amphibians"], region: ["Sub-Saharan Africa"] });
    const parsed = parseParams(qs);
    expect(parsed.countries.size).toBeGreaterThan(0);
  });
});
