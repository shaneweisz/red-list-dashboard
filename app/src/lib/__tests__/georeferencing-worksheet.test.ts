import { describe, it, expect } from "vitest";
import {
  detectDelimiter,
  excludedRowsTsv,
  formatErrorRadius,
  isAssessorsOwn,
  parseDelimited,
  parseErrorRadius,
  parseWorksheet,
  worksheetWithGeoreferences,
} from "../georeferencing-worksheet";
import type { Exclusion, Georeference } from "../georeferences";

/**
 * A cut-down `Manual_georeferencing_data` paste, keeping the shapes that
 * actually occur in the assessors' sheets: a quoted GEONOTES containing commas
 * and a URL, a radius written "10km", one written "15km" with a trailing tab,
 * a bare metre value, a "0" for none stated, and a row not yet georeferenced.
 */
const HEADERS = ["BARCODE", "GENUS", "SP1", "COUNTRY", "LOCALITY", "LAT", "LONG", "LLORIG", "ERRRAD", "GEONOTES", "SOURCE", "GBIFID"];
const SHEET = [
  HEADERS.join("\t"),
  ["182983", "Dioscorea", "biplicata", "CO", "cerca de Tenasucá", "4.69091", "-74.38978", "GBIF", "10km",
    '"Tenasuca is a reserve, per OSM: 4.69091, -74.38978. Adding 10km to cover it."', "www.gbif.org/occurrence/1890907408", "1890907408"].join("\t"),
  // The trailing tab is real — one sheet has it — and Excel quotes the cell on
  // copy, which is the only way a tab can survive inside a tab-separated field.
  ["P00748313", "Dioscorea", "biplicata", "CO", "La Palmilla Quindio", "4.47", "-75.33", "GBIF", '"15km\t"',
    "Should be Province de Mariquita", "www.gbif.org/occurrence/439582394", "439582394"].join("\t"),
  ["US2222438", "Dioscorea", "biplicata", "PE", "Lomas de Virú", "-8.33485", "-78.81039", "Google Maps", "600",
    "", "www.gbif.org/occurrence/2592300363", "2592300363"].join("\t"),
  ["B100250002", "Dioscorea", "biplicata", "PE", "Pativilca", "-10.694725", "-77.777023", "Google Maps", "0",
    "", "www.gbif.org/occurrence/144855531", "144855531"].join("\t"),
  ["NOTYET001", "Dioscorea", "biplicata", "CO", "Quindío, no coordinates", "", "", "", "", "", "", "1252668836"].join("\t"),
].join("\n");

describe("detectDelimiter", () => {
  it("reads a clipboard paste as tab-separated", () => {
    expect(detectDelimiter("A\tB\tC\n1\t2\t3")).toBe("\t");
  });
  it("reads a saved file as comma-separated", () => {
    expect(detectDelimiter("A,B,C\n1,2,3")).toBe(",");
  });
});

describe("parseDelimited", () => {
  /**
   * GEONOTES holds the assessor's reasoning and routinely contains commas and
   * line breaks; Excel quotes it on copy. Splitting on the delimiter alone
   * shifts every column after it.
   */
  it("keeps a quoted field with delimiters inside it whole", () => {
    const rows = parseDelimited('A,B\n1,"has, commas, inside"', ",");
    expect(rows[1]).toEqual(["1", "has, commas, inside"]);
  });

  it("keeps a quoted field with a line break whole", () => {
    const rows = parseDelimited('A\tB\n1\t"line one\nline two"', "\t");
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe("line one\nline two");
  });

  it("unescapes a doubled quote", () => {
    expect(parseDelimited('A\n"he said ""no"""', ",")[1][0]).toBe('he said "no"');
  });

  it("keeps empty trailing cells", () => {
    expect(parseDelimited("A,B,C\n1,,", ",")[1]).toEqual(["1", "", ""]);
  });
});

describe("parseErrorRadius", () => {
  it("reads the forms the sheets actually use", () => {
    expect(parseErrorRadius("10km")).toBe(10_000);
    expect(parseErrorRadius("15km\t")).toBe(15_000);
    expect(parseErrorRadius("1.5 km")).toBe(1_500);
    expect(parseErrorRadius("600")).toBe(600);
    expect(parseErrorRadius("600 m")).toBe(600);
  });

  it("treats blank and 0 as none stated", () => {
    expect(parseErrorRadius("")).toBe(0);
    expect(parseErrorRadius("0")).toBe(0);
    expect(parseErrorRadius(undefined)).toBeNull();
  });

  // Inventing precision is the one thing a georeference must never do.
  it("refuses to guess at something it can't read", () => {
    expect(parseErrorRadius("about a mile")).toBeNull();
    expect(parseErrorRadius("10-15km")).toBeNull();
  });
});

