import { describe, it, expect } from "vitest";
import {
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
    expect(params.get("returnGeometry")).toBe("false");
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
