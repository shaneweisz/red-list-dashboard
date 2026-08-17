/**
 * Moving georeferences between this tool and the assessors' spreadsheet.
 *
 * The established workflow is a georeferencing workbook driven from GBIF: a
 * GBIF export lands in its own sheet, the assessor does the hand work in
 * `Manual_georeferencing_data`, and two further sheets — the GeoCAT point file
 * and the IUCN point file — are derived from it by formula. (The workbook also
 * has sheets for a BRAHMS export; in practice those go unused.)
 *
 * Those formulas are why this module is careful: they address columns by
 * position, so anything pasted back has to have the same columns in the same
 * order or the workbook silently starts producing #REF!.
 *
 * The exchange is therefore deliberately narrow. We read a pasted copy of that
 * one sheet, take only the georeferencing fields from it, and give it back with
 * only those fields changed. Every other column is carried through untouched,
 * including ones this app knows nothing about.
 *
 * Excel puts TSV on the clipboard when you copy a range, which is why paste is
 * the primary path: no file to save, no download folder, nothing to name.
 */

import type { Georeference, Exclusion } from "./georeferences";

/** The only columns the exchange reads and writes. Everything else passes through. */
const GBIF_ID = "GBIFID";
const LAT = "LAT";
const LON = "LONG";
const ERR_RAD = "ERRRAD";
const GEONOTES = "GEONOTES";
const LL_ORIG = "LLORIG";

/**
 * The template's columns, for a sheet built from scratch rather than round-tripped.
 *
 * Taken from a real worksheet. The order matters for the same reason as above,
 * and the set varies slightly between assessors — one had KEWSOURCE, four
 * didn't — which is why a round-trip always prefers the header row it was
 * given over this one.
 */
export const WORKSHEET_COLUMNS = [
  "NAME", "BARCODE", "BOTRECCAT", "FAMILY", "GENUS", "SP1", "RANK1", "SP2", "VERBATIMTAXON",
  "DETBY", "DETDD", "DETMM", "DETYY", "COLLECTOR", "ADDCOLL", "PREFIX", "NUMBER", "SUFFIX",
  "COLLDD", "COLLMM", "COLLYY", "LOCNOTES", "KEWAREA", "COUNTRY", "MAJORAREA", "MINORAREA",
  "LOCALITY", "COORD", "LATDEG", "LATMIN", "LATSEC", "NS", "LONGDEG", "LONGMIN", "LONGSEC", "EW",
  LAT, LON, "LLUNIT", LL_ORIG, "GAZETTEER", "GEOCHECK", ERR_RAD, GEONOTES, "ALT", "ALTMAX",
  "HABITATTXT", "PLANTDESC", "FREQUENCY", "POP SIZE", "POP DETAILS", "FLCODE", "FRCODE",
  "VERNACULAR", "LANGUAGE", "USES", "NOTES", "DUPS", "SOURCE", GBIF_ID,
];

/**
 * Splits delimited text into rows, honouring quotes.
 *
 * A quoted field is necessary rather than fussy here: GEONOTES holds the
 * assessor's reasoning, which routinely contains commas, tabs and line breaks,
 * and Excel quotes it on copy. Splitting on the delimiter alone tears those
 * cells apart and silently shifts every column after them.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Tab for a clipboard paste out of Excel, comma for a saved CSV. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.includes("\t") ? "\t" : ",";
}

/**
 * Reads an error radius the way the sheet writes it.
 *
 * Free text in practice: "10km", "15km" with a trailing tab, "1.5 km", a bare
 * "600" meaning metres, and "0" meaning none stated. A radius that can't be
 * read is reported rather than guessed at, since inventing precision is the one
 * thing a georeference must never do.
 */
export function parseErrorRadius(raw: string | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim().toLowerCase();
  if (text === "" || text === "0") return 0;
  const match = text.match(/^([\d.]+)\s*(km|m|metres|meters)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2] === "km" ? Math.round(value * 1000) : Math.round(value);
}

