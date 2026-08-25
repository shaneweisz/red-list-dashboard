"use client";

import { useEffect, useState } from "react";
import { useMap } from "react-map-gl/maplibre";

/**
 * The map's tools, behind a cog above its bottom-right controls.
 *
 * EOO/AOO and measuring are both things an assessor reaches for occasionally
 * and neither is worth a permanent panel — between them they had two corners
 * of the map, the metrics standing open whether or not they were switched on.
 *
 * The offset is measured rather than fixed. The control column below holds the
 * scale bar and the attribution, and the attribution's height depends on how
 * many layers are crediting themselves: one line for a bare basemap, more once
 * protected areas, habitat, ecoregions and tree cover loss are all on.
 */
export default function MapToolsMenu({
  open,
  onToggle,
  measuring,
  onMeasureToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  measuring: boolean;
  onMeasureToggle: () => void;
  children?: React.ReactNode;
}) {
  const { current: map } = useMap();
  const [offset, setOffset] = useState(40);

  useEffect(() => {
    if (!map) return;
    const column = map.getContainer().querySelector(".maplibregl-ctrl-bottom-right");
    if (!column) return;
    const measure = () => setOffset(column.getBoundingClientRect().height + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [map]);

  return (
    <div className="absolute right-2 z-[1000] flex flex-col items-end gap-1.5" style={{ bottom: offset }}>
      {open && (
        <div className="w-56 rounded-lg bg-white dark:bg-zinc-800 shadow-md border border-zinc-200 dark:border-zinc-700 p-2 space-y-2">
          {children}
          <button
            onClick={onMeasureToggle}
            className={`flex items-center gap-1.5 w-full px-1.5 py-1 rounded text-[11px] transition-colors ${
              measuring
                ? "bg-blue-600 text-white"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            }`}
          >
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 20L20 4M4 20v-5m0 5h5M20 4v5m0-5h-5" />
            </svg>
            {measuring ? "Measuring — click two points" : "Measure a distance"}
          </button>
        </div>
      )}
      <button
        onClick={onToggle}
        title={open ? "Hide the map tools" : "Map tools: EOO/AOO and measuring"}
        aria-label="Map tools"
        className={`p-1.5 rounded-lg shadow-md border transition-colors ${
          open || measuring
            ? "bg-blue-600 border-blue-700 text-white"
            : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="3" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}
