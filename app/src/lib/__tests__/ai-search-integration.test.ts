import { describe, it, expect } from "vitest";
import { runAiSearch, type AiSearchResult } from "../ai-search";

// =============================================================================
// Integration tests — call the real Gemini API and validate the URL output.
//
// These tests require GEMINI_API_KEY in env and consume API credits.
// Run explicitly with: GEMINI_API_KEY=... npm test -- ai-search-integration
//
// Each test validates:
//   1. A query string was produced (starts with "?")
//   2. Expected URL parameters are present
//   3. Parameter values are valid
// =============================================================================

const API_KEY = process.env.GEMINI_API_KEY;
const describeIfKey = API_KEY ? describe : describe.skip;

/** Parse a query string into a URLSearchParams for easy assertions */
function parseQs(qs: string): URLSearchParams {
  return new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs);
}

/** Helper: assert a param contains at least one of the expected values */
function expectParamContainsAny(
  params: URLSearchParams,
  key: string,
  allowed: string[],
  delimiter = ","
) {
  const raw = params.get(key);
  expect(raw, `Expected param "${key}" to be present`).toBeTruthy();
  const values = raw!.split(delimiter);
  const hasMatch = values.some((v) => allowed.includes(v));
  expect(hasMatch, `"${key}=${raw}" should contain one of: ${allowed.join(", ")}`).toBe(true);
}

// Shared options — lower thinking budget to save tokens
const opts = { thinkingBudget: 1024, maxIterations: 6 };

