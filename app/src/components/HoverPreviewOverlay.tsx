"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";

function getThumbUrl(url: string): string {
  return url.replace(/\/original\./, "/small.");
}

interface HoveredObs {
  imageUrl: string | null;
  audioUrl?: string | null;
  date: string | null;
  observer: string | null;
  location: string | null;
  decimalLatitude?: number | null;
  decimalLongitude?: number | null;
}

export default function HoverPreviewOverlay({
  hoveredObs,
}: {
  hoveredObs: HoveredObs | null;
}) {
  const map = useMap();
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(
    null
  );

  useEffect(() => {
    if (
      !hoveredObs ||
      hoveredObs.decimalLatitude == null ||
      hoveredObs.decimalLongitude == null
    ) {
      setScreenPos(null);
      return;
    }
    const point = map.latLngToContainerPoint([
      hoveredObs.decimalLatitude,
      hoveredObs.decimalLongitude,
    ]);
    const rect = map.getContainer().getBoundingClientRect();
    setScreenPos({ x: rect.left + point.x, y: rect.top + point.y });
  }, [hoveredObs, map]);

  if (!screenPos || !hoveredObs) return null;

  // Hide if the point is outside the visible map area
  const rect = map.getContainer().getBoundingClientRect();
  if (
    screenPos.x < rect.left ||
    screenPos.x > rect.right ||
    screenPos.y < rect.top ||
    screenPos.y > rect.bottom
  ) {
    return null;
  }

  const W = 172;
  let left = screenPos.x - W / 2;
  if (left < 4) left = 4;
  if (left + W > window.innerWidth - 4) left = window.innerWidth - 4 - W;

  // Show above the point by default; flip below if too close to the top of the map
  const showBelow = screenPos.y - rect.top < 180;
  const top = showBelow ? screenPos.y + 20 : screenPos.y - 20;

  return createPortal(
    <div
      className="fixed z-[99999] pointer-events-none"
      style={{
        left,
        top,
        transform: showBelow ? "none" : "translateY(-100%)",
      }}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        style={{ width: W }}
      >
        {hoveredObs.imageUrl ? (
          <img
            src={getThumbUrl(hoveredObs.imageUrl)}
            alt="Observation"
            className="w-full object-cover"
            style={{ height: 108 }}
          />
        ) : hoveredObs.audioUrl ? (
          <div
            className="flex items-center justify-center bg-emerald-50 dark:bg-emerald-950"
            style={{ height: 60 }}
          >
            <svg
              className="w-6 h-6 text-emerald-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
              />
            </svg>
          </div>
        ) : null}
        <div className="p-1.5 text-xs space-y-0.5">
          {hoveredObs.date && (
            <div className="text-zinc-500 dark:text-zinc-400">
              {hoveredObs.date}
            </div>
          )}
          {hoveredObs.observer && (
            <div className="text-zinc-600 dark:text-zinc-300 truncate">
              <span className="text-zinc-400">by</span> {hoveredObs.observer}
            </div>
          )}
          {hoveredObs.location && (
            <div
              className="text-zinc-500 dark:text-zinc-400 truncate"
              title={hoveredObs.location}
            >
              {hoveredObs.location}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
