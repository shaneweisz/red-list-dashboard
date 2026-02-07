"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

interface FitBoundsProps {
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

export default function FitBounds({ bbox }: FitBoundsProps) {
  const map = useMap();
  const fittedRef = useRef<string | null>(null);

  useEffect(() => {
    const key = bbox.join(",");
    if (fittedRef.current === key) return;
    fittedRef.current = key;

    const [minLon, minLat, maxLon, maxLat] = bbox;

    // If all points are at the same location, just center there
    if (minLon === maxLon && minLat === maxLat) {
      map.setView([minLat, minLon], 10);
      return;
    }

    const bounds: LatLngBoundsExpression = [
      [minLat, minLon],
      [maxLat, maxLon],
    ];

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [bbox, map]);

  return null;
}