/** Written back in the sheet's own idiom: kilometres where it divides evenly. */
export function formatErrorRadius(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return "0";
  if (metres >= 1000 && metres % 1000 === 0) return `${metres / 1000}km`;
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)}km`;
  return String(Math.round(metres));
}

export interface WorksheetImport {
  /** The sheet's own header row, kept so the paste back can match it exactly. */
  headers: string[];
  /** Every data row, verbatim, including columns this app doesn't understand. */
  rows: string[][];
  /** Georeferences read from rows that had usable coordinates. */
  georeferences: Georeference[];
  /** Rows whose coordinates couldn't be used, with the reason. */
  skipped: { row: number; gbifID: string; reason: string }[];
  /** Rows carrying coordinates but no stated radius — imported, worth flagging. */
  withoutRadius: number;
}

const number_ = (raw: string | undefined): number | null => {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
};

/**
 * Reads a pasted `Manual_georeferencing_data` sheet.
 *
 * Keyed on GBIFID, which every worksheet examined carries — the workflow is
 * GBIF-driven — and which is what this app's georeferences are keyed on too, so
 * the join needs no matching heuristics. Columns are found by name, never by
 * position, because the template's column set differs between assessors.
 */
export function parseWorksheet(
  text: string,
  options: { georeferencedBy?: string | null; scientificName?: string } = {}
): WorksheetImport {
  const rows = parseDelimited(text, detectDelimiter(text));
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const index = new Map(headers.map((h, i) => [h.toUpperCase(), i]));
  const at = (row: string[], column: string) => {
    const i = index.get(column.toUpperCase());
    return i == null ? undefined : row[i];
  };

  const georeferences: Georeference[] = [];
  const skipped: WorksheetImport["skipped"] = [];
  let withoutRadius = 0;
  const dataRows = rows.slice(1);

  dataRows.forEach((row, i) => {
    const rawId = at(row, GBIF_ID)?.trim() ?? "";
    const lat = number_(at(row, LAT));
    const lon = number_(at(row, LON));
    // A row with no coordinates isn't an error — most of the sheet starts that
    // way — so it's only worth reporting when it also can't be identified.
    if (lat == null || lon == null) return;
    const gbifID = Number(rawId);
    if (!rawId || !Number.isFinite(gbifID)) {
      skipped.push({ row: i + 2, gbifID: rawId, reason: "no GBIF id to attach it to" });
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skipped.push({ row: i + 2, gbifID: rawId, reason: `coordinates out of range (${lat}, ${lon})` });
      return;
    }
    const radius = parseErrorRadius(at(row, ERR_RAD));
    if (radius == null) {
      skipped.push({ row: i + 2, gbifID: rawId, reason: `couldn't read the radius "${at(row, ERR_RAD)}"` });
      return;
    }
    if (radius === 0) withoutRadius += 1;
    georeferences.push({
      gbifID,
      scientificName: options.scientificName,
      decimalLatitude: lat,
      decimalLongitude: lon,
      coordinateUncertaintyInMeters: radius,
      georeferenceRemarks: at(row, GEONOTES)?.trim() || undefined,
      // LLORIG is the sheet's own record of where the coordinates came from.
      georeferenceProtocol: at(row, LL_ORIG)?.trim() || undefined,
      georeferencedBy: options.georeferencedBy || undefined,
      georeferencedDate: new Date().toISOString(),
    });
  });

  return { headers, rows: dataRows, georeferences, skipped, withoutRadius };
}

function toTsv(rows: string[][]): string {
  const cell = (value: string) =>
    /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return rows.map((row) => row.map(cell).join("\t")).join("\n");
}

/**
 * The sheet as it came in, with this app's georeferences written into it.
 *
 * Only LAT, LONG, ERRRAD, GEONOTES and LLORIG are touched; every other column
 * is returned byte-for-byte, so the derived GeoCAT and IUCN sheets keep
 * working. Excluded records are left out, which is what deleting a row means in
 * the sheet — `excludedRowsTsv` below hands them back separately so the reasons
 * aren't quietly lost.
 */
