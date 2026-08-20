/**
 * Remembered view toggles. The load-bearing property is that a stored value is
 * only ever trusted when the caller recognises it — localStorage is user-
 * writable, and a bad value reaching a component as an unexpected string would
 * render a chart tab that doesn't exist.
 *
 * The suite runs in vitest's node environment (no jsdom), so `window` is stubbed
 * here rather than pulling in a DOM implementation for two functions.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readViewPreference, writeViewPreference } from "../view-preference";

const CREDIT_MODES = ["assessors", "reviewers", "facilitators"] as const;
const YEARS_MODES = ["range", "year"] as const;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const realWindow = (globalThis as { window?: unknown }).window;
const setWindow = (localStorage: Store | null) => {
  (globalThis as { window?: unknown }).window = localStorage ? { localStorage } : undefined;
};

function memoryStorage(): Store & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

let store: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  store = memoryStorage();
  setWindow(store);
});
afterAll(() => { (globalThis as { window?: unknown }).window = realWindow; });

describe("view preferences", () => {
  it("round-trips a stored preference", () => {
    writeViewPreference("creditChartMode", "facilitators");
    expect(readViewPreference("creditChartMode", CREDIT_MODES)).toBe("facilitators");
  });

  it("reads null when nothing has been stored", () => {
    expect(readViewPreference("creditChartMode", CREDIT_MODES)).toBeNull();
  });

  it("rejects a value the caller does not recognise", () => {
    store.map.set("rld:view-pref:creditChartMode", "contributors");
    expect(readViewPreference("creditChartMode", CREDIT_MODES)).toBeNull();
  });

  it("keeps each toggle's value separate", () => {
    writeViewPreference("yearsChartMode", "year");
    writeViewPreference("creditChartMode", "reviewers");
    expect(readViewPreference("yearsChartMode", YEARS_MODES)).toBe("year");
    expect(readViewPreference("creditChartMode", CREDIT_MODES)).toBe("reviewers");
  });

  it("namespaces its keys so it cannot collide with the pinned-species list", () => {
    writeViewPreference("yearsChartMode", "year");
    expect([...store.map.keys()]).toEqual(["rld:view-pref:yearsChartMode"]);
  });

  it("survives storage throwing — private browsing must not break the page", () => {
    setWindow({
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    expect(() => writeViewPreference("yearsChartMode", "year")).not.toThrow();
    expect(readViewPreference("yearsChartMode", YEARS_MODES)).toBeNull();
  });

  it("reads null and writes nothing on the server, where there is no window", () => {
    setWindow(null);
    expect(readViewPreference("yearsChartMode", YEARS_MODES)).toBeNull();
    expect(() => writeViewPreference("yearsChartMode", "year")).not.toThrow();
  });
});
