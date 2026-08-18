"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  commit as commitTo,
  historyLines,
  initHistory,
  jumpBack as jumpBackIn,
  redo as redoIn,
  redoLabel as redoLabelOf,
  undo as undoIn,
  undoLabel as undoLabelOf,
  type History,
} from "@/lib/edit-history";
import {
  loadExclusions,
  loadGeoreferences,
  saveExclusions,
  saveGeoreferences,
  type Exclusion,
  type Georeference,
} from "@/lib/georeferences";

/** Everything the assessor has added to a species, as one document. */
export interface AssessorEdits {
  georeferences: Record<number, Georeference>;
  exclusions: Record<number, Exclusion>;
}

/**
 * The assessor's edits, with undo and redo over them.
 *
 * Both stores move together through one history because the actions cross them.
 * Every write goes through `commit`, which is also the only place that persists
 * — so there's no path that changes the data without becoming undoable.
 *
 * The history itself is in memory, so a reload starts a fresh session. That's
 * deliberate: a snapshot of a few hundred records with the assessor's reasoning
 * attached runs to hundreds of kilobytes, and fifty of them would exhaust the
 * browser storage the data itself lives in.
 */
export function useAssessorEdits(
  speciesKey: string,
  options: { onStorageError?: () => void } = {}
) {
  const load = (key: string): AssessorEdits => ({
    georeferences: loadGeoreferences(key),
    exclusions: loadExclusions(key),
  });

  const [history, setHistory] = useState<History<AssessorEdits>>(() => initHistory(load(speciesKey)));
  const onStorageError = useRef(options.onStorageError);
  useEffect(() => {
    onStorageError.current = options.onStorageError;
  }, [options.onStorageError]);

  /**
   * A different species is a different document, not a further edit of this one.
   *
   * Adjusted during render rather than in an effect: an effect would paint one
   * frame of the previous species' georeferences over the new species' map, and
   * reading from storage is idempotent, so there's nothing to defer.
   */
  const [loadedFor, setLoadedFor] = useState(speciesKey);
  if (loadedFor !== speciesKey) {
    setLoadedFor(speciesKey);
    setHistory(initHistory(load(speciesKey)));
  }

  const persist = useCallback(
    (edits: AssessorEdits) => {
      // Both attempted, not short-circuited: if the georeferences don't fit,
      // the exclusions still might, and dropping them too would lose more than
      // the failure required.
      const savedGeoreferences = saveGeoreferences(speciesKey, edits.georeferences);
      const savedExclusions = saveExclusions(speciesKey, edits.exclusions);
      if (!savedGeoreferences || !savedExclusions) onStorageError.current?.();
    },
    [speciesKey]
  );

  /**
   * Records an edit. Takes whichever store changed; the other is carried over,
   * so a caller never has to restate what it isn't touching.
   */
  const commit = useCallback(
    (change: Partial<AssessorEdits>, label: string) => {
      setHistory((current) => {
        const next = { ...current.present.state, ...change };
        persist(next);
        return commitTo(current, next, label, new Date().toISOString());
      });
    },
    [persist]
  );

  const undo = useCallback(() => {
    setHistory((current) => {
      const next = undoIn(current);
      if (next !== current) persist(next.present.state);
      return next;
    });
  }, [persist]);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = redoIn(current);
      if (next !== current) persist(next.present.state);
      return next;
    });
  }, [persist]);

  const jumpBack = useCallback(
    (stepsBack: number) => {
      setHistory((current) => {
        const next = jumpBackIn(current, stepsBack - 1);
        if (next !== current) persist(next.present.state);
        return next;
      });
    },
    [persist]
  );

  /**
   * Cmd/Ctrl-Z, and shift for redo — but never while a field has focus. Undo in
   * a text box belongs to the text box; taking it would make the notes field
   * lose a sentence and a georeference at the same time.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const lines = useMemo(() => historyLines(history), [history]);

  return {
    georeferences: history.present.state.georeferences,
    exclusions: history.present.state.exclusions,
    commit,
    undo,
    redo,
    jumpBack,
    canUndo: canUndoOf(history),
    canRedo: canRedoOf(history),
    undoLabel: undoLabelOf(history),
    redoLabel: redoLabelOf(history),
    history: lines,
  };
}
