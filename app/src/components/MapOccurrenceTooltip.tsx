"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";

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
  const map = useMap();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const point = map.latLngToContainerPoint([props.lat, props.lng]);
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
  }, [map, props.lat, props.lng]);

  if (!pos) return null;

  const container = map.getContainer();
  const uncertainty = props.coordinateUncertaintyInMeters;

  return createPortal(
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y - 12,
        transform: "translate(-50%, -100%)",
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden" style={{ maxWidth: 220 }}>
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
        </div>
      </div>
      {/* Arrow pointing down */}
      <div
        className="mx-auto"
        style={{
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "6px solid white",
        }}
      />
    </div>,
    container
  );
}
