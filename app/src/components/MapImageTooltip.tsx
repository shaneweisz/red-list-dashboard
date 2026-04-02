"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";

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
  const { current: map } = useMap();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const point = map.project([lng, lat]);
      setPos({ x: point.x, y: point.y });
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
    };
  }, [map, lat, lng]);

  if (!pos || !map) return null;

  const container = map.getContainer();
  const containerRect = container.getBoundingClientRect();

  // Convert to viewport-fixed coordinates to avoid overflow clipping
  const fixedX = containerRect.left + pos.x;
  const fixedY = containerRect.top + pos.y;

  const clampedX = Math.max(containerRect.left + 4, Math.min(fixedX - 42, containerRect.right - 84));
  const showBelow = fixedY < 80;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: clampedX,
        top: showBelow ? fixedY + 12 : fixedY - 72,
        zIndex: 10000,
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
    document.body
  );
}
