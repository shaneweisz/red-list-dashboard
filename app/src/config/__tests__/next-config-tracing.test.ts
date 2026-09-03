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

const ROUTE_FILES = ["route.ts", "route.tsx", "page.tsx"];
const isRouteDir = (dir: string) => ROUTE_FILES.some((f) => fs.existsSync(path.join(dir, f)));

/**
 * Every directory a route key can name, following `*` where it appears.
 *
 * The keys are globs, which is why a dynamic route is written `/mapping/*` and
 * not `/mapping/[key]`: square brackets are a character class to a glob, so
 * that key would match `/mapping/k` and nothing that exists. Following the
 * glob here keeps the guard honest for those — a key matching no directory at
 * all is still the silent no-op this test was written for.
 */
function resolveRouteDirs(route: string): string[] {
  let dirs = [APP_DIR];
  for (const segment of route.replace(/^\//, "").split("/")) {
    if (!segment) continue;
    const next: string[] = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      if (segment.includes("*")) {
        const pattern = segment
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        const re = new RegExp(`^${pattern}$`);
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && re.test(entry.name)) next.push(path.join(dir, entry.name));
        }
      } else {
        next.push(path.join(dir, segment));
      }
    }
    dirs = next;
  }
  return dirs;
}

describe("next.config.ts file tracing", () => {
  it("finds the tracing keys at all (guards the parser itself)", () => {
    const keys = tracingRouteKeys();
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("/api/redlist/species");
  });

  it.each(tracingRouteKeys())("%s is a route that exists", (route) => {
    // A route path maps to src/app/<path>/route.ts (or page.tsx for a page).
    const exists = resolveRouteDirs(route).some(isRouteDir);
    expect(exists, `${route} has no route file under src/app — a stale tracing key prunes nothing`).toBe(true);
  });

  it("still fails a key that matches nothing, glob or not", () => {
    // The guard is only worth having if it still catches the case it was
    // written for once globs are followed.
    expect(resolveRouteDirs("/api/redlist/assessor-candidates-by-country").some(isRouteDir)).toBe(false);
    expect(resolveRouteDirs("/no-such-route/*").some(isRouteDir)).toBe(false);
  });

  it("follows a glob to the dynamic route it stands for", () => {
    expect(resolveRouteDirs("/mapping/*")).toContain(path.join(APP_DIR, "mapping", "[key]"));
  });
});
