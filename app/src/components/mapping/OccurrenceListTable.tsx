"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QUALITY_FLAG_LABELS, type QualityFlag } from "@/lib/mapping/coordinate-cleaning";
import {
  browserLanguage,
  knownTranslation,
  languageName,
  translateText,
  TRANSLATION_PROVIDERS,
  type Translation,
  type TranslationProvider,
} from "@/lib/mapping/translate";
import { formatGbifIssue } from "@/lib/gbif";
import {
  duplicateOf,
  parseAssessorDate,
  parseCoordinateEntry,
  resolvePrimary,
  type Georeference,
} from "@/lib/mapping/georeferences";

/**
 * A single GBIF occurrence, as returned by /api/occurrences. Shared with
 * OccurrenceMapRow (which renders these as map circles) — the list view below
 * is the same records shown as rows, with the Darwin Core fields a map dot has
 * nowhere to put (locality, collector, catalogue number, …).
 */
export interface OccurrenceFeature {
  type: "Feature";
  properties: {
    gbifID: number;
    species: string;
    eventDate?: string;
    recordedBy?: string;
    country?: string;
    countryCode?: string;
    basisOfRecord?: string;
    datasetKey?: string;
    datasetName?: string;
    publishingOrgKey?: string;
    coordinateUncertaintyInMeters?: number | null;
    year?: number | null;
    month?: number | null;
    institutionCode?: string;
    /** typeStatus — holotype, isotype and the rest, where the record is one. */
    typeStatus?: string;
    /** GrSciColl's id for the holding institution — see grscicoll.ts. */
    institutionKey?: string;
    qualityFlags?: string[];
    locality?: string;
    verbatimLocality?: string;
    stateProvince?: string;
    elevation?: number | null;
    depth?: number | null;
    identifiedBy?: string;
    collectionCode?: string;
    catalogNumber?: string;
    /** recordNumber — the collector's own number, which is what a label and a
     *  field notebook agree on before any institution has catalogued it. */
    recordNumber?: string;
    establishmentMeans?: string;
    verbatimElevation?: string;
    /** The publisher's own record id — outlives a GBIF re-key. */
    occurrenceID?: string;
    /** Which record set this came from — see CoordinateStatus in the API route. */
    coordinateStatus?: "mapped" | "issue" | "missing";
    /** GBIF's own geospatial issues with this record's coordinates. */
    gbifIssues?: string[];
    /** Images attached to the record — a herbarium sheet's own photograph. */
    images?: { url: string; title?: string; creator?: string; license?: string; rightsHolder?: string }[];
  };
  /** null when GBIF has no coordinates for the record — it exists as a locality
   *  string only, which is what makes it a georeferencing candidate. */
  geometry: {
    type: "Point";
    coordinates: [number, number];
  } | null;
}

/**
 * The rest of the Darwin Core a GBIF occurrence carries, available from the
 * column picker and off by default. The visible set below is what an assessor
 * reads first; these are what they reach for when a particular question comes
 * up — a name's type status, an eDNA record's sampling protocol, somebody
 * else's georeferenceRemarks on the same locality.
 */
const EXTRA_COLUMNS: { key: string; label: string; title: string; numeric?: boolean }[] = [
  // Taxonomy
  { key: "acceptedScientificName", label: "Accepted name", title: "acceptedScientificName" },
  { key: "scientificNameAuthorship", label: "Authorship", title: "scientificNameAuthorship" },
  { key: "verbatimScientificName", label: "Verbatim name", title: "verbatimScientificName — the name as the publisher wrote it" },
  { key: "taxonRank", label: "Rank", title: "taxonRank" },
  { key: "taxonomicStatus", label: "Taxonomic status", title: "taxonomicStatus" },
  { key: "iucnRedListCategory", label: "IUCN category", title: "iucnRedListCategory, as GBIF holds it" },
  { key: "kingdom", label: "Kingdom", title: "kingdom" },
  { key: "phylum", label: "Phylum", title: "phylum" },
  { key: "class", label: "Class", title: "class" },
  { key: "order", label: "Order", title: "order" },
  { key: "family", label: "Family", title: "family" },
  { key: "genus", label: "Genus", title: "genus" },
  // The record
  { key: "occurrenceStatus", label: "Occurrence status", title: "occurrenceStatus — present or absent" },
  { key: "individualCount", label: "Individuals", title: "individualCount", numeric: true },
  { key: "organismQuantity", label: "Quantity", title: "organismQuantity", numeric: true },
  { key: "organismQuantityType", label: "Quantity type", title: "organismQuantityType" },
  { key: "sex", label: "Sex", title: "sex" },
  { key: "lifeStage", label: "Life stage", title: "lifeStage" },
  { key: "behavior", label: "Behaviour", title: "behavior" },
  { key: "degreeOfEstablishment", label: "Degree of establishment", title: "degreeOfEstablishment" },
  { key: "pathway", label: "Pathway", title: "pathway — how it got there, for introductions" },
  { key: "typeStatus", label: "Type status", title: "typeStatus — holotype, paratype, …" },
  { key: "preparations", label: "Preparations", title: "preparations — how the specimen is preserved" },
  { key: "fieldNumber", label: "Field number", title: "fieldNumber" },
  { key: "occurrenceRemarks", label: "Occurrence remarks", title: "occurrenceRemarks" },
  { key: "occurrenceID", label: "Occurrence ID", title: "occurrenceID — the publisher's own identifier" },
  // The event
  { key: "day", label: "Day", title: "day", numeric: true },
  { key: "eventTime", label: "Time", title: "eventTime" },
  { key: "verbatimEventDate", label: "Verbatim date", title: "verbatimEventDate — the date as written on the label" },
  { key: "dateIdentified", label: "Date identified", title: "dateIdentified" },
  { key: "identificationRemarks", label: "Identification remarks", title: "identificationRemarks" },
  { key: "samplingProtocol", label: "Sampling protocol", title: "samplingProtocol" },
  { key: "samplingEffort", label: "Sampling effort", title: "samplingEffort" },
  { key: "habitat", label: "Habitat", title: "habitat" },
  // The place
  { key: "continent", label: "Continent", title: "continent" },
  { key: "county", label: "County", title: "county" },
  { key: "municipality", label: "Municipality", title: "municipality" },
  { key: "waterBody", label: "Water body", title: "waterBody" },
  { key: "island", label: "Island", title: "island" },
  { key: "islandGroup", label: "Island group", title: "islandGroup" },
  { key: "higherGeography", label: "Higher geography", title: "higherGeography" },
  { key: "verbatimLocality", label: "Verbatim locality", title: "verbatimLocality — the locality as written on the label" },
  { key: "locationRemarks", label: "Location remarks", title: "locationRemarks" },
  { key: "coordinatePrecision", label: "Coordinate precision", title: "coordinatePrecision", numeric: true },
  { key: "geodeticDatum", label: "Datum", title: "geodeticDatum" },
  { key: "elevationAccuracy", label: "Elevation accuracy", title: "elevationAccuracy", numeric: true },
  { key: "depth", label: "Depth", title: "depth in metres", numeric: true },
  { key: "depthAccuracy", label: "Depth accuracy", title: "depthAccuracy", numeric: true },
  { key: "georeferencedBy", label: "Georeferenced by", title: "georeferencedBy — who placed the published coordinates" },
  { key: "georeferenceProtocol", label: "Georeference protocol", title: "georeferenceProtocol" },
  { key: "georeferenceSources", label: "Georeference sources", title: "georeferenceSources" },
  { key: "georeferenceRemarks", label: "Georeference remarks", title: "georeferenceRemarks" },
  // Dataset and rights
  { key: "publishingCountry", label: "Publishing country", title: "publishingCountry" },
  { key: "protocol", label: "Protocol", title: "protocol — how GBIF ingested the record" },
  { key: "license", label: "Licence", title: "license" },
  { key: "rightsHolder", label: "Rights holder", title: "rightsHolder" },
  { key: "references", label: "References", title: "references — the publisher's page for this record" },
  { key: "lastInterpreted", label: "Last interpreted", title: "lastInterpreted — when GBIF last processed it" },
  { key: "isSequenced", label: "Sequenced", title: "isSequenced — has associated sequence data" },
  { key: "isInCluster", label: "In cluster", title: "isInCluster — GBIF thinks this duplicates another record" },
];

/** Never hidden, and never offered in the column picker. */
const ALWAYS_VISIBLE_COLUMNS = new Set(["rowNumber", "putBack", "reason", "duplicates", "marks"]);

/** Shown until someone changes it: the fields an assessor reads first. */
const DEFAULT_VISIBLE_COLUMNS = [
  "date", "coordinates", "recordedBy", "recordNumber", "locality", "stateProvince", "country",
  "uncertainty", "elevation", "identifiedBy", "basisOfRecord", "dataset", "catalog",
  "establishmentMeans", "gbifID",
];

const COLUMN_PREFS_KEY = "redlist-occurrence-columns:v1";

/** How wide the hover bubble is allowed to get, and what it's clamped by. */
const HOVER_NOTE_MAX_WIDTH = 320;
/**
 * How much room below the anchor the bubble needs before it opens downward.
 * Roughly a bubble with a locality and its translation in it.
 */
const HOVER_NOTE_FLIP_MARGIN = 150;

interface ColumnPrefs {
  /** Column ids in display order; anything unknown is ignored on read. */
  order: string[];
  visible: string[];
  /** Pixel widths, for columns whose edge has been dragged. */
  widths?: Record<string, number>;
}

/** Narrow enough to still show something, wide enough to be worth dragging to. */
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 900;

function loadColumnPrefs(): ColumnPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COLUMN_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.order) || !Array.isArray(parsed?.visible)) return null;
    return parsed as ColumnPrefs;
  } catch {
    return null;
  }
}

/** Forget a saved layout entirely, so the defaults apply again. */
function clearColumnPrefs() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(COLUMN_PREFS_KEY);
  } catch {
    // The in-memory reset has already happened; nothing else to do.
  }
}

function saveColumnPrefs(prefs: ColumnPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // A browser refusing storage shouldn't cost you the table.
  }
}


