"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** The record's locality text — the only thing an ungeoreferenced record has. */
  locality?: string;
  /** Present when these coordinates are the assessor's own, not GBIF's. */
  yourGeoreference?: { protocol?: string; remarks?: string };
  /** Opens the georeference editor for the record shown. The map point itself
   *  now opens GBIF on click, so this is where correcting it lives. */
  onEditGeoreference?: () => void;
  /** Images attached to the record — a herbarium sheet's own photograph, most
   *  usefully, which is what you want in front of you when reading its label. */
  images?: { url: string; title?: string; creator?: string; license?: string; rightsHolder?: string }[];
  /** Position within the records sharing this point, when more than one does. */
  page?: { index: number; total: number; onPrev: () => void; onNext: () => void };
  /** Dismisses a pinned tooltip. */
  onClose?: () => void;
  /** True once the reader has paged through: the tooltip is now click-dismissed. */
  pinned?: boolean;
  /** Keeps the tooltip up while the pointer is on it, so its controls are usable. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
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
  // Measured rather than guessed: the panel's height depends on which fields
  // the record has and whether it carries an image, and both the clamping and
  // the arrow's position need the real number. Observed rather than read once,
  // since paging between records at a point changes it under us.
  const [panelHeight, setPanelHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const panelRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) return;
    const observer = new ResizeObserver(() => setPanelHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    observerRef.current = observer;
  }, []);

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
  // Keep it inside the map vertically. The estimate only covers the first
  // frame, before the panel has been measured.
  const height = panelHeight || (props.imageUrl || props.images?.length ? 300 : 160);
  const halfHeight = height / 2;
  const clampedY = Math.max(
    containerRect.top + halfHeight + 4,
    Math.min(fixedY, containerRect.bottom - halfHeight - 4)
  );
  // Once clamped, the panel's middle is no longer level with the point, so the
  // arrow has to move to keep pointing at it — otherwise a tooltip nudged away
  // from the edge appears to be labelling a different record entirely.
  const arrowOffset = Math.max(10, Math.min(height - 10, fixedY - (clampedY - halfHeight)));

  // A rotated square rather than a CSS-border triangle, so it can carry the
  // panel's own background and border in both themes (the old triangle was
  // hardcoded white and vanished into dark mode).
  const arrow = (
    <div
      className="absolute w-2.5 h-2.5 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
      style={{
        top: arrowOffset,
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
      data-occurrence-tooltip=""
      style={{
        position: "fixed",
        left: showLeft ? fixedX - 12 : fixedX + 12,
        top: clampedY,
        transform: showLeft ? "translate(-100%, -50%)" : "translate(0, -50%)",
        zIndex: 10000,
        // Interactive when it has controls: you have to be able to reach the
        // pager — or the edit link — without the tooltip vanishing on the way.
        pointerEvents: props.page || props.onEditGeoreference ? "auto" : "none",
      }}
      onMouseEnter={props.onPointerEnter}
      onMouseLeave={props.onPointerLeave}
    >
      <div
        ref={panelRef}
        className="relative bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700"
        style={{ maxWidth: 220 }}
      >
        {arrow}
        <div className="rounded-lg overflow-hidden">
        {(props.imageUrl || props.images?.[0]) && (
          <img
            src={props.imageUrl || props.images![0].url}
            alt={props.images?.[0]?.title ?? ""}
            className="w-full h-32 object-cover bg-zinc-100 dark:bg-zinc-800"
          />
        )}
        <div className="p-2 text-xs space-y-0.5">
          {props.page && props.page.total > 1 && (
            <div className="flex items-center gap-1 pb-1 mb-1 border-b border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span className="tabular-nums">
                {props.page.index + 1} of {props.page.total} records here
              </span>
              {props.pinned && (
                <span className="text-[9px] text-zinc-400" title="Click anywhere outside to close">
                  pinned
                </span>
              )}
              <button
                onClick={props.page.onPrev}
                title="Previous record at this point"
                className="ml-auto p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={props.page.onNext}
                title="Next record at this point"
                className="p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {props.onClose && (
                <button
                  onClick={props.onClose}
                  title="Close (or click anywhere outside)"
                  className="p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
          <div className="font-medium italic text-zinc-900 dark:text-zinc-100">
            {props.species}
          </div>
          {props.locality && (
            <div className="text-zinc-600 dark:text-zinc-300">{props.locality}</div>
          )}
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
              {props.yourGeoreference ? "Radius" : "GPS Uncertainty"}: {uncertainty >= 1000
                ? `${(uncertainty / 1000).toFixed(1)}km`
                : `${uncertainty}m`}
            </div>
          )}
          {props.observer && (
            <div className="text-zinc-500 dark:text-zinc-400">by {props.observer}</div>
          )}
          <div className={`tabular-nums ${props.yourGeoreference ? "text-violet-600 dark:text-violet-400" : "text-zinc-400"}`}>
            {props.lat.toFixed(4)}, {props.lng.toFixed(4)}
          </div>
          {/* Says whose coordinates these are, so an assessor's own reading of
              a locality can never be mistaken for a published position. */}
          {props.yourGeoreference && (
            <div className="pt-0.5">
              <div className="flex items-baseline gap-1 text-violet-600 dark:text-violet-400 font-medium">
                <span>
                  ◆ Your georeference
                  {props.yourGeoreference.protocol ? ` · ${props.yourGeoreference.protocol}` : ""}
                </span>
                {props.onEditGeoreference && (
                  <button
                    onClick={props.onEditGeoreference}
                    title="Edit these coordinates, their uncertainty and your notes. You can also drag the point on the map."
                    className="ml-auto shrink-0 text-[10px] font-normal underline decoration-dotted hover:text-violet-800 dark:hover:text-violet-300"
                  >
                    Edit
                  </button>
                )}
              </div>
              {props.yourGeoreference.remarks && (
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {props.yourGeoreference.remarks}
                </div>
              )}
            </div>
          )}
          {props.images && props.images.length > 0 && (
            <div className="text-[10px] text-zinc-400 truncate" title={props.images[0].rightsHolder ?? props.images[0].creator ?? ""}>
              Image: {props.images[0].rightsHolder ?? props.images[0].creator ?? "see GBIF"}
              {props.images.length > 1 ? ` (+${props.images.length - 1} more)` : ""}
            </div>
          )}
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
