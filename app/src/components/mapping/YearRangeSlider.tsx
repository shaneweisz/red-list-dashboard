"use client";

import { useState } from "react";

interface YearRangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (range: [number, number]) => void;
  /** The layer's own colour, so the selected span reads as that layer. */
  color: string;
  /** Named for screen readers, since two handles need telling apart. */
  label: string;
}

/**
 * A year range, dragged rather than picked.
 *
 * This was two dropdowns, which worked and read badly: choosing a range is a
 * spatial judgement — how much of the series, from about where — and a pair of
 * select boxes turns it into two separate lookups down a list of 25 years.
 * The platform this layer comes from puts a timeline under the map for the
 * same reason, and dragging an end inwards to watch the map thin out is the
 * whole point of having the control at all.
 *
 * Built the way the date-range slider above it is: two range inputs stacked on
 * one track, each owning a handle. It looks like a custom control and behaves
 * like a native one — arrow keys, Home/End, and a focus ring on the handle
 * being moved — which no amount of divs and pointer maths gives you for free.
 */
export default function YearRangeSlider({
  min,
  max,
  value,
  onChange,
  color,
  label,
}: YearRangeSliderProps) {
  // Which handle to put on top. Without this the two inputs overlap and,
  // once both ends meet, whichever is painted last swallows the drag — so an
  // end that has been pulled all the way in can't be pulled back out.
  const [active, setActive] = useState<"from" | "to">("from");

  const [from, to] = value;
  const span = Math.max(1, max - min);
  const pct = (year: number) => ((year - min) / span) * 100;
  const whole = from === min && to === max;

  return (
    <div className="px-2 pb-1">
      <div className="relative h-5 flex items-center" style={{ ["--range-thumb" as string]: color }}>
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        <div
          className="absolute h-1.5 rounded-full"
          style={{ left: `${pct(from)}%`, right: `${100 - pct(to)}%`, background: color }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={from}
          onChange={(e) => onChange([Math.min(Number(e.target.value), to), to])}
          onPointerDown={() => setActive("from")}
          style={{ zIndex: active === "from" ? 5 : 3 }}
          className="dual-range-thumb"
          aria-label={`${label}: first year`}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={to}
          onChange={(e) => onChange([from, Math.max(Number(e.target.value), from)])}
          onPointerDown={() => setActive("to")}
          style={{ zIndex: active === "to" ? 5 : 4 }}
          className="dual-range-thumb"
          aria-label={`${label}: last year`}
        />
      </div>
      <div className="flex items-center justify-between text-[9px] tabular-nums text-zinc-400 dark:text-zinc-500">
        <span>{min}</span>
        {/* The selection itself, in the middle, because it is the number being
            changed — the ends are only there to say what the track spans. */}
        <span className="flex items-center gap-1">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">
            {from === to ? from : `${from}–${to}`}
          </span>
          {!whole && (
            <button
              onClick={() => onChange([min, max])}
              title="Back to the whole series"
              className="hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              ↺
            </button>
          )}
        </span>
        <span>{max}</span>
      </div>
    </div>
  );
}
