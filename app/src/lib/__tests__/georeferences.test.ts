import { describe, it, expect } from "vitest";
import {
  occurrencesToCsv,
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

const occurrence = (props: Record<string, unknown>, coords?: [number, number]) => ({
  properties: props,
  geometry: coords ? { coordinates: coords } : null,
});

/**
 * The only way an assessor's work leaves the browser, so what it writes for a
 * record they placed themselves is the thing worth pinning down.
 */
describe("occurrencesToCsv", () => {
  // Honours quoting, because the fields under test sit after ones that need it
  // — a naive split on commas reads the wrong column and passes for the wrong
  // reason.
  const fields = (line: string): string[] => {
    const out: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (c === '"') quoted = false;
        else current += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { out.push(current); current = ""; }
      else current += c;
    }
    out.push(current);
    return out;
  };

  const columnOf = (csv: string, header: string) => {
    const i = fields(csv.split("\n")[0]).indexOf(header);
    return (row: string) => fields(row)[i];
  };

  it("writes the assessor's coordinates in place of GBIF's, and says so", () => {
    const csv = occurrencesToCsv(
      [occurrence({ gbifID: 1234567890, species: "Dioscorea biplicata" }, [-70, 5])],
      { 1234567890: sibundoy }
    );
    const [, row] = csv.split("\n");
    const at = columnOf(csv, "decimalLatitude");
    expect(at(row)).toBe("1.1958");
    expect(columnOf(csv, "decimalLongitude")(row)).toBe("-76.9256");
    expect(columnOf(csv, "coordinateUncertaintyInMeters")(row)).toBe("1500");
    expect(columnOf(csv, "coordinateSource")(row)).toBe("assessor");
  });

  it("leaves a record the assessor hasn't touched as GBIF published it", () => {
    const csv = occurrencesToCsv([occurrence({ gbifID: 42 }, [-70, 5])], {});
    const [, row] = csv.split("\n");
    expect(columnOf(csv, "decimalLatitude")(row)).toBe("5");
    expect(columnOf(csv, "decimalLongitude")(row)).toBe("-70");
    expect(columnOf(csv, "coordinateSource")(row)).toBe("GBIF");
  });

  // The records with no coordinates are the ones georeferencing exists for, so
  // they have to survive the export rather than being dropped from it.
  it("keeps a record with no coordinates at all, marked as such", () => {
    const csv = occurrencesToCsv([occurrence({ gbifID: 7 })], {});
    const [, row] = csv.split("\n");
    expect(columnOf(csv, "decimalLatitude")(row)).toBe("");
    expect(columnOf(csv, "geodeticDatum")(row)).toBe("");
    expect(columnOf(csv, "coordinateSource")(row)).toBe("none");
  });

  // A locality description with a comma in it would otherwise shift every
  // column after it, silently moving coordinates into the wrong field.
  it("quotes a field containing a comma or a quote", () => {
    const csv = occurrencesToCsv(
      [occurrence({ gbifID: 7, locality: 'Sibundoy, 1.5 km SW ("the valley")' })],
      {}
    );
    expect(csv.split("\n")[1]).toContain('"Sibundoy, 1.5 km SW (""the valley"")"');
  });
});

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
