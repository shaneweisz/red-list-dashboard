"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { shouldSkipRequest, toCacheEntry, type SpeciesCacheEntry } from "./species-cache-logic";

export type { SpeciesCacheEntry };

interface SpeciesCacheValue {
  entries: Record<string, SpeciesCacheEntry>;
  loadingUrls: Set<string>;
  errors: Record<string, string>;
  // Idempotent: fetches `url` at most once, no matter how many callers request it
  // concurrently (e.g. two compare-mode panels both selecting "Birds") — later
  // callers for an already-cached or in-flight url are a no-op.
  request: (url: string) => void;
}

const SpeciesCacheContext = createContext<SpeciesCacheValue | null>(null);

/**
 * Shared species-fetch cache, keyed by the exact request URL (so e.g.
 * `?taxon=birds` and `?taxon=birds&category=NE` are naturally distinct entries).
 * Wrap one or more RedListView instances in a single provider to have them share
 * fetches — the single-dashboard page wraps exactly one instance (no behavior
 * change from today), compare mode wraps two so picking the same taxon on both
 * sides only fetches it once.
 */
export function SpeciesCacheProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, SpeciesCacheEntry>>({});
  const [loadingUrls, setLoadingUrls] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Tracks in-flight requests so concurrent callers (e.g. both panels mounting at
  // once) dedupe even before the first `entries` update lands.
  const inFlightRef = useRef<Set<string>>(new Set());

  const request = useCallback((url: string) => {
    if (shouldSkipRequest(url, entries, inFlightRef.current)) return;
    inFlightRef.current.add(url);
    setLoadingUrls(prev => new Set(prev).add(url));
    fetch(url)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Species API returned ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        setEntries(prev => ({ ...prev, [url]: toCacheEntry(data) }));
      })
      .catch(err => {
        setErrors(prev => ({ ...prev, [url]: err instanceof Error ? err.message : "Unknown error" }));
      })
      .finally(() => {
        inFlightRef.current.delete(url);
        setLoadingUrls(prev => {
          const next = new Set(prev);
          next.delete(url);
          return next;
        });
      });
  }, [entries]);

  const value = useMemo<SpeciesCacheValue>(
    () => ({ entries, loadingUrls, errors, request }),
    [entries, loadingUrls, errors, request]
  );

  return <SpeciesCacheContext.Provider value={value}>{children}</SpeciesCacheContext.Provider>;
}

export function useSpeciesCache(): SpeciesCacheValue {
  const ctx = useContext(SpeciesCacheContext);
  if (!ctx) throw new Error("useSpeciesCache must be used within a SpeciesCacheProvider");
  return ctx;
}
