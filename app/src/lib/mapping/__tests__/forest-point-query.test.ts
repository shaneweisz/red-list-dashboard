import { describe, it, expect, vi, afterEach } from "vitest";
import { hasForestAnswer, queryForestPoint } from "../forest-point-query";

/** Answers keyed by which dataset the URL asks for. */
function stubTiles(values: Record<string, number | null>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const dataset = new URL(input).searchParams.get("dataset") ?? "";
      const value = dataset in values ? values[dataset] : null;
      return { ok: true, json: async () => ({ values: [value], band_names: ["b1"] }) };
    })
  );
}

const DRIVERS = "wri_google_tree_cover_loss_drivers";
const LOSS = "umd_tree_cover_loss";
const DENSITY = "umd_tree_cover_density_2000";

describe("asking the rasters what happened at a point", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the driver from the stored class, not from a pixel's colour", async () => {
    stubTiles({ [DRIVERS]: 2, [LOSS]: 14, [DENSITY]: 81 });
    const point = await queryForestPoint(-55, -8);
    expect(point.driver?.label).toBe("Hard commodities");
  });

  it("reads the loss year, which the raster stores as years since 2000", async () => {
    stubTiles({ [DRIVERS]: 1, [LOSS]: 14, [DENSITY]: 81 });
    expect((await queryForestPoint(-55, -8)).lossYear).toBe(2014);
  });

  it("treats zero as no loss rather than the year 2000", async () => {
    // The series starts in 2001, so there is no year for a zero to mean.
    stubTiles({ [DRIVERS]: null, [LOSS]: 0, [DENSITY]: 81 });
    expect((await queryForestPoint(-55, -8)).lossYear).toBeUndefined();
  });

  it("carries the canopy cover that says how wooded it was first", async () => {
    stubTiles({ [DRIVERS]: 4, [LOSS]: 20, [DENSITY]: 99 });
    expect((await queryForestPoint(-55, -8)).canopyPercent).toBe(99);
  });

  it("flags a driver on ground the layers don't shade", async () => {
    // The point endpoint takes no threshold, so it answers for pixels the
    // tiles leave blank — saying so beats contradicting the map.
    stubTiles({ [DRIVERS]: 1, [LOSS]: 12, [DENSITY]: 12 });
    expect((await queryForestPoint(-47, -13)).belowThreshold).toBe(true);
  });

  it("doesn't flag one that is above the threshold", async () => {
    stubTiles({ [DRIVERS]: 1, [LOSS]: 12, [DENSITY]: 64 });
    expect((await queryForestPoint(-47, -13)).belowThreshold).toBeUndefined();
  });

  it("says nothing where the rasters hold nothing", async () => {
    stubTiles({});
    const point = await queryForestPoint(0, 0);
    expect(point.driver).toBeUndefined();
    expect(hasForestAnswer(point)).toBe(false);
  });

  it("still answers the parts it can when one dataset fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const dataset = new URL(input).searchParams.get("dataset") ?? "";
        if (dataset === DRIVERS) throw new Error("network");
        return { ok: true, json: async () => ({ values: [dataset === LOSS ? 14 : 88] }) };
      })
    );
    const point = await queryForestPoint(-55, -8);
    expect(point.driver).toBeUndefined();
    expect(point.lossYear).toBe(2014);
    expect(hasForestAnswer(point)).toBe(true);
  });

  it("survives a refusal from the service", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(hasForestAnswer(await queryForestPoint(0, 0))).toBe(false);
  });

  it("asks the versions the layers themselves are pinned to", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        seen.push(input);
        return { ok: true, json: async () => ({ values: [null] }) };
      })
    );
    await queryForestPoint(-55, -8);
    const drivers = seen.find((u) => u.includes(DRIVERS));
    expect(drivers).toContain("version=v1.13");
    // The density raster is only served at this one.
    expect(seen.find((u) => u.includes(DENSITY))).toContain("version=v1.8");
  });

  it("puts the coordinates in the path the endpoint expects", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        seen.push(input);
        return { ok: true, json: async () => ({ values: [null] }) };
      })
    );
    await queryForestPoint(-55.5, -8.25);
    expect(seen[0]).toContain("/point/-55.5,-8.25?");
  });
});
