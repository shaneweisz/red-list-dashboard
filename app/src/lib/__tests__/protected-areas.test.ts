import { describe, it, expect } from "vitest";
import {
  esriRingsToMultiPolygon,
  identifyUrl,
  parseIdentifyResponse,
  protectedPlanetUrl,
} from "../protected-areas";

describe("protectedPlanetUrl", () => {
  it("puts the site id in the path and the parcel in the query", () => {
    expect(protectedPlanetUrl({ siteId: "377207", sitePid: "377207" })).toBe(
      "https://www.protectedplanet.net/377207?site_pid=377207"
    );
  });

  // A bare /23_1 is a 500 on protectedplanet.net — multi-parcel sites are the
  // whole reason both ids are carried around.
  it("keeps a multi-parcel site on its parent id", () => {
    expect(protectedPlanetUrl({ siteId: "23", sitePid: "23_1" })).toBe(
      "https://www.protectedplanet.net/23?site_pid=23_1"
    );
  });
});

describe("identifyUrl", () => {
  const request = {
    lng: -110.5,
    lat: 44.6,
    bounds: [-111, 44, -110, 45] as [number, number, number, number],
    width: 800.4,
    height: 600.6,
  };

  it("asks about the clicked point in degrees", () => {
    const url = new URL(identifyUrl(request));
    const params = url.searchParams;
    expect(params.get("geometry")).toBe('{"x":-110.5,"y":44.6}');
    expect(params.get("geometryType")).toBe("esriGeometryPoint");
    expect(params.get("sr")).toBe("4326");
    expect(params.get("mapExtent")).toBe("-111,44,-110,45");
    expect(params.get("returnGeometry")).toBe("true");
  });

  // Point-only sites live in sublayer 0; querying the polygons alone drops them.
  it("queries every sublayer, not just the polygons", () => {
    expect(new URL(identifyUrl(request)).searchParams.get("layers")).toBe("all");
  });

  // The tolerance is in screen pixels, measured against imageDisplay — a
  // fractional canvas size would make it meaningless.
  it("rounds the canvas size and carries the screen dpi", () => {
    expect(new URL(identifyUrl(request)).searchParams.get("imageDisplay")).toBe("800,601,96");
  });

  // Full-resolution boundaries are megabytes each; a pixel's worth of
  // generalisation is visually identical at the zoom it was asked from.
  it("generalises the boundary to about a screen pixel", () => {
    const offset = Number(new URL(identifyUrl(request)).searchParams.get("maxAllowableOffset"));
    expect(offset).toBeCloseTo(1 / 800.4, 6);
  });

  /**
   * The tolerance is in screen pixels, so its ground meaning depends entirely
   * on the zoom. Left at a fixed 5, a click near a national park at continental
   * zoom came back as inside it — five pixels was tens of kilometres.
   */
  describe("click tolerance", () => {
    it("allows a few metres of slop when zoomed right in", () => {
      // ~0.001° across 800px ≈ 0.14 m per pixel.
      const url = new URL(identifyUrl({ ...request, bounds: [-110.5005, 44.6, -110.4995, 44.601] }));
      expect(Number(url.searchParams.get("tolerance"))).toBe(5);
    });

    it("tests plain containment when a pixel is kilometres wide", () => {
      // The whole of North America across 800px — ~100 km per pixel.
      const url = new URL(identifyUrl({ ...request, bounds: [-170, 20, -50, 70] }));
      expect(Number(url.searchParams.get("tolerance"))).toBe(0);
    });

    it("still takes an explicit tolerance", () => {
      expect(new URL(identifyUrl({ ...request, tolerance: 3 })).searchParams.get("tolerance")).toBe("3");
    });
  });

  it("survives a zero-width canvas rather than dividing by it", () => {
    const offset = Number(new URL(identifyUrl({ ...request, width: 0 })).searchParams.get("maxAllowableOffset"));
    expect(Number.isFinite(offset)).toBe(true);
  });
});

