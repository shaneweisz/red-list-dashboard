/**
 * Drift guard for /llms.txt — the discovery surface agents read first. Its
 * categorical-filter section is generated from the shared-filter registry, so
 * this asserts every registry filter (and the newly-added movement/growthForms/
 * endemic) is actually advertised — no filter can be merged undocumented here.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { SHARED_FILTER_VOCAB } from "@/lib/shared-filters";

const body = () => GET(new NextRequest("https://example.test/llms.txt")).text();

describe("/llms.txt", () => {
  it("advertises every shared-filter registry key", async () => {
    const text = await body();
    for (const v of SHARED_FILTER_VOCAB) {
      expect(text, `llms.txt is missing filter "${v.key}"`).toContain(v.key);
    }
  });

  it("includes the filters that previously drifted (movement, growthForms, endemic)", async () => {
    const text = await body();
    expect(text).toContain("movement");
    expect(text).toContain("growthForms");
    expect(text).toContain("endemic");
  });
});
