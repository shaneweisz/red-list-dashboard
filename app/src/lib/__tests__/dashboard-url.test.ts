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

  it("emits taxa as a single flat token list (no subgroups param)", () => {
    // The dashboard's parseParams expands these tokens (corals → invertebrates +
    // inv-corals) — see the round-trip below. A dynamic id (fishes' live
    // class-level drilldown — sharks-rays was retired as a static node in
    // Phase 8) is likewise one token, emitted in the short URL form: the rank
    // labels are recoverable from position, so they aren't written.
    expect(params({ taxa: ["fishes~class:chondrichthyes"] }).get("taxa")).toBe("fishes~chondrichthyes");
    const p = params({ taxa: ["corals"] });
    expect(p.get("taxa")).toBe("corals");
    expect(p.has("subgroups")).toBe(false);
  });

  it("resolves category aliases (threatened → CR,EN,VU)", () => {
    expect(params({ taxa: ["mammals"], categories: ["threatened"] }).get("categories")).toBe("CR,EN,VU");
  });

  it("resolves threat aliases (climate-change → 11)", () => {
    expect(params({ taxa: ["corals"], threats: ["climate-change"] }).get("threats")).toBe("11");
  });

  // The dashboard's Threats chart scopes itself (and a threat selection) to
  // threatened species by default; /browse and MCP don't, so a link carrying
  // threats has to opt out or it would show a strictly smaller set than the
  // answer it was generated from.
  it("opts out of the dashboard's threatened-only threat scope", () => {
    expect(params({ taxa: ["corals"], threats: ["climate-change"] }).get("threatsScope")).toBe("all");
    expect(params({ taxa: ["corals"] }).has("threatsScope")).toBe(false);
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

  it("joins assessors/reviewers/facilitators with the dashboard's pipe delimiter", () => {
    const p = params({ taxa: ["mammals"], assessors: ["Smith"], reviewers: ["Jones"], facilitators: ["Rutherford"] });
    expect(p.get("assessors")).toBe("Smith");
    expect(p.get("reviewers")).toBe("Jones");
    expect(p.get("facilitators")).toBe("Rutherford");
  });

  it("emits systems / trends", () => {
    const p = params({ taxa: ["mammals"], systems: ["Marine"], trends: ["Decreasing"] });
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

  it("a flat group token expands to the dashboard's root + sub-group selection", () => {
    // The agent emits taxa=corals; the dashboard expands it to the working
    // invertebrates + inv-corals — so the link reproduces the same view.
    const qs = browseInputToDashboardQuery({ taxa: ["corals"] });
    expect(qs).toBe("?taxa=corals");
    const parsed = parseParams(qs);
    expect(parsed.taxa).toEqual(new Set(["invertebrates"]));
    expect(parsed.subgroups).toEqual(new Set(["inv-corals"]));
  });
});

describe("browseInputToDashboardQuery emits the short taxon token", () => {
  // This is the link /browse and /api/mcp hand back to a person or an agent — the
  // most-shared URL the app produces. resolveTaxa returns INTERNAL node ids, which
  // spell out the pl-/inv-/fu- prefix and every rank label, so emitting them raw
  // produced the long form the address bar no longer uses. Both still resolve; this
  // is about the two staying in step.
  it.each([
    [["mammals~order:rodentia"], "mammals~rodentia"],
    [["mammals~rodentia"], "mammals~rodentia"],
    [["flowering_plants~dioscoreales~dioscoreaceae"], "flowering_plants~dioscoreales~dioscoreaceae"],
    [["sharks"], "fishes~chondrichthyes"], // alias that resolves to a dynamic id
    [["corals"], "corals"],
  ])("%j -> taxa=%s", (taxa, expected) => {
    expect(params({ taxa }).get("taxa")).toBe(expected);
  });

  it("writes ~ and , bare rather than percent-encoded", () => {
    const qs = browseInputToDashboardQuery({ taxa: ["mammals~order:rodentia"], countries: ["BR", "PE"] });
    expect(qs).toContain("taxa=mammals~rodentia");
    expect(qs).toContain("countries=BR,PE");
    expect(qs).not.toContain("%7E");
    expect(qs).not.toContain("%3A");
    expect(qs).not.toContain("%2C");
  });

  // The point of the short form is that the dashboard reads it back to the same node.
  it("round-trips through parseParams to the internal id", () => {
    const qs = browseInputToDashboardQuery({ taxa: ["flowering_plants~dioscoreales~dioscoreaceae"] });
    expect([...parseParams(qs).subgroups]).toEqual(["pl-flowering_plants~order:dioscoreales~family:dioscoreaceae"]);
  });
});
