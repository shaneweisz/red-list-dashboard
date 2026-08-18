/**
 * The IUCN point file, read from a CSV saved out of the assessor's workbook.
 *
 * This is the sheet an assessment is actually delivered on — the one that goes
 * to IUCN — so it's the assessor's finished answer for a species, not a working
 * note. Bringing it in lets the map show that answer beside GBIF's raw records
 * and beside whatever the assessor has since georeferenced here.
 *
 * It is deliberately read-only and stored apart from the assessor's own
 * georeferences. An earlier attempt round-tripped this workbook through the
 * clipboard and had to guess, row by row, whether a coordinate was the
 * assessor's own work or GBIF's copied into the sheet — a guess with no
 * reliable signal behind it (`LLORIG` says "GBIF" on rows carrying a
 * hand-measured radius) and no safe way to be wrong. Keeping the file as its
 * own layer removes the question entirely: everything in it came from the file,
 * and nothing in it silently becomes an edit.
 *
 * The 24 columns are IUCN's, in the workbook's order. Parsing keys off the
 * header row rather than position, so a file with columns reordered, renamed in
 * case, or carrying extras still reads.
 */

import { haversineMetres, type LngLat } from "@/lib/geo-distance";

/** The columns IUCN's point file specification defines, in the workbook's order. */
export const IUCN_POINT_FILE_COLUMNS = [
  "sci_name",
  "presence",
  "origin",
  "seasonal",
  "compiler",
  "yrcompiled",
  "citation",
  "dec_lat",
  "dec_long",
  "latitude",
  "longitude",
  "spatialref",
  "subspecies",
  "subpop",
  "data_sens",
  "sens_comm",
  "event_year",
  "source",
  "basisofrec",
  "catalog_no",
  "recordedby",
  "recordno",
  "dist_comm",
  "tax_comm",
] as const;

export interface IucnPoint {
  /** Row in the file as a spreadsheet counts them, header included. */
  row: number;
  latitude: number;
  longitude: number;
  /**
   * The GBIF record this row was built from, when `source` names one.
   *
   * This is what makes the file comparable rather than merely displayable: it
   * joins a delivered point back to the record on the map. Not every row has
   * one — a point traced to a Tropicos sheet or a journal article is still a
   * valid IUCN point, just not a GBIF one.
   */
  gbifID: number | null;
  /** Every column as written, for showing the row as the assessor filled it. */
  fields: Record<string, string>;
}

export interface PointFileImport {
  fileName: string;
  importedAt: string;
  points: IucnPoint[];
  /** One message per rejected row, quoting the row number to go and find. */
  errors: string[];
  /** Headers that weren't part of the IUCN specification, if any. */
  extraColumns: string[];
}

/** Split one delimited line, honouring quoted fields and doubled quotes. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Whichever of comma, tab and semicolon splits the header into most fields.
 *
 * "Save as CSV" writes semicolons rather than commas under a locale that uses
 * the comma as its decimal separator, and copying a sheet range gives tabs.
 * All three arrive looking like a CSV to the person sending it.
 */
export function detectDelimiter(headerLine: string): string {
  return [",", "\t", ";"]
    .map((d) => ({ d, n: splitDelimited(headerLine, d).length }))
    .sort((a, b) => b.n - a.n)[0].d;
}

