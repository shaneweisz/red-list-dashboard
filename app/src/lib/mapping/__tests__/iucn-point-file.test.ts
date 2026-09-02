import { describe, it, expect } from "vitest";
import {
  biggestDisagreements,
  buildIucnPointFileCsv,
  IUCN_POINT_FILE_COLUMNS,
  comparePointFile,
  decodeUploadedText,
  detectDelimiter,
  gbifIdFromSource,
  parseCoordinate,
  normaliseCatalogNumber,
  parseIucnPointFile,
  pointSummary,
  splitDelimited,
} from "../iucn-point-file";

const HEADER =
  "sci_name,presence,origin,seasonal,compiler,yrcompiled,citation,dec_lat,dec_long," +
  "latitude,longitude,spatialref,subspecies,subpop,data_sens,sens_comm,event_year,source," +
  "basisofrec,catalog_no,recordedby,recordno,dist_comm,tax_comm";

/** A row as the workbook writes it — quoted citation, GBIF source, Kew compiler. */
const row = (over: Partial<Record<string, string>> = {}) => {
  const f: Record<string, string> = {
    sci_name: "Dioscorea schunkei",
    presence: "1",
    origin: "1",
    seasonal: "1",
    compiler: "Amy Barker",
    yrcompiled: "2026",
    citation: '"Royal Botanic Gardens, Kew"',
    dec_lat: "-4.46667",
    dec_long: "-78.169167",
    latitude: "-4.46667",
    longitude: "-78.169167",
    spatialref: "WGS84",
    subspecies: "",
    subpop: "",
    data_sens: "0",
    sens_comm: "",
    event_year: "1973",
    source: "www.gbif.org/occurrence/1261872764",
    basisofrec: "PreservedSpecimen",
    catalog_no: "945435",
    recordedby: "Rubio Kayap",
    recordno: "379",
    dist_comm: "",
    tax_comm: "",
    ...over,
  };
  return HEADER.split(",")
    .map((h) => f[h] ?? "")
    .join(",");
};

const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("decodeUploadedText", () => {
  const bytes = (...values: number[]) => new Uint8Array(values).buffer;

  it("reads plain UTF-8", () => {
    expect(decodeUploadedText(new TextEncoder().encode("G. Arbeláez S.").buffer as ArrayBuffer)).toBe(
      "G. Arbeláez S."
    );
  });

  it("strips a UTF-8 byte-order mark", () => {
    const utf8 = new TextEncoder().encode("sci_name");
    expect(decodeUploadedText(bytes(0xef, 0xbb, 0xbf, ...utf8))).toBe("sci_name");
  });

  /**
   * Excel's plain "CSV (Comma delimited)" writes the system code page, not
   * UTF-8. Decoded as UTF-8 the collector's name comes out mangled, which is
   * how it was found: "G. Arbeláez S." arriving as "G. Arbel�ez S.".
   */
  it("falls back to Windows-1252 when the bytes aren't valid UTF-8", () => {
    // 0xE1 is á in Windows-1252 and an incomplete sequence in UTF-8.
    expect(decodeUploadedText(bytes(0x47, 0x2e, 0x20, 0x41, 0x72, 0x62, 0x65, 0x6c, 0xe1, 0x65, 0x7a))).toBe(
      "G. Arbeláez"
    );
  });

  it("reads UTF-16, which Excel's Unicode Text option writes", () => {
    expect(decodeUploadedText(bytes(0xff, 0xfe, 0x61, 0x00, 0x62, 0x00))).toBe("ab");
    expect(decodeUploadedText(bytes(0xfe, 0xff, 0x00, 0x61, 0x00, 0x62))).toBe("ab");
  });
});

