/**
 * Assessor-supplied georeferences for GBIF occurrence records.
 *
 * A great many GBIF records — herbarium sheets above all — carry a written
 * locality and no coordinates: "Indian garden. Valle de Sibundoy, 1.5 km SW
 * Sibundoy", 2200 m. Resolving one of those to a point and a radius is skilled,
 * slow work, and it is exactly the work an assessor does by hand when building
 * an assessment. This module is where that work is kept.
 *
 * A georeference is an *attribute of an existing GBIF record*, keyed by gbifID —
 * never a new occurrence. That keeps every GBIF count in the viewer honest: the
 * assessor's points are drawn and exported separately and are never folded into
 * "N GBIF records".
 *
 * Storage is the browser's localStorage, per species. That is deliberately the
 * first increment and not the last: it needs no account, no schema and no
 * decision about who vouches for the coordinates. It is also fragile — one
 * cleared cache and an afternoon's georeferencing is gone — which is why export
 * (and re-import) in Darwin Core terms is part of the feature rather than a
 * later nicety, and why the shape below is the shape a server table would take.
 */

/** Bumped only for a breaking change to the stored shape; read paths check it. */
export const GEOREFERENCE_SCHEMA_VERSION = 1;

const STORAGE_PREFIX = "redlist-georefs";

/** WGS84 throughout — the datum GBIF publishes in and IUCN assessments use. */
export const GEODETIC_DATUM = "WGS84";

/**
 * How a locality was resolved to a point. Free text is allowed (the list is a
 * convenience, not a controlled vocabulary), but these are the tools assessors
 * actually name in georeferenceProtocol.
 */
export const GEOREFERENCE_PROTOCOLS = [
  "GEOLocate",
  "Google Earth",
  "Gazetteer",
  "Topographic map",
  "Collector's field notes",
  "Point-radius from locality description",
] as const;

export interface Georeference {
  /** The GBIF record this position belongs to. */
  gbifID: number;
  /**
   * The publishing institution's own identifier for the record. GBIF keys are
   * durable but can be re-issued when a dataset is republished, and this is the
   * only thing that survives that — without it a re-key silently orphans the
   * work.
   */
  occurrenceID?: string;
  decimalLatitude: number;
  decimalLongitude: number;
  /**
   * Required, not optional. A point without a radius can't feed an EOO/AOO
   * calculation and misrepresents a locality like "Napo" as a pinpoint; the
   * radius is the whole of the point-radius method.
   */
  coordinateUncertaintyInMeters: number;
  georeferenceProtocol?: string;
  georeferenceRemarks?: string;
  /** Who did the work — filled from the signed-in account where there is one. */
  georeferencedBy?: string;
  /** ISO 8601, stamped on save. */
  georeferencedDate: string;
  /**
   * The locality text this was derived from, copied at save time so an exported
   * row stands on its own when it reaches a herbarium's data manager.
   */
  verbatimLocality?: string;
  /** Copied for the same reason — an export shouldn't need the app to be read. */
  scientificName?: string;
}

interface StoredGeoreferences {
  version: number;
  updatedAt: string;
  /** Keyed by gbifID as a string, since JSON object keys are strings. */
  records: Record<string, Georeference>;
}

function storageKey(speciesKey: string): string {
  return `${STORAGE_PREFIX}:v${GEOREFERENCE_SCHEMA_VERSION}:${speciesKey}`;
}

/** Every georeference stored for one species, keyed by gbifID. */
export function loadGeoreferences(speciesKey: string): Record<number, Georeference> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(speciesKey));
    if (!raw) return {};
    const parsed: StoredGeoreferences = JSON.parse(raw);
    if (parsed.version !== GEOREFERENCE_SCHEMA_VERSION) return {};
    const out: Record<number, Georeference> = {};
    for (const [id, g] of Object.entries(parsed.records ?? {})) {
      out[Number(id)] = g;
    }
    return out;
  } catch {
    // A corrupt or unreadable store must not take the occurrence viewer down
    // with it — the georeferences are an overlay, not the page.
    return {};
  }
}