export function worksheetWithGeoreferences(
  imported: Pick<WorksheetImport, "headers" | "rows">,
  georeferences: Record<number, Georeference>,
  exclusions: Record<number, Exclusion> = {}
): string {
  const index = new Map(imported.headers.map((h, i) => [h.trim().toUpperCase(), i]));
  const set = (row: string[], column: string, value: string) => {
    const i = index.get(column.toUpperCase());
    if (i != null) row[i] = value;
  };
  const idAt = index.get(GBIF_ID);

  const out: string[][] = [imported.headers];
  for (const original of imported.rows) {
    const gbifID = idAt == null ? NaN : Number(original[idAt]?.trim());
    if (Number.isFinite(gbifID) && exclusions[gbifID]) continue;
    const row = [...original];
    const mine = Number.isFinite(gbifID) ? georeferences[gbifID] : undefined;
    if (mine) {
      set(row, LAT, String(mine.decimalLatitude));
      set(row, LON, String(mine.decimalLongitude));
      set(row, ERR_RAD, formatErrorRadius(mine.coordinateUncertaintyInMeters));
      if (mine.georeferenceRemarks) set(row, GEONOTES, mine.georeferenceRemarks);
      if (mine.georeferenceProtocol) set(row, LL_ORIG, mine.georeferenceProtocol);
    }
    out.push(row);
  }
  return toTsv(out);
}

/**
 * The records struck out, and why.
 *
 * Excluding a record in the sheet means deleting its row, which loses the
 * reasoning with it. This is the same information as a separate block to paste
 * wherever the assessor keeps notes.
 */
export function excludedRowsTsv(
  imported: Pick<WorksheetImport, "headers" | "rows">,
  exclusions: Record<number, Exclusion>
): string {
  const index = new Map(imported.headers.map((h, i) => [h.trim().toUpperCase(), i]));
  const idAt = index.get(GBIF_ID);
  const barcodeAt = index.get("BARCODE");
  const out: string[][] = [["GBIFID", "BARCODE", "EXCLUSION_REASON", "EXCLUDED_BY", "EXCLUDED_AT"]];
  for (const row of imported.rows) {
    const gbifID = idAt == null ? NaN : Number(row[idAt]?.trim());
    const exclusion = Number.isFinite(gbifID) ? exclusions[gbifID] : undefined;
    if (!exclusion) continue;
    out.push([
      String(gbifID),
      (barcodeAt != null ? row[barcodeAt] : "") ?? "",
      exclusion.justification,
      exclusion.excludedBy ?? "",
      exclusion.excludedAt,
    ]);
  }
  return toTsv(out);
}

/**
 * Whether a row represents the assessor's own georeferencing, or just GBIF's
 * coordinates carried into the sheet.
 *
 * This distinction can't be read off the sheet. `Manual_georeferencing_data`
 * starts as a copy of the GBIF export, so a populated LAT/LONG usually means
 * "GBIF said so", not "I worked this out" — one worksheet examined had 135 such
 * rows. And LLORIG can't settle it either: it said "GBIF" on all twelve rows of
 * a worksheet whose author had demonstrably rewritten the coordinates by hand,
 * six of them with a radius and seven with reasoning. Nobody updates a
 * provenance column while thinking about a locality.
 *
 * So the test is against GBIF itself: coordinates that differ are the
 * assessor's, and coordinates that agree are still theirs if they've attached a
 * radius or a note — deciding that GBIF's point is right, to within 10 km, is a
 * georeferencing judgement and worth keeping.
 */
export function isAssessorsOwn(
  candidate: Pick<
    Georeference,
    "decimalLatitude" | "decimalLongitude" | "coordinateUncertaintyInMeters" | "georeferenceRemarks"
  >,
  gbif: { lat: number; lon: number } | null
): boolean {
  if (!gbif) return true;
  // ~1 m, well below the precision any of these sheets record.
  const moved =
    Math.abs(candidate.decimalLatitude - gbif.lat) > 1e-5 ||
    Math.abs(candidate.decimalLongitude - gbif.lon) > 1e-5;
  if (moved) return true;
  return candidate.coordinateUncertaintyInMeters > 0 || !!candidate.georeferenceRemarks?.trim();
}