describe("formatErrorRadius", () => {
  it("writes back in the sheet's own idiom", () => {
    expect(formatErrorRadius(10_000)).toBe("10km");
    expect(formatErrorRadius(1_500)).toBe("1.5km");
    expect(formatErrorRadius(600)).toBe("600");
    expect(formatErrorRadius(0)).toBe("0");
  });
});

describe("parseWorksheet", () => {
  const imported = parseWorksheet(SHEET, { georeferencedBy: "amy@example.org", scientificName: "Dioscorea biplicata" });

  it("takes a georeference from every row that has coordinates", () => {
    expect(imported.georeferences.map((g) => g.gbifID)).toEqual([
      1890907408, 439582394, 2592300363, 144855531,
    ]);
  });

  it("reads the coordinates, radius and reasoning", () => {
    expect(imported.georeferences[0]).toMatchObject({
      gbifID: 1890907408,
      decimalLatitude: 4.69091,
      decimalLongitude: -74.38978,
      coordinateUncertaintyInMeters: 10_000,
      georeferenceProtocol: "GBIF",
      scientificName: "Dioscorea biplicata",
      georeferencedBy: "amy@example.org",
    });
    expect(imported.georeferences[0].georeferenceRemarks).toContain("Adding 10km to cover it");
  });

  // Most of the sheet starts with empty coordinates; that's the normal state of
  // work not yet done, not an error to report.
  it("passes over a row that hasn't been georeferenced yet", () => {
    expect(imported.georeferences.some((g) => g.gbifID === 1252668836)).toBe(false);
    expect(imported.skipped).toHaveLength(0);
  });

  it("counts the rows with no radius stated", () => {
    expect(imported.withoutRadius).toBe(1);
  });

  it("keeps the header row and every data row for the trip back", () => {
    expect(imported.headers).toEqual(HEADERS);
    expect(imported.rows).toHaveLength(5);
  });

  it("reports a row it can't attach or trust rather than dropping it silently", () => {
    const odd = parseWorksheet(
      [HEADERS.join("\t"),
       ["X", "", "", "", "", "4.5", "-75.8", "", "10km", "", "", ""].join("\t"),
       ["Y", "", "", "", "", "99", "-75.8", "", "10km", "", "", "1"].join("\t"),
       ["Z", "", "", "", "", "4.5", "-75.8", "", "about a mile", "", "", "2"].join("\t")].join("\n")
    );
    expect(odd.georeferences).toHaveLength(0);
    expect(odd.skipped.map((s) => s.reason)).toEqual([
      "no GBIF id to attach it to",
      "coordinates out of range (99, -75.8)",
      'couldn\'t read the radius "about a mile"',
    ]);
  });

  // The column set differs between assessors — one worksheet had KEWSOURCE,
  // four didn't — so nothing may depend on a column's position.
  it("finds its columns by name, whatever the order", () => {
    const shuffled = ["GBIFID", "ERRRAD", "LONG", "LAT", "EXTRA"].join("\t") + "\n" +
      ["1890907408", "2km", "-74.4", "4.7", "ignored"].join("\t");
    expect(parseWorksheet(shuffled).georeferences[0]).toMatchObject({
      gbifID: 1890907408,
      decimalLatitude: 4.7,
      decimalLongitude: -74.4,
      coordinateUncertaintyInMeters: 2000,
    });
  });
});

