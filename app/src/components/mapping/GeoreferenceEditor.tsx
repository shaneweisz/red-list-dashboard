"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  parseCoordinatePair,
  validateGeoreference,
  type Georeference,
} from "@/lib/mapping/georeferences";
import type { OccurrenceFeature } from "./OccurrenceListTable";
import { formatKind, searchPlaces, GEOCODER_ATTRIBUTION, type Place } from "@/lib/mapping/geocode";
import { haversineMetres } from "@/lib/mapping/geo-distance";

interface GeoreferenceEditorProps {
  /**
   * How it's shown. "panel" docks it beside the map, which is what
   * georeferencing actually wants: the map, its search and the neighbouring
   * records all stay usable while you work. "modal" is the fallback where
   * there's no room to dock anything.
   */
  variant?: "modal" | "panel";
  /** A point picked by clicking the map, which fills the coordinates. */
  pickedPoint?: { lat: number; lon: number } | null;
  /** The draft, so the map can draw it before it's saved. */
  onDraftChange?: (draft: { lat: number | null; lon: number | null; uncertainty: number | null }) => void;
  /** The GBIF record being georeferenced. */
  feature: OccurrenceFeature;
  /** The assessor's existing georeference for it, when re-opening one. */
  existing?: Georeference;
  /** Signed-in account, recorded as georeferencedBy. */
  georeferencedBy?: string | null;
  scientificName?: string;
  onSave: (georeference: Georeference) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * What to search for, from what the label says.
 *
 * The administrative names go in the query rather than being used to filter:
 * Photon has no country parameter, and a place name plus its region is what
 * anyone would type anyway — it disambiguates a locality shared by a dozen
 * municipalities without excluding a hit whose region OSM spells differently.
 */
function localityQuery(p: OccurrenceFeature["properties"]): string {
  return [p.locality || p.verbatimLocality, p.stateProvince, p.country].filter(Boolean).join(", ");
}

/**
 * A radius that covers the named feature, for the point-radius method.
 *
 * Half the diagonal of the place's own extent, which is the smallest circle
 * centred on it that contains it. Only a starting point — the assessor still
 * owns the number — but it beats an empty box, and it is at least honestly
 * derived from how big the thing actually is rather than guessed.
 */
function radiusFromExtent(place: Place): number | null {
  if (!place.bbox) return null;
  const [west, south, east, north] = place.bbox;
  const diagonal = haversineMetres([west, south], [east, north]);
  if (!Number.isFinite(diagonal) || diagonal <= 0) return null;
  return Math.max(30, Math.round(diagonal / 2));
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-zinc-400 dark:text-zinc-500">{label}</span>
      <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-200 break-words">{value}</span>
    </div>
  );
}

