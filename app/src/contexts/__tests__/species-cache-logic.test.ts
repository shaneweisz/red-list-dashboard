import { describe, it, expect } from "vitest";
import { shouldSkipRequest, toCacheEntry, type SpeciesCacheEntry } from "../species-cache-logic";
import { type RedListSpecies } from "@/hooks/useRedListSpeciesQuery";

const emptyEntry: SpeciesCacheEntry = { species: [], truncated: false, tooLarge: false, neTotal: null };

describe("shouldSkipRequest", () => {
  it("does not skip a url that's neither cached nor in flight", () => {
    expect(shouldSkipRequest("/api/species?taxon=birds", {}, new Set())).toBe(false);
  });

  it("skips a url that's already cached", () => {
    const entries = { "/api/species?taxon=birds": emptyEntry };
    expect(shouldSkipRequest("/api/species?taxon=birds", entries, new Set())).toBe(true);
  });

  it("skips a url that's already in flight (concurrent callers dedupe before the first response lands)", () => {
    const inFlight = new Set(["/api/species?taxon=birds"]);
    expect(shouldSkipRequest("/api/species?taxon=birds", {}, inFlight)).toBe(true);
  });

  it("does not skip a different url just because another url is cached or in flight", () => {
    const entries = { "/api/species?taxon=birds": emptyEntry };
    const inFlight = new Set(["/api/species?taxon=mammals"]);
    expect(shouldSkipRequest("/api/species?taxon=reptiles", entries, inFlight)).toBe(false);
  });

  it("treats a taxon's Assessed and Not-Evaluated urls as distinct cache keys", () => {
    // The cache key is the exact request URL, so `?taxon=mammals` and
    // `?taxon=mammals&category=NE` are naturally separate entries — this is
    // what lets compare mode's two panels sit in different view modes for the
    // same taxon without one mode's cached data masking the other's.
    const entries = { "/api/species?taxon=mammals": emptyEntry };
    expect(shouldSkipRequest("/api/species?taxon=mammals&category=NE", entries, new Set())).toBe(false);
  });
});

describe("toCacheEntry", () => {
  it("defaults species to an empty array when absent", () => {
    expect(toCacheEntry({}).species).toEqual([]);
  });

  it("passes the species array through unchanged", () => {
    const species = [{ id: 1 }] as unknown as RedListSpecies[];
    expect(toCacheEntry({ species }).species).toBe(species);
  });

  it("coerces truncated/tooLarge to booleans, defaulting to false", () => {
    expect(toCacheEntry({}).truncated).toBe(false);
    expect(toCacheEntry({}).tooLarge).toBe(false);
    expect(toCacheEntry({ truncated: true, tooLarge: true }).truncated).toBe(true);
    expect(toCacheEntry({ truncated: true, tooLarge: true }).tooLarge).toBe(true);
  });

  it("defaults neTotal to null when absent", () => {
    expect(toCacheEntry({}).neTotal).toBe(null);
  });

  it("keeps a provided neTotal, including 0", () => {
    expect(toCacheEntry({ neTotal: 0 }).neTotal).toBe(0);
    expect(toCacheEntry({ neTotal: 42 }).neTotal).toBe(42);
  });
});
