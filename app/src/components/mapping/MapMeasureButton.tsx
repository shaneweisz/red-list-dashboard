"use client";

import { useEffect, useState } from "react";
import { useMap } from "react-map-gl/maplibre";

/**
 * The measure toggle, sitting on top of the map's bottom-right control column.
 *
 * Its offset is measured rather than fixed. The column holds the scale bar and
 * the attribution, and the attribution's height depends on how many layers are
 * switched on — one line for a bare basemap, three once protected areas,
 * habitat types, ecoregions and tree cover loss are all crediting themselves.
 * A hardcoded offset was right for whichever case it was written against and
 * overlapped the scale bar in the others.
 */
export default function MapMeasureButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const { current: map } = useMap();
  const [offset, setOffset] = useState(72);

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
    <div className="absolute right-2 z-[1000]" style={{ bottom: offset }}>
      <button
        onClick={onToggle}
        title={active ? "Stop measuring (or press Escape)" : "Measure the distance between two points on the map"}
        className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] transition-colors ${
          active
            ? "bg-blue-600 text-white"
            : "bg-white/80 dark:bg-zinc-800/80 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
        }`}
      >
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 20L20 4M4 20v-5m0 5h5M20 4v5m0-5h-5" />
        </svg>
        Measure
      </button>
    </div>
  );
}
