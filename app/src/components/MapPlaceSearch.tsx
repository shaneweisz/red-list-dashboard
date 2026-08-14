"use client";

import { useEffect, useRef, useState } from "react";
import {
  GEOCODER_ATTRIBUTION,
  formatKind,
  searchPlaces,
  type Place,
} from "@/lib/geocode";
import { parseCoordinatePair } from "@/lib/georeferences";

interface MapPlaceSearchProps {
  /** Where the map is looking, so results near it rank first. Read at search
   *  time rather than passed as state: the map moves constantly, and none of
   *  those moves should re-render this. */
  getCentre?: () => { lat: number; lng: number; zoom: number } | undefined;
  onSelect: (place: Place) => void;
  /** Pointing at a candidate marks it on the map, without moving the camera. */
  onPreview: (place: Place | null) => void;
  /** Removes the marker left by the last result. */
  onClear: () => void;
  /** True while a searched place is still marked on the map. */
  hasResult: boolean;
}

/**
 * Finds the locality written on a specimen label.
 *
 * Collapsed to a magnifier until you need it: on a map this small, a permanent
 * search field costs more than it earns, and the icon is understood everywhere.
 *
 * Typing a coordinate pair works too — "1.1958, -76.9256" offers to fly
 * straight there. Coordinates arrive by copy-paste far more often than by
 * being typed, and having to find a different box for them is the kind of
 * friction that stops people checking.
 */
export default function MapPlaceSearch({ getCentre, onSelect, onPreview, onClear, hasResult }: MapPlaceSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const coordinates = parseCoordinatePair(query);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced, and never per-keystroke: Photon is a free service and a search
  // on every letter is both rude and slower than the typing.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || coordinates) {
      setResults([]);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      const centre = getCentre?.();
      searchPlaces(trimmed, {
        lat: centre?.lat,
        lng: centre?.lng,
        zoom: centre?.zoom,
        signal: controller.signal,
      })
        .then((places) => {
          setResults(places);
          setLoading(false);
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          setResults([]);
          setFailed(true);
          setLoading(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The map moves constantly; re-searching because it did would be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Click away to close, like the other map controls.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const choose = (place: Place) => {
    onPreview(null);
    onSelect(place);
    setOpen(false);
    setResults([]);
  };

  if (!open) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => setOpen(true)}
          title="Search for a place — a locality from a specimen label, or a coordinate pair"
          className="p-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
        </button>
        {hasResult && (
          <button
            onClick={onClear}
            title="Remove the searched place from the map"
            className="px-1.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-md text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"
          >
            Clear pin
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="w-72 max-w-[80vw]">
      <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-md">
        <svg className="w-3.5 h-3.5 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "Enter") {
              if (coordinates) {
                choose({
                  id: "coords",
                  name: `${coordinates.lat}, ${coordinates.lon}`,
                  context: "",
                  lat: coordinates.lat,
                  lng: coordinates.lon,
                });
              } else if (results[0]) {
                choose(results[0]);
              }
            }
          }}
          placeholder="Place, or lat, lon"
          className="flex-1 min-w-0 bg-transparent text-xs text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
        />
        {query !== "" && (
          <button
            onClick={() => setQuery("")}
            title="Clear"
            className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {(coordinates || results.length > 0 || loading || failed || query.trim().length >= 2) && (
        <div className="mt-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg overflow-hidden text-xs">
          {coordinates ? (
            <button
              onClick={() =>
                choose({
                  id: "coords",
                  name: `${coordinates.lat}, ${coordinates.lon}`,
                  context: "",
                  lat: coordinates.lat,
                  lng: coordinates.lon,
                })
              }
              className="block w-full text-left px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              <span className="text-zinc-800 dark:text-zinc-100 tabular-nums">
                {coordinates.lat}, {coordinates.lon}
              </span>
              <span className="block text-[10px] text-zinc-400">Go to these coordinates</span>
            </button>
          ) : loading ? (
            <div className="px-2 py-1.5 text-zinc-400">Searching…</div>
          ) : failed ? (
            <div className="px-2 py-1.5 text-amber-600 dark:text-amber-400">Couldn&apos;t reach the search service.</div>
          ) : results.length === 0 ? (
            <div className="px-2 py-1.5 text-zinc-400">No places found.</div>
          ) : (
            <div onMouseLeave={() => onPreview(null)}>
              {results.map((place) => (
                <button
                  key={place.id}
                  onClick={() => choose(place)}
                  onMouseEnter={() => onPreview(place)}
                  onMouseLeave={() => onPreview(null)}
                  onFocus={() => onPreview(place)}
                  onBlur={() => onPreview(null)}
                  className="block w-full text-left px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-700 border-b border-zinc-100 dark:border-zinc-700 last:border-b-0"
                >
                  <span className="text-zinc-800 dark:text-zinc-100">{place.name}</span>
                  {place.kind && (
                    <span className="ml-1 text-[10px] text-zinc-400">{formatKind(place.kind)}</span>
                  )}
                  {place.context && (
                    <span className="block text-[10px] text-zinc-400 truncate">{place.context}</span>
                  )}
                </button>
              ))}
              <div className="px-2 py-1 text-[9px] text-zinc-400 bg-zinc-50 dark:bg-zinc-900/40">
                {GEOCODER_ATTRIBUTION}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