/** Replace the stored set for one species. Returns false if the write failed. */
export function saveGeoreferences(
  speciesKey: string,
  records: Record<number, Georeference>
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: StoredGeoreferences = {
      version: GEOREFERENCE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      records: Object.fromEntries(Object.entries(records)),
    };
    window.localStorage.setItem(storageKey(speciesKey), JSON.stringify(payload));
    return true;
  } catch {
    // Quota exceeded, or storage disabled (private windows, locked-down
    // browsers). Reported to the user rather than swallowed: silently losing
    // this particular work is the failure mode worth shouting about.
    return false;
  }
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Reject anything that can't be a WGS84 point with a usable radius. */
export function validateGeoreference(input: {
  decimalLatitude: number | null;
  decimalLongitude: number | null;
  coordinateUncertaintyInMeters: number | null;
}): ValidationResult {
  const errors: string[] = [];
  const { decimalLatitude: lat, decimalLongitude: lon, coordinateUncertaintyInMeters: unc } = input;

  if (lat == null || Number.isNaN(lat)) errors.push("Latitude is required");
  else if (lat < -90 || lat > 90) errors.push("Latitude must be between −90 and 90");

  if (lon == null || Number.isNaN(lon)) errors.push("Longitude is required");
  else if (lon < -180 || lon > 180) errors.push("Longitude must be between −180 and 180");

  if (unc == null || Number.isNaN(unc)) errors.push("Uncertainty radius is required");
  else if (unc <= 0) errors.push("Uncertainty radius must be greater than 0");

  // (0, 0) is the single most common bad coordinate in biodiversity data — it's
  // what an empty field parses to. Catching it here means the tool can't
  // reintroduce the very error its coordinate-cleaning checks exist to find.
  if (lat === 0 && lon === 0) errors.push("(0, 0) is not a real locality — check the coordinates");

  return { ok: errors.length === 0, errors };
}

/**
 * Accept a pasted "lat, lon" pair (or "lat lon"), which is what copying out of
 * GEOLocate, Google Earth or a gazetteer actually puts on the clipboard.
 * Returns null when the text isn't a coordinate pair, so the caller can leave
 * whatever was typed alone.
 */
export function parseCoordinatePair(text: string): { lat: number; lon: number } | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Darwin Core terms, in the order they appear in an export.
 *
 * This is the vocabulary GBIF publishes in and herbaria receive corrections in,
 * which is the point of exporting at all: the file can go back to the
 * publishing institution and fix the record at source, not just feed one
 * assessment.
 */
const CSV_COLUMNS: { header: string; get: (g: Georeference) => string }[] = [
  { header: "gbifID", get: (g) => String(g.gbifID) },
  { header: "occurrenceID", get: (g) => g.occurrenceID ?? "" },
  { header: "scientificName", get: (g) => g.scientificName ?? "" },
  { header: "verbatimLocality", get: (g) => g.verbatimLocality ?? "" },
  { header: "decimalLatitude", get: (g) => String(g.decimalLatitude) },
  { header: "decimalLongitude", get: (g) => String(g.decimalLongitude) },
  { header: "geodeticDatum", get: () => GEODETIC_DATUM },
  { header: "coordinateUncertaintyInMeters", get: (g) => String(g.coordinateUncertaintyInMeters) },
  { header: "georeferencedBy", get: (g) => g.georeferencedBy ?? "" },
  { header: "georeferencedDate", get: (g) => g.georeferencedDate },
  { header: "georeferenceProtocol", get: (g) => g.georeferenceProtocol ?? "" },
  { header: "georeferenceRemarks", get: (g) => g.georeferenceRemarks ?? "" },
];

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function georeferencesToCsv(georeferences: Georeference[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const rows = georeferences.map((g) => CSV_COLUMNS.map((c) => escapeCsvField(c.get(g))).join(","));
  return [header, ...rows].join("\n");
}

/** Split one CSV line, honouring quoted fields and doubled quotes inside them. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export interface CsvImportResult {
  georeferences: Georeference[];
  /** One message per rejected row, quoting the row number the user can go find. */
  errors: string[];
}

