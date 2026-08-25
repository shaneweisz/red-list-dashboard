"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";

interface MapOccurrenceTooltipProps {
  lat: number;
  lng: number;
  /**
   * Every field this record has, as label/value pairs, in the order they
   * should be read.
   *
   * A table rather than a styled summary. The panel used to pick a dozen
   * fields and give each its own colour and weight — italic species, amber
   * flags, violet georeference — which made a record look like a verdict. Two
   * plain columns say the same things and let you compare one record with the
   * next without decoding the formatting first.
   */
  fields: { label: string; value: string }[];
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
  /** True once the reader has paged through: the tooltip is now click-dismissed. */
  pinned?: boolean;
  /** Keeps the tooltip up while the pointer is on it, so its controls are usable. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  /**
   * What you can do with this record, drawn as a block at the foot of the
   * panel.
   */
  actions?: React.ReactNode;
}

/** Fields shown at once before the table pages. */
const FIELDS_PER_PAGE = 7;

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
  /** Which page of the record's fields is showing. */
  const [fieldPage, setFieldPage] = useState(0);
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

  // Convert container-relative position to viewport-fixed position
  const fixedX = containerRect.left + pos.x;
  const fixedY = containerRect.top + pos.y;

  const shownImages = (props.images ?? []).filter((i) => !brokenImages.includes(i.url));
  const totalPages = Math.max(1, Math.ceil(props.fields.length / FIELDS_PER_PAGE));
  const first = Math.min(fieldPage, totalPages - 1) * FIELDS_PER_PAGE;
  const pageFields = props.fields.slice(first, first + FIELDS_PER_PAGE);

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
          {/* The record as a table. One type, one colour, two columns: the
              label you are looking up and the value it has. */}
          <table className="w-full border-collapse">
            <tbody>
              {pageFields.map((field) => (
                <tr key={field.label} className="align-top">
                  <td className="py-[1px] pr-1.5 text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                    {field.label}
                  </td>
                  <td className="py-[1px] text-zinc-700 dark:text-zinc-200 break-words">
                    {field.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 pt-1 mt-1 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-400">
              <span className="tabular-nums">
                {first + 1}–{Math.min(first + FIELDS_PER_PAGE, props.fields.length)} of {props.fields.length}
              </span>
              <button
                onClick={() => setFieldPage((n) => (n - 1 + totalPages) % totalPages)}
                title="Previous fields"
                className="ml-auto p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => setFieldPage((n) => (n + 1) % totalPages)}
                title="More fields"
                className="p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
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
