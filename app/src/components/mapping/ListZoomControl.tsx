"use client";

import { useState } from "react";

/**
 * How small and how large the table can be drawn.
 *
 * Wide, because the reason to reach for this is usually an unusual screen —
 * a projector at the back of a room, a laptop beside a 4K monitor — and a
 * range that stops at a comfortable-looking 150% is no use to either. Bounded
 * at all only so a mistyped number can't shrink the table past the point where
 * the control to fix it is legible.
 */
export const LIST_ZOOM_MIN = 0.1;
export const LIST_ZOOM_MAX = 4;
export const LIST_ZOOM_DEFAULT = 1;

/** Rounded to whole percents, which is the unit the box is typed in. */
export function clampZoom(percent: number): number {
  const z = Math.round(percent) / 100;
  return Math.min(LIST_ZOOM_MAX, Math.max(LIST_ZOOM_MIN, z));
}

interface ListZoomControlProps {
  zoom: number;
  onChange: (zoom: number) => void;
}

/**
 * The table's size, steppable and typeable.
 *
 * It was two buttons and a label that reset when clicked. Stepping in tenths
 * is fine for a nudge and tedious for anything else, and the one number the
 * control actually shows was the one thing you couldn't set — so this makes
 * the percentage itself the input.
 *
 * Typed text is held locally until it's committed, so typing "1" on the way to
 * "125" doesn't shrink the table to a hundredth of its size and take the box
 * with it.
 */
export default function ListZoomControl({ zoom, onChange }: ListZoomControlProps) {
  const [typed, setTyped] = useState<string | null>(null);

  const step = (delta: number) =>
    onChange(clampZoom(Math.round((zoom + delta) * 100)));

  const commit = () => {
    if (typed == null) return;
    const parsed = Number(typed.replace(/[^0-9.]/g, ""));
    // An empty or unreadable box goes back to what it was rather than to some
    // default: the number was already there, and losing it to a stray keypress
    // is worse than ignoring the edit.
    if (Number.isFinite(parsed) && parsed > 0) onChange(clampZoom(parsed));
    setTyped(null);
  };

  return (
    <div className="ml-auto flex items-center gap-0.5 pr-1">
      <button
        onClick={() => step(-0.1)}
        disabled={zoom <= LIST_ZOOM_MIN}
        title="Smaller — fit more of the table on the screen"
        className="px-1 py-0.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
      >
        −
      </button>
      <div className="flex items-center text-[10px] text-zinc-400">
        <input
          value={typed ?? String(Math.round(zoom * 100))}
          onChange={(e) => setTyped(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setTyped(null);
              e.currentTarget.blur();
            }
          }}
          title={`How large the table is drawn, as a percentage. Type any value between ${Math.round(LIST_ZOOM_MIN * 100)} and ${LIST_ZOOM_MAX * 100}.`}
          aria-label="Table size, as a percentage"
          inputMode="numeric"
          className="w-6 bg-transparent text-right tabular-nums outline-none hover:text-zinc-600 dark:hover:text-zinc-300 focus:text-zinc-700 dark:focus:text-zinc-200"
        />
        <span className="pr-0.5">%</span>
      </div>
      <button
        onClick={() => step(0.1)}
        disabled={zoom >= LIST_ZOOM_MAX}
        title="Bigger"
        className="px-1 py-0.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
      >
        +
      </button>
      {zoom !== LIST_ZOOM_DEFAULT && (
        <button
          onClick={() => onChange(LIST_ZOOM_DEFAULT)}
          title="Back to 100%"
          className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          ↺
        </button>
      )}
    </div>
  );
}
