"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";

/**
 * Renders a small photo tooltip above a lat/lng point on the map.
 * Uses useMap() to convert coordinates to pixel position, then
 * portals a plain HTML img into the map container.
 */
export default function MapImageTooltip({
  lat,
  lng,
  imageUrl,
}: {
  lat: number;
  lng: number;
  imageUrl: string;
}) {
  const map = useMap();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const point = map.latLngToContainerPoint([lat, lng]);
      setPos({ x: point.x, y: point.y });
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    map.on("moveend", update);
    map.on("zoomend", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
      map.off("moveend", update);
      map.off("zoomend", update);
    };
  }, [map, lat, lng]);

  if (!pos) return null;

  const container = map.getContainer();

  return createPortal(
    <div
      style={{
        position: "absolute",
        left: pos.x - 42,
        top: pos.y - 72,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      <img
        src={imageUrl}
        alt=""
        style={{
          width: 80,
          height: 60,
          objectFit: "cover",
          borderRadius: 6,
          border: "2px solid #3b82f6",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          display: "block",
          background: "white",
        }}
      />
    </div>,
    container
  );
}
