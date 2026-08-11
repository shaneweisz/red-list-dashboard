"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { QUALITY_FLAG_LABELS, type QualityFlag } from "@/lib/coordinate-cleaning";

interface MapOccurrenceTooltipProps {
  lat: number;
  lng: number;
  species: string;
  basisOfRecord?: string;
  datasetName?: string;
  eventDate?: string;
  coordinateUncertaintyInMeters?: number | null;
  imageUrl?: string | null;
  observer?: string | null;
  qualityFlags?: string[];
  outsideNativeRange?: boolean;
  country?: string;
}

// Format basisOfRecord to human-readable string
function formatBasis(basis?: string): string {
  if (!basis) return "";
  const labels: Record<string, string> = {
    HUMAN_OBSERVATION: "Human observation",
    PRESERVED_SPECIMEN: "Preserved specimen",
    MACHINE_OBSERVATION: "Machine observation",
    FOSSIL_SPECIMEN: "Fossil specimen",
    LIVING_SPECIMEN: "Living specimen",
    MATERIAL_SAMPLE: "Material sample",
    OCCURRENCE: "Occurrence",
    MATERIAL_CITATION: "Material citation",
  };
  return labels[basis] || basis.replace(/_/g, " ").toLowerCase();
}

export default function MapOccurrenceTooltip(props: MapOccurrenceTooltipProps) {
  const { current: map } = useMap();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const point = map.project([props.lng, props.lat]);
      setPos({ x: point.x, y: point.y });
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
    };
  }, [map, props.lat, props.lng]);

  if (!pos || !map) return null;

  const container = map.getContainer();
  const containerRect = container.getBoundingClientRect();
  const uncertainty = props.coordinateUncertaintyInMeters;

  // Convert container-relative position to viewport-fixed position
  const fixedX = containerRect.left + pos.x;
  const fixedY = containerRect.top + pos.y;

  const tooltipWidth = 220;
  // Beside the point rather than above it: the map is far wider than it is
  // tall, so horizontal room is what there is plenty of — and a tooltip above
  // the point covers the very area you're comparing it against. Flips to the
  // left when there isn't room on the right.
  const showLeft = fixedX + tooltipWidth + 24 > containerRect.right;
  // Keep it inside the map vertically; the estimate is deliberately generous
  // since the height depends on which fields the record has.
  const estimatedHeight = props.imageUrl ? 260 : 150;
  const halfHeight = estimatedHeight / 2;
  const clampedY = Math.max(
    containerRect.top + halfHeight + 4,
    Math.min(fixedY, containerRect.bottom - halfHeight - 4)
  );

  // A rotated square rather than a CSS-border triangle, so it can carry the
  // panel's own background and border in both themes (the old triangle was
  // hardcoded white and vanished into dark mode).
  const arrow = (
    <div
      className="absolute w-2.5 h-2.5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
      style={{
        top: "50%",
        [showLeft ? "right" : "left"]: -5,
        transform: "translateY(-50%) rotate(45deg)",
        borderRightWidth: showLeft ? 1 : 0,
        borderTopWidth: showLeft ? 1 : 0,
        borderLeftWidth: showLeft ? 0 : 1,
        borderBottomWidth: showLeft ? 0 : 1,
      }}
    />
  );

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: showLeft ? fixedX - 12 : fixedX + 12,
        top: clampedY,
        transform: showLeft ? "translate(-100%, -50%)" : "translate(0, -50%)",
        zIndex: 10000,
        pointerEvents: "none",
      }}
    >
      <div className="relative bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700" style={{ maxWidth: 220 }}>
        {arrow}
        <div className="rounded-lg overflow-hidden">
        {props.imageUrl && (
          <img
            src={props.imageUrl}
            alt=""
            className="w-full h-24 object-cover"
          />
        )}
        <div className="p-2 text-xs space-y-0.5">
          <div className="font-medium italic text-zinc-900 dark:text-zinc-100">
            {props.species}
          </div>
          {props.basisOfRecord && (
            <div className="text-zinc-500 dark:text-zinc-400">
              {formatBasis(props.basisOfRecord)}
            </div>
          )}
          {props.datasetName && (
            <div className="text-zinc-500 dark:text-zinc-400 truncate" title={props.datasetName}>
              {props.datasetName}
            </div>
          )}
          {props.eventDate && (
            <div className="text-zinc-600 dark:text-zinc-300">{props.eventDate}</div>
          )}
          {uncertainty != null && (
            <div className="text-zinc-400">
              GPS Uncertainty: {uncertainty >= 1000
                ? `${(uncertainty / 1000).toFixed(1)}km`
                : `${uncertainty}m`}
            </div>
          )}
          {props.observer && (
            <div className="text-zinc-500 dark:text-zinc-400">by {props.observer}</div>
          )}
          <div className="text-zinc-400 tabular-nums">
            {props.lat.toFixed(4)}, {props.lng.toFixed(4)}
          </div>
          {props.qualityFlags && props.qualityFlags.length > 0 && (
            <div className="text-amber-600 dark:text-amber-400 font-medium pt-0.5">
              ⚠ Flagged: {props.qualityFlags.map((f) => QUALITY_FLAG_LABELS[f as QualityFlag] || f).join(", ")}
            </div>
          )}
          {props.outsideNativeRange && (
            <div className="text-amber-600 dark:text-amber-400 font-medium pt-0.5">
              🌍 Outside native range{props.country ? ` (${props.country})` : ""}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