/** The GBIF record id in a `source` value, when it names a GBIF occurrence. */
export function gbifIdFromSource(source: string): number | null {
  const match = source.match(/gbif\.org\/occurrence\/(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Coordinates written for a spreadsheet rather than for a parser.
 *
 * Excel exports what the cell holds, which under a comma-decimal locale is
 * "-4,4667", and assessors sometimes leave a degree sign on. Both are
 * unambiguous once the field has already been split off, so reading them is
 * better than rejecting the row and making someone edit the file by hand.
 */
export function parseCoordinate(raw: string): number | null {
  const cleaned = raw.trim().replace(/[°\s]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const KNOWN_COLUMNS = new Set<string>(IUCN_POINT_FILE_COLUMNS);

/**
 * Read an IUCN point file.
 *
 * Rows are rejected individually and reported by row number, rather than
 * failing the whole file: a 135-row sheet with one bad coordinate should give
 * up 134 points and one message, not nothing.
 */
export function parseIucnPointFile(text: string, fileName: string): PointFileImport {
  const base: PointFileImport = {
    fileName,
    importedAt: new Date().toISOString(),
    points: [],
    errors: [],
    extraColumns: [],
  };

  const lines = text.split(/\r?\n/);
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmpty === -1) return { ...base, errors: ["The file is empty"] };

  const delimiter = detectDelimiter(lines[firstNonEmpty]);
  const headers = splitDelimited(lines[firstNonEmpty], delimiter).map((h) =>
    h.trim().toLowerCase().replace(/^﻿/, "")
  );
  const column = (name: string) => headers.indexOf(name);

  // dec_lat/dec_long are the specification's; latitude/longitude duplicate them
  // in the workbook and are all some exports carry.
  const latIdx = column("dec_lat") !== -1 ? column("dec_lat") : column("latitude");
  const lonIdx = column("dec_long") !== -1 ? column("dec_long") : column("longitude");
  if (latIdx === -1 || lonIdx === -1) {
    return {
      ...base,
      errors: [
        "This doesn't look like an IUCN point file — it needs dec_lat and dec_long columns (or latitude and longitude).",
      ],
    };
  }

  const errors: string[] = [];
  const points: IucnPoint[] = [];

  for (let i = firstNonEmpty + 1; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    const values = splitDelimited(lines[i], delimiter);
    // 1-based and counting the header, so it matches the row number in Excel.
    const row = i + 1;

    const fields: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) fields[h] = (values[idx] ?? "").trim();
    });

    const rawLat = (values[latIdx] ?? "").trim();
    const rawLon = (values[lonIdx] ?? "").trim();
    const latitude = parseCoordinate(rawLat);
    const longitude = parseCoordinate(rawLon);
    if (latitude === null || longitude === null) {
      // A blank is a record the assessor meant to include and never got to,
      // which is worth saying differently from a value that failed to read —
      // one is unfinished work, the other is a typo.
      errors.push(
        rawLat === "" && rawLon === ""
          ? `Row ${row}: no coordinates filled in`
          : `Row ${row}: couldn't read "${rawLat}, ${rawLon}" as coordinates`
      );
      continue;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      errors.push(`Row ${row}: ${latitude}, ${longitude} is off the globe`);
      continue;
    }

    points.push({
      row,
      latitude,
      longitude,
      gbifID: gbifIdFromSource(fields.source ?? ""),
      fields,
    });
  }

  if (points.length === 0 && errors.length === 0) {
    errors.push("The file has a header row but no points under it");
  }

  return {
    ...base,
    points,
    errors,
    extraColumns: headers.filter((h) => h && !KNOWN_COLUMNS.has(h)),
  };
}

/** How a point file row reads in a tooltip: its identifying columns, if filled. */
export function pointSummary(point: IucnPoint): { label: string; value: string }[] {
  const show = [
    ["sci_name", "Species"],
    ["event_year", "Year"],
    ["basisofrec", "Basis of record"],
    ["catalog_no", "Catalogue no."],
    ["recordedby", "Recorded by"],
    ["recordno", "Record no."],
    ["compiler", "Compiler"],
    ["citation", "Citation"],
    ["dist_comm", "Distribution comment"],
  ] as const;
  return show
    .filter(([key]) => (point.fields[key] ?? "").length > 0)
    .map(([key, label]) => ({ label, value: point.fields[key] }));
}

// ---------------------------------------------------------------------------
// Storage
//
// Its own key, not folded into the assessor's edits: this is a file they
// brought, and undoing an edit should never quietly swap out the reference
// layer they are comparing against.
// ---------------------------------------------------------------------------

export const POINT_FILE_SCHEMA_VERSION = 1;
const STORAGE_PREFIX = "redlist-pointfile";

function storageKey(speciesKey: string): string {
  return `${STORAGE_PREFIX}:v${POINT_FILE_SCHEMA_VERSION}:${speciesKey}`;
}

interface StoredPointFile {
  version: number;
  imported: PointFileImport;
}

export function loadPointFile(speciesKey: string): PointFileImport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(speciesKey));
    if (!raw) return null;
    const parsed: StoredPointFile = JSON.parse(raw);
    if (parsed.version !== POINT_FILE_SCHEMA_VERSION) return null;
    return parsed.imported ?? null;
  } catch {
    return null;
  }
}

