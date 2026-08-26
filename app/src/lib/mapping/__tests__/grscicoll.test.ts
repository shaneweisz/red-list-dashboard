import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchInstitutionName, knownInstitutionName, resetInstitutionNames } from "../grscicoll";

const KEY = "0e919a55-08d3-4bd2-aec1-200858fafd92";

describe("fetchInstitutionName", () => {
  beforeEach(() => resetInstitutionNames());
  afterEach(() => vi.unstubAllGlobals());

  it("names the holder GBIF only identifies by key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: "Naturalis Biodiversity Center" }),
    })));
    expect(await fetchInstitutionName(KEY)).toBe("Naturalis Biodiversity Center");
    expect(knownInstitutionName(KEY)).toBe("Naturalis Biodiversity Center");
  });

  it("asks once per institution, however many of its records you open", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ name: "Kew" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([fetchInstitutionName(KEY), fetchInstitutionName(KEY)]);
    await fetchInstitutionName(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("remembers a key it couldn't resolve rather than retrying it", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchInstitutionName(KEY)).toBeNull();
    expect(await fetchInstitutionName(KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("survives GBIF being unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    expect(await fetchInstitutionName(KEY)).toBeNull();
  });

  it("says nothing about a key nobody has asked about", () => {
    expect(knownInstitutionName("unasked")).toBeUndefined();
  });
});
