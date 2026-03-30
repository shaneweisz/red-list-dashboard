"use client";

import { useState, useEffect, useRef } from "react";

interface AohMetadata {
  id_no: string;
  scientific_name: string;
  aoh_total: number;
  range_total: number;
  prevalence: number;
  category: string;
  bounds: [number, number, number, number] | null; // [south, west, north, east]
}

interface AohMapLayerProps {
  sisTaxonId: number;
  taxonGroup: string;
  visible: boolean;
}

// This component must be rendered inside a MapContainer.
// It uses the Leaflet map instance directly via useMap() to add an ImageOverlay.
function AohMapLayerInner({ sisTaxonId, taxonGroup, visible }: AohMapLayerProps) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require("react-leaflet");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require("leaflet");

  const map = useMap();
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const [metadata, setMetadata] = useState<AohMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<number | null>(null);

  // Fetch metadata + add image overlay
  useEffect(() => {
    if (!visible || !sisTaxonId || fetchedRef.current === sisTaxonId) return;

    setLoading(true);

    fetch(`/api/species/${sisTaxonId}/aoh/metadata?taxonGroup=${encodeURIComponent(taxonGroup)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: AohMetadata) => {
        setMetadata(data);
        fetchedRef.current = sisTaxonId;

        if (data.bounds) {
          const [south, west, north, east] = data.bounds;
          const bounds = L.latLngBounds(
            L.latLng(south, west),
            L.latLng(north, east)
          );
          const pngUrl = `/api/species/${sisTaxonId}/aoh?taxonGroup=${encodeURIComponent(taxonGroup)}`;
          const overlay = L.imageOverlay(pngUrl, bounds, {
            opacity: 0.7,
            interactive: false,
          });
          overlayRef.current = overlay;
          overlay.addTo(map);
        }
      })
      .catch(() => {
        // Silent fail
      })
      .finally(() => setLoading(false));

    return () => {
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [visible, sisTaxonId, taxonGroup, map, L]);

  // Toggle visibility
  useEffect(() => {
    if (!overlayRef.current) return;
    if (visible) {
      if (!map.hasLayer(overlayRef.current)) {
        overlayRef.current.addTo(map);
      }
    } else {
      map.removeLayer(overlayRef.current);
    }
  }, [visible, map]);

  if (!visible || loading) return null;

  // Stats panel rendered as a map overlay
  if (metadata && metadata.bounds) {
    return (
      <div className="absolute top-2 right-2 z-[1000] bg-white dark:bg-zinc-800 px-2.5 py-2 rounded shadow text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
        <div className="font-medium text-zinc-800 dark:text-zinc-100">Area of Habitat</div>
        <div>AOH: {metadata.aoh_total.toLocaleString(undefined, { maximumFractionDigits: 0 })} km&sup2;</div>
        <div>Range: {metadata.range_total.toLocaleString(undefined, { maximumFractionDigits: 0 })} km&sup2;</div>
        <div>Prevalence: {(metadata.prevalence * 100).toFixed(1)}%</div>
      </div>
    );
  }

  return null;
}

// Dynamic wrapper to avoid SSR issues with Leaflet
import dynamic from "next/dynamic";

const AohMapLayer = dynamic(
  () => Promise.resolve(AohMapLayerInner),
  { ssr: false }
);

export default AohMapLayer;
export type { AohMetadata };
