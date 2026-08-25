"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { QUALITY_FLAG_LABELS, type QualityFlag } from "@/lib/mapping/coordinate-cleaning";

interface MapOccurrenceTooltipProps {
  lat: number;
  lng: number;
  species: string;
  basisOfRecord?: string;
  datasetName?: string;
  eventDate?: string;
  coordinateUncertaintyInMeters?: number | null;
  /** Kept for the caller's sake; the tooltip no longer draws it. A photograph
   *  is the slowest thing in the panel and it resized under the pointer as you
   *  paged between records — the fields are what's being read. */
  imageUrl?: string | null;
  observer?: string | null;
  qualityFlags?: string[];
  outsideNativeRange?: boolean;
  country?: string;
  /** The record's locality text — the only thing an ungeoreferenced record has. */
  locality?: string;
  /** Present when these coordinates are the assessor's own, not GBIF's. */
  yourGeoreference?: { protocol?: string; remarks?: string };
  /**
   * Photographs the publisher attached to the record, from GBIF's media.
   *
   * Drawn in a fixed-height strip. The earlier attempt let the picture size
   * itself, so the panel grew and shrank under the pointer as you paged
   * between records stacked on one spot; reserving the height means the
   * fields below it never move.
   */
  images?: { url: string; title?: string; creator?: string; license?: string; rightsHolder?: string }[];
  /** Position within the records sharing this point, when more than one does. */
  page?: { index: number; total: number; onPrev: () => void; onNext: () => void };
  /** Dismisses a pinned tooltip. */
  onClose?: () => void;
  /**
   * What you can do with this record, drawn as a block at the foot of the
   * panel once it's been clicked.
   *
   * They belong here rather than in a menu of their own: the panel already
   * names the record and is already pointing at it, and a second popup for the
   * same point meant two boxes explaining one dot.
   */
  actions?: React.ReactNode;
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
  /**
   * Photograph URLs the browser couldn't load, so they can be left out of the
   * render.
   *
   * A dead publisher image link used to be dealt with by removing its node
   * from the document in the error handler. That takes a node React owns out
   * from under it, and the next time React unmounts that subtree — moving the
   * pointer off the record, or paging to the next one at the same point — it
   * tries to remove a child that is no longer there and throws
   * NotFoundError, which takes the whole page down.
   */
  const [brokenImages, setBrokenImages] = useState<string[]>([]);
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

  const shownImages = (props.images ?? []).filter((i) => !brokenImages.includes(i.url));

  const tooltipWidth = 220;
  // Beside the point rather than above it: the map is far wider than it is
  // tall, so horizontal room is what there is plenty of — and a tooltip above
  // the point covers the very area you're comparing it against. Flips to the
  // left when there isn't room on the right.
  const showLeft = fixedX + tooltipWidth + 24 > containerRect.right;
  /**
   * Kept inside the map horizontally, the way it already was vertically.
   *
   * Choosing a side isn't enough on its own: zoomed in, a record near a corner
   * put the panel past the map's edge and the close button went with it, since
   * the button sits in the panel's own top row rather than floating. The edge
   * is computed here and clamped, so there is no arrangement that hides it.
   */
  const panelLeft = Math.max(
    containerRect.left + 4,
    Math.min(
      showLeft ? fixedX - 12 - tooltipWidth : fixedX + 12,
      containerRect.right - tooltipWidth - 4
    )
  );
  // Keep it inside the map vertically. The estimate only covers the first
  // frame, before the panel has been measured.
  const height = panelHeight || 160;
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
        left: panelLeft,
        top: clampedY,
        // Only the vertical half-shift: the horizontal edge is already the
        // clamped value, so translating it again would undo the clamp.
        transform: "translateY(-50%)",
        width: tooltipWidth,
        zIndex: 10000,
        // Interactive when it has controls: you have to be able to reach the
        // pager — or the edit link — without the tooltip vanishing on the way.
        pointerEvents: props.page || props.actions ? "auto" : "none",
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
        <div className="p-2 text-xs space-y-0.5">
          {/* The controls row. Laid out as a label that gives way and a
              button group that never does: the label used to be free to push
              the buttons along, so at "10 of 120 records here" the row grew
              past the panel and the close button was clipped off its edge by
              the panel's own overflow-hidden. */}
          {((props.page && props.page.total > 1) || props.onClose) && (
            <div className="flex items-center gap-1 pb-1 mb-1 border-b border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-500 dark:text-zinc-400">
              {props.page && props.page.total > 1 && (
                <span
                  className="tabular-nums truncate min-w-0"
                  title={`Record ${props.page.index + 1} of ${props.page.total} at this point`}
                >
                  {props.page.index + 1} of {props.page.total} here
                </span>
              )}
              {props.pinned && (
                <span className="text-[9px] text-zinc-400 shrink-0" title="Click anywhere outside to close">
                  pinned
                </span>
              )}
              <div className="ml-auto flex items-center shrink-0">
                {props.page && props.page.total > 1 && (
                  <>
                    <button
                      onClick={props.page.onPrev}
                      title="Previous record at this point"
                      className="p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
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
                  </>
                )}
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
              </div>
              {props.yourGeoreference.remarks && (
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {props.yourGeoreference.remarks}
                </div>
              )}
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
          {/* A specimen photograph settles identifications a locality string
              can't. Last in the panel and at a fixed height, so the text above
              it never moves while it loads. */}
          {shownImages.length > 0 && (
            <div className="pt-1">
              <div className="flex gap-1 h-14 overflow-x-auto">
                {shownImages.map((image) => (
                  <a
                    key={image.url}
                    href={image.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    // Credit belongs with the picture: GBIF media carries the
                    // publisher's own rights statement and it travels with it.
                    title={[image.title, image.creator, image.rightsHolder, image.license]
                      .filter(Boolean)
                      .join(" · ")}
                    className="block h-14 shrink-0 rounded overflow-hidden bg-zinc-100 dark:bg-zinc-800"
                  >
                    <img
                      src={image.url}
                      alt={image.title ?? "Specimen photograph"}
                      loading="lazy"
                      className="h-14 w-auto object-cover"
                      onError={() => {
                        // A publisher's dead image link shouldn't leave a
                        // broken-image glyph sitting in the panel — but it has
                        // to go by not being rendered, not by being pulled out
                        // of the DOM behind React's back.
                        setBrokenImages((prev) =>
                          prev.includes(image.url) ? prev : [...prev, image.url]
                        );
                      }}
                    />
                  </a>
                ))}
              </div>
              {shownImages[0].creator && (
                <div className="text-[10px] text-zinc-400 truncate">
                  © {shownImages[0].creator}
                  {shownImages[0].license ? ` · ${shownImages[0].license.replace(/^https?:\/\//, "")}` : ""}
                </div>
              )}
            </div>
          )}
        </div>
        {props.actions && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 p-1 space-y-0.5 text-[11px] text-zinc-700 dark:text-zinc-200">
            {props.actions}
          </div>
        )}
        </div>
      </div>
    </div>,
    document.body
  );
}