export const BASIS_LABELS: Record<string, string> = {
  HUMAN_OBSERVATION: "Human observation",
  MACHINE_OBSERVATION: "Machine observation",
  OBSERVATION: "Observation",
  PRESERVED_SPECIMEN: "Preserved specimen",
  FOSSIL_SPECIMEN: "Fossil specimen",
  LIVING_SPECIMEN: "Living specimen",
  MATERIAL_SAMPLE: "Material sample",
  MATERIAL_CITATION: "Material citation",
  OCCURRENCE: "Occurrence",
};

function formatBasis(basis?: string): string {
  if (!basis) return "";
  return BASIS_LABELS[basis] ?? basis.replace(/_/g, " ").toLowerCase();
}

/** Date part only — GBIF eventDates carry a time component we never show. */
function formatDate(p: OccurrenceFeature["properties"]): string {
  if (p.eventDate) return p.eventDate.slice(0, 10);
  if (p.year != null) return p.month != null ? `${p.year}-${String(p.month).padStart(2, "0")}` : String(p.year);
  return "";
}

/** Locality, falling back to verbatimLocality (all iNaturalist records have). */
function localityOf(p: OccurrenceFeature["properties"]): string {
  return p.locality || p.verbatimLocality || "";
}

/** Elevation, or depth shown as a negative when only depth is recorded. */
function elevationOf(p: OccurrenceFeature["properties"]): number | null {
  if (p.elevation != null) return p.elevation;
  if (p.depth != null) return -p.depth;
  // Herbarium sheets often only have the transcribed string ("1900", "ca. 2200 m"),
  // which is worth showing: elevation is one of the strongest constraints when
  // georeferencing a historical locality by hand.
  if (p.verbatimElevation) {
    const n = parseFloat(p.verbatimElevation.replace(/[^0-9.\-]/g, ""));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * Everything this dashboard has to say against a record: GBIF's own geospatial
 * issues, the coordinate-cleaning checks it trips, and whether it falls outside
 * the native range. One list, so the flag in the margin and the Flags column
 * can never disagree about whether a record is questioned.
 */
function flagsOf(
  p: OccurrenceFeature["properties"],
  isOutsideNativeRange: (countryCode: string | null | undefined) => boolean,
  nativeRangeSourceLabel: string
): string[] {
  const flags = (p.gbifIssues ?? []).map((i) => `GBIF: ${formatGbifIssue(i)}`);
  flags.push(...(p.qualityFlags ?? []).map((f) => QUALITY_FLAG_LABELS[f as QualityFlag] ?? f));
  // Named for the source it came from: POWO and the Red List can disagree
  // about where a species is native, and which of them called this record
  // out is the first thing you need to know to judge it.
  if (isOutsideNativeRange(p.countryCode)) flags.push(`Outside ${nativeRangeSourceLabel} native range`);
  return flags;
}

/** institutionCode / collectionCode / catalogNumber, compacted into one cell. */
function catalogOf(p: OccurrenceFeature["properties"]): string {
  return [p.institutionCode, p.collectionCode, p.catalogNumber].filter(Boolean).join(" · ");
}

type SortValue = string | number | null;

interface ColumnDef {
  key: string;
  label: string;
  /** Header tooltip — the Darwin Core term(s) behind this column. */
  title?: string;
  /** Tailwind width/alignment classes applied to both header and cells. */
  className?: string;
  align?: "left" | "right";
  value: (p: OccurrenceFeature["properties"], f: OccurrenceFeature) => SortValue;
  /** Cell contents, when they aren't just the sort value rendered as text.
   *  `index` is the row's place in the table as drawn, for the one column
   *  whose content is that place rather than anything about the record. */
  render?: (
    p: OccurrenceFeature["properties"],
    f: OccurrenceFeature,
    index: number
  ) => React.ReactNode;
  /** A control drawn in the header beside the label — the Included column's
   *  show/hide toggle. Its own clicks are kept off the sort handler. */
  headerExtra?: React.ReactNode;
  /** Half the usual side padding: for a column of one glyph, the padding was
   *  most of the column. */
  compact?: boolean;
  /** Draws only `headerExtra` in the header: the eye says "shown" by itself,
   *  and the word beside it was spending a column's width on saying it twice.
   *  The label is still what the column picker lists. */
  headerIconOnly?: boolean;
}

/**
 * Typing a position straight into the Coordinates cell.
 *
 * This is the whole georeferencing gesture now: click the cell, type where the
 * locality description puts the record, press Enter. It replaced a modal — and
 * before that a docked side panel — that asked for latitude, longitude, radius
 * and a note in four separate boxes before it would accept anything.
 *
 * It takes what a gazetteer, GEOLocate or Google Earth actually puts on the
 * clipboard: "1.1958, -76.9256". A third number is read as the uncertainty
 * radius in metres, for when it's known at the time of typing; the radius is
 * otherwise edited in its own cell, where it's shown.
 */
/**
 * Typing a date into the Date cell.
 *
 * The same gesture as the coordinates beside it, and the same reason for it: a
 * herbarium label carries a date that GBIF's transcription often doesn't, and
 * the assessor reading the sheet is the person who can supply it. As precise as
 * the label is — a year alone is an answer.
 */
function DateCellEditor({
  initial,
  initialNote,
  onCommit,
  onClear,
}: {
  initial: string;
  initialNote: string;
  onCommit: (eventDate: string | null, note: string) => void;
  onClear?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [note, setNote] = useState(initialNote);
  const parsed = parseAssessorDate(text);
  const ok = "eventDate" in parsed;
  const empty = text.trim() === "";
  const commit = () => onCommit(ok ? parsed.eventDate : null, note.trim());
  return (
    <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()} data-cell-editor>
      <div className="flex items-center gap-1">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCommit(null, note);
          }
        }}
        onBlur={(e) => {
          // Moving between the two boxes isn't leaving the cell.
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-cell-editor]")) return;
          commit();
        }}
        placeholder="yyyy-mm-dd"
        title={
          ok || empty
            ? "The date as the label gives it: yyyy, yyyy-mm or yyyy-mm-dd. Enter to keep, Escape to cancel."
            : (parsed as { error: string }).error
        }
        className={`w-24 rounded border bg-white dark:bg-zinc-900 px-1 py-0.5 text-[11px] tabular-nums ${
          ok || empty
            ? "border-violet-400 text-violet-700 dark:text-violet-300"
            : "border-red-400 text-red-600 dark:text-red-400"
        }`}
      />
      {onClear && (
        <button
          onMouseDown={(e) => { e.preventDefault(); onClear(); }}
          title="Drop your date and go back to what GBIF published"
          className="text-[10px] text-zinc-400 hover:text-red-600"
        >
          clear
        </button>
      )}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); onCommit(null, note); }
        }}
        onBlur={(e) => {
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-cell-editor]")) return;
          commit();
        }}
        placeholder="why — the label, a note, a paper"
        title="Where this date comes from, in your words. Kept with the date."
        className="w-40 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300"
      />
    </div>
  );
}

function CoordinateCellEditor({
  initial,
  initialNote,
  onCommit,
  onClear,
}: {
  initial: string;
  initialNote: string;
  onCommit: (
    edit: { lat: number; lon: number; uncertainty?: number; note?: string } | null
  ) => void;
  onClear?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [note, setNote] = useState(initialNote);
  const parsed = parseCoordinateEntry(text);
  const empty = text.trim() === "";
  const commit = () => onCommit(parsed ? { ...parsed, note: note.trim() } : null);
  return (
    <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()} data-cell-editor>
      <div className="flex items-center gap-1">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); onCommit(null); }
        }}
        // Committing on blur as well as Enter: clicking away from a cell you
        // have typed into should keep what you typed, not discard it. Moving
        // to the note box beside it isn't leaving the cell.
        onBlur={(e) => {
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-cell-editor]")) return;
          commit();
        }}
        placeholder="lat, lon"
        title="Latitude, longitude in decimal degrees. A third number is read as the uncertainty radius in metres. Enter to keep, Escape to cancel."
        className={`w-32 rounded border bg-white dark:bg-zinc-900 px-1 py-0.5 text-[11px] tabular-nums ${
          parsed || empty
            ? "border-violet-400 text-violet-700 dark:text-violet-300"
            : "border-red-400 text-red-600 dark:text-red-400"
        }`}
      />
      {onClear && (
        <button
          onMouseDown={(e) => { e.preventDefault(); onClear(); }}
          title="Drop your coordinates and go back to what GBIF published"
          className="text-[10px] text-zinc-400 hover:text-red-600"
        >
          clear
        </button>
      )}
      </div>
      {/* How you read the locality, in your words. A georeference is an
          interpretation, and the next person to open this — including you in
          six months — needs the reasoning, not just the point. */}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); onCommit(null); }
        }}
        onBlur={(e) => {
          if ((e.relatedTarget as HTMLElement | null)?.closest("[data-cell-editor]")) return;
          commit();
        }}
        placeholder="why — how you read the locality"
        title="How you arrived at this position, in your words. Saved as the georeference's remarks."
        className="w-40 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300"
      />
    </div>
  );
}

/** The uncertainty radius, typed in metres straight into its own cell. */
function RadiusCellEditor({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (metres: number | null) => void;
}) {
  const [text, setText] = useState(initial);
  const value = Number(text.trim());
  const valid = text.trim() !== "" && Number.isFinite(value) && value > 0;
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(valid ? value : null); }
        if (e.key === "Escape") { e.preventDefault(); onCommit(null); }
      }}
      onBlur={() => onCommit(valid ? value : null)}
      placeholder="metres"
      title="Radius in metres. Enter to keep, Escape to cancel."
      className={`w-16 rounded border bg-white dark:bg-zinc-900 px-1 py-0.5 text-[11px] text-right tabular-nums ${
        valid ? "border-violet-400 text-violet-700 dark:text-violet-300" : "border-red-400 text-red-600"
      }`}
    />
  );
}

