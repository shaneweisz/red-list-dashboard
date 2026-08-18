import { describe, it, expect } from "vitest";
import { formatKind, parsePhotonResponse, searchUrl } from "../geocode";

describe("searchUrl", () => {
  it("asks for the query", () => {
    const params = new URL(searchUrl("Raudal de Yuruparí")).searchParams;
    expect(params.get("q")).toBe("Raudal de Yuruparí");
    expect(params.get("limit")).toBe("6");
  });

  /**
   * A label's place name is often shared with a hotel or a street on the other
   * side of the continent, and the records already say which part of the world
   * we're in.
   */
  it("biases towards where you're looking", () => {
    const params = new URL(searchUrl("Yuruparí", { lat: 0.88, lng: -71.02, zoom: 7.4 })).searchParams;
    expect(params.get("lat")).toBe("0.8800");
    expect(params.get("lon")).toBe("-71.0200");
    expect(params.get("zoom")).toBe("7");
    expect(params.get("location_bias_scale")).toBe("0.6");
  });

  it("leaves the bias off when there's nowhere to bias to", () => {
    const params = new URL(searchUrl("Cali")).searchParams;
    expect(params.get("lat")).toBeNull();
    expect(params.get("location_bias_scale")).toBeNull();
  });
});

describe("parsePhotonResponse", () => {
  // Shape taken from a real response for "Farallones de Cali".
  const response = {
    features: [
      {
        geometry: { type: "Point", coordinates: [-76.5527411, 3.3910141] },
        properties: {
          osm_type: "R",
          osm_id: 9146154,
          osm_key: "place",
          osm_value: "neighbourhood",
          name: "Farallones",
          district: "Comuna 18",
          city: "Cali",
          county: "Cali",
          state: "Valle del Cauca",
          country: "Colombia",
          extent: [-76.5537877, 3.3926488, -76.5514067, 3.3900719],
        },
      },
      {
        geometry: { type: "Point", coordinates: [-71.015577, 0.8822135] },
        properties: {
          osm_type: "N",
          osm_id: 1,
          osm_value: "waterfall",
          name: "Raudal Pucarón (Yuruparí)",
          state: "Vaupés",
          country: "Colombia",
        },
      },
    ],
  };

  /**
   * Photon returns the same OSM object more than once — the same node at two
   * granularities, or one place matched by two of its names. The id is pin
   * identity as well as a React key, so a collision dropped the second pin and
   * pointed rename and dismiss at the first.
   */
  it("gives every result its own id, even when Photon repeats an OSM object", () => {
    const twin = {
      features: [
        { geometry: { type: "Point", coordinates: [-71.01, 0.88] },
          properties: { osm_type: "N", osm_id: 3342806869, name: "Chingaza", country: "Colombia" } },
        { geometry: { type: "Point", coordinates: [-73.75, 4.53] },
          properties: { osm_type: "N", osm_id: 3342806869, name: "Chingaza", country: "Colombia" } },
      ],
    };
    const ids = parsePhotonResponse(twin).map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("still gives an id when Photon omits the OSM identifiers", () => {
    const bare = {
      features: [
        { geometry: { type: "Point", coordinates: [-71.01, 0.88] },
          properties: { name: "Somewhere", country: "Colombia" } },
      ],
    };
    expect(parsePhotonResponse(bare)[0].id).toBeTruthy();
  });

  it("reads name, position and feature type", () => {
    const places = parsePhotonResponse(response);
    expect(places).toHaveLength(2);
    expect(places[1]).toMatchObject({
      name: "Raudal Pucarón (Yuruparí)",
      kind: "waterfall",
      lat: 0.8822135,
      lng: -71.015577,
      context: "Vaupés, Colombia",
    });
  });

  // OSM repeats a name across administrative levels often enough that the
  // context line reads "Cali, Cali, …" if you just concatenate them.
  it("doesn't repeat a name that appears at two levels", () => {
    expect(parsePhotonResponse(response)[0].context).toBe("Cali, Valle del Cauca, Colombia");
  });

  /**
   * Photon's extent is [west, north, east, south] — not the [w, s, e, n] that
   * MapLibre's fitBounds and the rest of this codebase use. Getting this wrong
   * flips the box inside out and the map flies somewhere else entirely.
   */
  it("reorders the extent into west/south/east/north", () => {
    expect(parsePhotonResponse(response)[0].bbox).toEqual([
      -76.5537877, 3.3900719, -76.5514067, 3.3926488,
    ]);
  });

  it("leaves a point feature without a box", () => {
    expect(parsePhotonResponse(response)[1].bbox).toBeUndefined();
  });

  it("skips anything with no name or no position to fly to", () => {
    expect(
      parsePhotonResponse({
        features: [
          { geometry: { coordinates: [1, 2] }, properties: {} },
          { properties: { name: "Nowhere" } },
          { geometry: { coordinates: ["x", 2] }, properties: { name: "Bad" } },
        ],
      })
    ).toEqual([]);
  });

  it("survives a response that isn't one", () => {
    expect(parsePhotonResponse(null)).toEqual([]);
    expect(parsePhotonResponse({})).toEqual([]);
  });
});

describe("formatKind", () => {
  it("says OSM's snake_case out loud", () => {
    expect(formatKind("protected_area")).toBe("protected area");
    expect(formatKind(undefined)).toBe("");
  });
});
