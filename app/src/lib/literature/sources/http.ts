/**
 * Polite HTTP for the literature source adapters.
 *
 * All of these APIs are free and mostly unauthenticated, and several of them
 * (OpenAlex, Europe PMC, Semantic Scholar) explicitly ask callers to identify
 * themselves and to back off when told to. So: one identifying User-Agent, a
 * contact address, a hard timeout so a stalled source can't pin a Vercel
 * function open, and a 429/503 path that reports "rate limited" instead of
 * hammering the endpoint with retries.
 */

import type { SourceResult, SourceStatus } from "../types";

/** Contact address sent to APIs that ask for one (OpenAlex's "polite pool"). */
export const CONTACT_EMAIL = "sw984@cam.ac.uk";

export const USER_AGENT =
  `RedListDashboard/1.0 (+https://github.com/shaneweisz/redlist-dashboard; mailto:${CONTACT_EMAIL})`;

/** Per-source budget. The route gives all sources this long, in parallel. */
export const SOURCE_TIMEOUT_MS = 8_000;

export class SourceHttpError extends Error {
  constructor(
    readonly status: SourceStatus,
    message: string,
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

/**
 * GET some JSON, mapping transport-level outcomes onto `SourceStatus`.
 * Throws `SourceHttpError` so each adapter's `catch` can report a status
 * without re-deriving it.
 */
export async function fetchJson<T>(
  url: string,
  init: { signal: AbortSignal; headers?: Record<string, string> },
): Promise<T> {
  const response = await fetch(url, {
    signal: init.signal,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
  });

  if (response.status === 429 || response.status === 503) {
    throw new SourceHttpError("rate_limited", `HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new SourceHttpError("error", `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Uniform failure shape, so a broken source degrades instead of 500-ing. */
export function failed(error: unknown): SourceResult {
  if (error instanceof SourceHttpError) {
    return { status: error.status, works: [], upstreamTotal: null, note: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  // AbortError is what a blown `SOURCE_TIMEOUT_MS` budget looks like.
  const isAbort = error instanceof Error && error.name === "AbortError";
  return {
    status: "error",
    works: [],
    upstreamTotal: null,
    note: isAbort ? `Timed out after ${SOURCE_TIMEOUT_MS / 1000}s` : message,
  };
}

/** A source we can't query because its API key isn't configured. */
export function unconfigured(envVar: string): SourceResult {
  return {
    status: "unconfigured",
    works: [],
    upstreamTotal: null,
    note: `Set ${envVar} to enable this source`,
  };
}

/** `"a" OR "b" OR "c"` — the phrase-OR syntax Europe PMC, CORE and Google Books share. */
export function quotedOrQuery(variants: string[]): string {
  return variants.map((v) => `"${v}"`).join(" OR ");
}
