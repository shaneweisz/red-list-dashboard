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

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * One row per record the filters left in, in Darwin Core terms: GBIF's own
 * fields, with the assessor's coordinates substituted where they supplied any
 * and `georeferencedBy`/`georeferenceRemarks` saying so. Exporting only the
 * georeferenced handful would leave out the evidence they sit in.
 */
export function occurrencesToCsv(
  rows: {
    properties: Record<string, unknown>;
    geometry: { coordinates: [number, number] } | null;
  }[],
  georeferences: Record<number, Georeference>
): string {
  const header = OCCURRENCE_CSV_COLUMNS.map((c) => c.header).join(",");
  const lines = rows.map((row) => {
    const p = row.properties;
    const mine = georeferences[Number(p.gbifID)];
    const lat = mine?.decimalLatitude ?? row.geometry?.coordinates[1] ?? null;
    const lon = mine?.decimalLongitude ?? row.geometry?.coordinates[0] ?? null;
    return OCCURRENCE_CSV_COLUMNS.map((c) =>
      escapeCsvField(c.get(p, { lat, lon, mine }))
    ).join(",");
  });
  return [header, ...lines].join("\n");
}

const str = (v: unknown): string => {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join("; ");
  return String(v);
};

const OCCURRENCE_CSV_COLUMNS: {
  header: string;
  get: (
    p: Record<string, unknown>,
    ctx: { lat: number | null; lon: number | null; mine?: Georeference }
  ) => string;
}[] = [
  { header: "gbifID", get: (p) => str(p.gbifID) },
  { header: "occurrenceID", get: (p) => str(p.occurrenceID) },
  { header: "scientificName", get: (p) => str(p.species) },
  { header: "basisOfRecord", get: (p) => str(p.basisOfRecord) },
  { header: "eventDate", get: (p) => str(p.eventDate) },
  { header: "year", get: (p) => str(p.year) },
  { header: "country", get: (p) => str(p.country) },
  { header: "countryCode", get: (p) => str(p.countryCode) },
  { header: "stateProvince", get: (p) => str(p.stateProvince) },
  { header: "locality", get: (p) => str(p.locality || p.verbatimLocality) },
  { header: "decimalLatitude", get: (_p, c) => (c.lat == null ? "" : String(c.lat)) },
  { header: "decimalLongitude", get: (_p, c) => (c.lon == null ? "" : String(c.lon)) },
  { header: "geodeticDatum", get: (_p, c) => (c.lat == null ? "" : GEODETIC_DATUM) },
  {
    header: "coordinateUncertaintyInMeters",
    get: (p, c) => str(c.mine ? c.mine.coordinateUncertaintyInMeters : p.coordinateUncertaintyInMeters),
  },
  { header: "elevation", get: (p) => str(p.elevation ?? p.verbatimElevation) },
  { header: "recordedBy", get: (p) => str(p.recordedBy) },
  { header: "identifiedBy", get: (p) => str(p.identifiedBy) },
  { header: "institutionCode", get: (p) => str(p.institutionCode) },
  { header: "collectionCode", get: (p) => str(p.collectionCode) },
  { header: "catalogNumber", get: (p) => str(p.catalogNumber) },
  { header: "datasetName", get: (p) => str(p.datasetName) },
  { header: "establishmentMeans", get: (p) => str(p.establishmentMeans) },
  { header: "gbifIssues", get: (p) => str(p.gbifIssues) },
  // Whose coordinates the row carries, and the assessor's note on them.
  { header: "georeferencedBy", get: (_p, c) => str(c.mine?.georeferencedBy) },
  { header: "georeferencedDate", get: (_p, c) => str(c.mine?.georeferencedDate) },
  { header: "georeferenceRemarks", get: (_p, c) => str(c.mine?.georeferenceRemarks) },
  {
    header: "coordinateSource",
    get: (_p, c) => (c.mine ? "assessor" : c.lat == null ? "none" : "GBIF"),
  },
];

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


/**
 * Records an assessor has struck out by hand, and why.
 *
 * A filter says "these records don't match my rules"; an exclusion says "I have
 * looked at this record and it shouldn't count" — a transcription error, a
 * duplicate of the sheet above it, a cultivated plant recorded as wild. That
 * judgement is worth as much as the coordinates, and it's worthless without the
 * reason, so the reason is required.
 */
export interface Exclusion {
  gbifID: number;
  /** Why. Required — an exclusion nobody can audit is just missing data. */
  justification: string;
  /** ISO 8601, stamped on save. */
  excludedAt: string;
  excludedBy?: string;
}

const EXCLUSIONS_PREFIX = "redlist-exclusions";

function exclusionsKey(speciesKey: string): string {
  return `${EXCLUSIONS_PREFIX}:v${GEOREFERENCE_SCHEMA_VERSION}:${speciesKey}`;
}

export function loadExclusions(speciesKey: string): Record<number, Exclusion> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(exclusionsKey(speciesKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed?.version !== GEOREFERENCE_SCHEMA_VERSION) return {};
    const out: Record<number, Exclusion> = {};
    for (const [id, e] of Object.entries(parsed.records ?? {})) out[Number(id)] = e as Exclusion;
    return out;
  } catch {
    return {};
  }
}

export function saveExclusions(speciesKey: string, records: Record<number, Exclusion>): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      exclusionsKey(speciesKey),
      JSON.stringify({ version: GEOREFERENCE_SCHEMA_VERSION, updatedAt: new Date().toISOString(), records })
    );
    return true;
  } catch {
    return false;
  }
}

/** Reasons that come up again and again, offered as one-click options. */
export const EXCLUSION_REASONS = [
  "Duplicate of another record",
  "Transcription error in the coordinates",
  "Cultivated or captive, not a wild occurrence",
  "Locality too vague to place",
  "Misidentified",
  "Outside the species' known range",
] as const;