describe("esriRingsToMultiPolygon", () => {
  // Clockwise in lng/lat encloses; anticlockwise cuts a hole out of it.
  const outer = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
  const hole = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]];

  it("nests a hole inside the ring it was cut from", () => {
    const geometry = esriRingsToMultiPolygon([outer, hole]);
    expect(geometry?.type).toBe("MultiPolygon");
    expect(geometry?.coordinates).toHaveLength(1);
    expect(geometry?.coordinates[0]).toHaveLength(2);
    expect(geometry?.coordinates[0][1]).toEqual(hole);
  });

  it("keeps separate parcels apart", () => {
    const second = [[10, 0], [10, 1], [11, 1], [11, 0], [10, 0]];
    expect(esriRingsToMultiPolygon([outer, second])?.coordinates).toHaveLength(2);
  });

  it("has nothing to draw for a point-only site", () => {
    expect(esriRingsToMultiPolygon(undefined)).toBeNull();
    expect(esriRingsToMultiPolygon([])).toBeNull();
    expect(esriRingsToMultiPolygon([[[0, 0], [1, 1]]])).toBeNull();
  });
});

describe("parseIdentifyResponse", () => {
  // Shape taken from a real response for a click inside Yellowstone.
  const yellowstone = {
    results: [
      {
        layerId: 1,
        value: "Yellowstone Proposed or Recom",
        attributes: {
          SITE_ID: "555661572",
          SITE_PID: "555661572",
          NAME: "Yellowstone Proposed or Recom",
          NAME_ENG: "Yellowstone Proposed or Recommended Wilderness",
          DESIG_ENG: "Recommended Wilderness",
          IUCN_CAT: "Ib",
          STATUS: "Designated",
          STATUS_YR: "1972",
          SITE_TYPE: "PA",
          REP_AREA: "8983.3",
        },
      },
      {
        layerId: 1,
        value: "Yellowstone National Park",
        attributes: {
          SITE_ID: "377207",
          SITE_PID: "377207",
          NAME_ENG: "Yellowstone National Park",
          DESIG_ENG: "National Park",
          IUCN_CAT: "II",
          STATUS: "Designated",
          STATUS_YR: "1872",
          SITE_TYPE: "PA",
          REP_AREA: "8991.2",
        },
      },
    ],
  };

  it("reads every designation, not just the first", () => {
    const areas = parseIdentifyResponse(yellowstone);
    expect(areas).toHaveLength(2);
    expect(areas.map((a) => a.name)).toEqual([
      "Yellowstone Proposed or Recommended Wilderness",
      "Yellowstone National Park",
    ]);
    expect(areas[1].siteId).toBe("377207");
    expect(areas[1].iucnCategory).toBe("II");
    expect(areas[1].statusYear).toBe(1872);
    expect(areas[1].reportedAreaKm2).toBeCloseTo(8991.2);
  });

  it("still reads the pre-2025 field names", () => {
    const areas = parseIdentifyResponse({
      results: [{ attributes: { WDPAID: "23", WDPA_PID: "23_1", NAME: "San Guillermo" } }],
    });
    expect(areas[0]).toMatchObject({ siteId: "23", sitePid: "23_1", name: "San Guillermo" });
  });

  it("falls back to the site id when there is no parcel id", () => {
    const areas = parseIdentifyResponse({ results: [{ attributes: { SITE_ID: "14", NAME: "Tierra del Fuego" } }] });
    expect(areas[0].sitePid).toBe("14");
  });

  it("drops ArcGIS's placeholders rather than showing them", () => {
    const areas = parseIdentifyResponse({
      results: [
        {
          attributes: {
            SITE_ID: "2013",
            SITE_PID: "2013",
            NAME_ENG: "Yellowstone",
            DESIG_ENG: "World Heritage Site",
            IUCN_CAT: "Not Applicable",
            STATUS_YR: "Null",
          },
        },
      ],
    });
    expect(areas[0].iucnCategory).toBeUndefined();
    expect(areas[0].statusYear).toBeNull();
  });

  it("shows a site once however many times the service returns it", () => {
    const doubled = { results: [...yellowstone.results, yellowstone.results[1]] };
    expect(parseIdentifyResponse(doubled)).toHaveLength(2);
  });

  it("treats a click on open water as no protected areas", () => {
    expect(parseIdentifyResponse({ results: [] })).toEqual([]);
    expect(parseIdentifyResponse({})).toEqual([]);
    expect(parseIdentifyResponse(null)).toEqual([]);
  });

  it("skips records with no id, which nothing could be linked to", () => {
    expect(parseIdentifyResponse({ results: [{ attributes: { NAME: "Somewhere" } }] })).toEqual([]);
  });
});
