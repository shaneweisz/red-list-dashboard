"use client";

import { useMemo, useState } from "react";
import { QUALITY_FLAG_LABELS, type QualityFlag } from "@/lib/coordinate-cleaning";

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
    qualityFlags?: string[];
    locality?: string;
    verbatimLocality?: string;
    stateProvince?: string;
    elevation?: number | null;
    depth?: number | null;
    identifiedBy?: string;
    collectionCode?: string;
    catalogNumber?: string;
    establishmentMeans?: string;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

const ROWS_PER_PAGE = 50;

const BASIS_LABELS: Record<string, string> = {
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
  return null;
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
  /** Cell contents, when they aren't just the sort value rendered as text. */
  render?: (p: OccurrenceFeature["properties"], f: OccurrenceFeature) => React.ReactNode;
}

interface OccurrenceListTableProps {
  occurrences: OccurrenceFeature[];
  /** Whether the initial /api/occurrences fetch is still in flight. */
  loading: boolean;
  /** Species' native countries per the currently selected source, for the
   *  "outside native range" flag shown in the Flags column (same signal the map
   *  tooltip shows). */
  isOutsideNativeRange: (countryCode: string | null | undefined) => boolean;
}

export default function OccurrenceListTable({
  occurrences,
  loading,
  isOutsideNativeRange,
}: OccurrenceListTableProps) {
  // Default sort: newest first, matching GBIF's own default result order.
  const [sortKey, setSortKey] = useState<string>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [rawPage, setPage] = useState(0);

  const columns = useMemo<ColumnDef[]>(
    () => [
      {
        key: "date",
        label: "Date",
        title: "eventDate (or year/month when no full date was recorded)",
        // Without nowrap the browser breaks yyyy-mm-dd at its hyphens.
        className: "whitespace-nowrap",
        value: (p) => formatDate(p) || null,
      },
      {
        key: "basisOfRecord",
        label: "Basis of record",
        title: "basisOfRecord — what kind of evidence the record is based on",
        className: "whitespace-nowrap",
        value: (p) => formatBasis(p.basisOfRecord) || null,
      },
      {
        key: "locality",
        label: "Locality",
        title: "locality, falling back to verbatimLocality",
        className: "min-w-[12rem] max-w-[18rem]",
        value: (p) => localityOf(p) || null,
        render: (p) => {
          const loc = localityOf(p);
          return loc ? <span className="block truncate" title={loc}>{loc}</span> : null;
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
        key: "coordinates",
        label: "Coordinates",
        title: "decimalLatitude, decimalLongitude",
        className: "whitespace-nowrap tabular-nums",
        value: (_p, f) => f.geometry.coordinates[1],
        render: (_p, f) => {
          const [lon, lat] = f.geometry.coordinates;
          return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        },
      },
      {
        key: "uncertainty",
        label: "Uncertainty",
        title: "coordinateUncertaintyInMeters",
        className: "whitespace-nowrap tabular-nums",
        align: "right",
        value: (p) => p.coordinateUncertaintyInMeters ?? null,
        render: (p) => {
          const u = p.coordinateUncertaintyInMeters;
          if (u == null) return null;
          return u >= 1000 ? `${(u / 1000).toFixed(1)} km` : `${u} m`;
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
        key: "recordedBy",
        label: "Recorded by",
        title: "recordedBy — the observer or collector",
        className: "max-w-[12rem]",
        value: (p) => p.recordedBy || null,
        render: (p) =>
          p.recordedBy ? <span className="block truncate" title={p.recordedBy}>{p.recordedBy}</span> : null,
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
      {
        key: "flags",
        label: "Flags",
        title: "Coordinate-cleaning checks this record trips, and whether it falls outside the species' native range — the same signals the map tooltip shows",
        className: "max-w-[16rem]",
        // Sort by how many flags a record trips, so the questionable records
        // group together at one end.
        value: (p) => (p.qualityFlags?.length ?? 0) + (isOutsideNativeRange(p.countryCode) ? 1 : 0),
        render: (p) => {
          const flags = (p.qualityFlags ?? []).map((f) => QUALITY_FLAG_LABELS[f as QualityFlag] ?? f);
          if (isOutsideNativeRange(p.countryCode)) flags.push("Outside native range");
          if (flags.length === 0) return null;
          const text = flags.join(", ");
          return (
            <span className="block truncate text-amber-600 dark:text-amber-400" title={text}>
              ⚠ {text}
            </span>
          );
        },
      },
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
    [isOutsideNativeRange]
  );

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

  const pageCount = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE));
  // Clamped during render rather than reset in an effect: tightening a filter
  // can shrink the result set out from under the current page, and re-rendering
  // an empty page first (then correcting it) is a visible flash.
  const page = Math.min(rawPage, pageCount - 1);
  const pageRows = sorted.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      // Text columns read best A→Z first; dates and counts most-recent/largest first.
      setSortAsc(!["date", "uncertainty", "elevation", "gbifID", "flags", "coordinates"].includes(key));
    }
    setPage(0);
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
    <div className="flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Scrolls in both axes: horizontally because there are more Darwin Core
          fields than fit any sensible width, vertically so the panel stays
          roughly map-height instead of pushing the rest of the page down. */}
      <div className="overflow-auto max-h-[520px]">
        <table className="min-w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-800">
            <tr>
              {columns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    title={col.title}
                    onClick={() => toggleSort(col.key)}
                    className={`px-2 py-1.5 font-medium text-[11px] whitespace-nowrap cursor-pointer select-none border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                      col.align === "right" ? "text-right" : "text-left"
                    } ${active ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-400"} ${col.className ?? ""}`}
                  >
                    {col.label}
                    <span className={`ml-1 ${active ? "text-zinc-400" : "text-transparent"}`}>
                      {active && !sortAsc ? "▼" : "▲"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((f) => (
              <tr
                key={f.properties.gbifID}
                onClick={() => window.open(`https://www.gbif.org/occurrence/${f.properties.gbifID}`, "_blank", "noopener,noreferrer")}
                className="cursor-pointer border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              >
                {columns.map((col) => {
                  const content = col.render ? col.render(f.properties, f) : col.value(f.properties, f);
                  return (
                    <td
                      key={col.key}
                      className={`px-2 py-1.5 align-top text-zinc-600 dark:text-zinc-300 ${
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
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-zinc-400 text-sm">
                  No occurrences match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Footer: how many rows the filters left, plus paging */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="tabular-nums">
          {sorted.length === 0
            ? "0 records"
            : `${(page * ROWS_PER_PAGE + 1).toLocaleString()}–${Math.min((page + 1) * ROWS_PER_PAGE, sorted.length).toLocaleString()} of ${sorted.length.toLocaleString()} records`}
        </span>
        {pageCount > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              title="Previous page"
              className="p-1 sm:p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="tabular-nums">
              {page + 1}/{pageCount}
            </span>
            <button
              onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
              disabled={page >= pageCount - 1}
              title="Next page"
              className="p-1 sm:p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