export default function GeoreferenceEditor({
  variant = "modal",
  pickedPoint,
  onDraftChange,
  feature,
  existing,
  georeferencedBy,
  scientificName,
  onSave,
  onDelete,
  onClose,
}: GeoreferenceEditorProps) {
  const p = feature.properties;
  const originalCoords = feature.geometry?.coordinates;

  const [lat, setLat] = useState(existing ? String(existing.decimalLatitude) : "");
  const [lon, setLon] = useState(existing ? String(existing.decimalLongitude) : "");
  const [uncertainty, setUncertainty] = useState(
    existing ? String(existing.coordinateUncertaintyInMeters) : ""
  );
  const [remarks, setRemarks] = useState(existing?.georeferenceRemarks ?? "");
  const [showErrors, setShowErrors] = useState(false);
  // Looking the locality up, in here rather than in another tab. The round trip
  // through an external tool — search there, read the numbers off, type them
  // back — is the whole of the friction this removes.
  const [query, setQuery] = useState(() => localityQuery(feature.properties));
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      // Biased towards GBIF's own coordinates where it has any — a flagged
      // record is usually flagged for being in the wrong place, not the wrong
      // country, so its neighbourhood is still the right one to look in.
      setResults(
        await searchPlaces(trimmed, {
          lat: originalCoords?.[1],
          lng: originalCoords?.[0],
          zoom: originalCoords ? 6 : undefined,
        })
      );
    } catch {
      setResults([]);
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  };

  const applyPlace = (place: Place) => {
    setLat(String(Number(place.lat.toFixed(5))));
    setLon(String(Number(place.lng.toFixed(5))));
    // Only fills an empty box: a number already typed is the assessor's, and
    // the extent of a named feature is a weaker claim than their own reading.
    const radius = radiusFromExtent(place);
    if (uncertainty.trim() === "" && radius != null) setUncertainty(String(radius));
    setShowErrors(false);
    setResults(null);
  };

  /**
   * A click on the map lands here. It overwrites whatever is typed, which is
   * the point — clicking the map IS how you say where it was, and having to
   * clear the boxes first would make the map the slower way to do it.
   */
  useEffect(() => {
    if (!pickedPoint) return;
    setLat(String(pickedPoint.lat));
    setLon(String(pickedPoint.lon));
    setShowErrors(false);
  }, [pickedPoint]);

  // Hand the draft back so the map can draw the point and its radius as they
  // are typed, rather than only once saved.
  useEffect(() => {
    onDraftChange?.({
      lat: lat.trim() === "" ? null : Number(lat),
      lon: lon.trim() === "" ? null : Number(lon),
      uncertainty: uncertainty.trim() === "" ? null : Number(uncertainty),
    });
    // onDraftChange is a fresh closure each render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, uncertainty]);

  /**
   * Escape closes the modal, which is what Escape does to a thing laid over the
   * page. It deliberately does not close the docked panel: there, Escape
   * belongs to whatever is on top of it — dismissing the map's search, ending a
   * measurement — and losing a half-filled georeference to a keystroke aimed at
   * something else is exactly the kind of loss this panel exists to avoid.
   */
  useEffect(() => {
    if (variant !== "modal") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, variant]);

  const parsed = {
    decimalLatitude: lat.trim() === "" ? null : Number(lat),
    decimalLongitude: lon.trim() === "" ? null : Number(lon),
    coordinateUncertaintyInMeters: uncertainty.trim() === "" ? null : Number(uncertainty),
  };
  const validation = useMemo(
    () => validateGeoreference(parsed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lat, lon, uncertainty]
  );

  /**
   * Pasting "1.1958, -76.9256" into the latitude box fills both, because that
   * is what copying a result out of GEOLocate or Google Earth actually gives
   * you, and splitting it by hand every time is the kind of friction that makes
   * a tool annoying to use forty records in.
   */
  const handleLatChange = (value: string) => {
    const pair = parseCoordinatePair(value);
    if (pair) {
      setLat(String(pair.lat));
      setLon(String(pair.lon));
      return;
    }
    setLat(value);
  };

  const handleSave = () => {
    if (!validation.ok) {
      setShowErrors(true);
      return;
    }
    onSave({
      gbifID: p.gbifID,
      occurrenceID: p.occurrenceID,
      scientificName: p.species || scientificName,
      verbatimLocality: p.locality || p.verbatimLocality,
      decimalLatitude: parsed.decimalLatitude as number,
      decimalLongitude: parsed.decimalLongitude as number,
      coordinateUncertaintyInMeters: parsed.coordinateUncertaintyInMeters as number,
      georeferenceRemarks: remarks.trim() || undefined,
      georeferencedBy: georeferencedBy || undefined,
      georeferencedDate: new Date().toISOString(),
    });
  };

  const locality = p.locality || p.verbatimLocality;

  const body = (
      <>
        <div className="flex items-start gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {existing ? "Edit georeference" : "Add georeference"}
            </h2>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Your own coordinates for GBIF record{" "}
              <a
                href={`https://www.gbif.org/occurrence/${p.gbifID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
              >
                {p.gbifID}
              </a>
              . Stored in this browser only.
            </p>
            {variant === "panel" && (
              <p className="text-[11px] text-violet-600 dark:text-violet-400 mt-1">
                Click the map to place the point, or drag it once placed.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="shrink-0 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* What the record says — the evidence being georeferenced from. */}
        <div className="px-4 py-3 space-y-1 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
          <Row label="Locality" value={locality} />
          <Row label="State/Province" value={p.stateProvince} />
          <Row label="Country" value={p.country} />
          <Row label="Elevation" value={p.verbatimElevation ?? (p.elevation != null ? `${p.elevation} m` : null)} />
          <Row label="Date" value={p.eventDate?.slice(0, 10) ?? p.year} />
          <Row label="Recorded by" value={p.recordedBy} />
          <Row
            label="Catalogue"
            value={[p.institutionCode, p.collectionCode, p.catalogNumber].filter(Boolean).join(" · ")}
          />
          {originalCoords && (
            <Row
              label="GBIF says"
              value={`${originalCoords[1].toFixed(4)}, ${originalCoords[0].toFixed(4)}${
                p.gbifIssues?.length ? " — flagged by GBIF" : ""
              }`}
            />
          )}
        </div>

        {/* Find the locality without leaving the record */}
        <div className="px-4 py-3 space-y-2 border-b border-zinc-200 dark:border-zinc-700">
          <label className="block text-xs">
            <span className="block mb-1 text-zinc-500 dark:text-zinc-400">
              Look up the locality
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runSearch();
                  }
                }}
                placeholder="Place name, with its region"
                className="flex-1 min-w-0 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={runSearch}
                disabled={searching || query.trim().length < 2}
                className="shrink-0 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
          </label>
          {results != null && (
            searchFailed ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Couldn&apos;t reach the search service.
              </p>
            ) : results.length === 0 ? (
              <p className="text-[11px] text-zinc-400">
                Nothing found. Try a shorter name, or drop the region.
              </p>
            ) : (
              <div className="rounded border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700 max-h-44 overflow-y-auto">
                {results.map((place) => {
                  const radius = radiusFromExtent(place);
                  return (
                    <button
                      key={place.id}
                      onClick={() => applyPlace(place)}
                      className="block w-full text-left px-2 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <span className="text-zinc-800 dark:text-zinc-100">{place.name}</span>
                      {place.kind && (
                        <span className="ml-1 text-[10px] text-zinc-400">{formatKind(place.kind)}</span>
                      )}
                      <span className="block text-[10px] text-zinc-400 truncate">
                        {place.context}
                        <span className="tabular-nums">
                          {place.context ? " · " : ""}
                          {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                        </span>
                        {radius != null && ` · ±${radius.toLocaleString()} m`}
                      </span>
                    </button>
                  );
                })}
                <p className="px-2 py-1 text-[9px] text-zinc-400">{GEOCODER_ATTRIBUTION}</p>
              </div>
            )
          )}
        </div>

        {/* The georeference itself */}
        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs">
              <span className="block mb-1 text-zinc-500 dark:text-zinc-400">Latitude</span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                autoFocus
                onChange={(e) => handleLatChange(e.target.value)}
                placeholder="1.1958"
                className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 tabular-nums"
              />
            </label>
            <label className="text-xs">
              <span className="block mb-1 text-zinc-500 dark:text-zinc-400">Longitude</span>
              <input
                type="text"
                inputMode="decimal"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                placeholder="-76.9256"
                className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 tabular-nums"
              />
            </label>
            <label className="text-xs">
              <span className="block mb-1 text-zinc-500 dark:text-zinc-400">
                Uncertainty (m) <span className="text-amber-600 dark:text-amber-400">required</span>
              </span>
              <input
                type="number"
                min={1}
                value={uncertainty}
                onChange={(e) => setUncertainty(e.target.value)}
                placeholder="1500"
                className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 tabular-nums"
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="block mb-1 text-zinc-500 dark:text-zinc-400">Notes</span>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="How you resolved it, and anything a reviewer would need to check it"
              className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100"
            />
          </label>

          {showErrors && !validation.ok && (
            <ul className="text-[11px] text-red-600 dark:text-red-400 list-disc pl-4 space-y-0.5">
              {validation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
          {existing && (
            <button
              onClick={onDelete}
              className="px-2 py-1 rounded border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={showErrors && !validation.ok}
            className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-xs text-white font-medium transition-colors disabled:opacity-50"
          >
            {existing ? "Save changes" : "Save georeference"}
          </button>
        </div>
      </>
  );

  // Docked: part of the page, so the map beside it stays live — pannable,
  // searchable, and clickable to place the point.
  if (variant === "panel") {
    return (
      <div className="flex flex-col w-[22rem] shrink-0 min-h-0 overflow-y-auto border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        {body}
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>,
    document.body
  );
}
