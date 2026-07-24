import { type RedListSpecies } from "@/hooks/useRedListSpeciesQuery";

export interface SpeciesCacheEntry {
  species: RedListSpecies[];
  truncated: boolean;
  tooLarge: boolean;
  neTotal: number | null;
}

// True when a request for `url` should be skipped — already cached, or a
// fetch for it is already in flight. Pulled out of SpeciesCacheProvider as a
// plain function (rather than left inline in the component) so the actual
// dedup decision is directly unit-testable — this repo's test suite only
// covers .ts logic, not .tsx rendering (see vitest.config.ts).
export function shouldSkipRequest(
  url: string,
  entries: Record<string, SpeciesCacheEntry>,
  inFlight: ReadonlySet<string>
): boolean {
  return entries[url] !== undefined || inFlight.has(url);
}

// Normalizes a raw /api/redlist/species JSON response into a cache entry.
export function toCacheEntry(data: {
  species?: RedListSpecies[];
  truncated?: boolean;
  tooLarge?: boolean;
  neTotal?: number | null;
}): SpeciesCacheEntry {
  return {
    species: data.species ?? [],
    truncated: !!data.truncated,
    tooLarge: !!data.tooLarge,
    neTotal: data.neTotal ?? null,
  };
}