/** Replace the stored file for one species. Returns false if the write failed. */
export function savePointFile(speciesKey: string, imported: PointFileImport): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: StoredPointFile = { version: POINT_FILE_SCHEMA_VERSION, imported };
    window.localStorage.setItem(storageKey(speciesKey), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearPointFile(speciesKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(speciesKey));
  } catch {
    // Nothing to do: the layer is already gone from the map either way.
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * How a point in the file was tied back to a record on the map.
 *
 * The GBIF occurrence id looks like the obvious key and is not a sufficient
 * one. GBIF reissues occurrence ids when a dataset is re-indexed, so a file
 * compiled a few months earlier cites ids that no longer resolve: of the twelve
 * points in the Dioscorea biplicata file, five still matched by id while seven
 * matched on catalogue number, and the five were a subset of the seven.
 * Matching on id alone would have thrown away most of the comparison and
 * reported the loss as "not in the loaded sample".
 */
export type MatchVia = "gbif-id" | "catalog-no";

export interface MatchedRecord {
  gbifID: number;
  /** GBIF's own coordinate, or null where it published none — which is
   *  precisely the case the assessor georeferenced the record for. */
  lat: number | null;
  lon: number | null;
  via: MatchVia;
}

export interface PointComparison {
  point: IucnPoint;
  /** The record on the map this point belongs to, if it could be found. */
  matched: MatchedRecord | null;
  /** Metres from GBIF's own coordinate for that record. */
  fromGbif: number | null;
  /** Metres from the assessor's georeference for that record. */
  fromMine: number | null;
}

export interface PointFileComparison {
  rows: PointComparison[];
  /** Points tied to a record currently loaded. */
  matched: number;
  /** Of those, the ones that only matched on catalogue number. */
  matchedByCatalogNo: number;
  /** Points naming no GBIF record at all — literature, herbarium catalogues. */
  unsourced: number;
  /** Points that name a record but couldn't be found among the loaded ones. */
  notFound: number;
  /**
   * Points sitting somewhere GBIF didn't put them — either moved off a
   * published coordinate, or placed against a record GBIF never located. This
   * is the georeferencing work the file carries.
   */
  placed: number;
  /** Points the assessor has also georeferenced here. */
  alsoMine: number;
}

/** Anything further than this from GBIF's coordinate was placed, not copied. */
const MOVED_THRESHOLD_METRES = 100;

/**
 * Catalogue numbers as written by two different systems.
 *
 * The same sheet appears as "US 1142895" in the workbook and "US1142895" in
 * GBIF, or with a leading zero one side and not the other. Comparing anything
 * but letters and digits, case-folded, makes the join fail on formatting.
 */
export function normaliseCatalogNumber(raw: string | null | undefined): string {
  return (raw ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Where each point in the file sits relative to what's on the map.
 *
 * The two distances are the reason for loading it: `fromGbif` says whether the
 * assessor put the record somewhere other than where GBIF published it, and
 * `fromMine` says whether the delivered answer agrees with the one being worked
 * out here. A large `fromMine` is the interesting case — two readings of the
 * same locality that disagree — and it is exactly what merging the file into
 * one layer would have hidden.
 */
export function comparePointFile(
  points: IucnPoint[],
  match: (point: IucnPoint) => MatchedRecord | null,
  georeferences: Record<number, { decimalLatitude: number; decimalLongitude: number }>
): PointFileComparison {
  const rows = points.map<PointComparison>((point) => {
    const here: LngLat = [point.longitude, point.latitude];
    const matched = match(point);
    // Keyed on the matched record's id, not the file's: a point that matched on
    // catalogue number cites an id GBIF has since retired, and looking the
    // assessor's own georeference up under that would find nothing.
    const mine = matched ? georeferences[matched.gbifID] : undefined;
    return {
      point,
      matched,
      fromGbif:
        matched && matched.lat != null && matched.lon != null
          ? haversineMetres(here, [matched.lon, matched.lat])
          : null,
      fromMine: mine ? haversineMetres(here, [mine.decimalLongitude, mine.decimalLatitude]) : null,
    };
  });

  return {
    rows,
    matched: rows.filter((r) => r.matched).length,
    matchedByCatalogNo: rows.filter((r) => r.matched?.via === "catalog-no").length,
    unsourced: rows.filter((r) => r.point.gbifID == null && !r.matched).length,
    notFound: rows.filter((r) => r.point.gbifID != null && !r.matched).length,
    // A record GBIF never located, now carrying a coordinate, is placed work
    // just as much as one moved off a published coordinate is.
    placed: rows.filter(
      (r) =>
        (r.fromGbif != null && r.fromGbif > MOVED_THRESHOLD_METRES) ||
        (r.matched != null && r.matched.lat == null)
    ).length,
    alsoMine: rows.filter((r) => r.fromMine != null).length,
  };
}

/** The comparisons worth looking at first: where the two answers disagree most. */
export function biggestDisagreements(comparison: PointFileComparison, limit = 10): PointComparison[] {
  return comparison.rows
    .filter((r) => r.fromMine != null)
    .sort((a, b) => (b.fromMine ?? 0) - (a.fromMine ?? 0))
    .slice(0, limit);
}