describe("splitDelimited", () => {
  it("keeps a quoted field containing the delimiter whole", () => {
    expect(splitDelimited('a,"Kew, Richmond",c', ",")).toEqual(["a", "Kew, Richmond", "c"]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(splitDelimited('a,"he said ""no""",c', ",")).toEqual(["a", 'he said "no"', "c"]);
  });
});

describe("detectDelimiter", () => {
  // Excel writes semicolons under a comma-decimal locale, and a copied range
  // arrives tab-separated. Both look like "a CSV" to whoever sends it.
  it("picks whichever separator the header actually uses", () => {
    expect(detectDelimiter("sci_name,dec_lat,dec_long")).toBe(",");
    expect(detectDelimiter("sci_name\tdec_lat\tdec_long")).toBe("\t");
    expect(detectDelimiter("sci_name;dec_lat;dec_long")).toBe(";");
  });
});

describe("gbifIdFromSource", () => {
  it("reads the record id out of a GBIF occurrence URL", () => {
    expect(gbifIdFromSource("www.gbif.org/occurrence/1890907408")).toBe(1890907408);
    expect(gbifIdFromSource("https://www.GBIF.org/occurrence/439582394")).toBe(439582394);
  });

  // Real rows in the assessors' files: a Tropicos sheet and a journal article.
  // These are valid IUCN points that simply have no GBIF record behind them.
  it("gives nothing for a source that isn't a GBIF record", () => {
    expect(gbifIdFromSource("https://legacy.tropicos.org/Specimen/3425736")).toBeNull();
    expect(gbifIdFromSource("https://www.redalyc.org/journal/669/66976164007/movil/")).toBeNull();
    expect(gbifIdFromSource("")).toBeNull();
  });
});

describe("parseCoordinate", () => {
  it("reads a plain decimal", () => {
    expect(parseCoordinate("-4.46667")).toBeCloseTo(-4.46667);
  });

  // Exported under a locale where the comma is the decimal separator.
  it("reads a comma decimal separator", () => {
    expect(parseCoordinate("-4,46667")).toBeCloseTo(-4.46667);
  });

  it("ignores a degree sign left on the value", () => {
    expect(parseCoordinate("-4.46667°")).toBeCloseTo(-4.46667);
  });

  it("gives nothing for a blank or unreadable value", () => {
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate("about 4 south")).toBeNull();
  });
});

