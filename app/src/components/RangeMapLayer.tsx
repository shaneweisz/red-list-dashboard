"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { GeoJsonObject } from "geojson";

const GeoJSON = dynamic(
  () => import("react-leaflet").then((mod) => mod.GeoJSON),
  { ssr: false }
);

interface RangeMapLayerProps {
  assessmentId: number;
  visible: boolean;
}

// Style each feature by presence/origin category
function featureStyle(feature: GeoJSON.Feature | undefined) {
  const presence = feature?.properties?.presence;
  const origin = feature?.properties?.origin;

  // Base style: extant native
  const base = {
    weight: 2,
    fillOpacity: 0.15,
    opacity: 0.8,
  };

  // Possibly Extinct or Extinct
  if (presence === 4 || presence === 5) {
    return { ...base, color: "#9ca3af", fillColor: "#9ca3af", dashArray: "6 4", fillOpacity: 0.1 };
  }

  // Possibly Extant or Presence Uncertain
  if (presence === 3 || presence === 6) {
    return { ...base, color: "#f59e0b", fillColor: "#f59e0b", dashArray: "4 4", fillOpacity: 0.1 };
  }

  // Reintroduced or Assisted Colonisation
  if (origin === 2 || origin === 6) {
    return { ...base, color: "#3b82f6", fillColor: "#3b82f6" };
  }

  // Introduced
  if (origin === 3) {
    return { ...base, color: "#8b5cf6", fillColor: "#8b5cf6", dashArray: "4 2" };
  }

  // Vagrant
  if (origin === 4) {
    return { ...base, color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.08 };
  }

  // Default: Extant Native (presence=1,2 + origin=1)
  return { ...base, color: "#e11d48", fillColor: "#e11d48" };
}

export default function RangeMapLayer({ assessmentId, visible }: RangeMapLayerProps) {
  const [geojson, setGeojson] = useState<GeoJsonObject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible || !assessmentId || fetchedRef.current === assessmentId) return;

    setLoading(true);
    setError(false);

    fetch(`/api/species/${assessmentId}/range-map`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        setGeojson(data);
        fetchedRef.current = assessmentId;
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [visible, assessmentId]);

  if (!visible || error || !geojson) return null;

  if (loading) {
    // The parent component shows the loading state via the toggle button
    return null;
  }

  return (
    <GeoJSON
      key={`range-${assessmentId}`}
      data={geojson}
      style={featureStyle}
    />
  );
}
