"use client";

import { useEffect, useRef, useState } from "react";
import { overlayUrl } from "@/lib/mapping/map-overlays";
import {
  decodeEffort,
  gbifCountUrl,
  effortAsset,
  effortColour,
  rampTop,
  type EffortGroup,
} from "@/lib/mapping/sampling-effort";

export interface SamplingEffortLayer {
  /**
   * The coloured surface as an object URL, for the map's image source.
   *
   * A blob rather than the canvas itself: MapLibre has a canvas source but
   * react-map-gl doesn't type one, and a blob URL is cheaper than the data URL
   * the alternative would need — toDataURL on 4096 square is seconds of
   * base64 for a string the map only turns back into pixels.
   */
  url: string;
  /** Records per cell, row-major, for reading a value under a click. */
  counts: Uint32Array;
  size: number;
  /** The count the ramp tops out at — the 99th percentile of occupied cells. */
  top: number;
  group: EffortGroup;
}

/**
 * Loads a sampling-effort surface and colours it in the browser.
 *
 * The published PNG carries counts rather than colour, so this is where the
 * ramp and its normalisation are applied — which is the point of shipping
 * numbers: changing either is a style change here, not a rebuild and re-upload
 * of a 3 MB asset, and the same numbers answer "how many records in this cell".
 *
 * Decoded a band of rows at a time. The image is 4096 square, so holding the
 * source pixels, the counts and the coloured output all at once would be about
 * 200 MB; a band at a time keeps that to the canvas plus the counts.
 */
export function useSamplingEffort(group: EffortGroup | null) {
  const [layer, setLayer] = useState<SamplingEffortLayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Surfaces already built, so switching taxa back and forth is instant. */
  const cache = useRef(new Map<EffortGroup, SamplingEffortLayer>());

  useEffect(() => {
    if (!group) {
      setLayer(null);
      return;
    }
    const cached = cache.current.get(group);
    if (cached) {
      setLayer(cached);
      return;
    }

    let abandoned = false;
    setLoading(true);
    setFailed(false);

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (abandoned) return;
      try {
        const size = image.width;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("no 2d context");
        context.drawImage(image, 0, 0);

        const counts = new Uint32Array(size * size);
        const BAND = 256;

        // Pass one: read the counts out of the pixels.
        for (let y = 0; y < size; y += BAND) {
          const rows = Math.min(BAND, size - y);
          const band = context.getImageData(0, y, size, rows);
          for (let i = 0, p = y * size; i < band.data.length; i += 4, p++) {
            const value = decodeEffort(band.data[i], band.data[i + 1], band.data[i + 2], band.data[i + 3]);
            counts[p] = value ?? 0;
          }
        }

        // The ramp is scaled to this taxon's own distribution, so a group with
        // a hundredth of the records still uses the whole ramp instead of
        // sitting dark against all-groups totals.
        const top = rampTop(counts);
        const logTop = Math.log1p(top);

        // Pass two: colour in place, band by band.
        for (let y = 0; y < size; y += BAND) {
          const rows = Math.min(BAND, size - y);
          const band = context.getImageData(0, y, size, rows);
          for (let i = 0, p = y * size; i < band.data.length; i += 4, p++) {
            const value = counts[p];
            if (value <= 0) {
              band.data[i + 3] = 0;
              continue;
            }
            const t = Math.min(1, Math.log1p(value) / logTop);
            const [r, g, b] = effortColour(t);
            band.data[i] = r;
            band.data[i + 1] = g;
            band.data[i + 2] = b;
            // Barely-surveyed cells stay a whisper rather than a stain.
            band.data[i + 3] = Math.round(30 + 205 * t);
          }
          context.putImageData(band, 0, y);
        }

        canvas.toBlob((blob) => {
          if (abandoned || !blob) {
            if (!blob) setFailed(true);
            return;
          }
          const built: SamplingEffortLayer = {
            url: URL.createObjectURL(blob),
            counts,
            size,
            top,
            group,
          };
          cache.current.set(group, built);
          setLayer(built);
        }, "image/png");
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };
    image.onerror = () => {
      if (abandoned) return;
      setFailed(true);
      setLoading(false);
    };
    image.src = overlayUrl(effortAsset(group));

    return () => {
      abandoned = true;
    };
  }, [group]);

  // The blobs are held for the session so switching taxa back is instant; they
  // only need releasing when the map itself goes away.
  useEffect(() => {
    const built = cache.current;
    return () => {
      for (const entry of built.values()) URL.revokeObjectURL(entry.url);
      built.clear();
    };
  }, []);

  return { layer, loading, failed };
}