interface OccurrenceListTableProps {
  /** Every loaded record, filtered or not — see `excludedIds`. */
  occurrences: OccurrenceFeature[];
  /** Whether the initial /api/occurrences fetch is still in flight. */
  loading: boolean;
  /** Species' native countries per the currently selected source, for the
   *  "outside native range" flag shown in the Flags column (same signal the map
   *  tooltip shows). */
  isOutsideNativeRange: (countryCode: string | null | undefined) => boolean;
  /** Which source that range came from — "POWO" or "IUCN" — for the flag's
   *  own wording. */
  nativeRangeSourceLabel: string;
  /** The assessor's own georeferences, keyed by gbifID. */
  georeferences?: Record<number, Georeference>;
  /**
   * Saves coordinates typed into the Coordinates cell. Absent = feature
   * unavailable.
   *
   * Coordinates, and nothing else: a georeference is made by typing a position
   * where the position is shown, rather than by opening something. The radius
   * and the note are edited in their own cells, the same way.
   */
  onSaveGeoreference?: (
    feature: OccurrenceFeature,
    edit: { lat: number; lon: number; uncertainty?: number; note?: string }
  ) => void;
  /** Clears the assessor's coordinates for a record, leaving GBIF's alone. */
  onClearGeoreference?: (feature: OccurrenceFeature) => void;
  /** The record currently highlighted on the map, so its row can match. */
  hoveredGbifId?: number | null;
  /**
   * A record the table should scroll to and pick out — set by "View all GBIF
   * fields" on the map. The map can only draw a position; every other field
   * GBIF publishes is a column here, so that's where the answer lives.
   */
  /** Pointer entered/left a row — the map highlights the matching record. */
  onHoverRow?: (feature: OccurrenceFeature | null) => void;
  /**
   * A row was clicked. The map pins that record's panel, the mirror of a click
   * on a point scrolling the table to its row.
   */
  /** Records the filters have excluded. They stay in the table, greyed, rather
   *  than vanishing — a record you can't see is a record you can't judge. */
  excludedIds?: Set<number>;
  /**
   * Which list this is: the records themselves, or the ones set aside.
   *
   * The excluded ones are a tab of their own rather than greyed rows in the
   * middle of this one — they've been judged, and what you want from them is
   * the reason and a way back, not their place in the sort.
   */
  variant?: "records" | "excluded";
  /**
   * A record to scroll to and pick out — the panel on the map asking the
   * table to go to the record it's showing. Cleared and re-set by the caller,
   * so asking for the same record twice takes you back to it.
   */
  focusGbifId?: number | null;
  /**
   * The records set aside as duplicates, by the record each was kept in
   * favour of. Their primaries can unfold to show them in place.
   */
  duplicates?: Map<number, OccurrenceFeature[]>;
  /** Dropping one row on another says the first duplicates the second. */
  onMarkDuplicate?: (gbifIDs: number[], primaryGbifID: number) => void;
  /** Dates the assessor read off a label GBIF didn't transcribe. */
  dates?: Record<number, { eventDate: string; remarks?: string }>;
  onSaveDate?: (feature: OccurrenceFeature, eventDate: string, note?: string) => void;
  onClearDate?: (feature: OccurrenceFeature) => void;
  /** Right-clicking a row opens the record's menu where the pointer is. */
  onRowContextMenu?: (feature: OccurrenceFeature, at: { x: number; y: number }) => void;
  /** Drawn at the right of the footer — the save button, where there is one. */
  footerExtra?: React.ReactNode;
  /** Scales the table, so more of it fits without shrinking the controls. */
  zoom?: number;
  /** Records struck out by hand, with the reason given for each. */
  exclusions?: Record<number, { justification: string }>;
  /** Asks for a justification and excludes the given records. */
  onExclude?: (gbifIDs: number[]) => void;
  /** Puts hand-excluded records back, as one edit. */
  onInclude?: (gbifIDs: number[]) => void;
  /** Fill the height of the column the table is in. */
  fillHeight?: boolean;
  /** How the map and this table are arranged, when the caller offers a choice.
   *  The control lives here, beside the column picker, because both are
   *  questions about how you want to read the table. */
  panelLayout?: "rows" | "columns";
  onTogglePanelLayout?: () => void;
}

/**
 * Which records offer a georeference affordance: those GBIF has no coordinates
 * for, and those whose coordinates GBIF flags. Records GBIF is happy with are
 * left alone — overriding a good coordinate is a different act from supplying a
 * missing one, and inviting it here would quietly fork the source data.
 */
export function isGeoreferenceable(p: OccurrenceFeature["properties"]): boolean {
  return p.coordinateStatus === "missing" || p.coordinateStatus === "issue";
}

