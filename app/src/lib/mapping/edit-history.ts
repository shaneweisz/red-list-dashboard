/**
 * Undo and redo over the assessor's own edits.
 *
 * Snapshots rather than commands-and-inverses. A species holds tens to a few
 * hundred records, so copying the whole document per edit is cheaper than
 * reasoning about how to invert each kind of change — and it's the reason this
 * stays small enough to trust.
 *
 * One history over both stores (georeferences and exclusions) rather than one
 * each: a single action crosses them — dropping a selection onto the record it
 * duplicates writes exclusions while the georeference it was dropped on stays —
 * and "undo" means the last thing the assessor did, not the last thing done to
 * a particular store.
 *
 * Labels are carried, not optional. The table can hide the very rows an edit
 * touched (the Included column's eye toggle), so an unlabelled undo would act
 * off-screen with nothing to say for itself.
 */

export interface Snapshot<T> {
  state: T;
  /** What produced this state. Null for the state as first loaded. */
  label: string | null;
  /** ISO timestamp, for the session list. Null as first loaded. */
  at: string | null;
}

export interface History<T> {
  present: Snapshot<T>;
  /** Earlier snapshots, most recent first. */
  past: Snapshot<T>[];
  /** Undone snapshots, next-to-redo first. */
  future: Snapshot<T>[];
}

/**
 * How far back it remembers. Deep enough to cover a working session's worth of
 * mistakes, shallow enough that the snapshots can't grow without bound — they
 * are held in memory only, and a georeference carries the assessor's reasoning,
 * which runs to paragraphs.
 */
export const HISTORY_LIMIT = 50;

export function initHistory<T>(state: T): History<T> {
  return { present: { state, label: null, at: null }, past: [], future: [] };
}

/** Records a new state, discarding anything that had been undone. */
export function commit<T>(
  history: History<T>,
  state: T,
  label: string,
  at: string,
  limit = HISTORY_LIMIT
): History<T> {
  return {
    present: { state, label, at },
    past: [history.present, ...history.past].slice(0, limit),
    // Redo is only meaningful as "the thing I just undid". A fresh edit makes
    // that branch unreachable, so keeping it would offer to reapply an edit the
    // assessor has since worked past.
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/** What undo would take back — the action that produced the current state. */
export function undoLabel<T>(history: History<T>): string | null {
  return canUndo(history) ? history.present.label : null;
}

/** What redo would put back. */
export function redoLabel<T>(history: History<T>): string | null {
  return history.future[0]?.label ?? null;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const [previous, ...rest] = history.past;
  return {
    present: previous,
    past: rest,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [next, ...rest] = history.future;
  return {
    present: next,
    past: [history.present, ...history.past],
    future: rest,
  };
}

/**
 * Goes back to a state in the list, which is undo applied until it's reached.
 *
 * `index` counts into `past`, so 0 is one step back. Everything skipped over
 * stays in `future`, in order, so redo walks forward through it.
 */
export function jumpBack<T>(history: History<T>, index: number): History<T> {
  if (index < 0 || index >= history.past.length) return history;
  let result = history;
  for (let i = 0; i <= index; i++) result = undo(result);
  return result;
}

export interface HistoryLine {
  label: string;
  at: string | null;
  /** Steps back from the present; 0 is the present itself. */
  stepsBack: number;
  /** True for entries that have been undone and could be redone. */
  undone: boolean;
}

/**
 * The session's edits, newest first, for showing as a list.
 *
 * Undone edits are included rather than hidden: having just pressed undo, the
 * thing you most want to see is what you took off.
 */
export function historyLines<T>(history: History<T>): HistoryLine[] {
  const lines: HistoryLine[] = [];
  history.future.forEach((entry) => {
    if (entry.label) lines.push({ label: entry.label, at: entry.at, stepsBack: -1, undone: true });
  });
  lines.reverse();
  if (history.present.label) {
    lines.push({ label: history.present.label, at: history.present.at, stepsBack: 0, undone: false });
  }
  history.past.forEach((entry, i) => {
    if (entry.label) lines.push({ label: entry.label, at: entry.at, stepsBack: i + 1, undone: false });
  });
  return lines;
}
