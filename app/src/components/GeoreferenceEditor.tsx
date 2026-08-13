"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  parseCoordinatePair,
  validateGeoreference,
  type Georeference,
} from "@/lib/georeferences";
import type { OccurrenceFeature } from "./OccurrenceListTable";

interface GeoreferenceEditorProps {
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

/** GEOLocate's web form, prefilled — the tool most assessors georeference in. */
function geoLocateUrl(p: OccurrenceFeature["properties"]): string {
  const params = new URLSearchParams();
  if (p.country) params.set("country", p.country);
  if (p.stateProvince) params.set("state", p.stateProvince);
  const locality = p.locality || p.verbatimLocality;
  if (locality) params.set("locality", locality);
  return `https://www.geo-locate.org/web/WebGeoreflight.aspx?${params}`;
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

  // Escape closes, like every other dismissible layer in the app.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
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
          {locality && (
            <a
              href={geoLocateUrl(p)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 pt-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              Open this locality in GEOLocate
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
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
      </div>
    </div>,
    document.body
  );
}