/**
 * Read back a file this app exported — or one an assessor edited in a
 * spreadsheet, which is the more likely case and the reason parsing is
 * forgiving about column order and extra columns.
 */
export function csvToGeoreferences(text: string): CsvImportResult {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { georeferences: [], errors: ["The file is empty"] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const column = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const idIdx = column("gbifID");
  const latIdx = column("decimalLatitude");
  const lonIdx = column("decimalLongitude");
  const uncIdx = column("coordinateUncertaintyInMeters");

  if (idIdx === -1 || latIdx === -1 || lonIdx === -1) {
    return {
      georeferences: [],
      errors: ["The file needs at least gbifID, decimalLatitude and decimalLongitude columns"],
    };
  }

  const at = (fields: string[], idx: number) => (idx === -1 ? "" : (fields[idx] ?? "").trim());
  const georeferences: Georeference[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const rowNumber = i + 1; // 1-based, counting the header, so it matches a spreadsheet
    const gbifID = Number(at(fields, idIdx));
    if (!Number.isFinite(gbifID) || gbifID <= 0) {
      errors.push(`Row ${rowNumber}: gbifID "${at(fields, idIdx)}" isn't a GBIF record id`);
      continue;
    }
    const lat = at(fields, latIdx) === "" ? null : Number(at(fields, latIdx));
    const lon = at(fields, lonIdx) === "" ? null : Number(at(fields, lonIdx));
    const uncRaw = at(fields, uncIdx);
    const unc = uncRaw === "" ? null : Number(uncRaw);
    const validation = validateGeoreference({
      decimalLatitude: lat,
      decimalLongitude: lon,
      coordinateUncertaintyInMeters: unc,
    });
    if (!validation.ok) {
      errors.push(`Row ${rowNumber}: ${validation.errors.join("; ")}`);
      continue;
    }
    georeferences.push({
      gbifID,
      occurrenceID: at(fields, column("occurrenceID")) || undefined,
      scientificName: at(fields, column("scientificName")) || undefined,
      verbatimLocality: at(fields, column("verbatimLocality")) || undefined,
      decimalLatitude: lat as number,
      decimalLongitude: lon as number,
      coordinateUncertaintyInMeters: unc as number,
      georeferencedBy: at(fields, column("georeferencedBy")) || undefined,
      georeferencedDate: at(fields, column("georeferencedDate")) || new Date().toISOString(),
      georeferenceProtocol: at(fields, column("georeferenceProtocol")) || undefined,
      georeferenceRemarks: at(fields, column("georeferenceRemarks")) || undefined,
    });
  }

  return { georeferences, errors };
}

/**
 * A ring of points approximating a circle of `radiusMeters` around a position,
 * for drawing the uncertainty on the map. Metres are converted per-latitude, so
 * the circle stays a circle on the ground rather than becoming an ellipse away
 * from the equator.
 */
export function uncertaintyCircle(
  lat: number,
  lon: number,
  radiusMeters: number,
  segments = 64
): GeoJSON.Polygon {
  const METRES_PER_DEGREE_LAT = 111_320;
  const latRadians = (lat * Math.PI) / 180;
  const metresPerDegreeLon = METRES_PER_DEGREE_LAT * Math.max(Math.cos(latRadians), 1e-6);
  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    ring.push([
      lon + (radiusMeters * Math.cos(angle)) / metresPerDegreeLon,
      lat + (radiusMeters * Math.sin(angle)) / METRES_PER_DEGREE_LAT,
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}
