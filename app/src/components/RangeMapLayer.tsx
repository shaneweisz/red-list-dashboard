"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import type { GeoJsonObject, FeatureCollection, Feature } from "geojson";

const GeoJSON = dynamic(
  () => import("react-leaflet").then((mod) => mod.GeoJSON),
  { ssr: false }
);

export interface RangeCategory {
  key: string;
  label: string;
  color: string;
  dashArray?: string;
  count: number;
}

interface RangeMapLayerProps {
  assessmentId: number;
  visible: boolean;
  onLoadingChange?: (loading: boolean) => void;
  onCategoriesChange?: (categories: RangeCategory[]) => void;
  onNotFound?: (notFound: boolean) => void;
  visibleCategories?: Set<string>;
}

const PRESENCE_LABELS: Record<number, string> = {
  1: "Extant",
  2: "Probably Extant",
  3: "Possibly Extant",
  4: "Possibly Extinct",
  5: "Extinct",
  6: "Presence Uncertain",
};

const ORIGIN_LABELS: Record<number, string> = {
  1: "Native",
  2: "Reintroduced",
  3: "Introduced",
  4: "Vagrant",
  5: "Origin Uncertain",
  6: "Assisted Colonisation",
};

function getCategoryKey(presence: number, origin: number): string {
  return `${presence}-${origin}`;
}

function getCategoryStyle(presence: number, origin: number): { color: string; dashArray?: string } {
  // Possibly Extinct or Extinct
  if (presence === 4 || presence === 5) {
    return { color: "#9ca3af", dashArray: "6 4" };
  }
  // Possibly Extant or Presence Uncertain
  if (presence === 3 || presence === 6) {
    return { color: "#f59e0b", dashArray: "4 4" };
  }
  // Reintroduced or Assisted Colonisation
  if (origin === 2 || origin === 6) {
    return { color: "#3b82f6" };
  }
  // Introduced
  if (origin === 3) {
    return { color: "#8b5cf6", dashArray: "4 2" };
  }
  // Vagrant
  if (origin === 4) {
    return { color: "#f59e0b" };
  }
  // Default: Extant Native
  return { color: "#e11d48" };
}

function getCategoryLabel(presence: number, origin: number): string {
  const presenceLabel = PRESENCE_LABELS[presence] ?? `Presence ${presence}`;
  const originLabel = ORIGIN_LABELS[origin] ?? `Origin ${origin}`;
  // For the most common case, simplify
  if (presence === 1 && origin === 1) return "Extant (Native)";
  if (presence === 2 && origin === 1) return "Probably Extant (Native)";
  return `${presenceLabel} (${originLabel})`;
}

export default function RangeMapLayer({
  assessmentId,
  visible,
  onLoadingChange,
  onCategoriesChange,
  onNotFound,
  visibleCategories,
}: RangeMapLayerProps) {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible || !assessmentId || fetchedRef.current === assessmentId) return;

    setLoading(true);
    setError(false);
    onLoadingChange?.(true);

    onNotFound?.(false);

    fetch(`/api/species/${assessmentId}/range-map`)
      .then((res) => {
        if (res.status === 404) {
          onNotFound?.(true);
          throw new Error("404");
        }
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: FeatureCollection) => {
        setGeojson(data);
        fetchedRef.current = assessmentId;

        // Extract available categories
        const catMap = new Map<string, { presence: number; origin: number; count: number }>();
        for (const feature of data.features) {
          const presence = feature.properties?.presence ?? 1;
          const origin = feature.properties?.origin ?? 1;
          const key = getCategoryKey(presence, origin);
          const existing = catMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            catMap.set(key, { presence, origin, count: 1 });
          }
        }
        const categories: RangeCategory[] = Array.from(catMap.entries()).map(([key, val]) => {
          const style = getCategoryStyle(val.presence, val.origin);
          return {
            key,
            label: getCategoryLabel(val.presence, val.origin),
            color: style.color,
            dashArray: style.dashArray,
            count: val.count,
          };
        });
        // Sort: extant native first, then by label
        categories.sort((a, b) => {
          if (a.key === "1-1") return -1;
          if (b.key === "1-1") return 1;
          return a.label.localeCompare(b.label);
        });
        onCategoriesChange?.(categories);
      })
      .catch(() => setError(true))
      .finally(() => {
        setLoading(false);
        onLoadingChange?.(false);
      });
  }, [visible, assessmentId, onLoadingChange, onCategoriesChange]);

  // Filter features by visible categories
  const filteredGeojson = useMemo<GeoJsonObject | null>(() => {
    if (!geojson) return null;
    if (!visibleCategories) return geojson;
    const filtered: FeatureCollection = {
      type: "FeatureCollection",
      features: geojson.features.filter((f: Feature) => {
        const key = getCategoryKey(f.properties?.presence ?? 1, f.properties?.origin ?? 1);
        return visibleCategories.has(key);
      }),
    };
    return filtered;
  }, [geojson, visibleCategories]);

  if (!visible || error || !filteredGeojson) return null;
  if (loading) return null;

  const styleFeature = (feature: Feature | undefined) => {
    const presence = feature?.properties?.presence ?? 1;
    const origin = feature?.properties?.origin ?? 1;
    const catStyle = getCategoryStyle(presence, origin);
    return {
      weight: 2,
      fillOpacity: 0.15,
      opacity: 0.8,
      color: catStyle.color,
      fillColor: catStyle.color,
      ...(catStyle.dashArray ? { dashArray: catStyle.dashArray } : {}),
    };
  };

  return (
    <GeoJSON
      key={`range-${assessmentId}-${visibleCategories ? Array.from(visibleCategories).join(",") : "all"}`}
      data={filteredGeojson}
      style={styleFeature}
    />
  );
}