describeIfKey("AI Search integration (Gemini)", () => {
  // Generous timeout — agentic loop can take 10-30s
  const TIMEOUT = 60_000;

  it("simple: threatened frogs in South America", async () => {
    const result = await runAiSearch(
      "threatened frogs in South America",
      API_KEY!,
      opts,
    );

    console.log("[threatened frogs in SA]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    // Should filter to amphibia
    expectParamContainsAny(params, "taxa", ["amphibia"]);

    // Should have threatened categories (at least one of CR, EN, VU)
    expectParamContainsAny(params, "categories", ["CR", "EN", "VU"]);

    // Should have South American country codes
    const countries = (params.get("countries") || "").split(",");
    const southAmerica = ["AR", "BO", "BR", "CL", "CO", "EC", "PE", "VE", "GY", "SR", "PY", "UY"];
    const hasSA = countries.some((c) => southAmerica.includes(c));
    expect(hasSA, `countries should include South American codes, got: ${countries.join(",")}`).toBe(true);
  }, TIMEOUT);

  it("assessor lookup: plant assessments by Steve Bachman", async () => {
    const result = await runAiSearch(
      "plant assessments by Steve Bachman",
      API_KEY!,
      opts,
    );

    console.log("[Bachman plants]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    // Should filter to plantae
    expectParamContainsAny(params, "taxa", ["plantae"]);

    // Should have used the assessor search tool
    const usedAssessorTool = result.toolCalls.some((tc) => tc.name === "search_assessors");
    expect(usedAssessorTool, "Should have called search_assessors to verify name").toBe(true);

    // Assessors param should contain Bachman in the correct format
    const assessors = params.get("assessors") || "";
    expect(assessors.toLowerCase()).toContain("bachman");
  }, TIMEOUT);

  it("species search: random bird from South Africa — selects exactly one", async () => {
    const result = await runAiSearch(
      "a random bird species from South Africa",
      API_KEY!,
      opts,
    );

    console.log("[random SA bird]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    // Should filter to aves
    expectParamContainsAny(params, "taxa", ["aves"]);

    // Should have used pick_random_species tool
    const usedRandomTool = result.toolCalls.some((tc) => tc.name === "pick_random_species");
    expect(usedRandomTool, "Should have called pick_random_species to select one species").toBe(true);

    // Should have a species=ID parameter selecting exactly one species
    const speciesId = params.get("species");
    expect(speciesId, "Should include species=ID to select exactly one species").toBeTruthy();
    expect(Number(speciesId)).toBeGreaterThan(0);
  }, TIMEOUT);

  it("complex: outdated moth with 100+ new GBIF observations at 50%+ of total", async () => {
    const result = await runAiSearch(
      "an outdated moth species with at least 100 new GBIF observations, comprising over 50% of its total",
      API_KEY!,
      opts,
    );

    console.log("[outdated moth GBIF]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    // Should filter to invertebrates (moths)
    expectParamContainsAny(params, "taxa", ["invertebrates"]);

    // Should have outdated year ranges
    const years = params.get("years") || "";
    expect(years).toMatch(/20\+|11-20/);

    // Should have observation ranges >= 100
    const obsRanges = params.get("obsRanges") || "";
    const hasHighObs = ["101-1K", "1K-10K", "10K+"].some((r) => obsRanges.includes(r));
    expect(hasHighObs, `obsRanges should include 101-1K or higher, got: ${obsRanges}`).toBe(true);

    // Should sort by pctNewGbif to surface high-percentage species
    const sort = params.get("sort");
    expect(sort, "Should sort by pctNewGbif").toBe("pctNewGbif");
  }, TIMEOUT);

  it("handles typos: near tthreatenned frogs in South America", async () => {
    const result = await runAiSearch(
      "near tthreatenned frogs in South America",
      API_KEY!,
      opts,
    );

    console.log("[typo: near threatened frogs]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    // Should still get amphibia
    expectParamContainsAny(params, "taxa", ["amphibia"]);

    // "near threatened" = NT category (or possibly CR,EN,VU,NT if interpreted broadly)
    expectParamContainsAny(params, "categories", ["NT", "CR", "EN", "VU"]);
  }, TIMEOUT);

  it("marine filter: endangered marine mammals", async () => {
    const result = await runAiSearch(
      "endangered marine mammals",
      API_KEY!,
      opts,
    );

    console.log("[marine mammals]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "taxa", ["mammalia"]);
    expectParamContainsAny(params, "categories", ["EN", "CR"]);
    expectParamContainsAny(params, "systems", ["Marine"]);
  }, TIMEOUT);

  it("population trend: declining reptiles in Australia", async () => {
    const result = await runAiSearch(
      "declining reptiles in Australia",
      API_KEY!,
      opts,
    );

    console.log("[declining AU reptiles]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "taxa", ["reptilia"]);
    expectParamContainsAny(params, "trends", ["Decreasing"]);
    const countries = (params.get("countries") || "").split(",");
    expect(countries).toContain("AU");
  }, TIMEOUT);

  // ── Reassessment triage ─────────────────────────────────────────────

  it("triage: outdated species with many new observations sorted by % new", async () => {
    const result = await runAiSearch(
      "old assessments with 10K+ new GBIF observations, sorted by percentage new",
      API_KEY!,
      opts,
    );

    console.log("[triage: outdated + high obs]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    // Should have outdated year ranges
    const years = params.get("years") || "";
    expect(years).toMatch(/20\+|11-20/);

    // Should filter to high observation ranges
    expectParamContainsAny(params, "obsRanges", ["10K+", "1K-10K"]);

    // Should sort by pctNewGbif
    expect(params.get("sort")).toBe("pctNewGbif");
  }, TIMEOUT);

  // ── Data gap identification ─────────────────────────────────────────

  it("data gaps: DD freshwater fish in Southeast Asia", async () => {
    const result = await runAiSearch(
      "data deficient freshwater fish in Southeast Asia",
      API_KEY!,
      opts,
    );

    console.log("[DD freshwater fish SEA]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "taxa", ["fishes"]);
    expectParamContainsAny(params, "categories", ["DD"]);
    expectParamContainsAny(params, "systems", ["Freshwater"]);

    // Should have SE Asian country codes
    const countries = (params.get("countries") || "").split(",");
    const seAsia = ["BN", "ID", "KH", "LA", "MM", "MY", "PH", "SG", "TH", "TL", "VN"];
    const hasSEA = countries.some((c) => seAsia.includes(c));
    expect(hasSEA, `countries should include SE Asian codes, got: ${countries.join(",")}`).toBe(true);
  }, TIMEOUT);

  it("data gaps: DD species with many new observations", async () => {
    const result = await runAiSearch(
      "data deficient species that now have over 1000 GBIF observations",
      API_KEY!,
      opts,
    );

    console.log("[DD with 1K+ obs]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "categories", ["DD"]);
    expectParamContainsAny(params, "obsRanges", ["1K-10K", "10K+"]);
  }, TIMEOUT);

  it("data gaps: species with zero observations", async () => {
    const result = await runAiSearch(
      "species with no GBIF observations at all",
      API_KEY!,
      opts,
    );

    console.log("[zero obs]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "obsRanges", ["0"]);
  }, TIMEOUT);

  // ── Threat-focused queries ──────────────────────────────────────────

  it("threats: species threatened by agriculture in South America", async () => {
    const result = await runAiSearch(
      "species threatened by agriculture in the Amazon",
      API_KEY!,
      opts,
    );

    console.log("[agriculture Amazon]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    // Threat code 2 = Agriculture (or sub-codes 2.1, 2.2, 2.3, 2.4)
    const threats = (params.get("threats") || "").split(",");
    const hasAgri = threats.some((t) => t === "2" || t.startsWith("2."));
    expect(hasAgri, `threats should include agriculture codes, got: ${threats.join(",")}`).toBe(true);

    // Should include SA country codes (Amazon region)
    const countries = (params.get("countries") || "").split(",");
    const amazonCountries = ["BR", "CO", "PE", "EC", "BO", "VE", "GY", "SR", "GF"];
    const hasAmazon = countries.some((c) => amazonCountries.includes(c));
    expect(hasAmazon, `countries should include Amazon-region codes`).toBe(true);
  }, TIMEOUT);

  it("threats: mammals threatened by hunting in Central Africa", async () => {
    const result = await runAiSearch(
      "mammals threatened by hunting in Central Africa",
      API_KEY!,
      opts,
    );

    console.log("[hunting Central Africa]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "taxa", ["mammalia"]);

    // Threat 5.1 = Hunting & trapping, or 5 = Harvesting
    const threats = (params.get("threats") || "").split(",");
    const hasHunting = threats.some((t) => t === "5" || t === "5.1");
    expect(hasHunting, `threats should include hunting codes, got: ${threats.join(",")}`).toBe(true);
  }, TIMEOUT);

  // ── Category change candidates ──────────────────────────────────────

  it("category change: NT species with declining populations", async () => {
    const result = await runAiSearch(
      "near threatened species with declining populations",
      API_KEY!,
      opts,
    );

    console.log("[NT declining]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "categories", ["NT"]);
    expectParamContainsAny(params, "trends", ["Decreasing"]);
  }, TIMEOUT);

  // ── Explore & discover ──────────────────────────────────────────────

  it("explore: extinct in the wild species", async () => {
    const result = await runAiSearch(
      "extinct in the wild species",
      API_KEY!,
      opts,
    );

    console.log("[EW species]", result.queryString, "|", result.explanation);
    logToolCalls(result);

    const params = parseQs(result.queryString);
    expect(result.queryString).toMatch(/^\?/);

    expectParamContainsAny(params, "categories", ["EW"]);
  }, TIMEOUT);
});

function logToolCalls(result: AiSearchResult) {
  if (result.toolCalls.length === 0) {
    console.log("  (no tool calls)");
    return;
  }
  for (const tc of result.toolCalls) {
    const argsStr = JSON.stringify(tc.args);
    const resultPreview = tc.result.length > 100 ? tc.result.slice(0, 100) + "…" : tc.result;
    console.log(`  → ${tc.name}(${argsStr}) => ${resultPreview}`);
  }
}