export default function OccurrenceListTable({
  occurrences,
  loading,
  isOutsideNativeRange,
  nativeRangeSourceLabel,
  georeferences,
  onSaveGeoreference,
  onClearGeoreference,
  hoveredGbifId,
  onHoverRow,
  excludedIds,
  variant = "records",
  focusGbifId,
  dates,
  onSaveDate,
  onClearDate,
  duplicates,
  onMarkDuplicate,
  onRowContextMenu,
  footerExtra,
  zoom = 1,
  exclusions,
  onExclude,
  onInclude,
  fillHeight = false,
  panelLayout,
  onTogglePanelLayout,
}: OccurrenceListTableProps) {
  // Default sort: newest first, matching GBIF's own default result order.
  /** The record whose Coordinates cell is open for typing, if any. */
  const [editingCoords, setEditingCoords] = useState<number | null>(null);
  /** The record whose Uncertainty cell is open for typing, if any. */
  const [editingRadius, setEditingRadius] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<string>("date");
  const [sortAsc, setSortAsc] = useState(false);

  // Which columns are shown and in what order, remembered per browser. Read
  // lazily so the first paint is already the reader's own layout rather than
  // the default flashing past.
  const [columnPrefs, setColumnPrefs] = useState<ColumnPrefs | null>(() => loadColumnPrefs());
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const columnButtonRef = useRef<HTMLButtonElement>(null);
  // The picker is portalled and positioned from the button: the list panel
  // clips its own overflow (it has to — the table scrolls inside it), so an
  // absolutely-positioned dropdown gets cut off at the panel's edge.
  const [pickerAnchor, setPickerAnchor] = useState<{ right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!columnPickerOpen) return;
    const place = () => {
      const rect = columnButtonRef.current?.getBoundingClientRect();
      if (rect) setPickerAnchor({ right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top + 6 });
    };
    place();
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (columnPickerRef.current?.contains(target) || columnButtonRef.current?.contains(target)) return;
      setColumnPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("resize", place);
    };
  }, [columnPickerOpen]);

  // Find-in-table: highlights every hit and steps through them, rather than
  // filtering. Same reasoning as the Excluded column — you want to see the
  // record in its context, not have the table rearrange itself under you.
  const [search, setSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(true);
  /** Primaries whose duplicates are showing beneath them. */
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  /**
   * The row being dragged, and the row it is over.
   *
   * Duplicates are the commonest reason to set a record aside, and the
   * duplicate-of relationship is between two specific records — so saying it
   * by dragging one onto the other is both quicker than typing a reason and
   * more precise than the reason anyone would type.
   */
  /**
   * The photograph under the pointer, and where to put it.
   *
   * Drawn from a portal at the icon's own position: a preview big enough to
   * be worth showing is bigger than the row it belongs to, and a cell can't
   * overflow a scrolling table.
   */
  const [mediaPreview, setMediaPreview] = useState<{
    image: NonNullable<OccurrenceFeature["properties"]["images"]>[number];
    x: number;
    y: number;
  } | null>(null);
  /**
   * A line of hover text and where to put it — the flag's reasons, at the
   * flag. Its own bubble rather than a `title`, which the browser holds back
   * for about a second: long enough that the mark reads as unexplained.
   */
  const [hoverNote, setHoverNote] = useState<{
    text: string;
    x: number;
    y: number;
    /** Where the bubble's bottom edge goes when there's no room below. */
    above?: number;
    /** Whether this one is worth offering to translate — a locality is. */
    translate?: boolean;
  } | null>(null);
  /**
   * The bubble outlives the pointer leaving the cell, long enough to reach it.
   *
   * What's in it is a locality description or a collecting team — the things
   * you copy into a georeferencing note or a search box — so it has to be
   * possible to put the cursor in it. That means surviving the four pixels
   * between the cell and the bubble, and staying while the pointer is inside.
   */
  const noteTimer = useRef<number | null>(null);
  const showNote = useCallback((note: {
    text: string;
    x: number;
    y: number;
    above?: number;
    translate?: boolean;
  }) => {
    if (noteTimer.current != null) window.clearTimeout(noteTimer.current);
    noteTimer.current = null;
    setHoverNote(note);
  }, []);
  const hideNoteSoon = useCallback(() => {
    if (noteTimer.current != null) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      noteTimer.current = null;
      setHoverNote(null);
    }, 180);
  }, []);
  const keepNote = useCallback(() => {
    if (noteTimer.current != null) window.clearTimeout(noteTimer.current);
    noteTimer.current = null;
  }, []);
  /**
   * The translation of whatever the bubble is showing, once it's been asked
   * for.
   *
   * Held against the string it belongs to rather than the row, because the
   * bubble is one element that every cell borrows: moving to another locality
   * has to stop showing the last one's translation, and coming back to a
   * locality already translated has to show it again without spending a
   * second request.
   */
  const [translations, setTranslations] = useState<{
    source: string;
    entries: Partial<
      Record<TranslationProvider, { status: "loading" | "done" | "error"; result?: Translation; error?: string }>
    >;
  } | null>(null);
  /**
   * Asks one service, keeping whatever the other already said.
   *
   * Both at once is the point: the two disagree, and on a locality
   * description the disagreement is the information — one of them read
   * "Comisaría del Vaupés" as a police station and the other as the
   * territory it names.
   */
  const translateNote = useCallback((text: string, using: TranslationProvider) => {
    const target = browserLanguage();
    const set = (entry: { status: "loading" | "done" | "error"; result?: Translation; error?: string }) =>
      setTranslations((current) => ({
        source: text,
        // A different locality starts again; the same one keeps what it has.
        entries: { ...(current?.source === text ? current.entries : {}), [using]: entry },
      }));
    const already = knownTranslation(text, target, using);
    if (already) {
      set({ status: "done", result: already });
      return;
    }
    set({ status: "loading" });
    translateText(text, target, using)
      .then((result) => set({ status: "done", result }))
      .catch((error: unknown) =>
        set({ status: "error", error: error instanceof Error ? error.message : String(error) })
      );
  }, []);
  /**
   * What belongs under the bubble's text right now: this session's attempt if
   * it is about the string on screen, or one translated earlier and still
   * cached, which is what makes going back to a locality free.
   */
  /**
   * One line per service that has something to say about the locality on
   * screen — this session's attempt, or one translated earlier and still
   * cached, which is what makes coming back to a locality free.
   */
  const shownTranslations = !hoverNote?.translate
    ? []
    : (Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[])
        .map((provider) => {
          const attempt = translations?.source === hoverNote.text ? translations.entries[provider] : undefined;
          if (attempt) return { provider, ...attempt };
          const cached = knownTranslation(hoverNote.text, browserLanguage(), provider);
          return cached ? { provider, status: "done" as const, result: cached, error: undefined } : null;
        })
        .filter((line) => line != null);
  /**
   * The source language, where the services that answered agree on it. They
   * are detecting it independently, so where they disagree the header says
   * nothing rather than picking one.
   */
  const detectedLanguages = new Set(
    shownTranslations.map((line) => line.result?.detected).filter((code) => code != null)
  );
  const detectedSource = detectedLanguages.size === 1 ? [...detectedLanguages][0] : undefined;
  /** The record whose date is being typed. */
  const [editingDate, setEditingDate] = useState<number | null>(null);
  /**
   * The reason being read or rewritten, and where its icon is.
   *
   * A georeference and a hand-written date are both interpretations, and the
   * reasoning is the part of them worth keeping — but it is not what you scan
   * a table for. It lives behind an ⓘ beside the value: hovering reads it,
   * clicking rewrites it, and the column stays one line either way.
   */
  const [noteEditor, setNoteEditor] = useState<{
    feature: OccurrenceFeature;
    kind: "georeference" | "date";
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const holdRef = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const dropRef = useRef<number | null>(null);
  dropRef.current = dropTargetId;

  /** How long the button is held, and how far it may stray, before it's a drag. */
  const HOLD_MS = 350;
  const HOLD_SLOP = 6;

  const cancelHold = useCallback(() => {
    if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  }, []);

  const beginHold = useCallback(
    (id: number, x: number, y: number) => {
      cancelHold();
      const timer = window.setTimeout(() => {
        holdRef.current = null;
        setDraggingId(id);
      }, HOLD_MS);
      holdRef.current = { id, x, y, timer };
    },
    [cancelHold]
  );

  // The drag itself, once a hold has become one: the row under the pointer is
  // the drop target, and letting go on it says the dragged record duplicates
  // it. Done on the document so the pointer can leave the row it started on.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const hold = holdRef.current;
      if (hold) {
        // Moving before the hold is up is someone selecting text.
        if (Math.abs(e.clientX - hold.x) > HOLD_SLOP || Math.abs(e.clientY - hold.y) > HOLD_SLOP) cancelHold();
        return;
      }
      if (draggingId == null) return;
      e.preventDefault();
      const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        "tr[data-gbif-id]"
      );
      const id = over ? Number(over.dataset.gbifId) : null;
      setDropTargetId(id != null && id !== draggingId ? id : null);
    };
    const onUp = () => {
      cancelHold();
      const dragged = draggingId;
      const target = dropRef.current;
      setDraggingId(null);
      setDropTargetId(null);
      if (dragged == null || target == null || target === dragged) return;
      // Dropping onto a duplicate hands the record to the group's own head.
      const primary = resolvePrimary(target, exclusions ?? {});
      if (primary !== dragged) onMarkDuplicate?.([dragged], primary);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      cancelHold();
      setDraggingId(null);
      setDropTargetId(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keydown", onKey);
    };
  }, [draggingId, cancelHold, exclusions, onMarkDuplicate]);

  const updatePrefs = (next: ColumnPrefs) => {
    setColumnPrefs(next);
    saveColumnPrefs(next);
  };

  /**
   * Back to the shipped layout — order, visibility and widths together.
   * Resetting only the visible set left a reordered table looking unreset,
   * which is the one thing a reset button must not do.
   */
  const resetPrefs = () => {
    setColumnPrefs(null);
    clearColumnPrefs();
  };

  /**
   * A cell too long for its column: one line, cut off, and the whole of it in
   * the hover bubble. The same bubble the marks use, so a long string and a
   * flag are read the same way — and immediately, which the browser's own
   * tooltip is not.
   */
  const full = useCallback(
    // `translate` also means the bubble is worth opening for a value that
    // isn't cut off: the button in it is the point, not the overflow.
    (text: string, translate = false) => (
      <span
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          if (!translate && el.scrollWidth <= el.clientWidth) return;
          const box = el.getBoundingClientRect();
          showNote({ text, x: box.left, y: box.bottom + 4, above: box.top - 4, translate });
        }}
        onMouseLeave={hideNoteSoon}
        className="block truncate"
      >
        {text}
      </span>
    ),
    [showNote, hideNoteSoon]
  );

  /**
   * Keeps what's in the note box, against the value it belongs to.
   *
   * A georeference is re-saved at its own coordinates, a date at its own date:
   * the note is a field of the thing, and there is no separate store to write
   * it to — which also means one undo covers the whole edit.
   */
  const saveNote = useCallback(() => {
    // Read the editor and close it, then save. Doing the saving inside a state
    // updater meant asking a parent to change while this component was mid-
    // update, and React was within its rights to drop it — which it did: the
    // reason you typed came back as the one you had replaced.
    if (!noteEditor) return;
    setNoteEditor(null);
    const note = noteEditor.text.trim();
    const p = noteEditor.feature.properties;
    if (noteEditor.kind === "georeference") {
      const mine = georeferences?.[p.gbifID];
      if (mine && note !== (mine.georeferenceRemarks ?? "")) {
        onSaveGeoreference?.(noteEditor.feature, {
          lat: mine.decimalLatitude,
          lon: mine.decimalLongitude,
          uncertainty: mine.coordinateUncertaintyInMeters,
          note,
        });
      }
    } else {
      const mine = dates?.[p.gbifID];
      if (mine && note !== (mine.remarks ?? "")) onSaveDate?.(noteEditor.feature, mine.eventDate, note);
    }
  }, [noteEditor, georeferences, dates, onSaveGeoreference, onSaveDate]);

  /** The ⓘ that carries a reason: hover to read it, click to rewrite it. */
  const noteIcon = useCallback(
    (feature: OccurrenceFeature, kind: "georeference" | "date", text: string | undefined) => (
      <span
        onMouseEnter={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          showNote({
            text: text || "No reason given — click to add one",
            x: box.left,
            y: box.bottom + 4,
          });
        }}
        onMouseLeave={hideNoteSoon}
        onClick={(e) => {
          e.stopPropagation();
          const box = e.currentTarget.getBoundingClientRect();
          setHoverNote(null);
          setNoteEditor({ feature, kind, text: text ?? "", x: box.left, y: box.bottom + 4 });
        }}
        title=""
        className={`ml-1 inline-flex align-middle cursor-pointer ${
          text ? "text-violet-500" : "text-zinc-300 dark:text-zinc-600 hover:text-violet-500"
        }`}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 11v5" />
          <circle cx="12" cy="7.75" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
    ),
    [showNote, hideNoteSoon]
  );

  const columns = useMemo<ColumnDef[]>(
    () => [
      // Where you are in the list. Not a field of the record — a record has no
      // number — but the thing you say out loud to someone reading over your
      // shoulder, and the thing you count down to find your place again.
      {
        key: "rowNumber",
        label: "#",
        compact: true,
        title: "The row's place in the list as it's currently sorted",
        className: "whitespace-nowrap tabular-nums w-8",
        align: "right" as const,
        value: () => null,
        render: (p: OccurrenceFeature["properties"], f: OccurrenceFeature, index: number) =>
          duplicateOf(exclusions?.[p.gbifID]?.justification) != null ? (
            <span />
          ) : (
            <span className="text-zinc-400 dark:text-zinc-500">{index + 1}</span>
          ),
      } as ColumnDef,
      // The unfold control for a record other records duplicate, and the mark
      // on a duplicate shown beneath its primary. Drawn only when there are
      // duplicates to show, so an ordinary table isn't carrying an empty
      // column for a relationship nothing in it has.
      ...(duplicates && duplicates.size > 0
        ? [
            {
              key: "duplicates",
              label: "",
              compact: true,
              title: "Records set aside as duplicates of this one",
              className: "whitespace-nowrap w-8",
              value: (p: OccurrenceFeature["properties"]) => duplicates.get(p.gbifID)?.length ?? 0,
              render: (p: OccurrenceFeature["properties"]) => {
                const kept = duplicates.get(p.gbifID);
                if (!kept?.length) {
                  // An empty string rather than nothing: this column is a
                  // relationship, and the dash that stands for a missing field
                  // down every other column would read as one here.
                  return duplicateOf(exclusions?.[p.gbifID]?.justification) != null ? (
                    <span className="pl-2 text-zinc-400 dark:text-zinc-500" title="A duplicate of the record above">
                      ↳
                    </span>
                  ) : (
                    <span />
                  );
                }
                const open = unfolded.has(p.gbifID);
                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setUnfolded((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.gbifID)) next.delete(p.gbifID);
                        else next.add(p.gbifID);
                        return next;
                      });
                    }}
                    title={
                      open
                        ? "Fold the duplicates away"
                        : `Show the ${kept.length} record${kept.length === 1 ? "" : "s"} set aside as duplicates of this one`
                    }
                    className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="tabular-nums">{kept.length}</span>
                  </button>
                );
              },
            } as ColumnDef,
          ]
        : []),
      // One column for everything the row says about itself in a symbol: a
      // flag where the record is questioned, a star where it is a type
      // specimen, a camera where the publisher attached a photograph. Three
      // columns of padding for three glyphs was most of the margin.
      {
        key: "marks",
        label: "",
        title:
          "What this record carries: a flag for the cleaning checks it trips or a range it falls outside, a star for a type specimen, a camera for a photograph",
        className: "whitespace-nowrap",
        compact: true,
        value: (p: OccurrenceFeature["properties"]) =>
          flagsOf(p, isOutsideNativeRange, nativeRangeSourceLabel).length + (p.typeStatus ? 1 : 0) + (p.images?.length ?? 0),
        render: (p: OccurrenceFeature["properties"]) => {
          const flags = flagsOf(p, isOutsideNativeRange, nativeRangeSourceLabel);
          const type = p.typeStatus?.trim();
          const images = p.images ?? [];
          if (flags.length === 0 && !type && images.length === 0) return <span />;
          const note = (text: string) => ({
            onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
              const box = e.currentTarget.getBoundingClientRect();
              showNote({ text, x: box.right + 8, y: box.top - 2 });
            },
            onMouseLeave: hideNoteSoon,
          });
          return (
            <span className="flex items-center gap-0.5">
              {flags.length > 0 && (
                <span {...note(flags.join(" · "))} className="text-amber-600 dark:text-amber-500 cursor-help">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 22V3m0 0h12l-2 4 2 4H5" />
                  </svg>
                </span>
              )}
              {type && (
                <span
                  {...note(
                    `${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase().replace(/_/g, " ")} — a type specimen`
                  )}
                  className="text-amber-500 cursor-help"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
                  </svg>
                </span>
              )}
              {images.length > 0 && (
                <a
                  href={images[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  onMouseEnter={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    setMediaPreview({ image: images[0], x: box.right + 8, y: box.top });
                  }}
                  onMouseLeave={() => setMediaPreview(null)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="8.5" cy="10" r="1.5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 17l5-5 4 4 3-2 4 4" />
                  </svg>
                </a>
              )}
            </span>
          );
        },
      } as ColumnDef,
      // What the excluded list needs and the main one doesn't: why a record
      // was set aside, and a way to change your mind. Nothing stands in this
      // place on the main list — a record is counted unless it's in the other
      // tab, and a column of ticked boxes said only that.
      ...(variant === "excluded"
        ? [
            {
              key: "reason",
              label: "Excluded reason",
              title: "Why this record was excluded, as you gave it",
              className: "min-w-[10rem] max-w-[18rem]",
              value: (p: OccurrenceFeature["properties"]) => exclusions?.[p.gbifID]?.justification ?? null,
              render: (p: OccurrenceFeature["properties"]) => {
                const reason = exclusions?.[p.gbifID]?.justification;
                if (!reason) return null;
                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExclude?.([p.gbifID]);
                    }}
                    title={`${reason} — click to edit the reason`}
                    className="block w-full truncate text-left hover:underline"
                  >
                    {reason}
                  </button>
                );
              },
            } as ColumnDef,
            {
              key: "putBack",
              label: "",
              title: "Put this record back among the ones being counted",
              className: "whitespace-nowrap",
              value: () => null,
              render: (p: OccurrenceFeature["properties"]) => (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onInclude?.([p.gbifID]);
                  }}
                  title="Put this record back"
                  className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-500"
                >
                  Put back
                </button>
              ),
            } as ColumnDef,
          ]
        : []),
      {
        key: "date",
        label: "Date",
        title:
          "eventDate (or year/month when no full date was recorded). Click to type the date off the label yourself — yours shows in violet.",
        // Without nowrap the browser breaks yyyy-mm-dd at its hyphens.
        className: "whitespace-nowrap",
        // Sorted by the date being shown, so a record you've dated sorts where
        // you put it rather than at the end with the undated ones.
        value: (p) => dates?.[p.gbifID]?.eventDate ?? formatDate(p) ?? null,
        render: (p, f) => {
          const mine = dates?.[p.gbifID];
          const published = formatDate(p);
          const editable = !!onSaveDate;
          if (editable && editingDate === p.gbifID) {
            return (
              <DateCellEditor
                initial={mine?.eventDate ?? published ?? ""}
                initialNote={mine?.remarks ?? ""}
                onCommit={(eventDate, note) => {
                  setEditingDate(null);
                  if (eventDate) onSaveDate?.(f, eventDate, note);
                }}
                onClear={mine ? () => { setEditingDate(null); onClearDate?.(f); } : undefined}
              />
            );
          }
          const startEditing = (e: React.MouseEvent) => {
            e.stopPropagation();
            setEditingDate(p.gbifID);
          };
          if (mine) {
            return (
              <span className="flex items-center whitespace-nowrap">
                <button
                  onClick={startEditing}
                  title={`Your date${published ? ` — GBIF published ${published}` : ""}. Click to retype it.`}
                  className="text-violet-600 dark:text-violet-400 hover:underline"
                >
                  ◆ {mine.eventDate}
                </button>
                {noteIcon(f, "date", mine.remarks)}
              </span>
            );
          }
          if (published) {
            return editable ? (
              <button onClick={startEditing} title="Click to type the date off the label yourself" className="block text-left hover:underline decoration-dotted">
                {published}
              </button>
            ) : (
              published
            );
          }
          // An empty cell you can click, rather than a cell asking to be
          // clicked: the dash is what every other empty cell shows, and the
          // invitation was louder than the record.
          return editable ? (
            <button
              onClick={startEditing}
              title="GBIF has no date for this record. Click here and type the one on the label."
              className="block w-full text-left text-zinc-300 dark:text-zinc-600 hover:text-violet-500"
            >
              —
            </button>
          ) : null;
        },
      },
      {
        key: "coordinates",
        label: "Coordinates",
        title: "decimalLatitude, decimalLongitude — blank when GBIF has no coordinates for the record",
        className: "whitespace-nowrap tabular-nums",
        // Sorted by the position actually being shown, so a record you've
        // georeferenced sorts where you put it, not where GBIF left a hole.
        value: (p, f) => georeferences?.[p.gbifID]?.decimalLatitude ?? f.geometry?.coordinates[1] ?? null,
        // One column for where the record is, whoever placed it there: GBIF's
        // coordinates, yours in violet where you've supplied them, and the
        // affordance to add or change them in the same cell rather than a
        // separate one to hunt for.
        render: (p, f) => {
          const mine = georeferences?.[p.gbifID];
          const editable = isGeoreferenceable(p) && !!onSaveGeoreference;
          if (editable && editingCoords === p.gbifID) {
            return (
              <CoordinateCellEditor
                initialNote={mine?.georeferenceRemarks ?? ""}
                initial={
                  mine
                    ? `${mine.decimalLatitude}, ${mine.decimalLongitude}`
                    : f.geometry
                      ? `${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]}`
                      : ""
                }
                onCommit={(edit) => {
                  setEditingCoords(null);
                  if (edit) onSaveGeoreference?.(f, edit);
                }}
                onClear={mine ? () => { setEditingCoords(null); onClearGeoreference?.(f); } : undefined}
              />
            );
          }
          const startEditing = (e: React.MouseEvent) => {
            e.stopPropagation();
            setEditingCoords(p.gbifID);
          };
          if (mine) {
            return (
              <span className="flex items-center whitespace-nowrap">
                <button
                  onClick={startEditing}
                  title={`Your georeference: ${mine.decimalLatitude}, ${mine.decimalLongitude} ± ${mine.coordinateUncertaintyInMeters} m. Click to retype it, or drag the point on the map.`}
                  className="text-violet-600 dark:text-violet-400 hover:underline"
                >
                  ◆ {mine.decimalLatitude.toFixed(4)}, {mine.decimalLongitude.toFixed(4)}
                </button>
                {noteIcon(f, "georeference", mine.georeferenceRemarks)}
              </span>
            );
          }
          if (!f.geometry) {
            // An empty cell you can click, rather than a cell asking to be
            // clicked. The dash is what every other empty cell shows; the
            // invitation was louder than the record it sat in.
            return editable ? (
              <button
                onClick={startEditing}
                title="GBIF has no coordinates for this record — only a locality description. Click here and type the position you read it as, as \u201clat, lon\u201d."
                className="block w-full text-left text-zinc-300 dark:text-zinc-600 hover:text-violet-500"
              >
                —
              </button>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">Not georeferenced</span>
            );
          }
          const [lon, lat] = f.geometry.coordinates;
          const text = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          // Flagged coordinates are shown, not hidden — seeing that a record
          // sits at (0.0000, 0.0000) is the point — and typed over where you
          // can do better. Drawn as GBIF's own, because they are: violet is
          // for the coordinates you supplied, and marking a published position
          // as though you had put it there said the opposite of the truth.
          // The flag in the margin is what says it's questionable.
          return editable ? (
            <button
              onClick={startEditing}
              title="GBIF flags these coordinates. Click here and type your own."
              className="block text-left hover:underline decoration-dotted"
            >
              {text}
            </button>
          ) : (
            text
          );
        },
      },
      {
        key: "recordedBy",
        label: "Recorded by",
        title: "recordedBy — the observer or collector",
        // Narrow, cut off, and shown whole the moment you point at it. A
        // collecting team runs to four names and a locality to a paragraph:
        // at a width that fits them the record's own fields are pushed off
        // the screen, and a cell you have to scroll sideways is a cell nobody
        // reads. The bubble costs no width at all.
        className: "max-w-[8rem]",
        value: (p) => p.recordedBy || null,
        render: (p) => (p.recordedBy ? full(p.recordedBy) : null),
      },
      // Beside the collector, because it is the collector's own number: the two
      // together — "Zak 4412" — are how a specimen is cited, and how the same
      // gathering is recognised across the herbaria that split it up.
      {
        key: "recordNumber",
        label: "Record no.",
        title: "recordNumber — the collector's own number for this gathering",
        className: "whitespace-nowrap max-w-[8rem]",
        value: (p) => p.recordNumber || null,
        render: (p) =>
          p.recordNumber ? <span className="block truncate" title={p.recordNumber}>{p.recordNumber}</span> : null,
      },
      {
        key: "locality",
        label: "Locality",
        title: "locality, falling back to verbatimLocality",
        className: "max-w-[12rem]",
        value: (p) => localityOf(p) || null,
        render: (p) => {
          const loc = localityOf(p);
          return loc ? full(loc, true) : null;
        },
      },
      {
        key: "stateProvince",
        label: "State/Province",
        title: "stateProvince",
        className: "max-w-[10rem]",
        value: (p) => p.stateProvince || null,
        render: (p) =>
          p.stateProvince ? <span className="block truncate" title={p.stateProvince}>{p.stateProvince}</span> : null,
      },
      {
        key: "country",
        label: "Country",
        title: "country / countryCode",
        className: "max-w-[10rem]",
        value: (p) => p.country || null,
        render: (p) =>
          p.country ? <span className="block truncate" title={p.country}>{p.country}</span> : null,
      },
      {
        key: "uncertainty",
        label: "Uncertainty",
        title: "coordinateUncertaintyInMeters",
        className: "whitespace-nowrap tabular-nums",
        align: "right",
        // Yours where you've supplied a position, GBIF's otherwise — the same
        // rule the Coordinates column follows, so the two always describe the
        // same point.
        value: (p) =>
          georeferences?.[p.gbifID]?.coordinateUncertaintyInMeters ?? p.coordinateUncertaintyInMeters ?? null,
        render: (p, f) => {
          const mine = georeferences?.[p.gbifID];
          const u = mine?.coordinateUncertaintyInMeters ?? p.coordinateUncertaintyInMeters;
          const format = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
          if (mine && onSaveGeoreference) {
            if (editingRadius === p.gbifID) {
              return (
                <RadiusCellEditor
                  initial={String(mine.coordinateUncertaintyInMeters)}
                  onCommit={(metres) => {
                    setEditingRadius(null);
                    if (metres != null)
                      onSaveGeoreference(f, {
                        lat: mine.decimalLatitude,
                        lon: mine.decimalLongitude,
                        uncertainty: metres,
                      });
                  }}
                />
              );
            }
            // Editable in place, because typing coordinates alone leaves this
            // at a default that has to be visible to be corrected.
            return (
              <button
                onClick={(e) => { e.stopPropagation(); setEditingRadius(p.gbifID); }}
                title="The radius around your point, in metres — how much ground the locality description actually covers. Click to change it."
                className="text-violet-600 dark:text-violet-400 hover:underline decoration-dotted"
              >
                {format(mine.coordinateUncertaintyInMeters)}
              </button>
            );
          }
          if (u == null) return null;
          return format(u);
        },
      },
      {
        key: "elevation",
        label: "Elevation",
        title: "elevation in metres — a negative value is a recorded depth",
        className: "whitespace-nowrap tabular-nums",
        align: "right",
        value: (p) => elevationOf(p),
        render: (p) => {
          const e = elevationOf(p);
          return e == null ? null : `${e} m`;
        },
      },
      {
        key: "identifiedBy",
        label: "Identified by",
        title: "identifiedBy — who determined the species",
        className: "max-w-[12rem]",
        value: (p) => p.identifiedBy || null,
        render: (p) =>
          p.identifiedBy ? <span className="block truncate" title={p.identifiedBy}>{p.identifiedBy}</span> : null,
      },
      {
        key: "basisOfRecord",
        label: "Basis of record",
        title: "basisOfRecord — what kind of evidence the record is based on",
        className: "whitespace-nowrap",
        value: (p) => formatBasis(p.basisOfRecord) || null,
      },
      {
        key: "dataset",
        label: "Dataset",
        title: "datasetName — the GBIF dataset publishing the record",
        className: "min-w-[12rem] max-w-[16rem]",
        value: (p) => p.datasetName || null,
        render: (p) =>
          p.datasetName ? (
            p.datasetKey ? (
              <a
                href={`https://www.gbif.org/dataset/${p.datasetKey}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="block truncate hover:underline"
                title={p.datasetName}
              >
                {p.datasetName}
              </a>
            ) : (
              <span className="block truncate" title={p.datasetName}>{p.datasetName}</span>
            )
          ) : null,
      },
      {
        key: "catalog",
        label: "Catalogue",
        title: "institutionCode · collectionCode · catalogNumber",
        className: "max-w-[12rem]",
        value: (p) => catalogOf(p) || null,
        render: (p) => {
          const c = catalogOf(p);
          return c ? <span className="block truncate" title={c}>{c}</span> : null;
        },
      },
      {
        key: "establishmentMeans",
        label: "Establishment",
        title: "establishmentMeans — e.g. native, introduced, cultivated",
        className: "max-w-[8rem]",
        value: (p) => p.establishmentMeans || null,
        render: (p) =>
          p.establishmentMeans ? (
            <span className="block truncate capitalize" title={p.establishmentMeans}>
              {p.establishmentMeans.toLowerCase()}
            </span>
          ) : null,
      },
      // Everything else GBIF carries, off by default and available from the
      // column picker. Grouped roughly as GBIF groups them: taxonomy, the
      // record itself, the event, the place, the people, the dataset.
      ...EXTRA_COLUMNS.map((c) => ({
        key: c.key,
        label: c.label,
        title: c.title,
        className: c.numeric ? "whitespace-nowrap tabular-nums" : "max-w-[16rem]",
        align: c.numeric ? ("right" as const) : undefined,
        value: (p: OccurrenceFeature["properties"]) => {
          const raw = (p as Record<string, unknown>)[c.key];
          if (raw == null || raw === "") return null;
          if (Array.isArray(raw)) return raw.join(", ");
          if (typeof raw === "boolean") return raw ? "Yes" : "No";
          return typeof raw === "number" ? raw : String(raw);
        },
        render: (p: OccurrenceFeature["properties"]) => {
          const raw = (p as Record<string, unknown>)[c.key];
          if (raw == null || raw === "") return null;
          const text = Array.isArray(raw)
            ? raw.join(", ")
            : typeof raw === "boolean"
              ? (raw ? "Yes" : "No")
              : String(raw);
          return c.numeric ? text : <span className="block truncate" title={text}>{text}</span>;
        },
      })),
      {
        key: "gbifID",
        label: "GBIF",
        title: "gbifID — opens the record on gbif.org",
        className: "whitespace-nowrap tabular-nums",
        value: (p) => p.gbifID,
        render: (p) => (
          <a
            href={`https://www.gbif.org/occurrence/${p.gbifID}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            {p.gbifID}
          </a>
        ),
      },
    ],
    [isOutsideNativeRange, nativeRangeSourceLabel, georeferences, onSaveGeoreference, onClearGeoreference, editingCoords, editingRadius, exclusions, variant, onExclude, onInclude, duplicates, unfolded, dates, onSaveDate, onClearDate, editingDate, full, showNote, hideNoteSoon, noteIcon]
  );

  // The catalogue in the reader's own order, then the subset actually drawn.
  // Unknown ids in stored prefs are ignored and new columns fall in at the end,
  // so a saved layout survives this table gaining fields.
  const orderedColumns = useMemo(() => {
    // The unfold chevron and the excluded list's own columns lead, whatever
    // the reader's saved order says. They're not fields of the record but
    // handles on the row, and a saved layout from before they existed would
    // otherwise leave them at the far right, past sixteen columns of fields.
    const pinned = columns.filter((c) => ALWAYS_VISIBLE_COLUMNS.has(c.key));
    const rest = columns.filter((c) => !ALWAYS_VISIBLE_COLUMNS.has(c.key));
    if (!columnPrefs) return [...pinned, ...rest];
    const byKey = new Map(rest.map((c) => [c.key, c]));
    const ordered = columnPrefs.order.map((key) => byKey.get(key)).filter((c): c is ColumnDef => !!c);
    const seen = new Set(ordered.map((c) => c.key));
    return [...pinned, ...ordered, ...rest.filter((c) => !seen.has(c.key))];
  }, [columns, columnPrefs]);

  const visibleKeys = useMemo(
    () => new Set(columnPrefs ? columnPrefs.visible : DEFAULT_VISIBLE_COLUMNS),
    [columnPrefs]
  );
  // The excluded list's own two columns are always drawn: they aren't fields
  // of the record but the tab's reason for existing, and a saved layout from
  // before they existed doesn't know to ask for them.
  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => ALWAYS_VISIBLE_COLUMNS.has(c.key) || visibleKeys.has(c.key)),
    [orderedColumns, visibleKeys]
  );

  const columnWidths = columnPrefs?.widths ?? {};

  // Dragging the right edge of a header resizes that column. Tracked in a ref
  // rather than state: this fires on every mousemove, and a re-render per pixel
  // would make the drag feel like treacle on a long table.
  const resizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);

  useEffect(() => {
    if (!resizingColumn) return;
    const onMove = (e: MouseEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const width = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, drag.startWidth + (e.clientX - drag.startX))
      );
      const th = scrollRef.current?.querySelector<HTMLElement>(`th[data-column="${drag.key}"]`);
      if (th) {
        th.style.width = `${width}px`;
        th.style.minWidth = `${width}px`;
        th.style.maxWidth = `${width}px`;
      }
    };
    const onUp = () => {
      const drag = resizeRef.current;
      resizeRef.current = null;
      setResizingColumn(null);
      if (!drag) return;
      const th = scrollRef.current?.querySelector<HTMLElement>(`th[data-column="${drag.key}"]`);
      const width = th ? parseInt(th.style.width, 10) : drag.startWidth;
      if (!Number.isFinite(width)) return;
      updatePrefs({
        order: orderedColumns.map((c) => c.key),
        visible: orderedColumns.filter((c) => visibleKeys.has(c.key)).map((c) => c.key),
        widths: { ...columnWidths, [drag.key]: width },
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizingColumn]);

  const setVisible = (keys: string[]) => {
    // Store in catalogue order so the visible list can't imply an order that
    // contradicts the column order itself.
    const wanted = new Set(keys);
    updatePrefs({
      order: orderedColumns.map((c) => c.key),
      visible: orderedColumns.filter((c) => wanted.has(c.key)).map((c) => c.key),
      widths: columnWidths,
    });
  };

  /** Drops the dragged column into the position of the one it was dropped on. */
  const moveColumnBefore = (dragged: string | null, target: string) => {
    if (!dragged || dragged === target) return;
    const order = orderedColumns.map((c) => c.key);
    const from = order.indexOf(dragged);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, ...order.splice(from, 1));
    updatePrefs({
      order,
      visible: order.filter((k) => visibleKeys.has(k)),
      widths: columnWidths,
    });
  };

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return occurrences;
    const dir = sortAsc ? 1 : -1;
    return [...occurrences].sort((a, b) => {
      const av = col.value(a.properties, a);
      const bv = col.value(b.properties, b);
      // Blanks always sort last, whichever direction the column is sorted in —
      // a page of empty cells at the top is never what you asked for.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [occurrences, columns, sortKey, sortAsc]);

  /** Excluded either way — by a filter, or by hand with a reason. */
  const isExcluded = useCallback(
    (f: OccurrenceFeature) =>
      (excludedIds?.has(f.properties.gbifID) ?? false) || !!exclusions?.[f.properties.gbifID],
    [excludedIds, exclusions]
  );

  const excludedCount = useMemo(() => sorted.filter(isExcluded).length, [sorted, isExcluded]);
  const rows = useMemo(
    () => (showExcluded ? sorted : sorted.filter((f) => !isExcluded(f))),
    [sorted, showExcluded, isExcluded]
  );

  // Which rows match the find box, in display order.
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return rows
      .filter((f) =>
        visibleColumns.some((col) => {
          const v = col.value(f.properties, f);
          return v != null && String(v).toLowerCase().includes(needle);
        })
      )
      .map((f) => f.properties.gbifID);
  }, [rows, visibleColumns, search]);

  const matchSet = useMemo(() => new Set(matches), [matches]);

  /**
   * The rows as drawn: each one, and — where its duplicates are unfolded —
   * those beneath it. The duplicates are excluded records, so they are in no
   * list of their own here; they are borrowed from the other tab to be read
   * against the record they were set aside for.
   */
  const displayRows = useMemo(() => {
    if (!duplicates || duplicates.size === 0) return rows;
    const out: OccurrenceFeature[] = [];
    for (const f of rows) {
      out.push(f);
      if (unfolded.has(f.properties.gbifID)) out.push(...(duplicates.get(f.properties.gbifID) ?? []));
    }
    return out;
  }, [rows, duplicates, unfolded]);

  const currentMatch = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : null;

  /**
   * Bring a row to the top of the table rather than merely into view: you're
   * reading down from the record you just picked, so it wants to be where the
   * reading starts. Offset by the sticky header, which would otherwise sit on
   * top of it — scrollIntoView has no way to account for that.
   */
  const scrollRowToTop = (gbifID: number | null) => {
    if (gbifID == null) return;
    const container = scrollRef.current;
    const row = rowRefs.current.get(gbifID);
    if (!container || !row) return;
    const headerHeight = container.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top - headerHeight;
    container.scrollBy({ top: delta, behavior: "smooth" });
  };


  // After the row has been laid out, or there is nothing to scroll to yet.
  useEffect(() => {
    if (focusGbifId == null) return;
    const frame = requestAnimationFrame(() => scrollRowToTop(focusGbifId));
    return () => cancelAnimationFrame(frame);
  }, [focusGbifId]);

  const stepMatch = (delta: number) => {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    scrollRowToTop(matches[next]);
  };

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      // Text columns read best A→Z first; dates and counts most-recent/largest first.
      setSortAsc(!["date", "uncertainty", "elevation", "gbifID", "flags", "coordinates"].includes(key));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[300px] sm:min-h-[450px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800">
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading occurrences...
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden${
      fillHeight ? " flex-1 min-h-0" : ""
    }`}>
      {/* Always scrolls horizontally — there are more Darwin Core fields than
          fit under a map. Vertically it only scrolls when expanded, since a
          page is otherwise sized to be read whole. */}
      <div
        ref={scrollRef}
        className={`overflow-x-auto${fillHeight ? " flex-1 min-h-0 overflow-y-auto" : ""}`}
        // Only while a row is actually being dragged: the rest of the time
        // these rows are there to be read, and read means selected and copied.
        style={draggingId != null ? { userSelect: "none", cursor: "grabbing" } : undefined}
      >
        {/* Zoomed rather than restyled: one number shrinks the type, the
            padding and the column widths together, and leaves the controls
            around it at a size that can still be clicked. */}
        <table className="min-w-full text-xs border-collapse" style={zoom === 1 ? undefined : { zoom }}>
          <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-800">
            <tr>
              {visibleColumns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    data-column={col.key}
                    style={
                      columnWidths[col.key]
                        ? {
                            width: columnWidths[col.key],
                            minWidth: columnWidths[col.key],
                            maxWidth: columnWidths[col.key],
                          }
                        : undefined
                    }
                    title={`${col.title ?? col.label} — click to sort, drag to reorder`}
                    draggable
                    onDragStart={(e) => {
                      setDragColumn(col.key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      moveColumnBefore(dragColumn, col.key);
                      setDragColumn(null);
                    }}
                    onDragEnd={() => setDragColumn(null)}
                    onClick={() => toggleSort(col.key)}
                    className={`relative ${col.compact ? "px-1" : "px-2"} py-1.5 font-medium text-[11px] whitespace-nowrap cursor-pointer select-none border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                      col.align === "right" ? "text-right" : "text-left"
                    } ${active ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-400"} ${
                      dragColumn === col.key ? "opacity-40" : ""
                    } ${col.className ?? ""}`}
                  >
                    {!col.headerIconOnly && col.label}
                    <span className={`ml-1 ${active ? "text-zinc-400" : "text-transparent"}`}>
                      {active && !sortAsc ? "▼" : "▲"}
                    </span>
                    {col.headerExtra}
                    {/* Grab the edge to resize. Its own mousedown stops the
                        header's drag-to-reorder and click-to-sort from firing. */}
                    <span
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const th = e.currentTarget.parentElement as HTMLElement;
                        resizeRef.current = {
                          key: col.key,
                          startX: e.clientX,
                          startWidth: th.getBoundingClientRect().width,
                        };
                        setResizingColumn(col.key);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.preventDefault()}
                      title="Drag to resize this column"
                      className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none ${
                        resizingColumn === col.key ? "bg-blue-400" : "hover:bg-zinc-300 dark:hover:bg-zinc-600"
                      }`}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((f, rowIndex) => {
              const id = f.properties.gbifID;
              const excluded = isExcluded(f);
              const isDuplicate = duplicateOf(exclusions?.[id]?.justification) != null;
              return (
              <tr
                key={id}
                ref={(el) => {
                  if (el) rowRefs.current.set(id, el);
                  else rowRefs.current.delete(id);
                }}
                // What you can do with a record lives on the right button:
                // show it on the map, open it on gbif.org, set it aside. A
                // left click on a row does nothing — it used to select, and
                // then to open the map panel, and both were a gesture spent
                // on something a menu says better.
                onContextMenu={(e) => {
                  if (!onRowContextMenu) return;
                  e.preventDefault();
                  onRowContextMenu(f, { x: e.clientX, y: e.clientY });
                }}
                /**
                 * Press, hold, then drag a record onto the one it duplicates.
                 * The reason writes itself and names the record kept, which is
                 * more than anyone would type by hand — and dropping onto a
                 * duplicate hands the record to that duplicate's own primary,
                 * since a duplicate of a duplicate is a duplicate of the same
                 * record.
                 *
                 * Held rather than dragged outright, and by hand rather than
                 * with the browser's own drag and drop: a draggable row can't
                 * have its text selected, and these rows are read as much as
                 * they're rearranged. Moving before the hold is up is taken as
                 * the start of a selection and abandons the drag.
                 */
                data-gbif-id={id}
                onMouseDown={(e) => {
                  if (!onMarkDuplicate || e.button !== 0) return;
                  if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
                  beginHold(id, e.clientX, e.clientY);
                }}
                onMouseEnter={() => onHoverRow?.(f)}
                onMouseLeave={() => onHoverRow?.(null)}
                className={`border-b border-zinc-100 dark:border-zinc-800 ${
                  focusGbifId === id
                    ? "bg-blue-50 dark:bg-blue-950/40 ring-1 ring-inset ring-blue-400"
                    : hoveredGbifId === id
                    ? "bg-blue-50 dark:bg-blue-950/40"
                    : currentMatch === id
                      ? "bg-amber-100 dark:bg-amber-900/40"
                      : matchSet.has(id)
                        ? "bg-amber-50 dark:bg-amber-950/30"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                } ${excluded && variant === "records" && !isDuplicate ? "opacity-40" : ""} ${
                  isDuplicate && variant === "records"
                    ? "bg-zinc-50/80 dark:bg-zinc-800/40 text-zinc-500 dark:text-zinc-400"
                    : ""
                } ${draggingId === id ? "opacity-50" : ""} ${
                  dropTargetId === id
                    ? "outline outline-2 -outline-offset-2 outline-amber-500 bg-amber-50 dark:bg-amber-950/40"
                    : ""
                }`}
              >
                {visibleColumns.map((col) => {
                  const content = col.render
                    ? col.render(f.properties, f, rowIndex)
                    : col.value(f.properties, f);
                  return (
                    <td
                      key={col.key}
                      style={
                        columnWidths[col.key]
                          ? {
                              width: columnWidths[col.key],
                              minWidth: columnWidths[col.key],
                              maxWidth: columnWidths[col.key],
                            }
                          : undefined
                      }
                      className={`${col.compact ? "px-1" : "px-2"} py-1.5 align-top text-zinc-600 dark:text-zinc-300 ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${col.className ?? ""}`}
                    >
                      {content === null || content === "" ? (
                        <span className="text-zinc-300 dark:text-zinc-600">—</span>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-zinc-400 text-sm">
                  {sorted.length > 0
                    ? "Every record here is excluded — show them again from the Included column."
                    : "No occurrences match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* The reason, in the same place the hover bubble reads it from, with a
          box round it. Enter keeps it, Escape leaves it alone, and clicking
          away keeps it too — a reason you typed and clicked off is a reason
          you meant. */}
      {noteEditor && createPortal(
        <div
          style={{
            position: "fixed",
            left: Math.min(noteEditor.x, window.innerWidth - 300),
            top: Math.min(noteEditor.y, window.innerHeight - 120),
            width: 280,
            zIndex: 10003,
          }}
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg bg-white dark:bg-zinc-900 border border-violet-300 dark:border-violet-700 shadow-xl p-1.5"
        >
          <span className="block pb-1 text-[10px] text-zinc-400">
            {noteEditor.kind === "georeference"
              ? "How you read the locality, in your words"
              : "Where this date comes from, in your words"}
          </span>
          <textarea
            autoFocus
            rows={3}
            value={noteEditor.text}
            onChange={(e) => setNoteEditor({ ...noteEditor, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                saveNote();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setNoteEditor(null);
              }
            }}
            onBlur={saveNote}
            placeholder="why"
            className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-700 dark:text-zinc-200"
          />
        </div>,
        document.body
      )}
      {hoverNote && createPortal(
        <div
          style={{
            position: "fixed",
            // Clamped against the width the bubble can actually reach, not a
            // narrower guess at it: with a translation under the text it takes
            // all 320 and was running off the right edge.
            left: Math.max(4, Math.min(hoverNote.x, window.innerWidth - HOVER_NOTE_MAX_WIDTH - 8)),
            // A locality on the last row on screen had its bubble — and the
            // translate button in it — below the bottom of the window. There
            // it opens upward instead.
            ...(hoverNote.above != null && hoverNote.y > window.innerHeight - HOVER_NOTE_FLIP_MARGIN
              ? { bottom: Math.max(4, window.innerHeight - hoverNote.above) }
              : { top: Math.max(4, hoverNote.y) }),
            maxWidth: HOVER_NOTE_MAX_WIDTH,
            zIndex: 10002,
          }}
          onMouseEnter={keepNote}
          onMouseLeave={hideNoteSoon}
          data-hover-note
          className="rounded-md bg-zinc-900/95 dark:bg-zinc-700 px-1.5 py-1 text-[10px] leading-snug text-white shadow-lg select-text cursor-text"
        >
          {hoverNote.text}
          {/* A locality is the field a georeference is made from, and it is
              written in the language of whoever collected the specimen. One
              button per service rather than one button and a choice: they
              disagree, and on a locality description the disagreement is the
              information. Nothing is asked until it's clicked — both quotas
              are metered by the day. */}
          {hoverNote.translate &&
            (Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[]).map((provider) => (
              <button
                key={provider}
                onClick={() => translateNote(hoverNote.text, provider)}
                disabled={shownTranslations.some((line) => line.provider === provider && line.status === "loading")}
                title={`Translate this locality into ${languageName(browserLanguage()) ?? browserLanguage()} with ${TRANSLATION_PROVIDERS[provider].label}`}
                aria-label={`Translate this locality with ${TRANSLATION_PROVIDERS[provider].label}`}
                data-translate-with={provider}
                className="ml-1 inline-flex align-middle cursor-pointer text-white/50 hover:text-white disabled:hover:text-white/50"
              >
                {provider === "google" ? (
                  // A globe for the one that reads the whole web.
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18" />
                    <path d="M12 3c2.5 2.5 3.75 5.5 3.75 9S14.5 18.5 12 21c-2.5-2.5-3.75-5.5-3.75-9S9.5 5.5 12 3z" />
                  </svg>
                ) : (
                  // An open book for the one that is a translation memory.
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.5C10.5 5.2 8.5 4.5 4 4.5v13c4.5 0 6.5.7 8 2 1.5-1.3 3.5-2 8-2v-13c-4.5 0-6.5.7-8 2z" />
                    <path strokeLinecap="round" d="M12 6.5v13" />
                  </svg>
                )}
              </button>
            ))}
          {shownTranslations.length > 0 && (
            <div className="mt-1 pt-1 border-t border-white/20 space-y-0.5">
              <span className="text-white/60">
                Translates
                {detectedSource ? ` from ${languageName(detectedSource)}` : ""} to{" "}
                {languageName(browserLanguage()) ?? browserLanguage()}:
              </span>
              {shownTranslations.map((line) => (
                <div key={line.provider}>
                  <span className="text-white/40">{TRANSLATION_PROVIDERS[line.provider].label}</span>{" "}
                  {line.status === "loading" && <span className="text-white/60">translating…</span>}
                  {line.status === "error" && <span className="text-amber-300">{line.error}</span>}
                  {line.status === "done" && line.result && (
                    <>
                      {line.result.text}
                      {line.result.truncated && (
                        <span className="text-white/40">
                          {" "}
                          (its first {TRANSLATION_PROVIDERS[line.provider].maxChars} characters)
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
      {mediaPreview && createPortal(
        <div
          style={{
            position: "fixed",
            left: Math.min(mediaPreview.x, window.innerWidth - 240),
            top: Math.max(8, Math.min(mediaPreview.y - 60, window.innerHeight - 260)),
            width: 220,
            zIndex: 10002,
            pointerEvents: "none",
          }}
          className="rounded-lg overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl"
        >
          <img src={mediaPreview.image.url} alt="" className="w-full max-h-[15rem] object-contain" />
          <span className="block px-1.5 py-1 text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
            {mediaPreview.image.creator ? `© ${mediaPreview.image.creator} · ` : ""}
            Click to open the full image
          </span>
        </div>,
        document.body
      )}
      {/* Footer: how many rows the filters left, and which columns are shown */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="tabular-nums">
          {rows.length === 0 ? "0 records" : `${rows.length.toLocaleString()} records`}
          {variant === "records" && excludedCount > 0 && (
            <span className="text-zinc-400">
              {" "}· {excludedCount.toLocaleString()} removed by your filters
              {showExcluded ? "" : " (hidden)"}
            </span>
          )}
        </span>
        {/* The rows the filters took out are greyed in place by default — a
            record you can't see is a record you can't reconsider — and this
            takes them out of the table once you've stopped reconsidering.
            It used to live in the header of a column that no longer exists. */}
        {variant === "records" && excludedCount > 0 && (
          <button
            onClick={() => setShowExcluded((v) => !v)}
            title={
              showExcluded
                ? "Hide the rows your filters removed"
                : "Show the rows your filters removed (greyed out, in place)"
            }
            className={
              showExcluded
                ? "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                : "text-emerald-600 dark:text-emerald-400"
            }
          >
            {showExcluded ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                <circle cx="12" cy="12" r="2.75" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5c1.7 0 3.2.5 4.5 1.2M21.5 12s-1.3 2.4-3.7 4.2M4 20L20 4" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.9 14.1a3 3 0 014.2-4.2" />
              </svg>
            )}
          </button>
        )}
        <div className="flex items-center gap-1">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Find in table…"
            title="Search every shown column. Matches are highlighted; Enter steps to the next one."
            className="w-36 px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-[11px] text-zinc-700 dark:text-zinc-200"
          />
          {search.trim() !== "" && (
            <>
              <span className="tabular-nums">
                {matches.length === 0 ? "none" : `${Math.min(matchIndex, matches.length - 1) + 1}/${matches.length}`}
              </span>
              <button
                onClick={() => stepMatch(-1)}
                disabled={matches.length === 0}
                title="Previous match"
                className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                onClick={() => stepMatch(1)}
                disabled={matches.length === 0}
                title="Next match"
                className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {footerExtra}
          {onTogglePanelLayout && (
            <button
              onClick={onTogglePanelLayout}
              title={
                panelLayout === "rows"
                  ? "Put the list beside the map"
                  : "Put the list below the map"
              }
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 text-[10px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4" width="18" height="16" rx="1.5" />
                {panelLayout === "rows" ? (
                  <path strokeLinecap="round" d="M3 13h18" />
                ) : (
                  <path strokeLinecap="round" d="M13 4v16" />
                )}
              </svg>
              {panelLayout === "rows" ? "Side by side" : "Stacked"}
            </button>
          )}
          <button
            ref={columnButtonRef}
            onClick={() => setColumnPickerOpen((v) => !v)}
            title="Choose which GBIF fields to show, and in what order. Remembered in this browser."
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 text-[10px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6" />
            </svg>
            Columns
            <span className="tabular-nums">{visibleColumns.length}/{orderedColumns.length}</span>
          </button>
          {columnPickerOpen && pickerAnchor && createPortal(
            <div
              ref={columnPickerRef}
              style={{ position: "fixed", right: pickerAnchor.right, bottom: pickerAnchor.bottom, zIndex: 10002 }}
              className="w-80 max-h-[70vh] overflow-y-auto bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-zinc-400 dark:text-zinc-500 sticky top-0 bg-white dark:bg-zinc-900">
                <button onClick={() => setVisible(orderedColumns.map((c) => c.key))} className="hover:underline">
                  Show all
                </button>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <button onClick={resetPrefs} className="hover:underline">
                  Reset to default
                </button>
                <span className="ml-auto">Drag a row to reorder</span>
              </div>
              {orderedColumns.filter((col) => !ALWAYS_VISIBLE_COLUMNS.has(col.key)).map((col) => {
                const shown = visibleKeys.has(col.key);
                return (
                  <div
                    key={col.key}
                    draggable
                    onDragStart={(e) => {
                      setDragColumn(col.key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      moveColumnBefore(dragColumn, col.key);
                      setDragColumn(null);
                    }}
                    onDragEnd={() => setDragColumn(null)}
                    className={`flex items-center gap-2 px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs ${
                      dragColumn === col.key ? "opacity-40" : ""
                    }`}
                  >
                    {/* The handle: six dots, the usual sign for "pick me up". */}
                    <span className="cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-600 select-none" title="Drag to reorder">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="6" r="1.6" />
                        <circle cx="15" cy="6" r="1.6" />
                        <circle cx="9" cy="12" r="1.6" />
                        <circle cx="15" cy="12" r="1.6" />
                        <circle cx="9" cy="18" r="1.6" />
                        <circle cx="15" cy="18" r="1.6" />
                      </svg>
                    </span>
                    <input
                      type="checkbox"
                      checked={shown}
                      onChange={() =>
                        setVisible(
                          shown
                            ? visibleColumns.filter((c) => c.key !== col.key).map((c) => c.key)
                            : [...visibleColumns.map((c) => c.key), col.key]
                        )
                      }
                      className="w-3 h-3 rounded accent-emerald-500 shrink-0"
                    />
                    <span
                      className={`flex-1 min-w-0 truncate ${shown ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-500"}`}
                      title={col.title}
                    >
                      {col.label}
                    </span>
                  </div>
                );
              })}
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
}