describe("worksheetWithGeoreferences", () => {
  const imported = parseWorksheet(SHEET);
  const georeferences: Record<number, Georeference> = {
    // The row that had none: coordinates supplied here.
    1252668836: {
      gbifID: 1252668836,
      decimalLatitude: 4.5,
      decimalLongitude: -75.8,
      coordinateUncertaintyInMeters: 2000,
      georeferenceRemarks: "GEOLocate on Hacienda Varsovia",
      georeferenceProtocol: "GEOLocate",
      georeferencedDate: "2026-08-17T00:00:00.000Z",
    },
  };

  const lines = () => worksheetWithGeoreferences(imported, georeferences).split("\n");

  /**
   * The workbook's GeoCAT and IUCN sheets read this one by column position, so
   * a changed column count or order silently turns them into #REF!.
   */
  it("returns the header row exactly as it arrived", () => {
    expect(lines()[0].split("\t")).toEqual(HEADERS);
  });

  it("writes the coordinates into the row that lacked them", () => {
    const row = lines().find((l) => l.includes("NOTYET001"))!.split("\t");
    expect(row[HEADERS.indexOf("LAT")]).toBe("4.5");
    expect(row[HEADERS.indexOf("LONG")]).toBe("-75.8");
    expect(row[HEADERS.indexOf("ERRRAD")]).toBe("2km");
    expect(row[HEADERS.indexOf("LLORIG")]).toBe("GEOLocate");
  });

  it("leaves every other column of that row alone", () => {
    const row = lines().find((l) => l.includes("NOTYET001"))!.split("\t");
    expect(row[HEADERS.indexOf("BARCODE")]).toBe("NOTYET001");
    expect(row[HEADERS.indexOf("LOCALITY")]).toBe("Quindío, no coordinates");
    expect(row).toHaveLength(HEADERS.length);
  });

  it("leaves rows it has nothing to say about untouched", () => {
    const row = lines().find((l) => l.includes("US2222438"))!.split("\t");
    expect(row[HEADERS.indexOf("ERRRAD")]).toBe("600");
    expect(row[HEADERS.indexOf("LLORIG")]).toBe("Google Maps");
  });

  it("re-quotes a note containing delimiters so the paste survives", () => {
    const withNote = worksheetWithGeoreferences(imported, {
      1890907408: { ...georeferences[1252668836], gbifID: 1890907408, georeferenceRemarks: "has\ttabs, commas\nand a line break" },
    });
    expect(withNote).toContain('"has\ttabs, commas\nand a line break"');
    // And it still parses back to the same thing.
    expect(parseWorksheet(withNote).georeferences[0].georeferenceRemarks)
      .toBe("has\ttabs, commas\nand a line break");
  });

  // Excluding a record in the sheet means deleting its row.
  it("leaves out records struck out here", () => {
    const exclusions: Record<number, Exclusion> = {
      439582394: { gbifID: 439582394, justification: "Duplicate of 1890907408", excludedAt: "2026-08-17T00:00:00.000Z" },
    };
    const out = worksheetWithGeoreferences(imported, georeferences, exclusions);
    expect(out).not.toContain("P00748313");
    expect(out.split("\n")).toHaveLength(5); // header + 4 remaining
  });
});

describe("excludedRowsTsv", () => {
  // Deleting a row loses the reasoning with it; this hands it back.
  it("lists what was struck out and why", () => {
    const imported = parseWorksheet(SHEET);
    const rows = excludedRowsTsv(imported, {
      439582394: {
        gbifID: 439582394,
        justification: "Duplicate of 1890907408",
        excludedAt: "2026-08-17T00:00:00.000Z",
        excludedBy: "amy@example.org",
      },
    }).split("\n");
    expect(rows[0].split("\t")).toEqual(["GBIFID", "BARCODE", "EXCLUSION_REASON", "EXCLUDED_BY", "EXCLUDED_AT"]);
    expect(rows[1].split("\t")).toEqual([
      "439582394", "P00748313", "Duplicate of 1890907408", "amy@example.org", "2026-08-17T00:00:00.000Z",
    ]);
  });
});

describe("isAssessorsOwn", () => {
  const at = (lat: number, lon: number, radius = 0, notes?: string) => ({
    decimalLatitude: lat,
    decimalLongitude: lon,
    coordinateUncertaintyInMeters: radius,
    georeferenceRemarks: notes,
  });

  it("counts a record GBIF can't place as theirs", () => {
    expect(isAssessorsOwn(at(4.5, -75.8), null)).toBe(true);
  });

  it("counts moved coordinates as theirs", () => {
    expect(isAssessorsOwn(at(4.5, -75.8), { lat: 4.6, lon: -75.8 })).toBe(true);
  });

  /**
   * The sheet's manual tab starts as a copy of the GBIF export, so an untouched
   * row carries GBIF's own coordinates. One worksheet had 135 of them; claiming
   * those as the assessor's work would mark the whole species as hand-placed.
   */
  it("doesn't claim GBIF's own coordinates, untouched", () => {
    expect(isAssessorsOwn(at(4.69091, -74.38978), { lat: 4.69091, lon: -74.38978 })).toBe(false);
  });

  // Deciding GBIF's point is right, to within 10 km, is a judgement worth keeping.
  it("counts a radius or a note at GBIF's own point as theirs", () => {
    expect(isAssessorsOwn(at(4.69091, -74.38978, 10_000), { lat: 4.69091, lon: -74.38978 })).toBe(true);
    expect(isAssessorsOwn(at(4.69091, -74.38978, 0, "checked against OSM"), { lat: 4.69091, lon: -74.38978 })).toBe(true);
  });

  it("ignores a difference far below what the sheets record", () => {
    expect(isAssessorsOwn(at(4.690910001, -74.389780001), { lat: 4.69091, lon: -74.38978 })).toBe(false);
  });
});
