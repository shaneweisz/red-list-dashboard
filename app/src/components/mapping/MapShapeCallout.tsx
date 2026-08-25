"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";

/**
 * A panel placed beside the shape it describes, rather than on top of it.
 *
 * Clicking a protected area or an ecoregion draws its boundary and then has to
 * say which one it is. A popup anchored at the click sits over that boundary —
 * worst exactly where you clicked near an edge, which is when the edge is the
 * question. Docking the answer in a corner of the map fixed that by throwing
 * away the association: you were told the name somewhere else entirely.
 *
 * So this projects the shape's own bounds to the screen and puts the panel just
 * outside them, preferring the side with room: right, then left, then below,
 * then above. Where nothing fits — a shape larger than the viewport, which is
 * common once you're zoomed into a national park — it falls back to the corner
 * of the shape's on-screen area that leaves the most boundary visible.
 */
export default function MapShapeCallout({
  bounds,
  lng,
  lat,
  width = 224,
  children,
}: {
  /** The shape's extent, west/south/east/north. Null for a point-only answer. */
  bounds: [number, number, number, number] | null;
  /** Where the click landed, used when there's no shape to sit beside. */
  lng: number;
  lat: number;
  width?: number;
  children: React.ReactNode;
}) {
  const { current: map } = useMap();
  const [tick, setTick] = useState(0);
  const [height, setHeight] = useState(140);

  useEffect(() => {
    if (!map) return;
    const update = () => setTick((t) => t + 1);
    map.on("move", update);
    map.on("zoom", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
    };
  }, [map]);

  if (!map) return null;
  void tick; // re-projected on every map move

  const container = map.getContainer().getBoundingClientRect();
  const GAP = 12;
  const EDGE = 6;

  // The shape's screen rectangle, clipped to the map — a park can run well off
  // the viewport, and placing against its true corner would put the panel
  // somewhere nobody can see.
  let rect: { left: number; top: number; right: number; bottom: number };
  if (bounds) {
    const a = map.project([bounds[0], bounds[3]]);
    const b = map.project([bounds[2], bounds[1]]);
    rect = {
      left: Math.max(0, Math.min(a.x, b.x)),
      right: Math.min(container.width, Math.max(a.x, b.x)),
      top: Math.max(0, Math.min(a.y, b.y)),
      bottom: Math.min(container.height, Math.max(a.y, b.y)),
    };
  } else {
    const p = map.project([lng, lat]);
    rect = { left: p.x, right: p.x, top: p.y, bottom: p.y };
  }

  const midY = (rect.top + rect.bottom) / 2;
  const midX = (rect.left + rect.right) / 2;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, container.width - width - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, container.height - height - EDGE));

  let x: number;
  let y: number;
  if (rect.right + GAP + width + EDGE <= container.width) {
    x = rect.right + GAP;
    y = clampY(midY - height / 2);
  } else if (rect.left - GAP - width - EDGE >= 0) {
    x = rect.left - GAP - width;
    y = clampY(midY - height / 2);
  } else if (rect.bottom + GAP + height + EDGE <= container.height) {
    x = clampX(midX - width / 2);
    y = rect.bottom + GAP;
  } else if (rect.top - GAP - height - EDGE >= 0) {
    x = clampX(midX - width / 2);
    y = rect.top - GAP - height;
  } else {
    // The shape fills the screen: sit in whichever corner its centre isn't in,
    // so the panel covers the least of the boundary that's actually visible.
    x = midX > container.width / 2 ? EDGE : container.width - width - EDGE;
    y = midY > container.height / 2 ? EDGE : container.height - height - EDGE;
  }

  return createPortal(
    <div
      data-shape-callout=""
      ref={(el) => {
        if (el && Math.abs(el.offsetHeight - height) > 1) setHeight(el.offsetHeight);
      }}
      style={{
        position: "fixed",
        left: container.left + x,
        top: container.top + y,
        width,
        zIndex: 1000,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
