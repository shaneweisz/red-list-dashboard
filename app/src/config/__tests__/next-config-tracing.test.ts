import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

/**
 * outputFileTracingIncludes / outputFileTracingExcludes are keyed by ROUTE PATH,
 * and a key that matches no route is silently ignored — Next says nothing, the
 * build succeeds locally, and the function it was meant to prune ships with the
 * whole dataset traced into it.
 *
 * That is not hypothetical: merging the assessor and reviewer candidate endpoints
 * into /api/redlist/credit-candidates left the two old keys behind, and the new
 * function went from ~80MB to 494MB — past Vercel's 250MB uncompressed cap — with
 * no local signal at all, because app/data/ is only fully populated at build time
 * on Vercel. This pins every key to a route that exists.
 */
const CONFIG_PATH = path.join(__dirname, "..", "..", "..", "next.config.ts");
const APP_DIR = path.join(__dirname, "..", "..", "app");

/** Route-path keys of the two tracing maps — object keys, not `source:` values. */
function tracingRouteKeys(): string[] {
  const src = fs.readFileSync(CONFIG_PATH, "utf-8");
  return [...src.matchAll(/^\s*"(\/[^"]*)":/gm)].map((m) => m[1]);
}

describe("next.config.ts file tracing", () => {
  it("finds the tracing keys at all (guards the parser itself)", () => {
    const keys = tracingRouteKeys();
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("/api/redlist/species");
  });

  it.each(tracingRouteKeys())("%s is a route that exists", (route) => {
    // A route path maps to src/app/<path>/route.ts (or page.tsx for a page).
    const base = path.join(APP_DIR, route.replace(/^\//, ""));
    const exists = ["route.ts", "route.tsx", "page.tsx"].some((f) => fs.existsSync(path.join(base, f)));
    expect(exists, `${route} has no route file under src/app — a stale tracing key prunes nothing`).toBe(true);
  });
});
