"use client";

import { useState } from "react";
import { parseCoordinateEntry } from "@/lib/mapping/georeferences";

interface MapGeoreferenceEditorProps {
  /** What the record already has, where the assessor has supplied it. */
  initial: { lat?: number; lon?: number; radius?: number; note?: string };
  /** The radius a position with none of its own stands for. */
  defaultRadius: number;
  /** Whether there is an assessor georeference here to take back. */
  mine: boolean;
  onSave: (edit: { lat: number; lon: number; uncertainty?: number; note?: string }) => void;
  /**
   * Keeps the reasoning on its own, for a locality that has none of the
   * coordinates yet — or that never gets any.
   */
  onSaveNote: (text: string) => void;
  onClear?: () => void;
}

/**
 * Georeferencing from the record's own panel on the map.
 *
 * The table's cell is the quick way — click where the coordinates are shown
 * and type — but it is the wrong place to be when the thing you are reading is
 * the map. Deciding where "En las orillas del Río Hollín" is means looking at
 * the river, the other records, the protected area boundary and the locality
 * text at once, and all of those are on the map with the panel open over them.
 * Sending you back to a row to type the answer loses the view you worked it
 * out from.
 *
 * The same three things the cells hold, in the order you settle them: the
 * position, how far it could be out, and how you read it. Saved together, on
 * one button, through the same undoable path the table writes on — so a
 * position typed here is the same edit as one typed there.
 */
export default function MapGeoreferenceEditor({
  initial,
  defaultRadius,
  mine,
  onSave,
  onSaveNote,
  onClear,
}: MapGeoreferenceEditorProps) {
  const [text, setText] = useState(
    initial.lat != null && initial.lon != null
      ? `${initial.lat.toFixed(4)}, ${initial.lon.toFixed(4)}`
      : ""
  );
  const [radius, setRadius] = useState(initial.radius != null ? String(initial.radius) : "");
  const [note, setNote] = useState(initial.note ?? "");

  const parsed = parseCoordinateEntry(text);
  const typedRadius = radius.trim() === "" ? null : Number(radius);
  const radiusValid = typedRadius == null || (Number.isFinite(typedRadius) && typedRadius > 0);

  const noteChanged = note.trim() !== (initial.note ?? "").trim();
  // A note on its own is worth keeping: the reasoning usually comes before the
  // coordinates — "two villages of this name; the collector's route says the
  // eastern one" is how you arrive at them — and sometimes instead of them,
  // when a locality can't be placed at all.
  const canSave = (parsed != null && radiusValid) || noteChanged;

  const save = () => {
    if (!canSave) return;
    if (!parsed) {
      onSaveNote(note);
      return;
    }
    if (!radiusValid) return;
    onSave({
      lat: parsed.lat,
      lon: parsed.lon,
      // A third number in the position box wins, since typing it there is the
      // more deliberate act of the two.
      uncertainty: parsed.uncertainty ?? typedRadius ?? undefined,
      note: note.trim(),
    });
  };

  // Enter saves from any of the three boxes: this is one answer in three
  // parts, not three fields to tab through.
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      className="pt-1 mt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-1"
      // MapLibre listens for keys on the container this panel is drawn in, so
      // typing "e" in here would otherwise pan the map east.
      onKeyDown={(e) => e.stopPropagation()}
      data-georeference-editor
    >
      <div className="flex items-center gap-1">
        <span className="text-violet-600 dark:text-violet-400">
          {mine ? "Your georeference" : "Georeference this record"}
        </span>
        {mine && onClear && (
          <button
            onClick={onClear}
            title="Drop your coordinates and go back to what GBIF published"
            className="ml-auto text-[10px] text-zinc-400 hover:text-red-600"
          >
            clear
          </button>
        )}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="lat, lon"
        title="Latitude, longitude in decimal degrees. A third number is read as the uncertainty radius in metres."
        aria-label="Coordinates"
        className={`w-full rounded border bg-white dark:bg-zinc-900 px-1 py-0.5 text-[11px] tabular-nums ${
          parsed || text.trim() === ""
            ? "border-violet-400 text-violet-700 dark:text-violet-300"
            : "border-red-400 text-red-600 dark:text-red-400"
        }`}
      />
      <div className="flex items-center gap-1">
        <span className="text-zinc-400 dark:text-zinc-500">±</span>
        <input
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={String(defaultRadius)}
          title="How far the true position could be from this one, in metres. A locality is an area; the radius is what says how big."
          aria-label="Uncertainty radius in metres"
          className={`w-16 rounded border bg-white dark:bg-zinc-900 px-1 py-0.5 text-[11px] text-right tabular-nums ${
            radiusValid
              ? "border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200"
              : "border-red-400 text-red-600 dark:text-red-400"
          }`}
        />
        <span className="text-zinc-400 dark:text-zinc-500">m</span>
        <button
          onClick={save}
          disabled={!canSave}
          title={
            parsed
              ? "Keep this position for the record"
              : noteChanged
                ? "Keep how you read this locality, without a position for it"
                : "Type a position as “lat, lon”, or just how you read the locality"
          }
          className="ml-auto px-1.5 py-0.5 rounded bg-violet-600 hover:bg-violet-700 disabled:opacity-30 disabled:hover:bg-violet-600 text-white text-[10px]"
        >
          Save
        </button>
      </div>
      {/* The reasoning, which is the part worth keeping: a georeference is an
          interpretation of a locality description, and the next person to open
          this — including you in six months — needs how you read it. */}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="why — how you read the locality"
        title="How you arrived at this position, in your words. Saved as the georeference's remarks."
        aria-label="Why — how you read the locality"
        className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300"
      />
    </div>
  );
}
