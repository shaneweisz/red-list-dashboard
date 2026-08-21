/**
 * Remembered view-toggle preferences.
 *
 * A handful of chart toggles have a default that is right for a first-time
 * visitor and wrong for a regular: someone at BirdLife wants the Facilitators
 * tab and specific assessment years every single session, and re-picking them
 * on every visit is friction with no upside. These persist that choice in
 * localStorage so the dashboard opens the way you last left it.
 *
 * Scope, deliberately narrow — this is for *how the same data is displayed*,
 * never for *which data is shown*. Filters stay in the URL, because a filter
 * that silently persisted would make a shared link mean different things to
 * different people, and would leave someone staring at a filtered dashboard
 * with no memory of having filtered it. A toggle qualifies here only if the
 * view still shows the same species either way.
 *
 * Precedence: an explicit choice in the URL always wins. A link that pins a
 * specific year, or names a chart tab, must render the same for the person who
 * receives it as for the person who sent it — see the callers, which read the
 * stored value only when the URL says nothing.
 *
 * Privacy: these are a few short strings that never leave the browser and
 * identify nobody. They are the user's own display settings, stored because
 * the user set them — no consent banner is required for that, and none of it
 * is sent to a server. See /privacy.
 */

const PREFIX = "rld:view-pref:";

/** Every persisted toggle, so the set is auditable in one place. */
export type ViewPreferenceKey =
  /** Years chart: "range" buckets vs specific "year" columns. */
  | "yearsChartMode"
  /** Credit chart tab: assessors | reviewers | facilitators. */
  | "creditChartMode"
  /** Country card: "map" vs "list". */
  | "countryViewMode";

/**
 * Read a remembered preference, validated against the values the caller
 * actually accepts.
 *
 * `allowed` is required rather than optional: a stale or hand-edited
 * localStorage value must never reach a component as an unexpected string. An
 * unrecognised value reads as "no preference" and the caller's default stands.
 *
 * Returns null during SSR (no window) so the server and the first client render
 * agree — the stored value is applied in an effect after mount, not during it.
 */
export function readViewPreference<T extends string>(
  key: ViewPreferenceKey,
  allowed: readonly T[],
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return allowed.find((v) => v === raw) ?? null;
  } catch {
    // Private-browsing modes and blocked-storage settings throw on access.
    // A remembered toggle is a convenience; never break the page over it.
    return null;
  }
}

/** Persist a preference. Silently no-ops when storage is unavailable. */
export function writeViewPreference(key: ViewPreferenceKey, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // As above — storage being unavailable is not an error worth surfacing.
  }
}
