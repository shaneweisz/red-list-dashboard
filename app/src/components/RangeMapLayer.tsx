"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection, Feature } from "geojson";

const Source = dynamic(
  () => import("react-map-gl/maplibre").then((mod) => mod.Source),
  { ssr: false }
);
const Layer = dynamic(
  () => import("react-map-gl/maplibre").then((mod) => mod.Layer),
  { ssr: false }
);

export interface RangeCategory {
  key: string;
  label: string;
  color: string;
  dashArray?: string;
  count: number;
}

export interface SimplificationInfo {
  tolerance: number;
  unit: string;
}

interface RangeMapLayerProps {
  assessmentId: number;
  visible: boolean;
  panelId?: string;
  onLoadingChange?: (loading: boolean) => void;
  onCategoriesChange?: (categories: RangeCategory[]) => void;
  onNotFound?: (notFound: boolean) => void;
  onSimplificationChange?: (info: SimplificationInfo | null) => void;
  visibleCategories?: Set<string>;
  // Reports the currently-visible range polygons (post category-filtering) up to
  // the parent, which pairs them with the filtered GBIF points to compute an
  // in-range/out-of-range breakdown. Point localities are excluded — they're not
  // areas to test containment against.
  onPolygonsChange?: (polygons: Feature[] | null) => void;
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
  if (presence === 4 || presence === 5) return { color: "#9ca3af", dashArray: "6 4" };
  if (presence === 3 || presence === 6) return { color: "#f59e0b", dashArray: "4 4" };
  if (origin === 2 || origin === 6) return { color: "#3b82f6" };
  if (origin === 3) return { color: "#8b5cf6", dashArray: "4 2" };
  if (origin === 4) return { color: "#f59e0b" };
  return { color: "#e11d48" };
}

function getCategoryLabel(presence: number, origin: number): string {
  const presenceLabel = PRESENCE_LABELS[presence] ?? `Presence ${presence}`;
  const originLabel = ORIGIN_LABELS[origin] ?? `Origin ${origin}`;
  if (presence === 1 && origin === 1) return "Extant (Native)";
  if (presence === 2 && origin === 1) return "Probably Extant (Native)";
  return `${presenceLabel} (${originLabel})`;
}

// Build a MapLibre data-driven color expression from features
function buildColorExpression(features: Feature[]): unknown[] {
  const seen = new Map<string, string>();
  for (const f of features) {
    const p = f.properties?.presence ?? 1;
    const o = f.properties?.origin ?? 1;
    const key = getCategoryKey(p, o);
    if (!seen.has(key)) {
      seen.set(key, getCategoryStyle(p, o).color);
    }
  }

  const expr: unknown[] = ["match", ["get", "_catKey"]];
  for (const [key, color] of seen) {
    expr.push(key, color);
  }
  expr.push("#e11d48"); // fallback
  return expr;
}

interface RangeGeoJSONResponse extends FeatureCollection {
  simplification?: SimplificationInfo;
}


export default function RangeMapLayer({
  assessmentId,
  visible,
  panelId = "main",
  onLoadingChange,
  onCategoriesChange,
  onNotFound,
  onSimplificationChange,
  visibleCategories,
  onPolygonsChange,
}: RangeMapLayerProps) {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible || !assessmentId || fetchedRef.current === assessmentId) return;

    // Use a microtask to avoid synchronous setState in effect body
    const controller = new AbortController();
    Promise.resolve().then(() => {
      setLoading(true);
      setError(false);
      onLoadingChange?.(true);
      onNotFound?.(false);
    });

    fetch(`/api/species/${assessmentId}/range-map`, { signal: controller.signal })
      .then((res) => {
        if (res.status === 404) {
          onNotFound?.(true);
          throw new Error("404");
        }
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: RangeGeoJSONResponse) => {
        // Add _catKey property to each feature for data-driven styling
        for (const feature of data.features) {
          const presence = feature.properties?.presence ?? 1;
          const origin = feature.properties?.origin ?? 1;
          feature.properties = {
            ...feature.properties,
            _catKey: getCategoryKey(presence, origin),
          };
        }
        setGeojson(data);
        fetchedRef.current = assessmentId;

        // Report simplification info to parent
        onSimplificationChange?.(data.simplification ?? null);

        // Extract categories
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
  }, [visible, assessmentId, onLoadingChange, onCategoriesChange, onNotFound, onSimplificationChange]);

  // Split into polygon and point features, filtered by visible categories
  const { polygonData, pointData, colorExpr } = useMemo(() => {
    if (!geojson) return { polygonData: null, pointData: null, colorExpr: null };

    const polygonFeatures: Feature[] = [];
    const pointFeatures: Feature[] = [];

    for (const f of geojson.features) {
      const key = f.properties?._catKey;
      if (visibleCategories && !visibleCategories.has(key)) continue;

      const geomType = f.geometry?.type;
      if (geomType === "Point" || geomType === "MultiPoint") {
        pointFeatures.push(f);
      } else {
        polygonFeatures.push(f);
      }
    }

    const allVisible = [...polygonFeatures, ...pointFeatures];
    const expr = allVisible.length > 0 ? buildColorExpression(allVisible) : null;

    return {
      polygonData: {
        type: "FeatureCollection" as const,
        features: polygonFeatures,
      },
      pointData: {
        type: "FeatureCollection" as const,
        features: pointFeatures,
      },
      colorExpr: expr,
    };
  }, [geojson, visibleCategories]);

  useEffect(() => {
    onPolygonsChange?.(polygonData?.features ?? null);
    return () => onPolygonsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygonData]);

  if (!visible || error || !polygonData || !colorExpr) return null;
  if (loading) return null;

  const sourceIdPolygons = `range-polygons-${panelId}`;
  const sourceIdPoints = `range-points-${panelId}`;

  return (
    <>
      {/* Polygon/MultiPolygon features — fill + outline */}
      {polygonData.features.length > 0 && (
        <Source id={sourceIdPolygons} type="geojson" data={polygonData}>
          <Layer
            id={`range-fill-${panelId}`}
            type="fill"
            paint={{
              "fill-color": colorExpr as unknown as string,
              "fill-opacity": 0.15,
            }}
          />
          <Layer
            id={`range-line-${panelId}`}
            type="line"
            paint={{
              "line-color": colorExpr as unknown as string,
              "line-width": 2,
              "line-opacity": 0.8,
            }}
          />
        </Source>
      )}
      {/* Point features — circle markers */}
      {pointData!.features.length > 0 && (
        <Source id={sourceIdPoints} type="geojson" data={pointData!}>
          <Layer
            id={`range-circles-${panelId}`}
            type="circle"
            paint={{
              "circle-radius": 4,
              "circle-color": colorExpr as unknown as string,
              "circle-opacity": 0.5,
              "circle-stroke-color": colorExpr as unknown as string,
              "circle-stroke-width": 1.5,
              "circle-stroke-opacity": 0.8,
            }}
          />
        </Source>
      )}
    </>
  );
}