/**
 * Records in the cell under a coordinate.
 *
 * The surface is Web Mercator across the whole world, so the lookup is the
 * projection in reverse. Null where the layer has nothing there — which is
 * unsurveyed, not zero-with-confidence.
 */
/**
 * The ground bounds of the cell under a coordinate, and how wide it is.
 *
 * Needed to open the cell on GBIF, and to say how big it actually is: a
 * Mercator pixel is a fixed span in projected space, so its width on the
 * ground falls away with latitude.
 */
export function effortCell(
  layer: SamplingEffortLayer,
  lng: number,
  lat: number
): { bounds: [number, number, number, number]; widthKm: number } | null {
  const { size } = layer;
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (clamped * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * size);
  const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI;
  const y = Math.floor(((1 - merc) / 2) * size);
  if (x < 0 || x >= size || y < 0 || y >= size) return null;

  const lngAt = (px: number) => (px / size) * 360 - 180;
  const latAt = (py: number) => {
    const m = 1 - (2 * py) / size;
    return (Math.atan(Math.sinh(Math.PI * m)) * 180) / Math.PI;
  };
  const west = lngAt(x);
  const east = lngAt(x + 1);
  // y counts down from the north, so the row's lower edge is the larger y.
  const north = latAt(y);
  const south = latAt(y + 1);
  const midLat = ((north + south) / 2) * (Math.PI / 180);
  return {
    bounds: [west, south, east, north],
    widthKm: ((east - west) / 360) * 40075 * Math.cos(midLat),
  };
}

export function effortAt(
  layer: SamplingEffortLayer,
  lng: number,
  lat: number
): number | null {
  const { size, counts } = layer;
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (clamped * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * size);
  const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI;
  const y = Math.floor(((1 - merc) / 2) * size);
  if (x < 0 || x >= size || y < 0 || y >= size) return null;
  const value = counts[y * size + x];
  return value > 0 ? value : null;
}

/**
 * How many records GBIF holds in a cell right now, for the taxon shown.
 *
 * Asked on demand rather than with the layer: it is one request per cell the
 * assessor actually asks about, against seventeen million cells nobody will.
 *
 * It exists because the layer's own figure is a snapshot published with the
 * paper and GBIF has moved since — on a cell east of Bogotá the layer says 2
 * and GBIF holds 1,442. Both are true about different moments, and showing them
 * side by side is the only way that reads as information rather than as a bug.
 */
export function useGbifCellCount(
  bounds: [number, number, number, number] | null,
  group: EffortGroup | null
) {
  const [count, setCount] = useState<number | null>(null);
  const [byBasis, setByBasis] = useState<{ basis: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  const key = bounds ? `${bounds.join(",")}|${group}` : null;
  useEffect(() => {
    if (!bounds || !group) {
      setCount(null);
      setByBasis([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setCount(null);
    setByBasis([]);
    fetch(gbifCountUrl(bounds, group), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { count?: number; facets?: { field: string; counts?: { name: string; count: number }[] }[] }) => {
        setCount(d.count ?? null);
        const facet = (d.facets ?? []).find((f) => f.field === "BASIS_OF_RECORD");
        setByBasis(
          (facet?.counts ?? [])
            .map((c) => ({ basis: c.name, count: c.count }))
            .sort((a, b) => b.count - a.count)
        );
      })
      .catch(() => {
        // A failed count leaves the snapshot figure and the link, which are the
        // parts that don't depend on the network being there.
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // Keyed on the cell and taxon rather than the array identity, which is
    // rebuilt on every render and would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { count, byBasis, loading };
}
