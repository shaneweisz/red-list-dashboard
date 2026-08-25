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
   * What this dashboard says about the record, as opposed to what GBIF
   * publishes about it: the coordinate-cleaning flags, whether it falls
   * outside the native range, why it's hidden, how an imported CSV row
   * disagrees with it.
   *
   * Kept out of the table and below it. Mixed in, an inference of ours read
   * as another field off the record, and the table stopped being a copy of
   * what the publisher sent. `flag` marks the ones worth picking out.
   */
  notes?: { label: string; value: string; flag?: boolean }[];
  /**
   * Photographs the publisher attached to the record, from GBIF's media.
   *
   * Drawn beside the panel at a size worth looking at — a herbarium sheet is
   * the record, and a 64px thumbnail of one says only that a photograph
   * exists. Clicking opens the full image.
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

  /**
   * The photographs, in a column of their own beside the panel.
   *
   * Wide enough to read a herbarium label off from the start. They used to be
   * 64px thumbnails that opened on hover, which meant the one thing on the
   * record you can actually look at was the one thing you had to go and find.
   *
   * The column takes the far side of the panel where there's room for it, and
   * the near side where there isn't, so it never lands off the map.
   */
  const IMAGE_WIDTH = 260;
  const outerLeft = showLeft ? panelLeft - IMAGE_WIDTH - 6 : panelLeft + tooltipWidth + 6;
  const innerLeft = showLeft ? panelLeft + tooltipWidth + 6 : panelLeft - IMAGE_WIDTH - 6;
  const fits = (x: number) => x >= containerRect.left + 4 && x + IMAGE_WIDTH <= containerRect.right - 4;
  const imagesLeft = Math.max(
    containerRect.left + 4,
    Math.min(fits(outerLeft) || !fits(innerLeft) ? outerLeft : innerLeft, containerRect.right - IMAGE_WIDTH - 4)
  );

  return createPortal(
    <>
    {shownImages.length > 0 && (
      <div
        style={{
          position: "fixed",
          left: imagesLeft,
          top: clampedY,
          transform: "translateY(-50%)",
          width: IMAGE_WIDTH,
          maxHeight: "min(70vh, 420px)",
          zIndex: 10000,
          pointerEvents: "auto",
        }}
        onMouseEnter={props.onPointerEnter}
        onMouseLeave={props.onPointerLeave}
        data-occurrence-images
        className="flex flex-col gap-1 overflow-y-auto"
      >
        {shownImages.map((image) => (
          <a
            key={image.url}
            href={image.url}
            target="_blank"
            rel="noopener noreferrer"
            // Credit belongs with the picture: GBIF media carries the
            // publisher's own rights statement and it travels with it.
            title={[image.title, image.creator, image.rightsHolder, image.license]
              .filter(Boolean)
              .join(" · ")}
            className="block rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-700"
          >
            <img
              src={image.url}
              alt={image.title ?? "Specimen photograph"}
              loading="lazy"
              className="w-full max-h-[19rem] object-contain"
              onError={() => {
                // A publisher's dead image link shouldn't leave a
                // broken-image glyph sitting beside the panel — but it has to
                // go by not being rendered, not by being pulled out of the DOM
                // behind React's back.
                setBrokenImages((prev) => (prev.includes(image.url) ? prev : [...prev, image.url]));
              }}
            />
            {image.creator && (
              <span className="block px-1.5 py-1 text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                © {image.creator}
                {image.license ? ` · ${image.license.replace(/^https?:\/\//, "")}` : ""}
              </span>
            )}
          </a>
        ))}
      </div>
    )}
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
        // Interactive when there is something to reach: the record pager, an
        // action, or a field list long enough to scroll. Inert otherwise, so a
        // panel with four lines in it can't get between the pointer and the
        // map.
        pointerEvents: props.page || props.actions || props.fields.length > 8 ? "auto" : "none",
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
              label you are looking up and the value it has.

              Scrolled rather than paged. Paging meant a record's fields were
              split across three screens with no way to see two of them at
              once, and the field you wanted was never on the page you were
              looking at. */}
          <div className="max-h-[220px] overflow-y-auto overscroll-contain">
          <table className="w-full border-collapse">
            <tbody>
              {props.fields.map((field) => (
                <tr key={field.label} className="align-top">
                  <td className="py-[1px] pr-1.5 whitespace-nowrap text-zinc-400 dark:text-zinc-500">
                    {field.label}
                  </td>
                  <td className="py-[1px] break-words text-zinc-700 dark:text-zinc-200">{field.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {props.notes && props.notes.length > 0 && (
            <div className="pt-1 mt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-0.5">
              {props.notes.map((note) => (
                <div
                  key={note.label}
                  className={`flex gap-1.5 ${
                    note.flag ? "text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  <span
                    className={`shrink-0 ${note.flag ? "text-amber-600 dark:text-amber-500" : "text-zinc-400 dark:text-zinc-500"}`}
                  >
                    {note.label}
                  </span>
                  <span className="break-words">{note.value}</span>
                </div>
              ))}
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
    </div>
    </>,
    document.body
  );
}
