import { describe, it, expect } from "vitest";
import {
  georeferencesToCsv,
  csvToGeoreferences,
  validateGeoreference,
  parseCoordinatePair,
  uncertaintyCircle,
  type Georeference,
} from "../georeferences";

// A real case from Dioscorea biplicata: a 1963 US National Herbarium sheet whose
// locality was never georeferenced, resolved by hand to the Sibundoy valley.
const sibundoy: Georeference = {
  gbifID: 1234567890,
  occurrenceID: "urn:catalog:US:Botany:2899641",
  scientificName: "Dioscorea biplicata",
  verbatimLocality: "Indian garden. Valle de Sibundoy, 1.5 km. SW Sibundoy.",
  decimalLatitude: 1.1958,
  decimalLongitude: -76.9256,
  coordinateUncertaintyInMeters: 1500,
  georeferencedBy: "assessor@example.org",
  georeferencedDate: "2026-08-11T10:00:00.000Z",
  georeferenceProtocol: "Point-radius from locality description",
  georeferenceRemarks: "Sibundoy town centre, offset SW; radius covers the valley floor",
};

describe("validateGeoreference", () => {
  it("accepts a point with a radius", () => {
    expect(
      validateGeoreference({
        decimalLatitude: 1.1958,
        decimalLongitude: -76.9256,
        coordinateUncertaintyInMeters: 1500,
      }).ok
    ).toBe(true);
  });

  it("requires an uncertainty radius", () => {
    const result = validateGeoreference({
      decimalLatitude: 1.1958,
      decimalLongitude: -76.9256,
      coordinateUncertaintyInMeters: null,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/uncertainty/i);
  });

  it("rejects out-of-range coordinates", () => {
    const result = validateGeoreference({
      decimalLatitude: 91,
      decimalLongitude: -200,
      coordinateUncertaintyInMeters: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("rejects null island, the error the cleaning checks exist to catch", () => {
    const result = validateGeoreference({
      decimalLatitude: 0,
      decimalLongitude: 0,
      coordinateUncertaintyInMeters: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/0, 0/);
  });
});

describe("parseCoordinatePair", () => {
  it.each([
    ["1.1958, -76.9256", 1.1958, -76.9256],
    ["1.1958,-76.9256", 1.1958, -76.9256],
    ["1.1958 -76.9256", 1.1958, -76.9256],
    ["-0.6667; -77.6667", -0.6667, -77.6667],
  ])("parses %s", (text, lat, lon) => {
    expect(parseCoordinatePair(text)).toEqual({ lat, lon });
  });

  it.each(["", "1.1958", "not a coordinate", "95, 10", "10, 200"])(
    "returns null for %s",
    (text) => {
      expect(parseCoordinatePair(text)).toBeNull();
    }
  );
});

describe("CSV round trip", () => {
  it("restores every field it wrote", () => {
    const csv = georeferencesToCsv([sibundoy]);
    const { georeferences, errors } = csvToGeoreferences(csv);
    expect(errors).toEqual([]);
    expect(georeferences).toHaveLength(1);
    expect(georeferences[0]).toEqual(sibundoy);
  });

  it("writes Darwin Core term names, so a herbarium can read the file", () => {
    const header = georeferencesToCsv([sibundoy]).split("\n")[0];
    expect(header.split(",")).toEqual([
      "gbifID",
      "occurrenceID",
      "scientificName",
      "verbatimLocality",
      "decimalLatitude",
      "decimalLongitude",
      "geodeticDatum",
      "coordinateUncertaintyInMeters",
      "georeferencedBy",
      "georeferencedDate",
      "georeferenceProtocol",
      "georeferenceRemarks",
    ]);
  });

  it("declares the datum every row is in", () => {
    const [, row] = georeferencesToCsv([sibundoy]).split("\n");
    expect(row).toContain("WGS84");
  });

  it("survives commas and quotes in a locality", () => {
    const awkward: Georeference = {
      ...sibundoy,
      verbatimLocality: 'Pando, Manuripi: entre "Conquista" y su puerto, sobre el río',
    };
    const { georeferences, errors } = csvToGeoreferences(georeferencesToCsv([awkward]));
    expect(errors).toEqual([]);
    expect(georeferences[0].verbatimLocality).toBe(awkward.verbatimLocality);
  });
});

describe("csvToGeoreferences", () => {
  it("accepts a spreadsheet-edited file with reordered and extra columns", () => {
    const csv = [
      "notes,decimalLongitude,gbifID,decimalLatitude,coordinateUncertaintyInMeters",
      "checked against the map sheet,-76.9256,1234567890,1.1958,1500",
    ].join("\n");
    const { georeferences, errors } = csvToGeoreferences(csv);
    expect(errors).toEqual([]);
    expect(georeferences[0]).toMatchObject({
      gbifID: 1234567890,
      decimalLatitude: 1.1958,
      decimalLongitude: -76.9256,
      coordinateUncertaintyInMeters: 1500,
    });
  });

  it("rejects bad rows individually, by spreadsheet row number, and keeps the good ones", () => {
    const csv = [
      "gbifID,decimalLatitude,decimalLongitude,coordinateUncertaintyInMeters",
      "1234567890,1.1958,-76.9256,1500",
      "notanid,1.0,-76.0,1000",
      "1234567891,999,-76.0,1000",
      "1234567892,1.0,-76.0,",
    ].join("\n");
    const { georeferences, errors } = csvToGeoreferences(csv);
    expect(georeferences).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/^Row 3:/);
    expect(errors[1]).toMatch(/^Row 4:/);
    expect(errors[2]).toMatch(/^Row 5:/);
  });

  it("reports a file that isn't a georeference export", () => {
    const { georeferences, errors } = csvToGeoreferences("species,count\nDioscorea,27");
    expect(georeferences).toEqual([]);
    expect(errors[0]).toMatch(/needs at least/i);
  });

  it("reports an empty file", () => {
    expect(csvToGeoreferences("").errors[0]).toMatch(/empty/i);
  });
});

describe("uncertaintyCircle", () => {
  it("closes the ring", () => {
    const ring = uncertaintyCircle(1.1958, -76.9256, 1500).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("is a circle on the ground, not in degrees — wider in longitude away from the equator", () => {
    const spanAt = (lat: number) => {
      const ring = uncertaintyCircle(lat, 0, 10_000).coordinates[0];
      const lons = ring.map(([lon]) => lon);
      return Math.max(...lons) - Math.min(...lons);
    };
    // At 60°N a degree of longitude is half a degree at the equator, so the same
    // ground radius has to span about twice the degrees.
    expect(spanAt(60) / spanAt(0)).toBeCloseTo(2, 1);
  });

  it("spans roughly twice the radius across", () => {
    const ring = uncertaintyCircle(0, 0, 111_320).coordinates[0];
    const lats = ring.map(([, lat]) => lat);
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(2, 1);
  });
});