describe("parseIucnPointFile", () => {
  it("reads a row and keeps every column as written", () => {
    const { points, errors } = parseIucnPointFile(file(row()), "schunkei.csv");
    expect(errors).toEqual([]);
    expect(points).toHaveLength(1);
    expect(points[0].latitude).toBeCloseTo(-4.46667);
    expect(points[0].longitude).toBeCloseTo(-78.169167);
    expect(points[0].gbifID).toBe(1261872764);
    expect(points[0].fields.citation).toBe("Royal Botanic Gardens, Kew");
    expect(points[0].fields.catalog_no).toBe("945435");
  });

  /** The row number has to match what Excel shows, or the message can't be acted on. */
  it("numbers rows as the spreadsheet does, counting the header", () => {
    const { points } = parseIucnPointFile(file(row(), row()), "f.csv");
    expect(points.map((p) => p.row)).toEqual([2, 3]);
  });

  // A real row in the schunkei file: full metadata, coordinates never filled
  // in. It's unfinished work rather than a typo, and reads differently.
  it("says when a row simply has no coordinates yet", () => {
    const { points, errors } = parseIucnPointFile(
      file(row({ dec_lat: "", dec_long: "", latitude: "", longitude: "" })),
      "f.csv"
    );
    expect(points).toHaveLength(0);
    expect(errors).toEqual(["Row 2: no coordinates filled in"]);
  });

  it("quotes back a value it couldn't read", () => {
    const { errors } = parseIucnPointFile(file(row({ dec_lat: "north of Jaén" })), "f.csv");
    expect(errors[0]).toContain("Row 2");
    expect(errors[0]).toContain("north of Jaén");
  });

  it("rejects a coordinate off the globe", () => {
    const { points, errors } = parseIucnPointFile(file(row({ dec_lat: "-104.2" })), "f.csv");
    expect(points).toHaveLength(0);
    expect(errors[0]).toMatch(/off the globe/);
  });

  /** One bad row shouldn't cost the other 134. */
  it("keeps the good rows and reports only the bad ones", () => {
    const { points, errors } = parseIucnPointFile(
      file(row(), row({ dec_lat: "", dec_long: "", latitude: "", longitude: "" }), row()),
      "f.csv"
    );
    expect(points).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it("falls back to latitude/longitude when dec_lat/dec_long are absent", () => {
    const text = "sci_name,latitude,longitude\nDioscorea schunkei,-4.46667,-78.169167";
    const { points, errors } = parseIucnPointFile(text, "f.csv");
    expect(errors).toEqual([]);
    expect(points[0].latitude).toBeCloseTo(-4.46667);
  });

  it("reads a file whose columns are reordered or renamed in caps", () => {
    const text = "DEC_LONG,DEC_LAT,SCI_NAME\n-78.169167,-4.46667,Dioscorea schunkei";
    const { points } = parseIucnPointFile(text, "f.csv");
    expect(points[0].latitude).toBeCloseTo(-4.46667);
    expect(points[0].longitude).toBeCloseTo(-78.169167);
  });

  it("notes columns that aren't part of the specification", () => {
    const text = "dec_lat,dec_long,my_notes\n-4.46667,-78.169167,checked";
    expect(parseIucnPointFile(text, "f.csv").extraColumns).toEqual(["my_notes"]);
  });

  it("turns away a file that isn't a point file at all", () => {
    const { points, errors } = parseIucnPointFile("species,count\nDioscorea,27", "f.csv");
    expect(points).toEqual([]);
    expect(errors[0]).toMatch(/dec_lat/);
  });

  it("says so when the file is empty, or has a header and nothing under it", () => {
    expect(parseIucnPointFile("", "f.csv").errors[0]).toMatch(/empty/i);
    expect(parseIucnPointFile(HEADER, "f.csv").errors[0]).toMatch(/no points/i);
  });
});

describe("pointSummary", () => {
  it("lists only the columns the assessor filled in", () => {
    const { points } = parseIucnPointFile(file(row({ dist_comm: "", tax_comm: "" })), "f.csv");
    const labels = pointSummary(points[0]).map((s) => s.label);
    expect(labels).toContain("Catalogue no.");
    expect(labels).not.toContain("Distribution comment");
  });
});

describe("comparePointFile", () => {
  const point = (over: Partial<Record<string, string>> = {}) =>
    parseIucnPointFile(file(row(over)), "f.csv").points[0];

  // ~1.1 km east of the file's coordinate at this latitude.
  const gbifRecord = {
    gbifID: 1261872764,
    lat: -4.46667,
    lon: -78.159167,
    via: "gbif-id" as const,
  };

  it("measures how far the delivered point sits from GBIF's own coordinate", () => {
    const c = comparePointFile([point()], () => gbifRecord, {});
    expect(c.rows[0].fromGbif).toBeGreaterThan(1000);
    expect(c.rows[0].fromGbif).toBeLessThan(1200);
    expect(c.placed).toBe(1);
  });

  it("treats a point still on GBIF's coordinate as not placed", () => {
    const p = point();
    const c = comparePointFile(
      [p],
      () => ({ gbifID: 1261872764, lat: p.latitude, lon: p.longitude, via: "gbif-id" }),
      {}
    );
    expect(c.rows[0].fromGbif).toBeLessThan(1);
    expect(c.placed).toBe(0);
  });

  /**
   * A record GBIF never located, now carrying a coordinate, is the whole
   * purpose of georeferencing — it counts as placed even though there's no
   * published coordinate to have moved away from.
   */
  it("counts a point against a record GBIF never located as placed", () => {
    const c = comparePointFile(
      [point()],
      () => ({ gbifID: 1261872764, lat: null, lon: null, via: "gbif-id" }),
      {}
    );
    expect(c.rows[0].fromGbif).toBeNull();
    expect(c.placed).toBe(1);
    expect(c.matched).toBe(1);
  });

  /** The interesting case: two readings of the same locality that disagree. */
  it("measures the gap against the assessor's own georeference for that record", () => {
    const c = comparePointFile([point()], () => gbifRecord, {
      1261872764: { decimalLatitude: -4.5, decimalLongitude: -78.169167 },
    });
    expect(c.rows[0].fromMine).toBeGreaterThan(3000);
    expect(c.alsoMine).toBe(1);
  });

  /**
   * A point that matched on catalogue number cites an id GBIF has since
   * retired, so the assessor's own georeference has to be looked up under the
   * matched record's id rather than the file's.
   */
  it("finds the assessor's georeference under the matched record, not the file's stale id", () => {
    const c = comparePointFile(
      [point()],
      () => ({ gbifID: 999, lat: null, lon: null, via: "catalog-no" }),
      { 999: { decimalLatitude: -4.5, decimalLongitude: -78.169167 } }
    );
    expect(c.rows[0].fromMine).toBeGreaterThan(3000);
    expect(c.matchedByCatalogNo).toBe(1);
  });

  it("counts a point with no GBIF source as unsourced, not as a mismatch", () => {
    const c = comparePointFile(
      [point({ source: "https://legacy.tropicos.org/Specimen/3425736" })],
      () => null,
      {}
    );
    expect(c.unsourced).toBe(1);
    expect(c.notFound).toBe(0);
    expect(c.matched).toBe(0);
    expect(c.rows[0].fromGbif).toBeNull();
  });

  // The file covers the whole assessment; the map holds a sample of it.
  it("counts a point whose record isn't among the loaded ones", () => {
    const c = comparePointFile([point()], () => null, {});
    expect(c.notFound).toBe(1);
    expect(c.unsourced).toBe(0);
    expect(c.matched).toBe(0);
  });
});

describe("normaliseCatalogNumber", () => {
  // "US 1142895" in the workbook is "US1142895" in GBIF; comparing anything but
  // letters and digits makes the join fail on formatting alone.
  it("ignores spacing, punctuation and case", () => {
    expect(normaliseCatalogNumber("US 1142895")).toBe(normaliseCatalogNumber("us1142895"));
    expect(normaliseCatalogNumber("B 10 0250002")).toBe(normaliseCatalogNumber("B-10-0250002"));
  });

  it("gives an empty string for nothing", () => {
    expect(normaliseCatalogNumber(null)).toBe("");
    expect(normaliseCatalogNumber("")).toBe("");
  });
});

describe("biggestDisagreements", () => {
  it("puts the widest gap against the assessor's own work first", () => {
    const points = [
      { ...parseIucnPointFile(file(row()), "f.csv").points[0], gbifID: 1 },
      { ...parseIucnPointFile(file(row()), "f.csv").points[0], gbifID: 2 },
    ];
    const c = comparePointFile(
      points,
      (p) => ({ gbifID: p.gbifID as number, lat: null, lon: null, via: "gbif-id" }),
      {
        1: { decimalLatitude: -4.47, decimalLongitude: -78.169167 },
        2: { decimalLatitude: -5.5, decimalLongitude: -78.169167 },
      }
    );
    expect(biggestDisagreements(c).map((r) => r.point.gbifID)).toEqual([2, 1]);
  });

  it("leaves out points the assessor hasn't georeferenced", () => {
    const c = comparePointFile([parseIucnPointFile(file(row()), "f.csv").points[0]], () => null, {});
    expect(biggestDisagreements(c)).toEqual([]);
  });
});

describe("buildIucnPointFileCsv", () => {
  const record = {
    gbifID: 2013787280,
    species: "Dioscorea biplicata",
    latitude: 4.366667,
    longitude: -75.750833,
    year: 1995,
    basisOfRecord: "PRESERVED_SPECIMEN",
    catalogNumber: "409847",
    recordedBy: "C. Vélez",
  };

  /** The `year` column of every written row, in the order they were written. */
  const yearsOf = (csv: string) => {
    const [header, ...rows] = csv.trim().split("\n");
    const i = header.split(",").indexOf("event_year");
    return rows.map((r) => r.split(",")[i]);
  };

  it("writes the points oldest first, whatever order they came in", () => {
    const csv = buildIucnPointFileCsv([
      { ...record, gbifID: 1, year: 2011 },
      { ...record, gbifID: 2, year: 1963 },
      { ...record, gbifID: 3, year: 1995 },
    ]);
    expect(yearsOf(csv)).toEqual(["1963", "1995", "2011"]);
  });

  it("dates a record from its eventDate where it has no year of its own", () => {
    const csv = buildIucnPointFileCsv([
      { ...record, gbifID: 1, year: undefined, eventDate: "2004-06-01" },
      { ...record, gbifID: 2, year: 1974 },
    ]);
    expect(yearsOf(csv)).toEqual(["1974", "2004"]);
  });

  it("puts the undated last — they aren't the oldest, they're unplaceable", () => {
    const csv = buildIucnPointFileCsv([
      { ...record, gbifID: 1, year: undefined, eventDate: undefined },
      { ...record, gbifID: 2, year: 1988 },
    ]);
    expect(yearsOf(csv)).toEqual(["1988", ""]);
  });

  it("keeps records of the same year in the order they arrived", () => {
    const csv = buildIucnPointFileCsv([
      { ...record, gbifID: 7, year: 1990, catalogNumber: "first" },
      { ...record, gbifID: 8, year: 1990, catalogNumber: "second" },
    ]);
    const order = csv.trim().split("\n").slice(1).map((r) => (r.includes("first") ? "first" : "second"));
    expect(order).toEqual(["first", "second"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [{ ...record, year: 2011 }, { ...record, year: 1963 }];
    buildIucnPointFileCsv(input);
    expect(input.map((r) => r.year)).toEqual([2011, 1963]);
  });

  it("writes the IUCN columns, in the order the importer reads them", () => {
    const csv = buildIucnPointFileCsv([record]);
    const [header, row] = csv.trim().split("\n");
    expect(header.split(",")).toEqual([...IUCN_POINT_FILE_COLUMNS]);
    const cells = Object.fromEntries(
      IUCN_POINT_FILE_COLUMNS.map((key, i) => [key, splitDelimited(row, ",")[i]])
    );
    expect(cells.sci_name).toBe("Dioscorea biplicata");
    expect(cells.dec_lat).toBe("4.366667");
    expect(cells.dec_long).toBe("-75.750833");
    expect(cells.latitude).toBe(cells.dec_lat);
    expect(cells.spatialref).toBe("WGS84");
    expect(cells.event_year).toBe("1995");
    expect(cells.source).toBe("www.gbif.org/occurrence/2013787280");
    expect(cells.catalog_no).toBe("409847");
  });

  it("spells the basis of record the way the file does, not the way GBIF does", () => {
    const csv = buildIucnPointFileCsv([record]);
    expect(csv).toContain("PreservedSpecimen");
    expect(csv).not.toContain("PRESERVED_SPECIMEN");
  });

  it("reads back as the points it was given", () => {
    const csv = buildIucnPointFileCsv([record, { ...record, gbifID: 9, latitude: -1, longitude: 2 }]);
    const parsed = parseIucnPointFile(csv, "export.csv");
    expect(parsed.errors).toEqual([]);
    expect(parsed.points.map((p) => [p.gbifID, p.latitude, p.longitude])).toEqual([
      [2013787280, 4.366667, -75.750833],
      [9, -1, 2],
    ]);
  });

  it("quotes a field that carries a comma", () => {
    const csv = buildIucnPointFileCsv([{ ...record, recordedBy: "Zak, V.; Jaramillo, J." }]);
    expect(csv).toContain('"Zak, V.; Jaramillo, J."');
    expect(parseIucnPointFile(csv, "e.csv").points[0].fields.recordedby).toBe("Zak, V.; Jaramillo, J.");
  });

  it("says which points a person georeferenced, since the file otherwise can't tell", () => {
    const csv = buildIucnPointFileCsv([{ ...record, georeferenced: true }]);
    expect(parseIucnPointFile(csv, "e.csv").points[0].fields.dist_comm).toMatch(/Georeferenced/);
  });
});
